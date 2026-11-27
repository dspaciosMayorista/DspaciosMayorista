// Hostinger journey harness (#103) — shared helpers. LOCAL ONLY: loopback listeners, a disposable Postgres database, synthetic data. Windows (PowerShell) process inspection.
// Nothing here reads a real secret: credentials are generated per work folder OUTSIDE the repository (see `init` in harness.mjs).
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(AQUI, "../../..");                         // the app folder (dspacios-travel)
export const MARCA_BD = "hostinger-journey-103 disposable";                  // database comment that marks a database as created (and therefore resettable) by this harness
export const ETIQUETA = "hostinger-journey-103";                             // docker label of every resource this harness creates
export const ETIQUETA_PG = "hostinger-journey-103.pg";                       // …and, with value «dedicated», of the ONE PostgreSQL container it may mutate
export const PG_PROPIO = "hj103_pg", PLANTILLA_PROPIA = "hj103_template";    // the dedicated container and the template database inside it
export const BUZON = "ACwalk0000test1";
const LEGADO = { webhookSecret: "walk-hostinger-webhook-secret", cronSecret: "walk-cron-secret", apiToken: "walk-api-token-not-real" };   // synthetic values of config folders created before `init` generated them

/** Local settings. The PostgreSQL container the harness MUTATES is not a free setting: it is always the dedicated container it creates itself (`pg-create`).
 *  HJ_SOURCE_PG_CONTAINER / HJ_SOURCE_TEMPLATE_DB name an existing container + template database that are only READ (pg_dump) to seed the dedicated container. */
export function ajustes(env = process.env) {
  const work = path.resolve(env.HJ_WORK || path.join(os.tmpdir(), "hostinger-journey-103")), reg = leerRegistroPg(work), pedido = env.HJ_PG_CONTAINER || "", propio = !pedido || pedido === PG_PROPIO;
  return {
    work, pg: propio ? PG_PROPIO : pedido, pgUser: "supabase_admin", pgPass: propio ? (reg?.password ?? "") : (env.HJ_PG_PASSWORD || ""),   // an explicit foreign container is only ever REFUSED (see exigirContenedorPropio)
    plantilla: PLANTILLA_PROPIA, db: env.HJ_DB || "hj103_journey", appPort: env.HJ_APP_PORT ? Number(env.HJ_APP_PORT) : null,
    fuente: env.HJ_SOURCE_PG_CONTAINER || "", fuentePlantilla: env.HJ_SOURCE_TEMPLATE_DB || "", fuentePass: env.HJ_SOURCE_PG_PASSWORD || "postgres", imagen: env.HJ_PG_IMAGE || "public.ecr.aws/supabase/postgres:15.8.1.085",
  };
}
export const leerRegistroPg = (work) => { try { return JSON.parse(fs.readFileSync(path.join(work, "pg.json"), "utf8")); } catch { return null; } };
export const requerir = (cond, msg) => { if (!cond) throw new Error(msg); };

// ── work folder / generated local credentials ──
function raizGit() { try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: AQUI, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } }
export function exigirTrabajoFueraDelRepo(work) {
  const top = raizGit(), w = path.resolve(work).toLowerCase().replace(/\\/g, "/");
  for (const r of [top ? path.resolve(top) : null, path.resolve(RAIZ)].filter(Boolean)) { const rr = r.toLowerCase().replace(/\\/g, "/"); requerir(w !== rr && !w.startsWith(rr + "/"), `HJ_WORK (${work}) is inside the repository: generated credentials must live OUTSIDE tracked folders.`); }
}
export function iniciarConfig(a) {
  exigirTrabajoFueraDelRepo(a.work); fs.mkdirSync(path.join(a.work, "procs"), { recursive: true });
  const f = path.join(a.work, "config.json");
  if (!fs.existsSync(f)) {
    const secreto = "local-hj-" + randomBytes(24).toString("hex"), b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const firmar = (p) => { const h = b({ alg: "HS256", typ: "JWT" }), c = b(p); return `${h}.${c}.${createHmac("sha256", secreto).update(`${h}.${c}`).digest("base64url")}`; };
    fs.writeFileSync(f, JSON.stringify({
      jwtSecret: secreto, anonKey: firmar({ role: "anon", iss: "local-hj", exp: 4102444800 }), serviceKey: firmar({ role: "service_role", iss: "local-hj", exp: 4102444800 }), rolesPassword: "r" + randomBytes(12).toString("hex"),
      puertos: { gateway: 19080, auth: 19081, rest: 19082, correo: 19083, app: 3047, sim: 19086, storage: 19084 },
      journey: { webhookSecret: randomBytes(18).toString("hex"), cronSecret: randomBytes(18).toString("hex"), apiToken: randomBytes(18).toString("hex") },
    }, null, 2), { mode: 0o600 });
  }
  return cargarConfig(a);
}
export function cargarConfig(a) {
  exigirTrabajoFueraDelRepo(a.work);
  const f = path.join(a.work, "config.json"); requerir(fs.existsSync(f), `No config at ${f}. Run: node harness.mjs init`);
  const c = JSON.parse(fs.readFileSync(f, "utf8"));
  c.puertos = { sim: 19086, storage: 19084, ...c.puertos }; c.journey = { ...LEGADO, ...(c.journey ?? {}) };
  return c;
}

// ── PostgreSQL container ownership: roles and passwords are CLUSTER-wide, so a database marker cannot protect other databases of a shared container ──
const dockerInspect = (nombre) => { try { return JSON.parse(execFileSync("docker", ["inspect", nombre], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0] ?? null; } catch { return null; } };
let _propioValidado = null;
/** Throws unless the container is THE dedicated one this work folder created: fixed name, full container id equal to the ownership record written at creation (an existing container cannot acquire that id),
 *  the harness labels, running, and — defence in depth — no database in the cluster other than harness databases. Runs before ANY template/database/role mutation (every psql call goes through it). */
export function exigirContenedorPropio(a, { sinSql = false, parado = false } = {}) {
  const clave = `${a.work}|${a.pg}|${sinSql}|${parado}`; if (_propioValidado === clave) return;
  requerir(a.pg === PG_PROPIO, `Refused: «${a.pg}» is not the harness-owned PostgreSQL container (${PG_PROPIO}). The harness mutates ONLY a dedicated container it created itself (node harness.mjs pg-create); nothing was touched.`);
  const reg = leerRegistroPg(a.work); requerir(reg?.id, "Refused: this work folder has no ownership record for a harness PostgreSQL container. Run: node harness.mjs pg-create (nothing was touched).");
  const info = dockerInspect(a.pg); requerir(info, `Refused: container ${a.pg} does not exist (nothing was touched).`);
  requerir(info.Id === reg.id, `Refused: container ${a.pg} is not the one this work folder created (container id differs from the ownership record); nothing was touched.`);
  requerir(info.Config?.Labels?.[ETIQUETA] === "1" && info.Config?.Labels?.[ETIQUETA_PG] === "dedicated", `Refused: container ${a.pg} lacks the harness ownership labels; nothing was touched.`);
  if (!parado) requerir(info.State?.Running, `Refused: container ${a.pg} is not running.`);
  if (!sinSql && !parado) {
    const foraneas = psqlCrudo(a, "postgres", "select coalesce(string_agg(datname, ','), '') from pg_database where datname not in ('postgres', 'template0', 'template1') and datname !~ '^hj103_'");
    requerir(foraneas === "", `Refused: the dedicated container holds non-harness databases (${foraneas}); the harness will not change cluster-wide roles there.`);
  }
  _propioValidado = clave;
}
function psqlCrudo(a, db, sql, { input = false } = {}) {
  const args = ["exec", "-i", "-e", `PGPASSWORD=${a.pgPass}`, a.pg, "psql", "-h", "127.0.0.1", "-U", a.pgUser, "-d", db, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"];
  return input ? execFileSync("docker", args, { input: sql, encoding: "utf8" }).trim() : execFileSync("docker", [...args, "-c", sql], { encoding: "utf8" }).trim();
}
/** The ONLY way the harness runs SQL in the cluster it mutates: ownership is verified first, on every entry point. */
export function psql(a, db, sql, opts = {}) { exigirContenedorPropio(a); return psqlCrudo(a, db, sql, opts); }

// ── database: every destructive statement goes through a validated, harness-created, disposable database ──
const literal = (s) => `'${String(s).replace(/'/g, "''")}'`;
export function nombreBdValido(db) { return /^hj103_[a-z0-9_]{1,40}$/.test(db); }
/** Throws unless `a.db` is a database THIS HARNESS created (name pattern + marker comment). Returns false if it does not exist at all. */
export function validarBdDesechable(a, { puedeNoExistir = false } = {}) {
  requerir(nombreBdValido(a.db), `Refused: database name «${a.db}» is not a harness database (must match hj103_[a-z0-9_]+).`);
  const fila = psql(a, "postgres", `select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = ${literal(a.db)}`);
  const existe = psql(a, "postgres", `select count(*) from pg_database where datname = ${literal(a.db)}`) === "1";
  if (!existe) { requerir(puedeNoExistir, `Database ${a.db} does not exist. Run: node harness.mjs up`); return false; }
  requerir(fila === MARCA_BD, `Refused: database ${a.db} exists but is NOT marked as a disposable harness database (comment ≠ «${MARCA_BD}»). Nothing was changed.`);
  return true;
}
/** SQL runner bound to a VALIDATED disposable database (validated once, when created). */
export function sqlDesechable(a) { validarBdDesechable(a); return (q) => psql(a, a.db, q); }
export function crearBdDesechable(a) {
    requerir(nombreBdValido(a.db) && a.db !== a.plantilla, `Refused: invalid target database «${a.db}».`);
  requerir(psql(a, "postgres", `select count(*) from pg_database where datname = ${literal(a.plantilla)}`) === "1", `Template database ${a.plantilla} not found in ${a.pg}. Run: node harness.mjs pg-create`);
  if (validarBdDesechable(a, { puedeNoExistir: true })) psql(a, "postgres", `drop database ${a.db} with (force)`);   // only a marked harness database is ever dropped
  let ok = false;
  for (let i = 0; i < 5 && !ok; i++) {
    psql(a, "postgres", `select pg_terminate_backend(pid) from pg_stat_activity where datname = ${literal(a.plantilla)} and pid <> pg_backend_pid()`);
    try { psql(a, "postgres", `create database ${a.db} template ${a.plantilla}`); ok = true; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000); }
  }
  requerir(ok, "Could not copy the template database.");
  psql(a, "postgres", `comment on database ${a.db} is ${literal(MARCA_BD)}`);
}

// ── process inspection (Windows) ──
const ps = (cmd) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8" }).trim();
export function infoProceso(pid) {
  const o = ps(`$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if ($p) { [pscustomobject]@{ pid = [int]$p.ProcessId; creado = $p.CreationDate.ToUniversalTime().ToString('o'); cmd = [string]$p.CommandLine } | ConvertTo-Json -Compress }`);
  return o ? JSON.parse(o) : null;
}
export function descendientes(pid) {
  const o = ps("ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ p = [int]$_.ProcessId; pp = [int]$_.ParentProcessId } }) -Compress");
  const todos = JSON.parse(o), vistos = new Set([pid]); let cambio = true;
  while (cambio) { cambio = false; for (const x of todos) if (vistos.has(x.pp) && !vistos.has(x.p)) { vistos.add(x.p); cambio = true; } }
  return vistos;
}
export function escuchas(puerto) {
  const o = ps(`ConvertTo-Json -InputObject @(Get-NetTCPConnection -LocalPort ${Number(puerto)} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ dir = [string]$_.LocalAddress; pid = [int]$_.OwningProcess } }) -Compress`);
  return JSON.parse(o || "[]");
}
const pausa = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ── ownership-verified process control ──
const regFile = (a, nombre) => path.join(a.work, "procs", `${nombre}.json`);
const leerReg = (a, n) => { try { return JSON.parse(fs.readFileSync(regFile(a, n), "utf8")); } catch { return null; } };
/** A record proves ownership ONLY while the live process has the same start time and a command line containing the launcher's marker (protects against PID reuse). */
export function verificarPropio(a, nombre) {
  const rec = leerReg(a, nombre); if (!rec) return { estado: "sin-registro" };
  const info = infoProceso(rec.pid); if (!info) return { estado: "muerto", rec };
  if (info.creado !== rec.creado) return { estado: "otro-proceso", rec, motivo: `start time differs (record ${rec.creado}, live ${info.creado})` };
  if (!String(info.cmd ?? "").toLowerCase().includes(String(rec.marcador).toLowerCase())) return { estado: "otro-proceso", rec, motivo: "command line does not contain the launcher marker" };
  return { estado: "propio", rec, info };
}
export function iniciarPropio(a, { nombre, cmd, args, env, puerto, marcador, log, cwd = RAIZ, esperarMs = 60_000 }) {
  fs.mkdirSync(path.join(a.work, "procs"), { recursive: true });
  const v = verificarPropio(a, nombre);
  requerir(v.estado !== "propio", `${nombre} is already running (pid ${v.rec?.pid}). Stop it first (node harness.mjs ${nombre === "app" ? "app-restart" : "down"}).`);
  if (v.estado === "muerto" || v.estado === "otro-proceso") fs.rmSync(regFile(a, nombre), { force: true });      // stale record: forgotten, the process (if any) is NOT touched
  const ocupantes = escuchas(puerto);
  requerir(!ocupantes.length, `Refused: port ${puerto} is already in use by pid ${[...new Set(ocupantes.map((o) => o.pid))].join(",")} — not ours, left untouched.`);
  const fd = fs.openSync(log, "a");
  const hijo = spawn(cmd, args, { env, cwd, detached: true, windowsHide: true, stdio: ["ignore", fd, fd] }); hijo.unref();
  let info = null; for (let i = 0; i < 20 && !info; i++) { info = infoProceso(hijo.pid); if (!info) pausa(250); }
  requerir(info, `${nombre}: the process did not appear.`);
  fs.writeFileSync(regFile(a, nombre), JSON.stringify({ nombre, pid: hijo.pid, creado: info.creado, marcador, puerto }));
  const t0 = Date.now(); let propios = null;
  while (Date.now() - t0 < esperarMs) {
    const l = escuchas(puerto);
    if (l.length) { propios = l; break; }
    if (!infoProceso(hijo.pid)) break; pausa(500);
  }
  const falla = (m) => { detenerPropio(a, nombre); throw new Error(`${nombre}: ${m} (see ${log})`); };
  if (!propios) falla("did not start listening");
  const dueños = descendientes(hijo.pid);
  if (!propios.every((l) => dueños.has(l.pid))) falla(`the listener on ${puerto} is not the process this launcher started`);
  return { pid: hijo.pid, escuchas: propios };
}
export function detenerPropio(a, nombre) {
  const v = verificarPropio(a, nombre);
  if (v.estado === "sin-registro") return { estado: "sin-registro", detalle: "no record: nothing owned by this launcher, nothing stopped" };
  if (v.estado === "muerto") { fs.rmSync(regFile(a, nombre), { force: true }); return { estado: "ya-detenido" }; }
  if (v.estado === "otro-proceso") { fs.rmSync(regFile(a, nombre), { force: true }); return { estado: "rechazado", detalle: `pid ${v.rec.pid} is NOT the process this launcher started (${v.motivo}); left untouched, stale record removed` }; }
  try { execFileSync("taskkill", ["/PID", String(v.rec.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* already gone */ }
  for (let i = 0; i < 20 && infoProceso(v.rec.pid); i++) pausa(250);
  fs.rmSync(regFile(a, nombre), { force: true });
  return { estado: "detenido", pid: v.rec.pid };
}

// ── loopback proof ──
export function interfacesExternas() { return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address); }
export function probarConexion(host, puerto, ms = 1500) {
  return new Promise((res) => { const s = net.connect({ host, port: puerto, timeout: ms }); s.once("connect", () => { s.destroy(); res(true); }); s.once("timeout", () => { s.destroy(); res(false); }); s.once("error", () => res(false)); });
}
/** Returns {soloLoopback, direcciones, externasAlcanzables}. Loopback only = every listener is 127.0.0.1 AND no non-loopback address of this machine accepts a connection. */
export async function comprobarSoloLoopback(puerto) {
  const l = escuchas(puerto), direcciones = [...new Set(l.map((x) => x.dir))];
  const externas = []; for (const ip of interfacesExternas()) if (await probarConexion(ip, puerto)) externas.push(ip);
  return { soloLoopback: l.length > 0 && direcciones.every((d) => d === "127.0.0.1") && externas.length === 0, direcciones, externasAlcanzables: externas };
}

/** Password of every synthetic review/seed account: derived from the work folder's generated config (never stored in the repository). */
export const contrasenaRevision = (cfg) => "Hj" + Buffer.from(cfg.rolesPassword).toString("hex").slice(0, 14) + "!";

// ── owner review session settings (shared by review.mjs, review_reply.mjs, seed_review.mjs, review_browser.mjs: ONE place, so every entry point reads the same folder) ──
export const DIR_REVISION_POR_DEFECTO = path.join(os.homedir(), "hostinger-review-103");
/** Review settings: the review folder comes from HJ_REVIEW_DIR (or HJ_WORK), default %USERPROFILE%\hostinger-review-103; the read-only schema source defaults to the executor's template container. */
export function ajustesRevision(env = process.env) {
  return ajustes({ ...env, HJ_WORK: env.HJ_WORK || env.HJ_REVIEW_DIR || DIR_REVISION_POR_DEFECTO, HJ_SOURCE_PG_CONTAINER: env.HJ_SOURCE_PG_CONTAINER || "pg127", HJ_SOURCE_TEMPLATE_DB: env.HJ_SOURCE_TEMPLATE_DB || "plantilla127" });
}
const archivoEstadoRevision = (a) => path.join(a.work, "review-state.json");
export const leerEstadoRevision = (a) => { try { return JSON.parse(fs.readFileSync(archivoEstadoRevision(a), "utf8")); } catch { return {}; } };
export const guardarEstadoRevision = (a, parcial) => { fs.mkdirSync(a.work, { recursive: true }); fs.writeFileSync(archivoEstadoRevision(a), JSON.stringify({ ...leerEstadoRevision(a), ...parcial }, null, 2)); };
/** Review progress (the seeded database, uploaded files, captured mail) is never discarded by ordinary commands: once the review data is seeded, up/down/pg-destroy refuse unless the operation is explicitly confirmed. */
export function exigirConfirmacionDestruccion(a, que) {
  if (leerEstadoRevision(a).seeded && process.env.HJ_CONFIRM_DESTROY !== "yes") throw new Error(`Refused: «${que}» would DESTROY the owner's review progress (database, uploaded files, captured mail). Use the explicit command: node review.mjs reset --destroy-review-data (owner-authorized only). Normal stop/start never destroys anything.`);
}

/** Writes (or refreshes) the plain-text credentials sheet of the synthetic review accounts INSIDE the review folder (outside the repository). Synthetic, local, disposable. */
export function escribirCredenciales(a, cfg) {
  const pass = contrasenaRevision(cfg), app = `http://127.0.0.1:${a.appPort ?? cfg.puertos.app}`;
  const txt = `REVIEW CREDENTIALS — D'spacios Travel · block #103 (synthetic, local, disposable)
=========================================================================
This file lives OUTSIDE the repository (${a.work}). It protects nothing real: every account below exists only inside the local review environment.

Address (only while the review session is running; only this computer can open it)
  Application ........ ${app}/login
  Captured outgoing mail (Mailpit, nothing is really sent) ... http://127.0.0.1:${cfg.puertos.correo}

Accounts (all four share the same password)
  Password ........... ${pass}
  admin103@walk.test ... role administracion  -> hotel page, contract requests, payment notices
  ops103@walk.test ..... role operaciones     -> payment notices, hotel page
  sup103@walk.test ..... role superadmin      -> everything
  venta103@walk.test ... role venta           -> shows what a sales advisor can NOT reach

Saved-account browser (no typing): node review.mjs browser            (opens Edge with the dedicated review profile; click the e-mail field and pick the account)
                                   node review.mjs browser ops103      (the same, with that account proposed first)

Session control (folder supabase\\scripts\\hostinger_journey_103 of the worktree .worktrees\\hotel-cal-103\\dspacios-travel; nothing runs until you ask)
  node review.mjs start      first time ~3-4 min; afterwards it RESUMES exactly where you left off
  node review.mjs stop       stops everything and DELETES NOTHING (your review progress is kept)
  node review.mjs status
  node review.mjs reply DTM-2001 "Confirmamos disponibilidad"     (plays the supplier's reply, step W8)
  The folder holding this file also keeps config.json: the verified product build has its connection address and public key baked in. Do not delete it.
  Deleting the review data is a separate, explicit, owner-authorized command (node review.mjs reset --destroy-review-data); it is never part of a normal stop.
`;
  fs.writeFileSync(path.join(a.work, "review_credentials.txt"), txt, { mode: 0o600 });
}
