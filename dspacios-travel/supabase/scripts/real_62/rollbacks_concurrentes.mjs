// B7 — Rollbacks protegidos contra escritores concurrentes, sobre la IMAGEN REAL de Supabase Postgres (Docker), con sesiones psql independientes.
// Cada caso espera por el ESTADO OBSERVADO (pg_stat_activity / pg_locks), no por tiempos fijos. Una base desechable por caso (copia de una base ya migrada). No toca otras bases.
// Casos por objetivo (322, 318, 319, 323, 317):
//   W · escritor EN CURSO (fila insertada sin commit): el rollback espera el candado; al confirmar el escritor, la guarda ve la fila y RECHAZA → la fila confirmada y el esquema quedan intactos.
//   T · escritor que retiene MÁS que el tiempo acotado: el rollback falla por «lock timeout» sin cambiar nada; el escritor confirma sin problema.
//   D · datos ya confirmados (sin concurrencia): rechazo, esquema y filas intactos.   E · tabla realmente vacía: el rollback tiene éxito y el objeto desaparece.
//   N (solo 322) · escritor que LLEGA mientras el rollback ya tiene el candado: espera y falla por «no existe» (no se perdió nada: la tabla estaba vacía en la guarda).
// Uso (desde dspacios-travel/):  node supabase/scripts/real_62/rollbacks_concurrentes.mjs [contenedor=pgb2b] [plantilla=plantillab2b]
import { execFileSync, spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PG = process.argv[2] ?? "pgb2b", PLANTILLA = process.argv[3] ?? "plantillab2b";
const SCR = join(process.cwd(), "supabase", "scripts"), MIG = join(process.cwd(), "supabase", "migrations");
const base = ["exec", "-i", "-e", "PGPASSWORD=postgres"];
const psqlArgs = (db, extra = []) => ["psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", ...extra];
const sql = (db, q) => execFileSync("docker", [...base, PG, ...psqlArgs(db), "-c", q], { encoding: "utf8" }).trim();
const sqlSafe = (db, q) => { try { return sql(db, q); } catch (e) { return "ERR:" + String(e.stderr ?? e.message).split("\n")[0]; } };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, fallos = 0;
const reg = (ok, t) => { total++; if (!ok) fallos++; console.log(`${ok ? "OK   " : "FALLO"} ${t}`); };

function lanzar(db, app, args) {
  const p = spawn("docker", [...base, "-e", `PGAPPNAME=${app}`, PG, ...psqlArgs(db), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  const fin = new Promise((r) => p.on("close", (code) => r({ code, out, err })));
  return { fin };
}
async function hasta(cond, ms = 20000, paso = 150) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await dormir(paso); } return false; }

// ── Preparación: base migrada (plantilla + 316…323), usada como plantilla de cada caso ─────────────────────────────────────────────────────────
const BASE = "m_rbconc_base";
sqlSafe("postgres", `select pg_terminate_backend(pid) from pg_stat_activity where datname in ('${BASE}','${PLANTILLA}') and pid <> pg_backend_pid()`);
sqlSafe("postgres", `drop database if exists ${BASE} with (force)`);
sql("postgres", `create database ${BASE} template ${PLANTILLA}`);
execFileSync("docker", [...base, PG, "rm", "-rf", "/tmp/scr", "/tmp/mig"]);
execFileSync("docker", ["cp", join(process.cwd(), "supabase", "scripts").replaceAll("\\", "/"), `${PG}:/tmp/scr`]);
sql(BASE, "alter table auth.users add column if not exists email_confirmed_at timestamptz, add column if not exists raw_app_meta_data jsonb"); // la plantilla trae un auth.users reducido
for (const n of [316, 317, 318, 319, 322, 323, 324]) {
  const f = readdirSync(MIG).find((x) => x.startsWith(`2026060100${String(n).padStart(4, "0")}_`));
  execFileSync("docker", [...base, PG, ...psqlArgs(BASE, ["-1"])], { input: readFileSync(join(MIG, f)), encoding: "utf8" });
}
console.log(`base migrada (${BASE}): ${sql(BASE, "select count(*) from pg_tables where schemaname = 'public'")} tablas públicas`);

// ── Fixtures mínimas (todas las columnas NOT NULL sin default, por tipo; FK/triggers apagados SOLO en la transacción del escritor) ─────────────
function fila(db, tabla, over = {}) {
  const cols = sql(db, `select column_name || '|' || data_type from information_schema.columns where table_schema = 'public' and table_name = '${tabla}' and is_nullable = 'NO' and column_default is null and is_generated = 'NEVER' and identity_generation is null`).split("\n").filter(Boolean).map((l) => l.split("|"));
  const val = (t) => ({ uuid: "gen_random_uuid()", text: "'x'", "character varying": "'x'", integer: "1", bigint: "1", smallint: "1", numeric: "1", boolean: "true", jsonb: "'{}'::jsonb", date: "current_date", "timestamp with time zone": "now()" })[t] ?? "null";
  const all = { ...Object.fromEntries(cols.map(([c, t]) => [c, val(t)])), ...over };
  return `insert into public.${tabla} (${Object.keys(all).join(",")}) values (${Object.values(all).join(",")});`;
}
const OBJ = {
  324: { rb: "rollback_324_registro_candados.sql", tabla: "registro_b2b_estado", insertar: (db) => fila(db, "registro_b2b_estado"), rechazo: /ROLLBACK 324 detenido/ },
  322: { rb: "rollback_322_clientes_aliado.sql", tabla: "aliado_clientes", insertar: (db) => fila(db, "aliado_clientes", { clave: "'cliente-de-prueba'", nombre: "'Cliente Prueba'" }), rechazo: /ROLLBACK 322 detenido/ },
  318: { rb: "rollback_318_firma_aceptacion.sql", tabla: "aliado_firmas", insertar: (db) => fila(db, "aliado_firmas", { mime: "'image/png'", sha256: "repeat('a',64)" }), rechazo: /318 rollback: hay firmas/ },
  319: { rb: "rollback_319_aliado_logo.sql", tabla: "aliado_logos", insertar: (db) => fila(db, "aliado_logos", { mime: "'image/png'", sha256: "repeat('a',64)", via: "'portal'" }), rechazo: /ROLLBACK_319_RECHAZADO/ },
  323: { rb: "rollback_323_solicitud_contrato.sql", tabla: "cotizacion_solicitudes_contrato", insertar: (db) => fila(db, "cotizacion_solicitudes_contrato"), rechazo: /ROLLBACK 323 detenido/ },
  317: { rb: "rollback_317_neto_manual.sql", tabla: "cotizacion_neto", insertar: (db) => fila(db, "cotizaciones", { id: 987001, tenant: "'mayorista'" }) + " " + fila(db, "cotizacion_neto", { cotizacion_id: 987001, modalidad: "'neto'", aliado_id: 1, moneda: "'COP'", tipo_asesor: "'agencia'", reconoce_recobro: "false", pvp_total: "5000000", descuento_total: "480000", neto_total: "4520000", costo_total: "4000000", base_comision: "4000000", pct_comision: "0.12", solo_tiquetes: "false", piso: "0.06", comision_ordinaria: "480000", participacion_recobro: "0" }), rechazo: /ROLLBACK 317/ },
};
const RB_OBJETO = { 324: "registro_b2b_estado", 322: "aliado_clientes", 318: "cuenta_cobro_aceptaciones", 319: "aliado_logos", 323: "cotizacion_solicitudes_contrato", 317: "crear_cotizacion_manual_neto" };
const existe = (db, n) => (n === 317 ? sql(db, "select to_regprocedure('public.crear_cotizacion_manual_neto(uuid,text,jsonb,jsonb,bigint,boolean,boolean)') is not null") : sql(db, `select to_regclass('public.${RB_OBJETO[n]}') is not null`)) === "t";
const filas = (db, n) => Number(sql(db, `select count(*) from public.${OBJ[n].tabla}`));
let caso = 0;
function nuevaBase() { const db = `m_rbconc_${++caso}`; sqlSafe("postgres", `drop database if exists ${db} with (force)`); sql("postgres", `create database ${db} template ${BASE}`); return db; }
const soltar = (db) => sqlSafe("postgres", `drop database if exists ${db} with (force)`);
// Escritor A: inserta SIN confirmar y se queda esperando; `modo` decide cuándo confirma (observando a la sesión del rollback por su application_name).
const escritorA = (db, n, app, modo) => {
  const esperaB = `exists (select 1 from pg_stat_activity where application_name = '${app}' and wait_event_type = 'Lock')`;
  const bucle = modo === "T"
    ? `do $$ declare t timestamptz := clock_timestamp(); visto boolean := false; begin loop perform pg_stat_clear_snapshot(); if ${esperaB} then visto := true; end if; exit when (visto and not ${esperaB}) or clock_timestamp() > t + interval '30 seconds'; perform pg_sleep(0.1); end loop; end $$;`
    : `do $$ declare t timestamptz := clock_timestamp(); begin loop perform pg_stat_clear_snapshot(); exit when ${esperaB} or clock_timestamp() > t + interval '30 seconds'; perform pg_sleep(0.1); end loop; end $$;`;
  return lanzar(db, "wr_A", ["-c", `begin; set local session_replication_role = replica; ${OBJ[n].insertar(db)} ${bucle} commit;`]);
};

for (const n of [322, 318, 319, 323, 317, 324]) {
  console.log(`\n=== objetivo ${n} ===`);
  const o = OBJ[n];
  // W · escritor en curso
  { const db = nuevaBase(); const app = `rb_${n}_W`;
    const A = escritorA(db, n, app, "W");
    const A_activo = await hasta(() => sql(db, "select count(*) from pg_stat_activity where application_name = 'wr_A' and state = 'active' and query like '%clock_timestamp%'") === "1");
    const B = lanzar(db, app, ["-f", `/tmp/scr/${o.rb}`]);
    const [ra, rb] = await Promise.all([A.fin, B.fin]);
    reg(A_activo && ra.code === 0, `${n} W · el escritor en curso confirma sin error (exit ${ra.code})`);
    reg(rb.code !== 0 && o.rechazo.test(rb.err + rb.out), `${n} W · el rollback ESPERÓ y, con la fila ya confirmada, se NIEGA (exit ${rb.code}: ${(rb.err.split("\n")[0] || rb.out).slice(0, 110)})`);
    reg(existe(db, n) && (n === 317 ? sql(db, "select count(*) from public.cotizacion_neto where modalidad = 'neto'") === "1" : filas(db, n) === 1), `${n} W · esquema intacto y la fila confirmada del escritor sigue ahí`);
    soltar(db); }
  // T · el escritor retiene más que el tiempo acotado del rollback
  { const db = nuevaBase(); const app = `rb_${n}_T`;
    const A = escritorA(db, n, app, "T");
    await hasta(() => sql(db, "select count(*) from pg_stat_activity where application_name = 'wr_A' and state = 'active' and query like '%clock_timestamp%'") === "1");
    const B = lanzar(db, app, ["-f", `/tmp/scr/${o.rb}`]);
    const [ra, rb] = await Promise.all([A.fin, B.fin]);
    reg(ra.code === 0, `${n} T · el escritor confirma sin error aunque el rollback agotó su espera (exit ${ra.code})`);
    reg(rb.code !== 0 && /lock timeout|tiempo de espera|canceling statement/i.test(rb.err), `${n} T · el rollback FALLA por tiempo de espera acotado y no cambia nada (exit ${rb.code}: ${rb.err.split("\n")[0].slice(0, 100)})`);
    reg(existe(db, n) && (n === 317 ? sql(db, "select count(*) from public.cotizacion_neto where modalidad = 'neto'") === "1" : filas(db, n) === 1), `${n} T · esquema intacto y fila confirmada conservada`);
    soltar(db); }
  // D · datos confirmados, sin concurrencia
  { const db = nuevaBase(); sql(db, `begin; set local session_replication_role = replica; ${o.insertar(db)} commit;`);
    const r = await lanzar(db, `rb_${n}_D`, ["-f", `/tmp/scr/${o.rb}`]).fin;
    reg(r.code !== 0 && o.rechazo.test(r.err + r.out) && existe(db, n), `${n} D · con datos confirmados se NIEGA y el esquema queda intacto (exit ${r.code})`);
    soltar(db); }
  // E · realmente vacía
  { const db = nuevaBase(); const r = await lanzar(db, `rb_${n}_E`, ["-f", `/tmp/scr/${o.rb}`]).fin;
    reg(r.code === 0 && !existe(db, n), `${n} E · vacía: el rollback tiene éxito y el objeto desaparece (exit ${r.code}${r.code ? ": " + r.err.split("\n")[0].slice(0, 100) : ""})`);
    soltar(db); }
}

// N · (322) un escritor que LLEGA mientras el rollback ya tiene el candado: espera y falla por «no existe»; la tabla estaba vacía en la guarda, no se pierde nada.
{ console.log("\n=== 322 N · escritor que llega con el candado ya tomado ===");
  const db = nuevaBase();
  const pausa = readFileSync(join(SCR, "rollback_322_clientes_aliado.sql"), "utf8").replace("drop table if exists public.aliado_clientes;", "select pg_sleep(8);\ndrop table if exists public.aliado_clientes;");
  execFileSync("docker", [...base, PG, "sh", "-c", "cat > /tmp/rb322_pausa.sql"], { input: pausa });
  const insC = OBJ[322].insertar(db); // se arma ANTES de que el rollback tome el candado (consulta el catálogo de la tabla)
  const B = lanzar(db, "rb_322_N", ["-f", "/tmp/rb322_pausa.sql"]);
  const tomado = await hasta(() => sql(db, "select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.application_name = 'rb_322_N' and l.mode = 'AccessExclusiveLock' and l.granted and l.relation = 'public.aliado_clientes'::regclass") === "1");
  const C = lanzar(db, "wr_C", ["-c", `set session_replication_role = replica; ${insC}`]);
  const esperaC = await hasta(() => sql(db, "select count(*) from pg_stat_activity where application_name = 'wr_C' and wait_event_type = 'Lock'") === "1");
  const [rb, rc] = await Promise.all([B.fin, C.fin]);
  reg(tomado, "322 N · el rollback tomó el candado ACCESS EXCLUSIVE (estado observado en pg_locks)");
  reg(esperaC, "322 N · el escritor nuevo quedó ESPERANDO el candado (wait_event_type = Lock)");
  reg(rb.code === 0 && sql(db, "select to_regclass('public.aliado_clientes') is null") === "t", `322 N · el rollback (tabla vacía) termina bien (exit ${rb.code})`);
  reg(rc.code !== 0 && /does not exist/i.test(rc.err), `322 N · el escritor nuevo falla por «no existe»: ninguna fila confirmada se perdió (exit ${rc.code}: ${rc.err.split("\n")[0].slice(0, 90)})`);
  soltar(db); }

// V · REPRODUCCIÓN de la carrera original con los cuerpos ANTERIORES de los rollbacks (guarda sin candado + DROP, tal como se entregaron, sin pausas artificiales).
// El escritor inserta SIN confirmar; el rollback viejo pasa su guarda (un SELECT no ve filas sin confirmar), se queda esperando el candado del DROP y, cuando el escritor confirma, borra la tabla CON la fila confirmada.
// 322, 318 y 323 reproducen el cuerpo entregado completo (la parte de la guarda y el DROP de la tabla); 319 usa la guarda entregada seguida del DROP de su tabla (su resto no interviene en la carrera).
const VIEJOS = {
  322: ["aliado_clientes", "begin;\ndo $$ begin if exists (select 1 from public.aliado_clientes) then raise exception 'viejo 322: hay clientes'; end if; end $$;\ndrop table if exists public.aliado_clientes;\ncommit;\n"],
  318: ["aliado_firmas", "begin;\ndo $$ begin if (select count(*) from public.cuenta_cobro_aceptaciones) > 0 or (select count(*) from public.aliado_firmas) > 0 then raise exception 'viejo 318: hay firmas'; end if; end $$;\ndrop function if exists public.aceptar_cuenta_cobro(text, bigint, jsonb, text, uuid);\ndrop function if exists public.registrar_firma_aliado(bigint, text, text, text, integer, uuid);\ndrop table if exists public.cuenta_cobro_aceptaciones;\ndrop table if exists public.aliado_firmas;\ncommit;\n"],
  319: ["aliado_logos", "begin;\ndo $$ begin if to_regclass('public.aliado_logos') is not null and exists (select 1 from public.aliado_logos) then raise exception 'viejo 319: hay logos'; end if; if exists (select 1 from storage.objects where bucket_id = 'aliado-logos') then raise exception 'viejo 319: hay archivos'; end if; end $$;\ndrop table if exists public.aliado_logos;\ncommit;\n"],
  323: ["cotizacion_solicitudes_contrato", "do $$ begin if to_regclass('public.cotizacion_solicitudes_contrato') is not null and exists (select 1 from public.cotizacion_solicitudes_contrato) then raise exception 'viejo 323: hay solicitudes'; end if; if exists (select 1 from public.avisos where tipo = 'solicitud_contrato') then raise exception 'viejo 323: hay avisos'; end if; end $$;\ndrop function if exists public.solicitar_contrato_cotizacion(bigint, uuid);\ndrop table if exists public.cotizacion_solicitudes_contrato;\n"],
};
for (const [n, [tabla, viejo]] of Object.entries(VIEJOS).map(([k, v]) => [Number(k), v])) {
  console.log(`\n=== ${n} V · reproducción del defecto con el cuerpo anterior (guarda sin candado) ===`);
  const db = nuevaBase();
  execFileSync("docker", [...base, PG, "sh", "-c", `cat > /tmp/rb${n}_viejo.sql`], { input: viejo });
  // El escritor confirma SOLO cuando observa al rollback viejo esperando el candado del DROP (la guarda ya pasó sin ver su fila sin confirmar): determinista, sin tiempos fijos.
  const A = escritorA(db, n, `rb_${n}_V`, "W");
  await hasta(() => sql(db, "select count(*) from pg_stat_activity where application_name = 'wr_A' and state = 'active' and query like '%clock_timestamp%'") === "1");
  const B = lanzar(db, `rb_${n}_V`, ["-f", `/tmp/rb${n}_viejo.sql`]);
  const [ra, rb] = await Promise.all([A.fin, B.fin]);
  const perdida = sql(db, `select to_regclass('public.${tabla}') is null`) === "t";
  reg(ra.code === 0 && rb.code === 0 && perdida, `${n} V · CUERPO ANTERIOR: el escritor confirmó (exit ${ra.code}), el rollback viejo también (exit ${rb.code}) y la tabla ${tabla} desapareció con la fila confirmada → pérdida de datos REPRODUCIDA`);
  soltar(db);
}

sqlSafe("postgres", `drop database if exists ${BASE} with (force)`);
console.log(`\nRESULTADO: ${total - fallos}/${total} OK, ${fallos} FALLO`);
process.exit(fallos ? 1 : 0);
