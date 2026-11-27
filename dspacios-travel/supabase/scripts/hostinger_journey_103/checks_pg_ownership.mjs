// HJ-3 focused checks: the harness mutates ONLY a dedicated PostgreSQL container it created itself (cluster roles/passwords are shared by every database of a cluster, so a database marker is not enough).
//   HJ_SOURCE_PG_CONTAINER + HJ_SOURCE_TEMPLATE_DB: an existing container/template that is only READ (pg_dump) to seed the dedicated container. Its roles and databases are snapshotted before and after to prove they are unchanged.
// Proves: (A) UNOWNED control containers (an arbitrary one; a hand-made one named hj103_pg WITH the harness labels but no ownership record; one with a forged record but foreign data) are refused by up/seed/down/pg-destroy/pg-create
// with their role verifiers, databases, data and held template sessions unchanged; (B) a dedicated owned fixture starts up (pg-create → up → seed), and its own foreign-database/unmarked-database guards hold; (C) teardown removes only what the harness created.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AQUI, ETIQUETA, ETIQUETA_PG, PG_PROPIO, ajustes } from "./lib.mjs";

const harness = path.join(AQUI, "harness.mjs"), work = fs.mkdtempSync(path.join(os.tmpdir(), "hj103-pgchk-")), aj = ajustes({ ...process.env, HJ_WORK: work });
const fuente = process.env.HJ_SOURCE_PG_CONTAINER, fuentePlantilla = process.env.HJ_SOURCE_TEMPLATE_DB, fuentePass = process.env.HJ_SOURCE_PG_PASSWORD || "postgres";
if (!fuente || !fuentePlantilla) { console.log("SKIP: set HJ_SOURCE_PG_CONTAINER and HJ_SOURCE_TEMPLATE_DB"); process.exit(0); }
const resultados = [], MARCA = "hj103-check";
const check = (n, ok, d = "") => { resultados.push(ok); console.log(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  — " + d : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const dockerOk = (...args) => { try { return docker(...args); } catch { return null; } };
const dx = (c, pass, db, sql) => execFileSync("docker", ["exec", "-e", `PGPASSWORD=${pass}`, c, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-t", "-A", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const h = (cmd, env = {}) => { const r = spawnSync(process.execPath, [harness, cmd], { env: { ...process.env, HJ_WORK: work, ...env }, encoding: "utf8" }); return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") }; };
const esperarListo = async (c, pass) => { for (let i = 0; i < 90; i++) { try { if (dx(c, pass, "postgres", "select 1") === "1") { await sleep(2500); return; } } catch { /* starting */ } await sleep(2000); } throw new Error(`${c} did not become ready`); };
const nuevo = async (nombre, pass, labels) => { docker("run", "-d", "--name", nombre, "--label", `${MARCA}=1`, ...labels.flatMap((l) => ["--label", l]), "--memory", "512m", "-e", `POSTGRES_PASSWORD=${pass}`, aj.imagen); await esperarListo(nombre, pass); };
/** What «unchanged» means: role verifiers (password hashes), the database list, the data, and the sessions held on a template-named database. */
const instantanea = (c, pass) => ({
  roles: dx(c, pass, "postgres", "select string_agg(rolname || ':' || coalesce(rolpassword, '-'), ';' order by rolname) from pg_authid where rolname in ('authenticator', 'supabase_auth_admin', 'supabase_admin', 'postgres', 'anon', 'service_role')"),
  bds: dx(c, pass, "postgres", "select string_agg(datname, ',' order by datname) from pg_database"),
  datos: (() => { try { return dx(c, pass, "ctl_data", "select string_agg(v, ',') from public.owner_marker"); } catch { return "-"; } })(),
  sesiones: (() => { try { return dx(c, pass, "postgres", "select count(*) from pg_stat_activity where datname = 'hj103_template' and query like '%pg_sleep%'"); } catch { return "-"; } })(),
});
const sinCambios = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const propios = [], retener = [];

async function preparar(nombre, pass) {
  dx(nombre, pass, "postgres", "alter role authenticator with password 'control-auth-pw'; alter role supabase_auth_admin with password 'control-auth-pw'");
  dx(nombre, pass, "postgres", "create database ctl_data"); dx(nombre, pass, "postgres", "create database hj103_template");
  dx(nombre, pass, "ctl_data", "create table public.owner_marker(v text); insert into public.owner_marker values ('control data')");
  const s = spawn("docker", ["exec", "-e", `PGPASSWORD=${pass}`, nombre, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", "hj103_template", "-c", "select pg_sleep(240)"], { detached: true, stdio: "ignore", windowsHide: true }); s.unref(); retener.push(s.pid);   // a session HELD on a template-named database: «terminate template sessions» must not touch it
  await sleep(1500);
}
const refusa = (r, re) => r.code !== 0 && re.test(r.out);

const fuenteAntes = (() => ({ roles: dx(fuente, fuentePass, "postgres", "select string_agg(rolname || ':' || coalesce(rolpassword, '-'), ';' order by rolname) from pg_authid where rolname in ('authenticator', 'supabase_auth_admin')"), bds: dx(fuente, fuentePass, "postgres", "select string_agg(datname, ',' order by datname) from pg_database") }))();
try {
  fs.mkdirSync(path.join(work, "procs"), { recursive: true });
  check("0.1 init generates credentials outside the repository", h("init").code === 0);

  // ── A1: an arbitrary UNOWNED container, named explicitly ──
  const C1 = "hj103_check_control", P1 = "ctl-pass-1";
  await nuevo(C1, P1, []); propios.push(C1); await preparar(C1, P1);
  const a1 = instantanea(C1, P1); check("A1.0 control container fixture: roles, databases, data and a held session on a template-named database", a1.datos === "control data" && a1.sesiones === "1" && /authenticator:SCRAM/.test(a1.roles), a1.sesiones + " session(s)");
  for (const cmd of ["up", "seed", "down", "pg-destroy", "pg-create"]) {
    const r = h(cmd, { HJ_PG_CONTAINER: C1, HJ_PG_PASSWORD: P1, HJ_SOURCE_PG_CONTAINER: fuente, HJ_SOURCE_TEMPLATE_DB: fuentePlantilla });
    check(`A1.1 ${cmd.padEnd(10)} against an unowned container is refused`, refusa(r, /Refused|unset HJ_PG_CONTAINER/), r.out.trim().split("\n").at(-1).slice(0, 120));
  }
  check("A1.2 …and the control's role verifiers, databases, data and held template session are UNCHANGED", sinCambios(instantanea(C1, P1), a1), JSON.stringify(instantanea(C1, P1)).slice(0, 80) + "…");
  check("A1.3 …and the harness created nothing: no harness container/network exists", docker("ps", "-a", "--filter", `label=${ETIQUETA}=1`, "--format", "{{.Names}}") === "" && dockerOk("network", "inspect", "hj103_net") === null);

  // ── A2: a HAND-MADE container named hj103_pg WITH the harness labels (relabel-style bypass), no ownership record ──
  const P2 = "ctl-pass-2";
  await nuevo(PG_PROPIO, P2, [`${ETIQUETA}=1`, `${ETIQUETA_PG}=dedicated`]); propios.push(PG_PROPIO); await preparar(PG_PROPIO, P2);
  const a2 = instantanea(PG_PROPIO, P2);
  for (const cmd of ["up", "seed", "down", "pg-destroy"]) { const r = h(cmd); check(`A2.1 ${cmd.padEnd(10)} on a labeled look-alike with NO ownership record is refused`, refusa(r, /no ownership record/), r.out.trim().split("\n").at(-1).slice(0, 110)); }
  const rc = h("pg-create", { HJ_SOURCE_PG_CONTAINER: fuente, HJ_SOURCE_TEMPLATE_DB: fuentePlantilla }); check("A2.2 pg-create refuses to replace/touch an existing container named hj103_pg", refusa(rc, /already exists/), rc.out.trim().slice(0, 100));
  fs.writeFileSync(path.join(work, "pg.json"), JSON.stringify({ nombre: PG_PROPIO, id: "0".repeat(64), password: P2 }));
  const rf = h("up"); check("A2.3 a record with a DIFFERENT container id is refused", refusa(rf, /id differs/), rf.out.trim().split("\n").at(-1).slice(0, 100));
  const idReal = docker("inspect", "-f", "{{.Id}}", PG_PROPIO);
  fs.writeFileSync(path.join(work, "pg.json"), JSON.stringify({ nombre: PG_PROPIO, id: idReal, password: P2 }));        // someone forges a record with the REAL id…
  const rg = h("up"); check("A2.4 …even then the container holding NON-harness databases is refused (defence in depth)", refusa(rg, /non-harness databases \(ctl_data\)/), rg.out.trim().split("\n").at(-1).slice(0, 120));
  const rs2 = h("seed"); check("A2.5 seed is refused for the same reason", refusa(rs2, /non-harness databases/));
  check("A2.6 the look-alike's role verifiers, databases, data and held template session are UNCHANGED", sinCambios(instantanea(PG_PROPIO, P2), a2));
  fs.rmSync(path.join(work, "pg.json"), { force: true });
  docker("rm", "-f", "-v", PG_PROPIO); propios.splice(propios.indexOf(PG_PROPIO), 1);                                    // our own fixture, removed by name (it carries the check marker)
  docker("rm", "-f", "-v", C1); propios.splice(propios.indexOf(C1), 1);

  // ── B: the dedicated, owned container ──
  const t0 = Date.now(), pc = h("pg-create", { HJ_SOURCE_PG_CONTAINER: fuente, HJ_SOURCE_TEMPLATE_DB: fuentePlantilla });
  check("B1 pg-create builds the dedicated container and loads the template read-only", pc.code === 0 && /ready/.test(pc.out), `${Math.round((Date.now() - t0) / 1000)} s; ${pc.out.trim().split("\n").at(-1).slice(0, 90)}`);
  const reg = JSON.parse(fs.readFileSync(path.join(work, "pg.json"), "utf8")), info = JSON.parse(docker("inspect", PG_PROPIO))[0];
  check("B2 ownership record = the container's full id; harness labels set; no published port", reg.id === info.Id && info.Config.Labels[ETIQUETA_PG] === "dedicated" && Object.keys(info.NetworkSettings.Ports ?? {}).every((k) => !info.NetworkSettings.Ports[k]), reg.id.slice(0, 12));
  const dueno = ajustes({ ...process.env, HJ_WORK: work });
  const pd = (db, sql) => dx(PG_PROPIO, dueno.pgPass, db, sql);
  const rolesAntes = pd("postgres", "select string_agg(rolname || ':' || coalesce(rolpassword, '-'), ';' order by rolname) from pg_authid where rolname in ('authenticator', 'supabase_auth_admin')");
  // guards inside the owned cluster
  pd("postgres", "create database foreign_db");
  for (const cmd of ["up", "seed"]) { const r = h(cmd); check(`B3 ${cmd.padEnd(5)} refuses an owned container that holds a non-harness database`, refusa(r, /non-harness databases \(foreign_db\)/), r.out.trim().split("\n").at(-1).slice(0, 100)); }
  check("B3.1 …and the cluster roles were not touched by those refusals", pd("postgres", "select string_agg(rolname || ':' || coalesce(rolpassword, '-'), ';' order by rolname) from pg_authid where rolname in ('authenticator', 'supabase_auth_admin')") === rolesAntes);
  pd("postgres", "drop database foreign_db");
  pd("postgres", "create database hj103_unmarked_chk template hj103_template"); pd("hj103_unmarked_chk", "create table public.owner_marker(v text); insert into public.owner_marker values ('owner data')");
  const cuenta = () => pd("hj103_unmarked_chk", "select (select count(*) from public.owner_marker) || '|' || (select count(*) from public.ventas)");
  const c0 = cuenta();
  for (const cmd of ["seed", "up", "down"]) { const r = h(cmd, { HJ_DB: "hj103_unmarked_chk" }); check(`B4 ${cmd.padEnd(4)} on a database the harness did not create (unmarked) is refused with data unchanged`, r.code !== 0 && /NOT marked/.test(r.out) && cuenta() === c0, r.out.trim().split("\n").at(-1).slice(0, 90)); }
  pd("postgres", "drop database hj103_unmarked_chk");
  const tUp = Date.now(), up = h("up");
  check("B5 up SUCCEEDS on the owned container (template → database → roles → migrations → Mailpit/GoTrue/PostgREST/gateway)", up.code === 0 && /stack ready/.test(up.out), `${Math.round((Date.now() - tUp) / 1000)} s`);
  const sd = h("seed"); check("B6 seed SUCCEEDS on the harness-marked database", sd.code === 0 && /seeded: 4 users, 2 contracts, 8 requests/.test(sd.out), sd.out.trim().split("\n").at(-1).slice(0, 90));
  check("B7 the database carries the harness marker and the cluster roles changed ONLY inside the owned container", pd("postgres", "select shobj_description(oid, 'pg_database') from pg_database where datname = 'hj103_journey'") === "hostinger-journey-103 disposable" && pd("postgres", "select string_agg(rolname || ':' || coalesce(rolpassword, '-'), ';' order by rolname) from pg_authid where rolname in ('authenticator', 'supabase_auth_admin')") !== rolesAntes);
  const dn = h("down"); check("B8 down removes the stack and drops the marked database; the template stays", dn.code === 0 && /dropped hj103_journey/.test(dn.out) && pd("postgres", "select string_agg(datname, ',' order by datname) from pg_database where datname like 'hj103%'") === "hj103_template" && docker("ps", "-a", "--filter", `label=${ETIQUETA}=1`, "--format", "{{.Names}}") === PG_PROPIO);
  const pdz = h("pg-destroy"); check("B9 pg-destroy removes exactly the verified dedicated container and its record", pdz.code === 0 && dockerOk("inspect", PG_PROPIO) === null && !fs.existsSync(path.join(work, "pg.json")));

  // ── C: the READ-ONLY source was never changed ──
  const fuenteDespues = { roles: dx(fuente, fuentePass, "postgres", "select string_agg(rolname || ':' || coalesce(rolpassword, '-'), ';' order by rolname) from pg_authid where rolname in ('authenticator', 'supabase_auth_admin')"), bds: dx(fuente, fuentePass, "postgres", "select string_agg(datname, ',' order by datname) from pg_database") };
  check("C1 the source container (template donor) kept its role verifiers and database list through the whole run", sinCambios(fuenteAntes, fuenteDespues));
} finally {
  try { h("down"); } catch { /* nothing */ }
  try { if (fs.existsSync(path.join(work, "pg.json"))) h("pg-destroy"); } catch { /* nothing */ }
  for (const c of ["hj103_check_control", PG_PROPIO]) { if (dockerOk("inspect", "-f", `{{index .Config.Labels "${MARCA}"}}`, c) === "1") dockerOk("rm", "-f", "-v", c); }    // only containers that carry THIS check's marker
  for (const p of retener) { try { execFileSync("taskkill", ["/PID", String(p), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } }
  fs.rmSync(work, { recursive: true, force: true });
}
const ok = resultados.every(Boolean);
console.log(`\nPG OWNERSHIP CHECKS ${ok ? "PASSED" : "FAILED"}: ${resultados.filter(Boolean).length}/${resultados.length}`);
process.exit(ok ? 0 : 1);
