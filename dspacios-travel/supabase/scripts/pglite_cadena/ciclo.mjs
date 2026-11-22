// Lifecycle of every NEW migration of the B2B block on the REAL migration chain (embedded PostgreSQL / PGlite, environment stubs only).
// Order requested for the owner: 316 -> 314 -> 317 -> 318 -> 319 -> 322 -> 323.
// Per migration: preflight (all OK/INFO) -> migration -> postcheck (no FALLO/REVISAR) -> re-apply -> postcheck -> SQL test file (if any) -> rollback cases.
// Usage: node ciclo.mjs <repo dspacios-travel path>
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
const reg = (ok, texto) => { total++; if (!ok) fallos++; console.log(`${ok ? "OK   " : "FALLO"} ${texto}`); };

for (const f of fs.readdirSync(mig).filter((x) => x.endsWith(".sql")).sort()) {
  const n = Number(f.match(/^2026060100(\d{4})_/)[1]);
  if (n > 311) break;
  await db.exec(leer(path.join(mig, f)));
}
console.log("base: cadena real hasta la 311 aplicada");

const filasEstado = (res) => {
  const r = Array.isArray(res) ? res.at(-1) : res;
  return r.rows;
};
async function consulta(archivo) {
  const sql = leer(path.join(scr, archivo)).trim().replace(/;\s*$/, "");
  const r = await db.query(sql);
  return r.rows;
}
const malas = (rows) => rows.filter((x) => !/^(OK|INFO)$/i.test(String(x.estado ?? x.veredicto ?? "")));

const PLAN = [
  { n: 316, pre: "preflight_316_recuperaciones_consumidas.sql", post: "postcheck_316_recuperaciones_consumidas.sql", rb: "rollback_316_recuperaciones_consumidas.sql", tests: [] },
  { n: 314, pre: "preflight_314_comparativa_b2b_aliado.sql", post: "postcheck_314_comparativa_b2b_aliado.sql", rb: "rollback_314_comparativa_b2b_aliado.sql", tests: [] },
  { n: 317, pre: "preflight_317_neto_manual.sql", post: "postcheck_317_neto_manual.sql", rb: "rollback_317_neto_manual.sql", tests: ["test_317_neto_manual.sql"] },
  { n: 318, pre: "preflight_318_firma_aceptacion.sql", post: "postcheck_318_firma_aceptacion.sql", rb: "rollback_318_firma_aceptacion.sql", tests: ["test_318_firma_aceptacion.sql"] },
  { n: 319, pre: "preflight_319_aliado_logo.sql", post: "postcheck_319_aliado_logo.sql", rb: "rollback_319_aliado_logo.sql", tests: ["test_319_aliado_logo.sql"] },
  { n: 322, pre: "preflight_322_clientes_aliado.sql", post: "postcheck_322_clientes_aliado.sql", rb: "rollback_322_clientes_aliado.sql", tests: ["test_322_clientes_aliado.sql"] },
  { n: 323, pre: "preflight_323_solicitud_contrato.sql", post: "postcheck_323_solicitud_contrato.sql", rb: "rollback_323_solicitud_contrato.sql", tests: ["test_323_solicitud_contrato.sql", "test_25_correccion_auditoria.sql", "test_25_historial_gemelas.sql"] },
];
// psql meta-commands: inline '\ir file' (fixtures shared by the 216 suites), drop the others (\set ON_ERROR_STOP, ...).
function prepara(archivo, vars = {}) {
  return leer(path.join(scr, archivo)).split("\n").map((l) => {
    const m = l.match(/^\\ir\s+(\S+)/);
    if (m) return prepara(m[1], vars);
    const s = l.match(/^\\set\s+(\w+)\s+'(.*)'\s*$/);
    if (s) { vars[s[1]] = s[2].replace(/''/g, "'"); return ""; }
    if (l.startsWith("\\")) return "";
    let o = l;
    for (const [k, v] of Object.entries(vars)) o = o.replace(new RegExp(`:'${k}'`, "g"), `'${v.replace(/'/g, "''")}'`).replace(new RegExp(`(?<!:):${k}\\b`, "g"), v);
    return o;
  }).join("\n");
}
// Tests of the 216 family end with a RAISE when something failed; remove it so the failing names come back as rows.
const sinRaiseFinal = (sql) => sql.replace(/do \$\$ begin\s+if exists \(select 1 from t216\.res where not ok\)[\s\S]*?end \$\$;/, "");
const SOLO = process.env.SOLO ? process.env.SOLO.split(",").map(Number) : null;

for (const p of PLAN) {
  if (SOLO && !SOLO.includes(p.n)) { // still need to apply it to keep dependencies for later ones
    await db.exec(leer(path.join(mig, migFile(p.n)))); continue;
  }
  console.log(`\n=== ${p.n} ===`);
  try {
    const pre = await consulta(p.pre);
    reg(pre.length > 0 && malas(pre).length === 0, `${p.n} preflight antes: ${pre.length} controles, todos OK/INFO${malas(pre).length ? " — MALOS: " + JSON.stringify(malas(pre).map((x) => x.control)) : ""}`);
    await db.exec(leer(path.join(mig, migFile(p.n))));
    reg(true, `${p.n} migración aplicada`);
    const post = await consulta(p.post);
    reg(post.length > 0 && malas(post).length === 0, `${p.n} postcheck: ${post.length} controles, sin FALLO/REVISAR${malas(post).length ? " — MALOS: " + JSON.stringify(malas(post).map((x) => `${x.control} obs=${x.observado} esp=${x.esperado}`)) : ""}`);
    let rea = "aplicada de nuevo sin error";
    try { await db.exec(leer(path.join(mig, migFile(p.n)))); } catch (e) { rea = "rechazada: " + String(e.message).split("\n")[0].slice(0, 160); try { await db.exec("rollback"); } catch {} }
    console.log(`INFO  ${p.n} re-aplicación: ${rea}`);
    const post2 = await consulta(p.post);
    reg(post2.length > 0 && malas(post2).length === 0, `${p.n} postcheck tras re-aplicar: sin FALLO/REVISAR`);
    for (const t of p.tests) {
      const sql = sinRaiseFinal(prepara(t));
      try {
        const avisos = []; const res = await db.exec(sql, { onNotice: (n) => avisos.push(String(n.message ?? n)) });
        const todas = res.flatMap((r) => r.rows ?? []);
        const resumen = todas.find((x) => x && "aciertos" in x && "fallos" in x);
        if (resumen) {
          const malos = todas.filter((x) => x && "nombre" in x && "detalle" in x && !("aciertos" in x));
          reg(Number(resumen.total) > 0 && Number(resumen.fallos) === 0, `${p.n} ${t}: ${resumen.aciertos}/${resumen.total} aciertos, ${resumen.fallos} en FALLO${malos.length ? " — " + JSON.stringify(malos.slice(0, 8).map((x) => `${x.nombre}: ${String(x.detalle).slice(0, 200)}`)) : ""}`);
        } else if (avisos.some((m) => /^OK:/.test(m))) {
          reg(true, `${p.n} ${t}: sin excepción y con el aviso de éxito del propio test — ${avisos.find((m) => /^OK:/.test(m)).slice(0, 160)}`);
        } else {
          const rows = todas.filter((x) => x && "estado" in x);
          const m = malas(rows);
          reg(rows.length > 0 && m.length === 0, `${p.n} ${t}: ${rows.length} controles, ${m.length} en FALLO${m.length ? " — " + JSON.stringify(m.slice(0, 5).map((x) => `${x.control} obs=${x.observado} esp=${x.esperado}`)) : ""}`);
        }
      } catch (e) { reg(false, `${p.n} ${t}: error de ejecución: ${String(e.message).split("\n")[0].slice(0, 220)}`); try { await db.exec("rollback"); } catch {} }
    }
  } catch (e) { reg(false, `${p.n}: ${String(e.message).split("\n")[0].slice(0, 260)}`); try { await db.exec("rollback"); } catch {} }
}
console.log(`\nRESULTADO: ${total - fallos}/${total} OK, ${fallos} FALLO`);
await db.close();
process.exit(fallos ? 1 : 0);
