// #103 R3-1 — real-concurrency regression for rollbacks 328 and 329, on a DISPOSABLE database created from a template (never an owner database).
//   node supabase/scripts/prueba_carrera_rollback_103.mjs [pg127] [plantilla127] [--sin-candados]
// Proves, per rollback: (S1) a writer still IN FLIGHT when the rollback starts is waited for and then SEEN by the guard (rollback refuses, row survives);
// (S2) a writer arriving AFTER the guard cannot commit: it blocks until the rollback ends and then fails (nothing is committed and silently lost);
// (S3) when the lock cannot be obtained, the rollback FAILS within its 5 s bound and leaves data, schema and the identity-guard row unchanged.
// --sin-candados is the NEGATIVE CONTROL: it strips the transaction/lock block from the script under test, so the same checks must FAIL.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const SIN = args.includes("--sin-candados");
const [CT = "pg127", TPL = "plantilla127"] = args.filter((a) => !a.startsWith("--"));
const DB = `carrera103_${randomBytes(4).toString("hex")}`;
const dockerArgs = (db, app) => ["exec", "-i", "-e", "PGPASSWORD=postgres", "-e", `PGAPPNAME=${app}`, CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-X", "-q", "-t", "-A"];
const sql = (db, s, app = "carrera103_admin") => execFileSync("docker", [...dockerArgs(db, app), "-v", "ON_ERROR_STOP=1"], { input: s, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const leer = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (m) => console.log(`OK    ${m}`);
const mal = (m) => { fallas++; console.log(`FALLA ${m}`); };
const check = (cond, m) => (cond ? ok(m) : mal(m));

// a psql session that stays open: we feed it statements one at a time and observe its exit
function sesion(app, db = DB) {
  const p = spawn("docker", [...dockerArgs(db, app), "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "", fin = null; const t0 = Date.now();
  p.stdout.on("data", (b) => (out += b)); p.stderr.on("data", (b) => (err += b));
  const termino = new Promise((res, rej) => { p.on("error", rej); p.on("close", (code) => { fin = { code, ms: Date.now() - t0 }; res(fin); }); });
  return { app, escribir: (s) => p.stdin.write(s), cerrar: () => p.stdin.end(), termino, get out() { return out; }, get err() { return err; }, get fin() { return fin; } };
}
async function hasta(cond, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await dormir(60); } return false; }
const espera = (app) => sql("postgres", `select count(*) from pg_stat_activity where datname = '${DB}' and application_name = '${app}' and wait_event_type = 'Lock'`) === "1";
const enTx = (app) => sql("postgres", `select count(*) from pg_stat_activity where datname = '${DB}' and application_name = '${app}' and state = 'idle in transaction'`) === "1";
const activo = (app, like) => sql("postgres", `select count(*) from pg_stat_activity where datname = '${DB}' and application_name = '${app}' and state = 'active' and query like '${like}'`) === "1";

// the script under test; the negative control removes the lock block and the transaction wrapper (what the delivered scripts used to lack)
function guion(ruta, marcador, pausa) {
  let s = leer(ruta);
  if (SIN) s = s.replace(/begin;\nset local lock_timeout = '5s';\ndo \$\$\n(?:declare t text;\n)?begin\n  foreach t[\s\S]*?end \$\$;\n/, "").replace(/\ncommit;\n?$/, "\n");
  if (pausa) { const i = s.indexOf(marcador); if (i < 0) throw new Error(`marker not found in ${ruta}`); s = s.slice(0, i) + `\nselect pg_sleep(${pausa});\n` + s.slice(i); }
  return s;
}
const firma = (db = DB) => sql(db, readFileSync("supabase/scripts/firma_esquema_103.sql", "utf8"));

const CASOS = {
  329: {
    ruta: "supabase/scripts/rollback_329_pago_proveedor_soportes.sql", marcador: "\ndrop table if exists public.solicitud_proveedor_pagos;", tabla: "cxp_pago_soportes",
    migraciones: ["327_conjuntos_fechas", "328_solicitudes_proveedor", "329_pago_proveedor_soportes"], confirma: "app.confirmar_perdida_329",
    insertar: (pago) => `insert into public.cxp_pago_soportes(cxp_pago_id,tenant,nombre,path,content_type,size_bytes,sha256) values(${pago},'mayorista','r.pdf','race/r.pdf','application/pdf',10,repeat('a',64));`,
  },
  328: {
    ruta: "supabase/scripts/rollback_328_solicitudes_proveedor.sql", marcador: "\n-- identity (284)", tabla: "solicitudes_proveedor",
    migraciones: ["327_conjuntos_fechas", "328_solicitudes_proveedor"], confirma: "app.confirmar_perdida_328",
    insertar: () => `insert into public.solicitudes_proveedor(numero_contrato,contrato_uid,destinatarios,asunto,token_respuesta,clave_envio) values('DTM-93103',(select contrato_uid from public.ventas where numero_contrato='DTM-93103'),array['r@example.test'],'race',repeat('r',32),'carrera-' || clock_timestamp()::text);`,
  },
};

async function caso(n) {
  const c = CASOS[n];
  console.log(`\n== rollback ${n}${SIN ? " (NEGATIVE CONTROL: no locks)" : ""} ==`);
  sql("postgres", `create database ${DB} template ${TPL}`);
  try {
    for (const m of c.migraciones) sql(DB, leer(`supabase/migrations/20260601000${m}.sql`));
    sql(DB, `begin; insert into public.ventas(numero_contrato,cliente,tenant) values('DTM-93103','Race','mayorista'); insert into public.cuentas_por_pagar(numero_contrato,proveedor,tenant,valor_total) values('DTM-93103','Race supplier','mayorista',100); insert into public.cxp_pagos(cuenta_por_pagar_id,valor,tenant) select id,50,'mayorista' from public.cuentas_por_pagar where numero_contrato='DTM-93103'; commit;`);
    const pago = sql(DB, "select id from public.cxp_pagos limit 1");
    const filas = () => Number(sql(DB, `select count(*) from public.${c.tabla}`));
    const existe = () => sql(DB, `select to_regclass('public.${c.tabla}') is not null`) === "t";
    const base = firma();

    // S1 — a writer in flight when the rollback starts
    { const W = sesion(`w1_${n}`); W.escribir(`begin;\n${c.insertar(pago)}\n`);
      await hasta(() => enTx(W.app));
      const R = sesion(`r1_${n}`); R.escribir(guion(c.ruta)); R.cerrar();
      const espero = await hasta(() => espera(R.app), 3000);
      W.escribir("commit;\n"); W.cerrar(); await W.termino; const fr = await R.termino;
      check(espero, `S1 the rollback WAITS for the in-flight writer (it did not run past it)`);
      check(fr.code !== 0 && /ABORTADO/.test(R.err), `S1 the guard SEES the committed row and refuses${fr.code === 0 ? " (rollback succeeded: data lost)" : ""}`);
      check(existe() && filas() === 1, `S1 the table and its committed row survive`);
      if (existe()) sql(DB, `delete from public.${c.tabla}`); }

    // S2 — a writer arriving AFTER the guard cannot commit
    { const R = sesion(`r2_${n}`); R.escribir(guion(c.ruta, c.marcador, 4)); R.cerrar();
      const llego = await hasta(() => activo(R.app, "%pg_sleep(4)%"), 6000);
      check(llego, `S2 the rollback reached the gap between its guard and its destructive statements`);
      const W = sesion(`w2_${n}`); W.escribir(`${c.insertar(pago)}\n`); W.cerrar();
      await dormir(700);
      const bloqueado = W.fin === null && await hasta(() => espera(W.app), 2000);
      check(bloqueado, `S2 the late writer is BLOCKED (it cannot commit inside the gap)`);
      const fr = await R.termino; await W.termino;
      check(fr.code === 0 || SIN, `S2 the empty-table rollback completes`);
      const perdido = !existe() ? "gone" : String(filas());
      check(!existe() && W.fin.code !== 0 && /does not exist|no existe/.test(W.err), `S2 the late writer FAILS (nothing committed and silently lost); table ${perdido}`); }

    // S3 — lock not obtainable: bounded failure, nothing changes
    sql("postgres", `drop database ${DB} with (force)`); sql("postgres", `create database ${DB} template ${TPL}`);
    for (const m of c.migraciones) sql(DB, leer(`supabase/migrations/20260601000${m}.sql`));
    sql(DB, `begin; insert into public.ventas(numero_contrato,cliente,tenant) values('DTM-93103','Race','mayorista'); insert into public.cuentas_por_pagar(numero_contrato,proveedor,tenant,valor_total) values('DTM-93103','Race supplier','mayorista',100); insert into public.cxp_pagos(cuenta_por_pagar_id,valor,tenant) select id,50,'mayorista' from public.cuentas_por_pagar where numero_contrato='DTM-93103'; commit;`);
    { const antes = firma(); const guardasAntes = sql(DB, "select count(*) from public.contrato_guardas_config");
      const H = sesion(`h3_${n}`); H.escribir(`begin;\n${c.insertar(sql(DB, "select id from public.cxp_pagos limit 1"))}\n`);
      await hasta(() => enTx(H.app));
      const R = sesion(`r3_${n}`); R.escribir(guion(c.ruta)); R.cerrar();
      const fr = await Promise.race([R.termino, dormir(12000).then(() => null)]);
      if (!fr) { sql("postgres", `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${DB}' and application_name = '${R.app}'`); mal(`S3 the rollback is STILL WAITING after 12 s (unbounded lock wait)`); H.escribir("rollback;\n"); H.cerrar(); await H.termino; return; }
      check(fr.code !== 0 && /lock timeout|tiempo de espera/i.test(R.err) && fr.ms >= 4000 && fr.ms <= 9000, `S3 lock not obtained: the rollback FAILS with a lock timeout after ${(fr.ms / 1000).toFixed(1)} s (bound 5 s)${fr.code === 0 ? " — it did NOT fail" : ""}`);
      H.escribir("rollback;\n"); H.cerrar(); await H.termino;
      check(firma() === antes, `S3 schema signature (tables, functions, triggers, identity guards) is unchanged`);
      check(sql(DB, "select count(*) from public.contrato_guardas_config") === guardasAntes && (n !== 328 || sql(DB, "select count(*) from public.contrato_guardas_config where tabla = 'solicitudes_proveedor'") === "1"), `S3 the identity-guard configuration is unchanged`);
      check(existe(), `S3 the table still exists`); }
    void base;
  } finally { sql("postgres", `drop database if exists ${DB} with (force)`); }
}

try { await caso(329); await caso(328); } finally { try { sql("postgres", `drop database if exists ${DB} with (force)`); } catch {} }
console.log(fallas ? `\nCARRERA: ${fallas} failure(s)` : "\nCARRERA: 0 failures");
process.exit(fallas ? 1 : 0);
