// REVISIÓN CONSOLIDADA LOCAL del dueño (bloques 1–3 + entregas pendientes sobre UNA sola composición). Solo local, datos sintéticos, nada sale de este equipo.
//   node revision.mjs preparar            UNA vez: base desde la cadena 327→343 + cuentas reales + semillas + foto para «restaurar». Se niega si ya está preparada.
//   node revision.mjs iniciar|detener     levanta/baja pila, correo de pruebas, API de correo simulada y app. NO borra ni recrea datos: el progreso se conserva.
//   node revision.mjs estado              qué está arriba
//   node revision.mjs navegador [ruta]    abre Edge con el perfil dedicado (cuentas guardadas; se elige la cuenta en el campo de correo)
//   node revision.mjs navegador-preparar  (re)siembra las cuentas en el perfil y comprueba que Edge rellena el login (cierra antes la ventana de revisión)
//   node revision.mjs respaldar           copia de seguridad (pg_dump + archivos) en la carpeta de revisión, sin parar nada
//   node revision.mjs restaurar --confirmar   ÚNICA forma de volver al estado inicial: DESCARTA el progreso (base y archivos) y reabre desde la foto. Sin --confirmar no hace nada.
// Ensayo sobre una COPIA desechable (nunca toca la base del dueño): REV_ENSAYO=1 node revision.mjs ensayo-crear|iniciar|detener|borrar  (mismos puertos: la base del dueño debe estar detenida).
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { lanzarPropio, detenerPropio } from "./procesos_propios.mjs";

const AQUI = import.meta.dirname;
const APP = path.resolve(AQUI, "../../..");
const CFG = path.join(process.env.LOCALAPPDATA, "dspacios-local-revision-consolidada");
const CFGM = CFG.replace(/\\/g, "/");
const PG = "pgrevc";
const BASE = "rev_consolidada_base";
const ENSAYO = process.env.REV_ENSAYO === "1";
const DB = ENSAYO ? "rev_consolidada_ensayo" : "rev_consolidada";
const FOTO = "rev_consolidada_foto";
const STORAGE = path.join(CFG, ENSAYO ? "storage_ensayo" : "storage");
const STORAGE_FOTO = path.join(CFG, "storage_foto");
const MAIL_DIR = path.join(CFG, ENSAYO ? "correo_ensayo" : "correo").split("\\").join("/");
const BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const EDGE = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p));
const cfg = () => JSON.parse(fs.readFileSync(path.join(CFG, "config.json"), "utf8"));
const estadoPath = path.join(CFG, "estado.json");
const estado = () => (fs.existsSync(estadoPath) ? JSON.parse(fs.readFileSync(estadoPath, "utf8")) : { preparado: false });
const guardarEstado = (e) => fs.writeFileSync(estadoPath, JSON.stringify({ ...estado(), ...e }, null, 2));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const fallo = (m) => { console.error("FALLÓ: " + m); process.exit(1); };

// Cuentas reales de la revisión (una sola contraseña, solo local). [alias, nombre, rol, tenant, aliado_id, activo]
export const CUENTAS = [
  ["superadmin", "Rev Superadmin", "superadmin", "mayorista", null, true],
  ["gerencia", "Rev Gerencia", "gerencia", "mayorista", null, true],
  ["administracion", "Rev Administracion", "administracion", "mayorista", null, true],
  ["operaciones", "Rev Operaciones", "operaciones", "mayorista", null, true],
  ["venta", "Rev Venta", "venta", "mayorista", null, true],
  ["venta2", "Rev Venta Dos", "venta", "mayorista", null, true],
  ["controlvuelo", "Rev Control de Vuelo", "control_vuelo", "mayorista", null, true],
  ["aliado", "Rev Agencia Aliada", "agencia", "mayorista", 9409, true],
  ["freelance", "Rev Freelance Aliado", "freelance", "mayorista", 8102, true],
  ["minorista", "Rev Minorista", "administracion", "minorista", null, true],
  ["inactivo", "Rev Cuenta Inactiva", "operaciones", "mayorista", null, false],
];
export const DOMINIO = "consolidada.test";
export const CLAVE = "Consolidada2026!";

function dk(args, opt = {}) { const r = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 1 << 28, ...opt }); return r; }
function psql(db, sql, { tolerar = false } = {}) {
  const r = spawnSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", PG, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0 && !tolerar) throw new Error(`SQL en ${db}: ${(r.stderr || r.stdout).slice(0, 600)}`);
  return (r.stdout ?? "").trim();
}
function pgCorriendo() { return dk(["inspect", "-f", "{{.State.Running}}", PG]).stdout.trim() === "true"; }
async function pgUp() {
  if (!pgCorriendo()) { const r = dk(["start", PG]); if (r.status !== 0) fallo(`no arranca ${PG} (¿Docker Desktop está abierto?): ${r.stderr}`); }
  for (let i = 0; i < 60; i++) { if (dk(["exec", PG, "pg_isready", "-U", "postgres", "-h", "127.0.0.1"]).status === 0) { await espera(2000); return; } await espera(1000); }
  fallo(`Postgres de ${PG} no queda listo en 60 s`);
}
const existeDb = (db) => psql("postgres", `select count(*) from pg_database where datname = '${db}'`) === "1";
const escuchando = (puerto) => new Promise((ok) => { const s = net.connect({ port: puerto, host: "127.0.0.1" }); s.on("connect", () => { s.destroy(); ok(true); }); s.on("error", () => ok(false)); });
const dirEscucha = (puerto) => spawnSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${puerto} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.LocalAddress } | Sort-Object -Unique) -join ','`], { encoding: "utf8" }).stdout.trim();

async function http(url, { esperado = 200, intentos = 30, cab = {} } = {}) {
  for (let i = 0; i < intentos; i++) { try { const r = await fetch(url, { headers: cab, signal: AbortSignal.timeout(4000) }); if (r.status === esperado) return true; } catch { /* aún no */ } await espera(2000); }
  return false;
}

// ── pila (GoTrue, PostgREST, Storage, Mailpit, gateway) ─────────────────────────────────────────────
async function pila(accion, vars = {}) {
  const logP = path.join(CFG, "pila.log"); fs.rmSync(logP, { force: true });
  const env = { ...process.env, ...vars };
  const cmd = `cd '${APP.replace(/\\/g, "/")}' && MSYS_NO_PATHCONV=1 bash supabase/scripts/revision_consolidada/pila_consolidada.sh ${accion} '${CFGM}' ${PG} ${BASE} > '${logP.replace(/\\/g, "/")}' 2>&1 < /dev/null`;
  const p = spawn(BASH, ["-lc", cmd], { env, windowsHide: true, stdio: "ignore" });
  const fin = accion === "subir" ? "pila consrev lista" : "pila consrev bajada";
  for (let i = 0; i < 150; i++) {
    if (fs.existsSync(logP) && fs.readFileSync(logP, "utf8").includes(fin)) return;
    if (p.exitCode !== null && p.exitCode !== 0) fallo(`pila.sh ${accion} terminó con código ${p.exitCode}:\n${cola(logP)}`);
    await espera(2000);
  }
  fallo(`pila.sh ${accion} no mostró «${fin}» en 300 s:\n${cola(logP)}`);
}
const cola = (f, n = 8) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").slice(-n).join("\n").replace(/eyJ[\w.-]+/g, "<jwt>") : "(sin log)");

// ── API de correo simulada (#103) y app compilada ───────────────────────────────────────────────────
const SIM_JS = path.join(APP, "supabase/scripts/hostinger_journey_103/mailapi_sim.mjs");
const BUZON = "ACwalk0000test1";
// RC-1: cada proceso propio deja un registro verificable (PID + hora de inicio + línea de comando) y SOLO se detiene si sigue siendo ese proceso. Nunca se mata por puerto.
const REG_APP = path.join(CFG, ENSAYO ? "app-ensayo.proceso.json" : "app.proceso.json");
const REG_SIM = path.join(CFG, ENSAYO ? "sim-ensayo.proceso.json" : "sim.proceso.json");
function iniciarSim(c) {
  if (!fs.existsSync(SIM_JS)) return;
  lanzarPropio(REG_SIM, { cwd: APP, log: path.join(CFG, "sim.log"), puerto: c.puertos.sim, ejecutable: process.execPath, args: [SIM_JS, String(c.puertos.sim), BUZON, c.journey.apiToken, path.join(CFG, ENSAYO ? "sim-state-ensayo.json" : "sim-state.json")] });
}
async function detenerProcesos(c) {
  for (const [nombre, reg, puerto] of [["app", REG_APP, c.puertos.app], ["simulador de correo", REG_SIM, c.puertos.sim]]) {
    const r = detenerPropio(reg); log(`  ${nombre}: ${r.estado} (${r.detalle})`);
    if (r.estado === "no-detenido") fallo(`${nombre} propio sigue vivo; no se continúa.`);
    if (await escuchando(puerto)) log(`  AVISO: el puerto ${puerto} sigue ocupado por un proceso que NO es propio; no se toca.`);
  }
}
function entornoApp(c) {
  const p = c.puertos;
  return {
    ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${p.gateway}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: c.anonKey, SUPABASE_SERVICE_ROLE_KEY: c.serviceKey, NEXT_PUBLIC_SITE_URL: `http://localhost:${p.app}`, CRON_SECRET: c.journey.cronSecret,
    SOLICITUD_PROVEEDOR_EMAIL: "captura", SOLICITUD_PROVEEDOR_CAPTURA_URL: `http://127.0.0.1:${p.correo}`, SOLICITUD_PROVEEDOR_REMITENTE: `solicitudes@${DOMINIO}`, SOLICITUD_PROVEEDOR_RESPONDER_A: `respuestas@${DOMINIO}`, SOLICITUD_PROVEEDOR_AVISO_EMAILS: `interno@${DOMINIO}`,
    SOLICITUD_PROVEEDOR_HOSTINGER: "activo", SOLICITUD_PROVEEDOR_HOSTINGER_WEBHOOK_SECRET: c.journey.webhookSecret, SOLICITUD_PROVEEDOR_HOSTINGER_TOKEN: c.journey.apiToken, SOLICITUD_PROVEEDOR_HOSTINGER_MAILBOX_ID: BUZON, SOLICITUD_PROVEEDOR_HOSTINGER_API_URL: `http://127.0.0.1:${p.sim}`,
    NODE_OPTIONS: "--max-old-space-size=1024",
  };
}
function iniciarApp(c) {
  lanzarPropio(REG_APP, { cwd: APP, log: path.join(CFG, "app.log"), puerto: c.puertos.app, ejecutable: process.execPath, args: ["node_modules/next/dist/bin/next", "start", "-p", String(c.puertos.app), "-H", "127.0.0.1"], env: entornoApp(c) });
}
function huellaBuild() { const f = path.join(APP, ".next", "BUILD_ID"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : null; }

// ── cuentas reales ──────────────────────────────────────────────────────────────────────────────────
async function crearCuentas(c) {
  const gw = `http://127.0.0.1:${c.puertos.gateway}`; const ids = {};
  for (const [alias, nombre] of CUENTAS) {
    const email = `${alias}@${DOMINIO}`;
    let id = psql(DB, `select id from auth.users where email = '${email}'`);
    if (!id) {
      const r = await fetch(`${gw}/auth/v1/admin/users`, { method: "POST", headers: { apikey: c.serviceKey, authorization: `Bearer ${c.serviceKey}`, "content-type": "application/json" }, body: JSON.stringify({ email, password: CLAVE, email_confirm: true, user_metadata: { nombre } }) });
      const j = await r.json(); if (!j.id) fallo(`no se creó ${email}: ${JSON.stringify(j).slice(0, 300)}`); id = j.id;
    }
    ids[alias] = id;
  }
  return ids;
}
function fijarPerfiles() {   // tras las semillas (las fichas de aliado ya existen)
  const filas = CUENTAS.map(([alias, nombre, rol, tenant, aliado, activo]) => `((select id from auth.users where email = '${alias}@${DOMINIO}'), '${alias}@${DOMINIO}', '${nombre}', '${rol}', ${activo}, '${tenant}', ${aliado ?? "null"})`).join(",\n");
  psql(DB, `insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values ${filas}
    on conflict (id) do update set email = excluded.email, nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant, aliado_id = excluded.aliado_id;`);
}
function escribirCredenciales(c) {
  const l = [`REVISIÓN CONSOLIDADA — cuentas sintéticas (solo este equipo). Contraseña de TODAS: ${CLAVE}`, `Aplicación: http://localhost:${c.puertos.app}/login   ·   Correo de pruebas (nada sale de este equipo): http://127.0.0.1:${c.puertos.correo}`, ""];
  for (const [alias, nombre, rol, tenant, aliado, activo] of CUENTAS) l.push(`${(alias + "@" + DOMINIO).padEnd(36)} ${rol.padEnd(15)} ${tenant.padEnd(10)} ${nombre}${aliado ? ` (ficha de aliado ${aliado})` : ""}${activo ? "" : " — CUENTA DESACTIVADA (prueba de acceso denegado)"}`);
  fs.writeFileSync(path.join(CFG, "credenciales.txt"), l.join("\r\n") + "\r\n");
}

// ── semillas ────────────────────────────────────────────────────────────────────────────────────────
function aplicarSemillas(sub = "") {
  const dir = path.join(AQUI, "semillas", sub); if (!fs.existsSync(dir)) return;
  const archivos = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of archivos) {
    const r = spawnSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", PG, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-v", "ON_ERROR_STOP=1"], { input: fs.readFileSync(path.join(dir, f), "utf8"), encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.status !== 0) fallo(`semilla ${f}: ${(r.stderr || r.stdout).split("\n").filter((x) => /ERROR|DETAIL|LINE/.test(x)).slice(0, 5).join(" | ")}`);
    log(`  semilla aplicada: ${f}`);
  }
}

const COMANDOS = {
  async preparar() {
    if (estado().preparado) {
      if (estado().entregado) fallo("la revisión ya fue ENTREGADA al dueño: preparar NO vuelve a sembrar sobre su progreso. Para volver al estado inicial usa «restaurar --confirmar».");
      if (!process.argv.includes("--rehacer")) fallo("la revisión ya está preparada (aún sin entregar): usa «preparar --rehacer» para reconstruirla desde la cadena y las semillas.");
      await pgUp(); psql("postgres", `select pg_terminate_backend(pid) from pg_stat_activity where datname in ('${DB}', '${FOTO}') and pid <> pg_backend_pid()`); psql("postgres", `drop database if exists ${DB} with (force)`); psql("postgres", `drop database if exists ${FOTO} with (force)`); fs.rmSync(STORAGE, { recursive: true, force: true }); guardarEstado({ preparado: false });
      for (const [alias] of CUENTAS) { /* las cuentas viven en la base: se recrean con ella */ void alias; }
    }
    const c = cfg(); await pgUp();
    if (!existeDb(BASE)) fallo(`falta ${BASE} (la cadena 327→343 cargada en ${PG}).`);
    if (existeDb(DB)) fallo(`ya existe la base ${DB}; no se recrea.`);
    log("== base desde la cadena aplicada"); psql("postgres", `create database ${DB} template ${BASE}`);
    fs.mkdirSync(STORAGE, { recursive: true });
    log("== pila (para crear las cuentas por GoTrue)"); await pila("subir", { PILA_DB: DB, PILA_SIN_MIGRACIONES: "1", PILA_STORAGE_DIR: STORAGE.replace(/\\/g, "/"), PILA_MAIL_DIR: MAIL_DIR, PILA_OTP_EXP: "600" });
    log("== cuentas reales"); await crearCuentas(c);
    log("== semillas"); aplicarSemillas();
    log("== perfiles de las cuentas"); fijarPerfiles();
    log("== semillas posteriores a los perfiles"); aplicarSemillas("tras_perfiles");
    if (fs.existsSync(path.join(AQUI, "semillas", "post", "post_semillas.sql"))) { psql(DB, fs.readFileSync(path.join(AQUI, "semillas", "post", "post_semillas.sql"), "utf8")); log("  post_semillas aplicado"); }
    escribirCredenciales(c);
    await pila("bajar", { PILA_DB: DB });
    log("== foto para «restaurar»"); psql("postgres", `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${DB}' and pid <> pg_backend_pid()`);
    psql("postgres", `create database ${FOTO} template ${DB}`); fs.rmSync(STORAGE_FOTO, { recursive: true, force: true }); fs.cpSync(STORAGE, STORAGE_FOTO, { recursive: true });
    guardarEstado({ preparado: true, preparadoEn: new Date().toISOString() });
    log(`Preparada. Credenciales: ${path.join(CFG, "credenciales.txt")}. Para empezar: node revision.mjs iniciar (nada está arriba ahora).`);
  },
  async iniciar() {
    if (!ENSAYO && !estado().preparado) fallo("la revisión no está preparada: ejecuta «preparar» una vez.");
    const c = cfg(); if (!huellaBuild()) fallo(`no hay build de producción en ${APP}\\.next`);
    for (const pto of [c.puertos.app, c.puertos.gateway, c.puertos.sim]) if (await escuchando(pto)) fallo(`el puerto ${pto} ya está ocupado (¿otra revisión arriba?). Detenla antes; no se mata nada ajeno.`);
    await pgUp(); if (!existeDb(DB)) fallo(`no existe la base ${DB}`);
    fs.mkdirSync(STORAGE, { recursive: true });
    await pila("subir", { PILA_DB: DB, PILA_SIN_MIGRACIONES: "1", PILA_STORAGE_DIR: STORAGE.replace(/\\/g, "/"), PILA_MAIL_DIR: MAIL_DIR, PILA_OTP_EXP: "600" });
    const gw = `http://127.0.0.1:${c.puertos.gateway}`;
    if (!(await http(`${gw}/auth/v1/health`, { cab: { apikey: c.anonKey }, intentos: 15 }))) fallo("GoTrue no responde 200");
    if (!(await http(`${gw}/rest/v1/`, { cab: { apikey: c.anonKey, authorization: `Bearer ${c.anonKey}` }, intentos: 15 }))) fallo("PostgREST no responde 200");
    if (!(await http(`http://127.0.0.1:${c.puertos.correo}/`, { intentos: 10 }))) fallo("el correo de pruebas (Mailpit) no responde");
    iniciarSim(c); iniciarApp(c);
    if (!(await http(`http://localhost:${c.puertos.app}/login`, { intentos: 40 }))) fallo(`la app no responde 200 en /login:\n${cola(path.join(CFG, "app.log"))}`);
    const dir = dirEscucha(c.puertos.app); if (dir !== "127.0.0.1") fallo(`la app debe escuchar SOLO en 127.0.0.1 y escucha en: ${dir}`);
    log(`Lista${ENSAYO ? " (ENSAYO sobre copia)" : ""}: http://localhost:${c.puertos.app}/login (abre SIEMPRE «localhost», no 127.0.0.1) · correo de pruebas http://127.0.0.1:${c.puertos.correo} · build ${huellaBuild()}`);
  },
  async detener() {
    const c = cfg(); await detenerProcesos(c);
    await pila("bajar", { PILA_DB: DB }); dk(["stop", PG]);
    log("Detenido. Bases, archivos, cuentas y perfil del navegador se conservan.");
  },
  async estado() {
    const c = cfg(); const e = estado();
    log(`preparada: ${e.preparado ? "sí (" + e.preparadoEn + ")" : "no"} · build: ${huellaBuild()} · base activa: ${DB}`);
    log(`app :${c.puertos.app} ${(await escuchando(c.puertos.app)) ? "ARRIBA (" + dirEscucha(c.puertos.app) + ")" : "abajo"} · gateway :${c.puertos.gateway} ${(await escuchando(c.puertos.gateway)) ? "arriba" : "abajo"} · correo :${c.puertos.correo} ${(await escuchando(c.puertos.correo)) ? "arriba" : "abajo"} · postgres ${PG}: ${pgCorriendo() ? "arriba" : "detenido"}`);
  },
  async respaldar() {
    await pgUp(); const sello = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13); const dir = path.join(CFG, "respaldos"); fs.mkdirSync(dir, { recursive: true });
    const dump = path.join(dir, `${DB}_${sello}.dump`); const r = spawnSync("docker", ["exec", "-e", "PGPASSWORD=postgres", PG, "pg_dump", "-h", "127.0.0.1", "-U", "supabase_admin", "-Fc", DB], { maxBuffer: 1 << 30 });
    if (r.status !== 0) fallo("pg_dump falló"); fs.writeFileSync(dump, r.stdout); fs.cpSync(STORAGE, path.join(dir, `storage_${DB}_${sello}`), { recursive: true });
    log(`Respaldo: ${dump} (+ archivos)`);
  },
  async restaurar() {
    if (ENSAYO) fallo("restaurar no aplica al ensayo: usa ensayo-borrar y ensayo-crear.");
    if (!process.argv.includes("--confirmar")) fallo("restaurar DESCARTA todo el progreso de la revisión (base y archivos). Repite con --confirmar si es lo que quieres.");
    const c = cfg(); await detenerProcesos(c); await pila("bajar", { PILA_DB: DB }); await pgUp();
    if (!existeDb(FOTO)) fallo(`no existe la foto ${FOTO}`);
    psql("postgres", `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${DB}' and pid <> pg_backend_pid()`);
    psql("postgres", `drop database if exists ${DB} with (force)`); psql("postgres", `create database ${DB} template ${FOTO}`);
    fs.rmSync(STORAGE, { recursive: true, force: true }); fs.cpSync(STORAGE_FOTO, STORAGE, { recursive: true });
    log("Revisión restaurada al estado inicial. Ejecuta «iniciar».");
  },
  async "ensayo-crear"() {
    if (!ENSAYO) fallo("usa REV_ENSAYO=1 para el ensayo"); await pgUp();
    if (!existeDb(FOTO)) fallo("no existe la foto de la revisión preparada");
    psql("postgres", `drop database if exists ${DB} with (force)`); psql("postgres", `create database ${DB} template ${FOTO}`);
    fs.rmSync(STORAGE, { recursive: true, force: true }); fs.cpSync(STORAGE_FOTO, STORAGE, { recursive: true }); fs.rmSync(MAIL_DIR, { recursive: true, force: true }); fs.rmSync(path.join(CFG, "sim-state-ensayo.json"), { force: true }); log(`Copia de ensayo creada: ${DB} (desde la foto; la base del dueño no se toca).`);
  },
  async "ensayo-iniciar"() { if (!ENSAYO) fallo("usa REV_ENSAYO=1"); return COMANDOS.iniciar(); },
  async "ensayo-detener"() { if (!ENSAYO) fallo("usa REV_ENSAYO=1"); return COMANDOS.detener(); },
  async "ensayo-borrar"() { if (!ENSAYO) fallo("usa REV_ENSAYO=1"); await pgUp(); psql("postgres", `drop database if exists ${DB} with (force)`); fs.rmSync(STORAGE, { recursive: true, force: true }); fs.rmSync(MAIL_DIR, { recursive: true, force: true }); log("Copia de ensayo borrada."); },
  async navegador() {
    const c = cfg(); const ruta = process.argv[3] ?? "/login"; const perfil = path.join(CFG, "edge-perfil");
    if (!EDGE) fallo("no encuentro Microsoft Edge"); if (!fs.existsSync(path.join(perfil, "Default", "Login Data"))) fallo("el perfil de revisión no está preparado: ejecuta «navegador-preparar»");
    spawn(EDGE, [`--user-data-dir=${perfil}`, "--no-first-run", "--no-default-browser-check", "--new-window", `http://localhost:${c.puertos.app}${ruta}`], { detached: true, stdio: "ignore" }).unref();
    log(`Edge (perfil de revisión) abierto en http://localhost:${c.puertos.app}${ruta}: elige la cuenta en la lista del campo de correo.`);
  },
  async "navegador-preparar"() {
    const r = spawnSync(process.execPath, [path.join(AQUI, "preparar_navegador.mjs"), ...process.argv.slice(3)], { cwd: APP, stdio: "inherit" }); process.exit(r.status ?? 1);
  },
};

const cmd = process.argv[2];
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("revision.mjs")) {
  if (!COMANDOS[cmd]) fallo(`uso: node revision.mjs ${Object.keys(COMANDOS).join("|")}`);
  try { await COMANDOS[cmd](); } catch (e) { fallo(String(e.message ?? e)); }
}
