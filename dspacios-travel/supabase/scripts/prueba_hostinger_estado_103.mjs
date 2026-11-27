// #103 HIN-2 — the REAL SQL of migration 330 (durable sweep cursor + parked-replies backlog) on a DISPOSABLE database created from a template (never an owner database):
//   node supabase/scripts/prueba_hostinger_estado_103.mjs [pg127] [plantilla127]
// Proves: preflight/apply/postcheck/idempotent re-apply; compare-and-swap semantics, including EIGHT truly concurrent sessions racing on the same version (exactly one wins); the CHECK rules the drain relies on; privileges
// (anon/authenticated denied everything, service_role allowed); the backlog table (upsert, cascade); and the guarded, locked rollback (refuses with a backlog, confirmed rollback, bounded lock timeout leaves everything unchanged, re-apply).
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const [CT = "pg127", TPL = "plantilla127"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DB = `hostinger330_${randomBytes(4).toString("hex")}`;
const args = (db, app) => ["exec", "-i", "-e", "PGPASSWORD=postgres", "-e", `PGAPPNAME=${app}`, CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-X", "-q", "-t", "-A"];
const sql = (db, s, app = "h330_admin", stop = true) => execFileSync("docker", [...args(db, app), ...(stop ? ["-v", "ON_ERROR_STOP=1"] : [])], { input: s, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const falla = (db, s) => { try { sql(db, s); return null; } catch (e) { return String(e.stderr ?? e.message); } };
const leer = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (m) => console.log(`OK    ${m}`);
const mal = (m) => { fallas++; console.log(`FALLA ${m}`); };
const check = (c, m) => (c ? ok(m) : mal(m));
const M = "supabase/migrations/20260601000330_hostinger_entrada_estado.sql", S = "supabase/scripts";
const controles = (db, f) => { const out = sql(db, leer(f)); const malos = out.split("\n").filter((l) => l.includes("|FALLA")); return { out, malos }; };
const firma = (db) => sql(db, leer(`${S}/firma_esquema_103.sql`));

function sesion(app, db, entrada) {
  const p = spawn("docker", [...args(db, app), "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = ""; const t0 = Date.now();
  p.stdout.on("data", (b) => (out += b)); p.stderr.on("data", (b) => (err += b));
  const fin = new Promise((res, rej) => { p.on("error", rej); p.on("close", (code) => res({ code, ms: Date.now() - t0, out: out.trim(), err })); });
  if (entrada) { p.stdin.write(entrada); p.stdin.end(); }
  return { p, fin, escribir: (s) => p.stdin.write(s), cerrar: () => p.stdin.end() };
}

sql("postgres", `create database ${DB} template ${TPL}`);
try {
  // ── preflight / apply / postcheck / idempotent re-apply ──
  let c = controles(DB, `${S}/preflight_330_hostinger_entrada_estado.sql`); check(c.malos.length === 0, `preflight OK before the first apply\n${c.out}`);
  const f0 = firma(DB);
  sql(DB, leer(M)); c = controles(DB, `${S}/postcheck_330_hostinger_entrada_estado.sql`); check(c.malos.length === 0, `postcheck OK after apply\n${c.out}`);
  const f1 = firma(DB); check(f0 !== f1, "applying 330 changes the schema signature");
  sql(DB, leer(M)); check(firma(DB) === f1, "re-applying 330 is idempotent (same schema signature)"); c = controles(DB, `${S}/postcheck_330_hostinger_entrada_estado.sql`); check(c.malos.length === 0, "postcheck OK after the re-apply");
  c = controles(DB, `${S}/preflight_330_hostinger_entrada_estado.sql`); check(c.malos.length === 0, "preflight accepts a re-application (2 tables present)");

  // ── read / compare-and-swap ──
  const B = "AC1a2b3c4d5e6f7g";
  const leerEstado = () => sql(DB, `select version || '|' || uid_cubierto || '|' || coalesce(barrido_tope::text, '-') || '|' || coalesce(barrido_siguiente::text, '-') from public.hostinger_estado_leer('${B}')`);
  check(leerEstado() === "0|0|-|-", "hostinger_estado_leer creates the row (version 0, cursor 0, no sweep) and is idempotent"); check(leerEstado() === "0|0|-|-", "a second read returns the same row");
  check(sql(DB, `select public.hostinger_estado_avanzar('${B}', 0, 0, 500, 500, null)`) === "t", "CAS with the current version wins"); check(leerEstado() === "1|0|500|500", "…and bumps the version");
  check(sql(DB, `select public.hostinger_estado_avanzar('${B}', 0, 0, 999, 999, null)`) === "f", "CAS with a STALE version loses"); check(leerEstado() === "1|0|500|500", "…and changes nothing");
  check(sql(DB, `select public.hostinger_estado_avanzar('${B}', 1, 0, 500, 400, null)`) === "t" && leerEstado() === "2|0|500|400", "a page advance moves barrido_siguiente down");
  check(sql(DB, `select public.hostinger_estado_avanzar('${B}', 2, 500, null, null, null)`) === "t" && leerEstado() === "3|500|-|-", "finishing a sweep sets uid_cubierto = tope and clears the sweep");
  check(sql(DB, `select public.hostinger_estado_avanzar('NO-EXISTE-1', 0, 0, null, null, null)`) === "f", "CAS on an unknown mailbox returns false");

  // ── the CHECK rules the drain relies on ──
  for (const [d, q] of [["tope without siguiente", `select public.hostinger_estado_avanzar('${B}', 3, 500, 600, null, null)`], ["siguiente > tope", `select public.hostinger_estado_avanzar('${B}', 3, 500, 600, 700, null)`], ["tope <= cubierto", `select public.hostinger_estado_avanzar('${B}', 3, 500, 400, 400, null)`], ["negative cursor", `select public.hostinger_estado_avanzar('${B}', 3, -1, null, null, null)`]]) {
    const e = falla(DB, q); check(e && /check|violates/i.test(e), `CHECK rejects: ${d}`);
  }
  check(leerEstado() === "3|500|-|-", "rejected updates changed nothing");
  check(/violates check/i.test(falla(DB, `select * from public.hostinger_estado_leer('ab')`) ?? ""), "mailbox id shape is enforced (too short)");

  // ── the eligibility threshold of a sweep (barrido_desde): saved with the sweep, kept while it advances, cleared when it ends, and impossible without a running sweep ──
  const B2 = "AC2desde0000test"; const leer2 = () => sql(DB, `select version || '|' || uid_cubierto || '|' || coalesce(barrido_tope::text, '-') || '|' || coalesce(barrido_siguiente::text, '-') || '|' || coalesce(to_char(barrido_desde at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'), '-') from public.hostinger_estado_leer('${B2}')`);
  check(leer2() === "0|0|-|-|-", "a new mailbox has no sweep and no threshold");
  check(sql(DB, `select public.hostinger_estado_avanzar('${B2}', 0, 0, 200, 200, '2026-11-20T10:00:00Z')`) === "t" && leer2() === "1|0|200|200|2026-11-20T10:00", "a sweep starts WITH its threshold, which is saved");
  check(sql(DB, `select public.hostinger_estado_avanzar('${B2}', 1, 0, 200, 150, '2026-11-20T10:00:00Z')`) === "t" && leer2() === "2|0|200|150|2026-11-20T10:00", "a (partial or page) advance keeps the SAME threshold");
  check(/violates check/i.test(falla(DB, `select public.hostinger_estado_avanzar('${B2}', 2, 200, null, null, '2026-11-21T00:00:00Z')`) ?? ""), "CHECK rejects a threshold without a running sweep");
  check(sql(DB, `select public.hostinger_estado_avanzar('${B2}', 2, 200, null, null, null)`) === "t" && leer2() === "3|200|-|-|-", "finishing the sweep clears the threshold");

  // ── EIGHT truly concurrent sessions racing on the same version: exactly one wins ──
  const carrera = async (n) => {
    const v = Number(sql(DB, `select version from public.hostinger_estado_leer('${B}')`));
    const ses = Array.from({ length: n }, (_, i) => sesion(`h330_cas_${i}`, DB, `select pg_sleep(0.6);\nselect public.hostinger_estado_avanzar('${B}', ${v}, 500, ${700 + i}, ${700 + i}, null);\n`));
    const res = await Promise.all(ses.map((s) => s.fin)); return res.map((r) => r.out.split("\n").pop());
  };
  const r8 = await carrera(8); check(r8.filter((x) => x === "t").length === 1 && r8.filter((x) => x === "f").length === 7, `8 concurrent CAS on one version: exactly 1 winner (${r8.join(",")})`);
  const e8 = leerEstado().split("|"); check(e8[0] === "4" && e8[2] === e8[3] && Number(e8[2]) >= 700 && Number(e8[2]) <= 707, `…and the state is the winner's (${e8.join("|")})`);

  // ── privileges ──
  for (const rol of ["anon", "authenticated"]) {
    for (const [d, q] of [["select estado", "select * from public.hostinger_estado_buzon"], ["insert estado", `insert into public.hostinger_estado_buzon (buzon_id) values ('ZZZZ1111')`], ["select pendientes", "select * from public.hostinger_respuestas_pendientes"], ["call leer", `select * from public.hostinger_estado_leer('${B}')`], ["call avanzar", `select public.hostinger_estado_avanzar('${B}', 0, 0, null, null, null)`]]) {
      const e = falla(DB, `set role ${rol}; ${q};`); check(e && /permission denied/i.test(e), `${rol} is denied: ${d}`);
    }
  }
  check(sql(DB, `set role service_role; select count(*) from public.hostinger_estado_buzon`) !== "", "service_role can read the state table"); check(sql(DB, `set role service_role; select public.hostinger_estado_avanzar('NO-EXISTE-2', 0, 0, null, null, null)`) === "f", "service_role can call the functions");

  // ── backlog table ──
  sql(DB, `insert into public.hostinger_respuestas_pendientes (buzon_id, uid, dedupe, message_id) values ('${B}', 42, 'hostinger:${B}:<m42@x>', '<m42@x>')
           on conflict (buzon_id, uid) do update set intentos = hostinger_respuestas_pendientes.intentos + 1, actualizado_en = now();
           insert into public.hostinger_respuestas_pendientes (buzon_id, uid, dedupe, message_id) values ('${B}', 42, 'hostinger:${B}:<m42@x>', '<m42@x>')
           on conflict (buzon_id, uid) do update set intentos = hostinger_respuestas_pendientes.intentos + 1, actualizado_en = now();`);
  check(sql(DB, `select intentos from public.hostinger_respuestas_pendientes where uid = 42`) === "2", "the backlog upserts on (mailbox, uid) and counts attempts");
  check(/foreign key/i.test(falla(DB, `insert into public.hostinger_respuestas_pendientes (buzon_id, uid, dedupe) values ('SIN-BUZON', 1, 'x')`) ?? ""), "a parked reply needs its mailbox row");
  check(/violates check/i.test(falla(DB, `insert into public.hostinger_respuestas_pendientes (buzon_id, uid, dedupe) values ('${B}', 0, 'x')`) ?? ""), "uid must be positive");

  // ── guarded, locked rollback ──
  const antes = firma(DB), filasAntes = sql(DB, "select (select count(*) from public.hostinger_estado_buzon) || '/' || (select count(*) from public.hostinger_respuestas_pendientes)");
  let e = falla(DB, leer(`${S}/rollback_330_hostinger_entrada_estado.sql`)); check(e && /ROLLBACK 330 ABORTADO/.test(e), "rollback REFUSES while a backlog exists (no confirmation)"); check(firma(DB) === antes && sql(DB, "select (select count(*) from public.hostinger_estado_buzon) || '/' || (select count(*) from public.hostinger_respuestas_pendientes)") === filasAntes, "…and changed nothing");
  // lock timeout: another session holds a row lock open → the rollback must FAIL within its 5 s bound and change nothing
  const H = sesion("h330_holder", DB); H.escribir(`begin;\nupdate public.hostinger_respuestas_pendientes set intentos = intentos where uid = 42;\n`); await dormir(800);
  const t0 = Date.now(); const R = sesion("h330_rb", DB, `select set_config('app.confirmar_perdida_330', 'si', false);\n${leer(`${S}/rollback_330_hostinger_entrada_estado.sql`)}`); const rr = await R.fin; const ms = Date.now() - t0;
  H.escribir("rollback;\n"); H.cerrar(); await H.fin;
  check(rr.code !== 0 && /lock timeout|tiempo de espera/i.test(rr.err) && ms >= 4000 && ms <= 9000, `lock held → the rollback fails with a lock timeout after ${(ms / 1000).toFixed(1)} s (bound 5 s)`); check(firma(DB) === antes && sql(DB, "select count(*) from public.hostinger_respuestas_pendientes") === "1", "…schema and data unchanged");
  // confirmed rollback, then re-apply
  sql(DB, `select set_config('app.confirmar_perdida_330', 'si', false);\n${leer(`${S}/rollback_330_hostinger_entrada_estado.sql`)}`);
  check(firma(DB) === f0, "confirmed rollback restores the initial schema signature exactly");
  sql(DB, leer(M)); check(firma(DB) === f1, "re-applying after the rollback reproduces the signature"); c = controles(DB, `${S}/postcheck_330_hostinger_entrada_estado.sql`); check(c.malos.length === 0, "postcheck OK after the final re-apply");
  // an empty-backlog rollback needs no confirmation
  sql(DB, leer(`${S}/rollback_330_hostinger_entrada_estado.sql`)); check(firma(DB) === f0, "with NO backlog the rollback needs no confirmation");
} finally { try { sql("postgres", `drop database if exists ${DB} with (force)`); } catch { /* */ } }
console.log(fallas ? `\nHOSTINGER-330: ${fallas} failure(s)` : "\nHOSTINGER-330: 0 failures");
process.exit(fallas ? 1 : 0);
