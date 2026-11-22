// Protected rollback cases for every NEW migration, on the REAL migration chain (PGlite; environment stubs only).
// Per migration (reverse order 323,322,319,318,317,314,316): with data -> rollback must REFUSE and leave the object; without data -> rollback succeeds,
// preflight reads "to apply" again (all OK/INFO), re-applying the migration passes the postcheck.
// Usage: node rollbacks.mjs <repo dspacios-travel path>
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import fs from "node:fs";
import path from "node:path";
import { ENTORNO } from "./entorno.mjs";

const repo = process.argv[2];
const mig = path.join(repo, "supabase", "migrations");
const scr = path.join(repo, "supabase", "scripts");
const leer = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const migFile = (n) => fs.readdirSync(mig).find((f) => f.startsWith(`2026060100${String(n).padStart(4, "0")}_`));
const db = new PGlite({ extensions: { uuid_ossp } });
await db.exec(ENTORNO);
let total = 0, fallos = 0;
const reg = (ok, t) => { total++; if (!ok) fallos++; console.log(`${ok ? "OK   " : "FALLO"} ${t}`); };
for (const f of fs.readdirSync(mig).filter((x) => x.endsWith(".sql")).sort()) await db.exec(leer(path.join(mig, f)));
console.log("base: cadena real completa (001-323 del árbol) aplicada");

const q = async (archivo) => (await db.query(leer(path.join(scr, archivo)).trim().replace(/;\s*$/, ""))).rows;
const malas = (rows) => rows.filter((x) => !/^(OK|INFO)$/i.test(String(x.estado ?? "")));
const intenta = async (sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec("rollback"); } catch {} return String(e.message).split("\n")[0]; } };
const existe = async (reg_) => (await db.query(`select to_regclass('${reg_}') is not null as e`)).rows[0].e;

// Minimal fixture insert: every NOT NULL column without default gets a type-based value; per-table overrides below. FK/triggers are off for the insert only.
async function fila(tabla, over = {}) {
  const cols = (await db.query(`select column_name, data_type, udt_name from information_schema.columns where table_schema='public' and table_name=$1 and is_nullable='NO' and column_default is null and is_generated='NEVER' and identity_generation is null`, [tabla])).rows;
  const val = (c) => {
    if (c.column_name in over) return over[c.column_name];
    switch (c.data_type) {
      case "uuid": return "gen_random_uuid()"; case "text": case "character varying": return "'x'";
      case "integer": case "bigint": case "smallint": case "numeric": return "1"; case "boolean": return "true";
      case "jsonb": case "json": return "'{}'::jsonb"; case "date": return "current_date"; case "timestamp with time zone": return "now()";
      case "ARRAY": return "'{}'"; default: return "null";
    }
  };
  const all = { ...Object.fromEntries(cols.map((c) => [c.column_name, val(c)])), ...over };
  const names = Object.keys(all);
  await db.exec(`set session_replication_role = replica; insert into public.${tabla} (${names.join(",")}) values (${names.map((n) => all[n]).join(",")}); set session_replication_role = origin;`);
}
const vaciar = (t) => db.exec(`set session_replication_role = replica; delete from public.${t}; set session_replication_role = origin;`);

const PLAN = [
  { n: 323, pre: "preflight_323_solicitud_contrato.sql", post: "postcheck_323_solicitud_contrato.sql", rb: "rollback_323_solicitud_contrato.sql", objeto: "public.cotizacion_solicitudes_contrato", datos: async () => { await fila("cotizacion_solicitudes_contrato"); }, limpia: () => vaciar("cotizacion_solicitudes_contrato"), refusa: /ROLLBACK 323 detenido/ },
  { n: 322, pre: "preflight_322_clientes_aliado.sql", post: "postcheck_322_clientes_aliado.sql", rb: "rollback_322_clientes_aliado.sql", objeto: "public.aliado_clientes", datos: async () => { await fila("aliado_clientes", { clave: "'cliente-de-prueba'", nombre: "'Cliente Prueba'" }); }, limpia: () => vaciar("aliado_clientes"), refusa: /ROLLBACK 322 detenido/ },
  { n: 319, pre: "preflight_319_aliado_logo.sql", post: "postcheck_319_aliado_logo.sql", rb: "rollback_319_aliado_logo.sql", objeto: "public.aliado_logos", datos: async () => { await fila("aliado_logos", { mime: "'image/png'", sha256: "repeat('a',64)", via: "'portal'" }); }, limpia: () => vaciar("aliado_logos"), refusa: /ROLLBACK_319_RECHAZADO/ },
  { n: 318, pre: "preflight_318_firma_aceptacion.sql", post: "postcheck_318_firma_aceptacion.sql", rb: "rollback_318_firma_aceptacion.sql", objeto: "public.cuenta_cobro_aceptaciones", datos: async () => { await fila("aliado_firmas", { mime: "'image/png'", sha256: "repeat('a',64)" }); }, limpia: () => vaciar("aliado_firmas"), refusa: /318 rollback: hay firmas/ },
  { n: 317, pre: "preflight_317_neto_manual.sql", post: "postcheck_317_neto_manual.sql", rb: "rollback_317_neto_manual.sql", objeto: "public.cotizacion_neto", datos: async () => { await fila("cotizaciones", { id: 987001, tenant: "'mayorista'" }); await fila("cotizacion_neto", { cotizacion_id: 987001, modalidad: "'neto'", aliado_id: 1, moneda: "'COP'", tipo_asesor: "'agencia'", reconoce_recobro: 'false', pvp_total: '5000000', descuento_total: '480000', neto_total: '4520000', costo_total: '4000000', base_comision: '4000000', pct_comision: '0.12', solo_tiquetes: 'false', piso: '0.06', comision_ordinaria: '480000', participacion_recobro: '0' }); }, limpia: async () => { await vaciar("cotizacion_neto"); await db.exec("set session_replication_role = replica; delete from public.cotizaciones where id = 987001; set session_replication_role = origin;"); }, refusa: /ROLLBACK 317/ },
  { n: 314, pre: "preflight_314_comparativa_b2b_aliado.sql", post: "postcheck_314_comparativa_b2b_aliado.sql", rb: "rollback_314_comparativa_b2b_aliado.sql", objeto: null, datos: null },
  { n: 316, pre: "preflight_316_recuperaciones_consumidas.sql", post: "postcheck_316_recuperaciones_consumidas.sql", rb: "rollback_316_recuperaciones_consumidas.sql", objeto: "public.recuperaciones_consumidas", datos: null },
];
const SOLO = process.env.SOLO ? process.env.SOLO.split(",").map(Number) : null;
for (const p of PLAN) {
  if (SOLO && !SOLO.includes(p.n)) { await db.exec(leer(path.join(scr, p.rb))).catch(() => {}); continue; }
  console.log(`\n=== rollback ${p.n} ===`);
  if (p.datos) {
    try {
      await p.datos();
      const e = await intenta(leer(path.join(scr, p.rb)));
      reg(e != null && p.refusa.test(e), `${p.n} con datos: el rollback se NIEGA (${e ? e.slice(0, 120) : "NO se negó"})`);
      if (p.objeto) reg(await existe(p.objeto), `${p.n} con datos: el objeto sigue existiendo`);
    } catch (e) { reg(false, `${p.n} fixture/rollback con datos: ${String(e.message).split("\n")[0].slice(0, 200)}`); }
    await p.limpia();
  } else console.log(`INFO  ${p.n}: sin guarda de datos por diseño (${p.n === 314 ? "restaura el cuerpo de la 211" : "solo marcadores «ya usado»"})`);
  const e2 = await intenta(leer(path.join(scr, p.rb)));
  reg(e2 == null, `${p.n} sin datos: el rollback se aplica${e2 ? " — " + e2.slice(0, 160) : ""}`);
  if (p.objeto && p.n !== 317 && p.n !== 314) reg(!(await existe(p.objeto)), `${p.n} tras el rollback: el objeto ya no existe`);
  try {
    const pre = await q(p.pre);
    reg(pre.length > 0 && malas(pre).length === 0, `${p.n} preflight tras el rollback vuelve a «por aplicar»: ${pre.length} controles OK/INFO${malas(pre).length ? " — MALOS " + JSON.stringify(malas(pre).map((x) => x.control)) : ""}`);
    await db.exec(leer(path.join(mig, migFile(p.n))));
    const post = await q(p.post);
    reg(post.length > 0 && malas(post).length === 0, `${p.n} re-aplicada tras el rollback: postcheck ${post.length} controles sin FALLO/REVISAR`);
  } catch (e) { reg(false, `${p.n} preflight/re-aplicación: ${String(e.message).split("\n")[0].slice(0, 220)}`); try { await db.exec("rollback"); } catch {} }
}
console.log(`\nRESULTADO: ${total - fallos}/${total} OK, ${fallos} FALLO`);
await db.close();
process.exit(fallos ? 1 : 0);
