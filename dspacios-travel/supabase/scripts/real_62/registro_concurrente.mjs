// B5 — Carreras REALES del registro B2B (migración 324) sobre la imagen real de Supabase Postgres, con sesiones psql independientes y esperas OBSERVADAS en pg_stat_activity.
// Casos:
//  R1 · una verificación en vuelo con el candado de fila tomado: la limpieza (descartar) ESPERA y, al terminar, ve el intento sin resolver → «ocupado» (no autoriza borrar).
//  R2 · el código correcto confirma la cuenta dentro de su transacción; el quinto intento incorrecto simultáneo ESPERA y al entrar resuelve «verificado» (nunca «descartar»).
//  R3 · reinicio (borrado atómico con su transacción abierta) y verificación a la vez: la reserva simultánea ESPERA y recibe «sin_cuenta».
//  R4 · ráfaga: N sesiones concurrentes mezclan reservar/resolver/descartar con una confirmación a mitad; al final se cumplen los invariantes (toda cuenta que una sesión confirmó dentro de un intento reservado SIGUE existiendo y confirmada; contadores coherentes).
//  L1 · verificación TARDÍA (transacción que confirma el correo) frente a un reinicio con la reserva vencida: el borrado espera y NO borra («verificado»).
//  L2 · el reinicio gana: la confirmación tardía llega a una cuenta borrada (UPDATE 0) y nada reaparece.   L3 · proceso interrumpido: la reserva huérfana se libera sin contarse como fallo.
//  R5 · completar concurrente (doble clic / dos pestañas): dos sesiones piden la solicitud a la vez → UNA sola fila en b2b_solicitudes.
// Uso (desde dspacios-travel/):  node supabase/scripts/real_62/registro_concurrente.mjs [contenedor=pgb2b] [plantilla=plantillab2b]
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PG = process.argv[2] ?? "pgb2b", PLANTILLA = process.argv[3] ?? "plantillab2b";
const MIG = join(process.cwd(), "supabase", "migrations", "20260601000324_registro_b2b_candados.sql");
const base = ["exec", "-i", "-e", "PGPASSWORD=postgres"];
const psqlArgs = (db, extra = []) => ["psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", ...extra];
const sql = (db, q, input) => execFileSync("docker", [...base, PG, ...psqlArgs(db), ...(input ? [] : ["-c", q])], { encoding: "utf8", input }).trim();
const sqlSafe = (db, q) => { try { return sql(db, q); } catch (e) { return "ERR:" + String(e.stderr ?? e.message).split("\n")[0]; } };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, fallos = 0;
const reg = (ok, t) => { total++; if (!ok) fallos++; console.log(`${ok ? "OK   " : "FALLO"} ${t}`); };
function lanzar(db, app, q) {
  const p = spawn("docker", [...base, "-e", `PGAPPNAME=${app}`, PG, ...psqlArgs(db), "-c", q], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  return { fin: new Promise((r) => p.on("close", (code) => r({ code, out: out.trim(), err }))) };
}
async function hasta(cond, ms = 20000, paso = 120) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await dormir(paso); } return false; }
const esperando = (db, app) => sql(db, `select count(*) from pg_stat_activity where application_name = '${app}' and wait_event_type = 'Lock'`) === "1";
const activo = (db, app, frag) => sql(db, `select count(*) from pg_stat_activity where application_name = '${app}' and state = 'active' and query like '%${frag}%'`) === "1";

// ── Base desechable: plantilla + columnas reales de auth.users + 324 ─────────────────────────────────────────────────────────────────────────────────
const BASE = "m_regconc_base";
sqlSafe("postgres", `select pg_terminate_backend(pid) from pg_stat_activity where datname in ('${BASE}','${PLANTILLA}') and pid <> pg_backend_pid()`);
sqlSafe("postgres", `drop database if exists ${BASE} with (force)`);
sql("postgres", `create database ${BASE} template ${PLANTILLA}`);
sql(BASE, "alter table auth.users add column if not exists email_confirmed_at timestamptz, add column if not exists raw_app_meta_data jsonb");
execFileSync("docker", [...base, PG, ...psqlArgs(BASE, ["-1"])], { input: readFileSync(MIG), encoding: "utf8" });
const U = (n) => `00000000-0000-4000-8000-0000003250${String(n).padStart(2, "0")}`;
function cuenta(db, n) {
  sql(db, `insert into auth.users (id, email, raw_app_meta_data) values ('${U(n)}', 'c325-${n}@x.test', '{"registro_b2b_codigo": true}'::jsonb) on conflict (id) do nothing;
           insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${U(n)}', 'c325-${n}@x.test', 'C325 Aliado ${n}', 'agencia', false, 'mayorista') on conflict (id) do update set rol = 'agencia', activo = false;
           select public.registro_b2b_iniciar('${U(n)}', '{"nit":"325${n}"}'::jsonb)`);
}
const fn = (db, f, ...a) => sql(db, `select public.${f}(${a.join(", ")})`);
const q = (s) => `'${s}'`;
let caso = 0;
function nuevaBase() { const db = `m_regconc_${++caso}`; sqlSafe("postgres", `drop database if exists ${db} with (force)`); sql("postgres", `create database ${db} template ${BASE}`); return db; }
const soltar = (db) => sqlSafe("postgres", `drop database if exists ${db} with (force)`);
const cuatroFallos = (db, n) => { for (let i = 0; i < 4; i++) { fn(db, "registro_b2b_reclamar_intento", q(U(n))); fn(db, "registro_b2b_resolver_intento", q(U(n)), q("fallo")); } };

// R1 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{ console.log("\n=== R1 · limpieza frente a una verificación en vuelo (candado de fila tomado) ===");
  const db = nuevaBase(); cuenta(db, 1);
  const X = lanzar(db, "reg_X", `begin; select public.registro_b2b_reclamar_intento('${U(1)}'); do $$ declare t timestamptz := clock_timestamp(); begin loop perform pg_stat_clear_snapshot(); exit when exists (select 1 from pg_stat_activity where application_name = 'reg_Y' and wait_event_type = 'Lock') or clock_timestamp() > t + interval '30 seconds'; perform pg_sleep(0.1); end loop; end $$; select pg_sleep(1.5); commit;`);
  await hasta(() => activo(db, "reg_X", "clock_timestamp"));
  const Y = lanzar(db, "reg_Y", `select public.registro_b2b_descartar('${U(1)}')`);
  const vistoEsperando = await hasta(() => esperando(db, "reg_Y"), 3000);
  const [rx, ry] = await Promise.all([X.fin, Y.fin]);
  reg(vistoEsperando, "R1 · la limpieza quedó ESPERANDO el candado de fila mientras la verificación tenía el intento reservado (observado)");
  reg(rx.code === 0 && ry.code === 0 && ry.out === "ocupado", `R1 · al entrar, la limpieza ve el intento en vuelo y responde «ocupado» (no autoriza borrar): «${ry.out}»`);
  reg(sql(db, `select estado || '/' || en_vuelo from public.registro_b2b_estado where usuario_id = '${U(1)}'`) === "pendiente/1", "R1 · el estado sigue «pendiente» con el intento en vuelo (nada se marcó para descarte)");
  soltar(db); }

// R2 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{ console.log("\n=== R2 · código correcto confirma la cuenta; el quinto incorrecto simultáneo no la descarta ===");
  const db = nuevaBase(); cuenta(db, 2); cuatroFallos(db, 2);
  // Dos reservas simultáneas no caben: el quinto intento (el correcto) lo reserva A; el incorrecto B es la reserva que sobra y se declara «en_curso».
  fn(db, "registro_b2b_reclamar_intento", q(U(2)));   // A: quinto intento reservado y en vuelo
  const A = lanzar(db, "reg_A", `begin; update auth.users set email_confirmed_at = now() where id = '${U(2)}'; select public.registro_b2b_resolver_intento('${U(2)}', 'exito'); do $$ declare t timestamptz := clock_timestamp(); begin loop perform pg_stat_clear_snapshot(); exit when exists (select 1 from pg_stat_activity where application_name = 'reg_B' and wait_event_type = 'Lock') or clock_timestamp() > t + interval '30 seconds'; perform pg_sleep(0.1); end loop; end $$; select pg_sleep(1.5); commit;`);
  await hasta(() => activo(db, "reg_A", "clock_timestamp"));
  const B = lanzar(db, "reg_B", `select public.registro_b2b_resolver_intento('${U(2)}', 'fallo')`);   // el «incorrecto» resuelve MIENTRAS A tiene el candado
  const visto = await hasta(() => esperando(db, "reg_B"), 3000);
  const [ra, rb] = await Promise.all([A.fin, B.fin]);
  reg(visto, "R2 · el intento incorrecto quedó ESPERANDO el candado mientras el correcto confirmaba la cuenta (observado)");
  reg(ra.code === 0 && rb.code === 0 && rb.out === "verificado", `R2 · el incorrecto resuelve «verificado» (NUNCA «descartar»): «${rb.out}»`);
  reg(fn(db, "registro_b2b_descartar", q(U(2))) === "verificado", "R2 · y descartar sigue sin autorizar el borrado de la cuenta verificada");
  reg(sql(db, `select count(*) from auth.users where id = '${U(2)}'`) === "1", "R2 · la cuenta verificada sigue existiendo");
  soltar(db); }

// R3 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{ console.log("\n=== R3 · reinicio (borrado atómico con su transacción abierta) frente a una verificación nueva ===");
  const db = nuevaBase(); cuenta(db, 3);
  const D = lanzar(db, "reg_D", `begin; select public.registro_b2b_descartar('${U(3)}'); do $$ declare t timestamptz := clock_timestamp(); begin loop perform pg_stat_clear_snapshot(); exit when exists (select 1 from pg_stat_activity where application_name = 'reg_V' and wait_event_type = 'Lock') or clock_timestamp() > t + interval '30 seconds'; perform pg_sleep(0.1); end loop; end $$; select pg_sleep(1.5); commit;`);
  await hasta(() => activo(db, "reg_D", "clock_timestamp"));
  const V = lanzar(db, "reg_V", `select public.registro_b2b_reclamar_intento('${U(3)}')`);
  const visto = await hasta(() => esperando(db, "reg_V"), 3000);
  const [rd, rv] = await Promise.all([D.fin, V.fin]);
  reg(visto, "R3 · la verificación nueva quedó ESPERANDO mientras el reinicio tenía la cuenta borrada sin confirmar (observado)");
  reg(rd.code === 0 && rv.code === 0 && rv.out === "sin_cuenta", `R3 · al entrar, la cuenta ya no existe: «sin_cuenta» (ni error de integridad ni verificación sobre nada): «${rv.out}»`);
  reg(sql(db, `select count(*) from auth.users where id = '${U(3)}'`) === "0" && sql(db, `select count(*) from public.registro_b2b_estado where usuario_id = '${U(3)}'`) === "0", "R3 · la cuenta, su perfil y su estado desaparecieron juntos (cascada)");
  soltar(db); }

// R4 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{ console.log("\n=== R4 · ráfaga concurrente con confirmación a mitad (invariantes) ===");
  const db = nuevaBase(); const N = 6; for (let n = 1; n <= N; n++) cuenta(db, n);
  sql(db, "create table public.rc_conf (id uuid)");   // cuentas que una sesión CONFIRMÓ dentro de un intento reservado (la fila realmente actualizada)
  const trabajos = [];
  // Cada sesión se comporta como la app: solo resuelve un intento que reservó («ok»); mezcla éxito/fallo/omitido y a veces pide descartar; una de cada tres confirma el correo a mitad.
  for (let n = 1; n <= N; n++) for (let s = 0; s < 3; s++) {
    const bloque = `do $$ declare r text; i int; nn int; hecho boolean := false; begin perform pg_sleep(${s === 1 ? 0 : 0.25}); for i in 1 .. 8 loop
      r := public.registro_b2b_reclamar_intento('${U(n)}');
      if r = 'ok' then
        -- Como en la app, el correo solo se confirma DENTRO de un intento reservado (verifyOtp con el código correcto), nunca por fuera.
        ${s === 1 ? `if not hecho then hecho := true; update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = '${U(n)}'; get diagnostics nn = row_count; if nn = 1 then insert into public.rc_conf values ('${U(n)}'); end if; perform public.registro_b2b_resolver_intento('${U(n)}', 'exito'); continue; end if;` : ""}
        perform public.registro_b2b_resolver_intento('${U(n)}', case (i + ${n + s}) % 4 when 0 then 'fallo' when 1 then 'exito' else 'omitido' end);
      end if;
      if i % 3 = 0 then perform public.registro_b2b_descartar('${U(n)}'); end if;
    end loop; end $$`;
    trabajos.push(lanzar(db, `reg_r4_${n}_${s}`, bloque).fin);
  }
  const res = await Promise.all(trabajos);
  reg(res.every((r) => r.code === 0), `R4 · las ${res.length} sesiones terminan sin error ni bloqueo mutuo (${res.filter((r) => r.code !== 0).length} con error)`);
  reg(sql(db, "select count(*) from public.rc_conf c where not exists (select 1 from auth.users u where u.id = c.id and u.email_confirmed_at is not null)") === "0", `R4 · INVARIANTE: las ${sql(db, "select count(*) from public.rc_conf")} cuentas confirmadas durante la ráfaga siguen existiendo y confirmadas (ninguna confirmada fue borrada)`);
  reg(Number(sql(db, "select count(*) from public.rc_conf")) >= 3, `R4 · la prueba NO es vacía: se confirmaron ${sql(db, "select count(*) from public.rc_conf")} de 6 cuentas dentro de intentos reservados`);
  reg(sql(db, "select count(*) from public.registro_b2b_estado where fallos + en_vuelo > reclamados or en_vuelo < 0") === "0", "R4 · contadores coherentes (fallos + en vuelo ≤ reclamados; en vuelo ≥ 0)");
  soltar(db); }

// R5 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{ console.log("\n=== R5 · completar simultáneo (doble clic / dos pestañas) ===");
  const db = nuevaBase(); cuenta(db, 5); sql(db, `update auth.users set email_confirmed_at = now() where id = '${U(5)}'`);
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => lanzar(db, `reg_c_${i}`, `select public.registro_b2b_completar('${U(5)}')`).fin));
  const salidas = rs.map((r) => r.out).sort();
  reg(rs.every((r) => r.code === 0) && salidas.filter((x) => x === "creada").length === 1 && salidas.filter((x) => x === "ya_existia").length === 7, `R5 · 8 llamadas simultáneas: exactamente UNA «creada» y siete «ya_existia» (${salidas.join(",")})`);
  reg(sql(db, `select count(*) from public.b2b_solicitudes where usuario_id = '${U(5)}'`) === "1", "R5 · UNA sola solicitud en b2b_solicitudes");
  soltar(db); }

// L1 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// La confirmación de Auth es un UPDATE de la fila de auth.users: aquí una transacción hace exactamente eso (como la verificación tardía de GoTrue) y se queda abierta.
{ console.log("\n=== L1 · verificación TARDÍA de Auth (confirma tras vencer la reserva) frente a un reinicio ===");
  const db = nuevaBase(); cuenta(db, 6);
  sql(db, `select public.registro_b2b_reclamar_intento('${U(6)}'); update public.registro_b2b_estado set ultimo_reclamo = now() - interval '3 minutes' where usuario_id = '${U(6)}'`);
  const G = lanzar(db, "reg_G", `begin; update auth.users set email_confirmed_at = now() where id = '${U(6)}'; do $$ declare t timestamptz := clock_timestamp(); begin loop perform pg_stat_clear_snapshot(); exit when exists (select 1 from pg_stat_activity where application_name = 'reg_Y' and wait_event_type = 'Lock') or clock_timestamp() > t + interval '30 seconds'; perform pg_sleep(0.1); end loop; end $$; select pg_sleep(1.5); commit;`);
  await hasta(() => activo(db, "reg_G", "clock_timestamp"));
  const Y = lanzar(db, "reg_Y", `select public.registro_b2b_descartar('${U(6)}')`);
  const visto = await hasta(() => esperando(db, "reg_Y"), 3000);
  const [rg, ry] = await Promise.all([G.fin, Y.fin]);
  reg(visto, "L1 · el borrado del reinicio quedó ESPERANDO el candado de la fila que la verificación tardía estaba confirmando (observado)");
  reg(rg.code === 0 && ry.code === 0 && ry.out === "verificado", `L1 · al terminar la confirmación el borrado no encuentra fila sin confirmar y responde «verificado» (NO borró): «${ry.out}»`);
  reg(sql(db, `select count(*) from auth.users where id = '${U(6)}' and email_confirmed_at is not null`) === "1", "L1 · la cuenta confirmada tarde sigue existiendo");
  reg(fn(db, "registro_b2b_completar", q(U(6))) === "creada", "L1 · y el registro se completa sin pérdida («creada»)");
  soltar(db); }

// L2 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{ console.log("\n=== L2 · el reinicio gana: la confirmación tardía llega a una cuenta ya borrada ===");
  const db = nuevaBase(); cuenta(db, 7);
  sql(db, `select public.registro_b2b_reclamar_intento('${U(7)}'); update public.registro_b2b_estado set ultimo_reclamo = now() - interval '3 minutes' where usuario_id = '${U(7)}'`);
  const D = lanzar(db, "reg_D2", `begin; select public.registro_b2b_descartar('${U(7)}'); do $$ declare t timestamptz := clock_timestamp(); begin loop perform pg_stat_clear_snapshot(); exit when exists (select 1 from pg_stat_activity where application_name = 'reg_G2' and wait_event_type = 'Lock') or clock_timestamp() > t + interval '30 seconds'; perform pg_sleep(0.1); end loop; end $$; select pg_sleep(1.5); commit;`);
  await hasta(() => activo(db, "reg_D2", "clock_timestamp"));
  const G = lanzar(db, "reg_G2", `with u as (update auth.users set email_confirmed_at = now() where id = '${U(7)}' returning 1) select count(*) from u`);
  const visto = await hasta(() => esperando(db, "reg_G2"), 3000);
  const [rd, rg] = await Promise.all([D.fin, G.fin]);
  reg(visto, "L2 · la confirmación tardía quedó ESPERANDO la fila que el reinicio estaba borrando (observado)");
  reg(rd.code === 0 && rg.code === 0 && rg.out === "0", `L2 · al terminar el borrado la confirmación actualiza 0 filas («${rg.out}»): la cuenta no reaparece confirmada`);
  reg(sql(db, `select count(*) from auth.users where id = '${U(7)}'`) === "0" && fn(db, "registro_b2b_completar", q(U(7))) === "sin_cuenta" && sql(db, `select count(*) from public.b2b_solicitudes where usuario_id = '${U(7)}'`) === "0", "L2 · sin cuenta, completar → «sin_cuenta» y ninguna solicitud huérfana");
  soltar(db); }

// L3 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{ console.log("\n=== L3 · proceso interrumpido: reserva que nunca se resolvió ===");
  const db = nuevaBase(); cuenta(db, 8); cuatroFallos(db, 8);
  fn(db, "registro_b2b_reclamar_intento", q(U(8)));   // quinto cupo reservado y el proceso «muere»
  reg(fn(db, "registro_b2b_reclamar_intento", q(U(8))) === "en_curso", "L3 · mientras la reserva es reciente, otra verificación espera («en_curso»)");
  sql(db, `update public.registro_b2b_estado set ultimo_reclamo = now() - interval '3 minutes' where usuario_id = '${U(8)}'`);
  reg(fn(db, "registro_b2b_reclamar_intento", q(U(8))) === "ok" && sql(db, `select fallos || '/' || en_vuelo from public.registro_b2b_estado where usuario_id = '${U(8)}'`) === "4/1", "L3 · vencida, se LIBERA sin contarse como fallo: la siguiente reserva da «ok» (4 fallos reales, 1 en vuelo)");
  cuenta(db, 9); fn(db, "registro_b2b_reclamar_intento", q(U(9)));
  sql(db, `update public.registro_b2b_estado set ultimo_reclamo = now() - interval '3 minutes' where usuario_id = '${U(9)}'`);
  reg(fn(db, "registro_b2b_descartar", q(U(9))) === "borrada" && sql(db, `select count(*) from auth.users where id = '${U(9)}'`) === "0", "L3 · sin verificación tardía, el reinicio reemplaza la cuenta sin verificar (no queda atascada)");
  soltar(db); }

sqlSafe("postgres", `drop database if exists ${BASE} with (force)`);
console.log(`\nRESULTADO: ${total - fallos}/${total} OK, ${fallos} FALLO`);
process.exit(fallos ? 1 : 0);
