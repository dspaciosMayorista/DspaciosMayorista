// Inspección VISUAL del documento del cliente en la copia de ensayo (nunca la base del dueño): crea contratos sintéticos que fuerzan los casos de RESPALDO del documento (sin reparto exacto del ajuste, servicio con cantidad inválida)
// y el caso de contraste, y para cada uno guarda captura a 1280 / 768 / 390 px y un PDF (impresión real del navegador), midiendo desborde y aplicando las reglas incondicionales: ningún «Ajuste por redondeo», ningún servicio con precio propio, total guardado intacto.
//   node supabase/scripts/revision_consolidada/visual_documentos.mjs <carpeta de salida>
import { chromium } from "../../../node_modules/@playwright/test/index.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SALIDA = process.argv[2] ?? "C:/tmp/consolidada/rev2/visual_docs";
fs.mkdirSync(SALIDA, { recursive: true });
const CFG = path.join(process.env.LOCALAPPDATA, "dspacios-local-revision-consolidada");
const cfg = JSON.parse(fs.readFileSync(path.join(CFG, "config.json"), "utf8"));
const APP = `http://localhost:${cfg.puertos.app}`, DB = "rev_consolidada_ensayo";
const sql = (q) => { const r = spawnSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", "pgrevc", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }); if (r.status !== 0) throw new Error("SQL: " + (r.stderr || r.stdout).slice(0, 300)); return r.stdout.trim(); };
const BASE = "DTM-0003";   // contrato pendiente en COP del recorrido (B95): se clona SOLO su cabecera
const AJ = "Ajuste de redondeo del reparto del hotel";   // texto EXACTO de la línea (DESCRIPCION_AJUSTE_REDONDEO)
// [numero, titulo, moneda, items[descripcion, adultos, ninos, tarifaAdulto, tarifaNino], expectativas]
const CASOS = [
  ["DTM-9911", "F1 · ajuste con solo niños (sin fila de adultos que lo reciba)", "COP", [["Niño 1 · Superior / PAM", 0, 2, 0, 100000], [AJ, 1, 0, 5, 0]], { sinColumnasValor: true, total: "200.005" }],
  ["DTM-9912", "F2 · centavos fraccionarios entre filas", "COP", [["Hotel A · Superior / PAM", 1, 0, 100000, 0], ["Hotel B · Superior / PAM", 2, 0, 90000, 0], [AJ, 1, 0, 0.01, 0]], { sinColumnasValor: true, total: "280.000" }],
    ["DTM-9913", "F3 · servicio en el contrato SIN reparto posible del ajuste (solo niños + servicio): el servicio nunca lleva precio", "COP", [["Niño 1 · Superior / PAM", 0, 2, 0, 100000], ["Servicio · Asistencia médica VIS", 1, 0, 76000, 0], [AJ, 1, 0, 5, 0]], { sinColumnasValor: true, total: "276.005", servicio: "Asistencia médica VIS", precioServicio: /76.000/ }],
  ["DTM-9914", "F4 · contraste: el ajuste SÍ se puede absorber (2 adultos)", "COP", [["PAQUETE · Superior / PAM", 2, 0, 715228, 0], [AJ, 1, 0, -1, 0]], { conColumnasValor: true, total: "1.430.455" }],
    ["DTM-9915", "F5 · presentación del redondeo (3 adultos × USD 477,33 + ajuste de 1 centavo = USD 1.432,00): DECISIÓN PENDIENTE del dueño", "USD", [["1 hab Triple (3 pax) · Superior / PAM", 3, 0, 477.33, 0], [AJ, 1, 0, 0.01, 0]], { conColumnasValor: true, total: "USD $1,432" }],
];
for (const [n, , moneda, items] of CASOS) {
  sql(`delete from public.contrato_items where numero_contrato = '${n}'; delete from public.ventas where numero_contrato = '${n}';
       insert into public.ventas select (jsonb_populate_record(null::public.ventas, to_jsonb(v) || jsonb_build_object('numero_contrato', '${n}', 'moneda', '${moneda}', 'share_token', gen_random_uuid(), 'cotizacion_id', null, 'contrato_uid', gen_random_uuid(), 'cliente', 'Cliente Visual ${n}'))).* from public.ventas v where v.numero_contrato = '${BASE}';`);
  items.forEach(([d, a, ni, ta, tn], i) => sql(`insert into public.contrato_items (numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden, modo_precio) values ('${n}', '${d.replace(/'/g, "''")}', ${a}, ${ni}, ${ta}, ${tn}, ${i + 1}, 'por_persona')`));
  const total = items.reduce((s, [, a, ni, ta, tn]) => s + a * ta + ni * tn, 0);
  sql(`update public.ventas set precio_venta = ${total} where numero_contrato = '${n}'`);
}
const nav = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-CO", timezoneId: "America/Bogota" });
const lg = await ctx.newPage();
await lg.goto(`${APP}/login`); await lg.waitForLoadState("networkidle").catch(() => {});
await lg.fill('input[name="email"]', "superadmin@consolidada.test"); await lg.fill('input[name="password"]', "Consolidada2026!");
await Promise.all([lg.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => null), lg.click('button[type="submit"]')]);
await lg.close();
const res = [];
const check = (caso, nombre, ok, det = "") => { res.push({ caso, nombre, ok: !!ok, det: String(det).slice(0, 300) }); console.log(`  ${ok ? "OK   " : "FALLA"} ${nombre}${ok ? "" : " · " + String(det).slice(0, 200)}`); };
for (const [n, titulo, , , exp] of CASOS) {
  console.log(`\n[${n}] ${titulo}`);
  for (const [w, et] of [[1280, "1280"], [768, "768"], [390, "390"]]) {
    const p = await ctx.newPage(); await p.setViewportSize({ width: w, height: 900 });
    const errores = []; p.on("pageerror", (e) => errores.push(String(e).slice(0, 160)));
    await p.goto(`${APP}/contrato/${n}`, { waitUntil: "domcontentloaded" }); await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}); await p.waitForTimeout(900);
    await p.screenshot({ path: path.join(SALIDA, `${n}_${et}.png`), fullPage: true });
    const t = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    const desborde = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(n, `[${et}] sin desborde horizontal`, !desborde);
    check(n, `[${et}] ninguna fila «Ajuste por redondeo»`, !/ajuste (de|por) redondeo/i.test(t), t.match(/.{0,40}ajuste[^.]{0,40}/i)?.[0]);
    check(n, `[${et}] el total guardado ${exp.total} se conserva`, t.replace(/\$\s+/g, "$").includes(exp.total), t.slice(t.indexOf("Valores y Pagos"), t.indexOf("Valores y Pagos") + 160));
    const cab = t.slice(t.indexOf("Valores y Pagos"), t.indexOf("CONTRATO DE PRESTACI", t.indexOf("Valores y Pagos")));
    if (exp.sinColumnasValor) check(n, `[${et}] sin columnas de tarifa/valor (no se inventa un reparto)`, !/Tarifa Adulto|Valor total/.test(cab), cab.slice(0, 200));
    if (exp.conColumnasValor && w >= 768) check(n, `[${et}] conserva las columnas de tarifa y valor`, /Tarifa Adulto/.test(cab) && /Valor total/.test(cab), cab.slice(0, 200));
    if (exp.servicio) { const i = t.indexOf(exp.servicio); check(n, `[${et}] el servicio se describe y NO muestra precio propio`, i >= 0 && !exp.precioServicio.test(t.slice(i, i + 140)), t.slice(i, i + 140)); check(n, `[${et}] no existe la tabla «Servicios adicionales» con valor total`, !/Servicios adicionales\s+Servicio\s+Pax\s+Valor total/.test(t)); }
    check(n, `[${et}] sin errores de página`, errores.length === 0, errores.join(" | "));
    if (w === 1280) { await p.emulateMedia({ media: "print" }); await p.pdf({ path: path.join(SALIDA, `${n}.pdf`), format: "A4", printBackground: true }); }
    await p.close();
  }
}
await nav.close();
fs.writeFileSync(path.join(SALIDA, "informe.json"), JSON.stringify({ base: DB, fecha: new Date().toISOString(), total: res.length, fallas: res.filter((r) => !r.ok).length, resultados: res }, null, 1));
console.log(`\n${res.filter((r) => r.ok).length}/${res.length} comprobaciones OK · salida ${SALIDA}`);
process.exit(res.some((r) => !r.ok) ? 1 : 0);
