// Owner corrections 2026-11-18 — items 1/2/5 on the FINAL production build, against a DISPOSABLE copy of the review database (never rev_revision).
// Expected values are HAND-CALCULATED below (not read from production helpers). Local only.
//   REV_DB_VERIF=rev_verif_corr must be the database served by the rev-* containers; the only writes are the labelled state flips on DTM-0005 (restored in `finally`).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { lanzar, abrir, APP, crearInforme, sinDesborde } from "./revision_comun.mjs";

const OUT = "C:/tmp/vcorr/docs";
mkdirSync(OUT, { recursive: true });
const DB = process.env.REV_DB_VERIF ?? "rev_verif_corr";
if (DB === "rev_revision") throw new Error("refusing to run against the owner's database");
const psql = (sql) => execFileSync("docker", ["exec", "-e", "PGPASSWORD=postgres", "pg304", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-A", "-t", "-c", sql], { encoding: "utf8" }).trim();
const { ok, cerrar } = crearInforme("correcciones 2026-11-18 · documentos (items 1, 2, 5)");
const num = (s) => Number(String(s).replace(/[^\d-]/g, "") || 0);
const tokenDe = (n) => psql(`select share_token from public.ventas where numero_contrato='${n}'`);
const tokenCot = (id) => psql(`select share_token from public.cotizaciones where id=${id}`);

/** Rows of the items table («Ítem … Valor total») as arrays of cell texts. */
async function filasItems(page) {
  const t = page.locator("table", { hasText: "Tarifa Adulto" }).first();
  return t.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.replace(/\s+/g, " ").trim())));
}
const cuerpo = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const PROMO_EN_CONTRATO = /Niño gratis (por habitación|de «)|PROMO (UNO|DOS)|· PRE BF|−\s?\$|-\s?\$\s?\d/;

const browser = await lanzar();
try {
  // ---------------------------------------------------------------- 2 · free-child documents (hand-calculated expectations)
  // DTM-0003: 2 adults × 732,000 = 1,464,000; Niño 1 366,000 − 366,000 (free) = 0  → total 1,464,000, 2 rows.
  // DTM-0004: 2 adults × 180,000 = 360,000; Niño 1 101,000 − 101,000 = 0           → total 360,000, 2 rows.
  // C-0005  : 1,464,000 + Niño 1 366,000 − 366,000 + Niño 2 293,000 = 1,757,000     → 3 rows (adult, free child, paying child 293,000).
  const casos = [
    // CORRECTED criteria (owner + Codex C1, 2026-11-18): the free child lives INSIDE the adult package row.
    // DTM-0003: ONE row [adults 2, children 1, child tariff 0] = 1,464,000 · DTM-0004: ONE row = 360,000 · C-0005: TWO rows [adults 2 + free child = 1,464,000] and [paying child 293,000] = 1,757,000.
    { n: "DTM-0003", total: 1464000, filas: [1464000], cant: [[2, 1]], gratis: 1, cot: 3 },
    { n: "DTM-0004", total: 360000, filas: [360000], cant: [[2, 1]], gratis: 1, cot: 4 },
    { n: "C-0005", total: 1757000, filas: [1464000, 293000], cant: [[2, 1], [0, 1]], gratis: 1, cot: 5, soloCotizacion: true },
  ];
  for (const vista of ["escritorio", "movil"]) {
    const sa = await abrir(browser, { email: "superadmin@revision.test", vista });
    const anon = await abrir(browser, { vista });
    for (const c of casos) {
      const rutas = [];
      if (!c.soloCotizacion) { rutas.push([`/contrato/${c.n}`, sa, "contrato interno"], [`/c/${tokenDe(c.n)}`, anon, "contrato público"]); }
      rutas.push([`/cotizacion/${c.cot}`, sa, "cotización interna"], [`/cot/${tokenCot(c.cot)}`, anon, "cotización pública"]);
      for (const [ruta, ctx, etiqueta] of rutas) {
        const p = ctx.page;
        await p.goto(APP + ruta, { waitUntil: "networkidle" });
        const f = await filasItems(p);
        const t = await cuerpo(p);
        const montos = f.map((r) => num(r[r.length - 1]));
        const id = `${vista} · ${c.n} · ${etiqueta}`;
        ok(f.length === c.filas.length, `${id}: ${f.length} filas de paquete (esperado ${c.filas.length}): ${f.map((r) => r[0]).join(" | ")}`);
        ok(JSON.stringify(montos) === JSON.stringify(c.filas), `${id}: importes por fila ${JSON.stringify(montos)} (esperado ${JSON.stringify(c.filas)})`);
        ok(montos.reduce((a, b) => a + b, 0) === c.total && new RegExp(`TOTAL DEL CONTRATO \\$ ?${c.total.toLocaleString("es-CO")}`).test(t), `${id}: la suma de filas = total mostrado = $${c.total.toLocaleString("es-CO")}`);
        ok(f.filter((r) => r.join(" ").includes("Niño gratis")).length === c.gratis, `${id}: exactamente ${c.gratis} fila(s) con «Niño gratis» (dentro de la fila del paquete)`);
        ok(JSON.stringify(f.map((r) => [num(r[1]), num(r[2])])) === JSON.stringify(c.cant), `${id}: adultos/niños por fila ${JSON.stringify(f.map((r) => [num(r[1]), num(r[2])]))} (esperado ${JSON.stringify(c.cant)})`);
        ok(!f.some((r) => num(r[r.length - 1]) < 0), `${id}: ninguna fila con importe negativo (sin renglón de promoción restando)`);
        const filaGratis = f.find((r) => r.join(" ").includes("Niño gratis"));
        ok(filaGratis && filaGratis.join(" ").includes("Niño gratis") && !/PRE BF|PROMO/.test(filaGratis.join(" ")), `${id}: la fila gratuita dice solo «Niño gratis»: «${filaGratis?.join(" · ")}»`);
        ok(!PROMO_EN_CONTRATO.test(t), `${id}: sin nombre de promoción ni cálculo (regex ${PROMO_EN_CONTRATO})`);
        if (c.n === "C-0005") ok(f.length === 2 && f[1][0].startsWith("Niño 2") && f[1].some((x) => /293\.000/.test(x)), `${id}: el niño que paga conserva su fila propia a $293.000 (2.ª fila)`);
        ok(await sinDesborde(p), `${id}: sin desborde horizontal`);
        if (vista === "escritorio") await p.screenshot({ path: `${OUT}/${c.n}-${etiqueta.replace(/ /g, "_")}-${vista}.png`, fullPage: true });
        else if (etiqueta === "contrato público" || etiqueta === "cotización pública") await p.screenshot({ path: `${OUT}/${c.n}-${etiqueta.replace(/ /g, "_")}-${vista}.png`, fullPage: true });
      }
    }
    await sa.ctx.close(); await anon.ctx.close();
  }

  // ---------------------------------------------------------------- NETO
  // Real NETO contracts (comision_estado='descontada'): precio_venta IS the exigible total, the commission/PVP must never print.
  // DTM-10606: exigible 1,800,000 (PVP original 1,900,000, commission 100,000). They carry NO item rows (seeded by #106) → they prove totals only.
  console.log("\n-- NETO (contratos NETO reales de #106, sin ítems) + niño gratis en NETO (DTM-0004 convertido a NETO SOLO en la copia desechable y restaurado)");
  const sa = await abrir(browser, { email: "superadmin@revision.test" });
  const anon = await abrir(browser, {});
  for (const [n, exigible, pvp, com] of [["DTM-10606", 1800000, 1900000, 100000], ["DTM-10615", 1400000, 1500000, 100000]]) {
    for (const [ruta, ctx, et] of [[`/contrato/${n}`, sa, "interno"], [`/c/${tokenDe(n)}`, anon, "público"]]) {
      await ctx.page.goto(APP + ruta, { waitUntil: "networkidle" });
      const t = await cuerpo(ctx.page);
      ok(new RegExp(`TOTAL DEL CONTRATO \\$ ?${exigible.toLocaleString("es-CO")}`).test(t) && !t.includes(pvp.toLocaleString("es-CO")) && !t.includes(`${com.toLocaleString("es-CO")}`), `NETO ${n} ${et}: total exigible $${exigible.toLocaleString("es-CO")}; nunca el PVP original $${pvp.toLocaleString("es-CO")} ni la comisión $${com.toLocaleString("es-CO")}`);
      await ctx.page.screenshot({ path: `${OUT}/NETO-${n}-${et}.png`, fullPage: true });
    }
  }
  // DTM-0004 as NETO: PVP 360,000 − commission 60,000 = exigible 300,000 ⇒ adult row prorated to 300,000, free child 0, sum 300,000; 360,000 and 60,000 never printed.
  const orig = psql("select coalesce(modo_compra,'')||'|'||coalesce(comision_estado,'')||'|'||coalesce(comision_b2b::text,'')||'|'||precio_venta from public.ventas where numero_contrato='DTM-0004'").split("|");
  try {
    psql("update public.ventas set modo_compra='neta', comision_estado='descontada', comision_b2b=60000, precio_venta=300000 where numero_contrato='DTM-0004'");
    for (const [ruta, ctx, et] of [["/contrato/DTM-0004", sa, "interno"], [`/c/${tokenDe("DTM-0004")}`, anon, "público"]]) {
      await ctx.page.goto(APP + ruta, { waitUntil: "networkidle" });
      const f = await filasItems(ctx.page); const t = await cuerpo(ctx.page);
      const montos = f.map((r) => num(r[r.length - 1]));
      ok(f.length === 1 && montos.reduce((x, y) => x + y, 0) === 300000 && /TOTAL DEL CONTRATO \$ ?300\.000/.test(t), `NETO+niño gratis DTM-0004 ${et}: UNA fila ${JSON.stringify(montos)} = 300.000 = total exigible`);
      ok(f.some((r) => r.join(" ").includes("Niño gratis")) && !f.some((r) => num(r[r.length - 1]) < 0), `NETO+niño gratis DTM-0004 ${et}: «Niño gratis» dentro de la fila y ningún importe negativo (filas: ${f.map((r) => r.join(" · ")).join(" || ")})`);
      ok(!t.includes("360.000") && !t.includes("60.000"), `NETO+niño gratis DTM-0004 ${et}: ni el PVP 360.000 ni la comisión 60.000 impresos`);
      await ctx.page.screenshot({ path: `${OUT}/NETO-DTM-0004-${et}.png`, fullPage: true });
    }
  } finally {
    psql(`update public.ventas set modo_compra=nullif('${orig[0]}',''), comision_estado=nullif('${orig[1]}',''), comision_b2b=nullif('${orig[2]}','')::numeric, precio_venta=${orig[3]} where numero_contrato='DTM-0004'`);
    ok(psql("select coalesce(modo_compra,'')||'|'||coalesce(comision_estado,'')||'|'||coalesce(comision_b2b::text,'')||'|'||precio_venta from public.ventas where numero_contrato='DTM-0004'") === orig.join("|"), "DTM-0004 restaurado a su estado original (no NETO, 360.000)");
  }

  // ---------------------------------------------------------------- 1 · USD document DTM-0005
  console.log("\n-- USD: DTM-0005 (USD 1,000 · TRM de cobro 4,100 · abono COP 1,230,000 ⇒ pagado USD 300, saldo USD 700; 1,230,000 / 4,100 = 300)");
  const usdChecks = async (ruta, ctx, etiqueta, esperado) => {
    await ctx.page.goto(APP + ruta, { waitUntil: "networkidle" });
    const t = await cuerpo(ctx.page);
    const id = `USD ${etiqueta}`;
    ok(!/Total a cobrar/i.test(t), `${id}: sin la tarjeta «Total a cobrar»`);
    // Owner rule 2026-11-18: the CLIENT document states the pending minimum in the CONTRACT currency (COP 1,230,000 / TRM 4,100 = USD 300); the COP collection instruction lives in the internal operational view only.
    ok(!/4\.100\.000|1\.230\.000|COP \$|\$ ?4\.100/.test(t), `${id}: ningún importe en COP en el documento de cliente (ni 4.100.000 ni 1.230.000)`);
    if (esperado.minimo) ok(/Pago mínimo para confirmar: \$300 USD/.test(t), `${id}: el mínimo para confirmar se expresa en USD 300 (1.230.000 / 4.100), no en COP`);
    ok(new RegExp(`TOTAL DEL CONTRATO USD \\$${esperado.total}`).test(t), `${id}: total USD $${esperado.total}`);
    ok(new RegExp(`TOTAL PAGADO USD \\$${esperado.pagado}\\b`).test(t) && new RegExp(`SALDO PENDIENTE USD \\$${esperado.saldo}\\b`).test(t), `${id}: pagado USD $${esperado.pagado} · saldo USD $${esperado.saldo}`);
    ok(esperado.minimo ? /Pago mínimo/.test(t) : !/Pago mínimo|Pago mínimo requerido|no disponible/i.test(t), `${id}: aviso/columna de pago mínimo ${esperado.minimo ? "visible (pendiente)" : "oculto (confirmado)"}`);
    ok(/Condiciones de pago/.test(t) && /Hotel Condición estándar/.test(t), `${id}: las condiciones congeladas siguen visibles`);
    return t;
  };
  const tok5 = tokenDe("DTM-0005");
  await usdChecks("/contrato/DTM-0005", sa, "interno · confirmado", { total: "1,000", pagado: "300", saldo: "700", minimo: false });
  await sa.page.screenshot({ path: `${OUT}/DTM-0005-interno-confirmado.png`, fullPage: true });
  await usdChecks(`/c/${tok5}`, anon, "público · confirmado", { total: "1,000", pagado: "300", saldo: "700", minimo: false });
  await anon.page.screenshot({ path: `${OUT}/DTM-0005-publico-confirmado.png`, fullPage: true });

  // internal COP accounting must keep COP
  await sa.page.goto(`${APP}/dashboard/contratos/DTM-0005`, { waitUntil: "networkidle" });
  const ficha = await cuerpo(sa.page);
  ok(/Total a cobrar/.test(ficha) && /4\.100\.000/.test(ficha), `ficha interna DTM-0005 conserva el cobro en COP («Total a cobrar» y $ 4.100.000)`);
  ok(/1\.230\.000/.test(ficha), `ficha interna DTM-0005 conserva el abono en COP ($ 1.230.000)`);
  await sa.page.screenshot({ path: `${OUT}/DTM-0005-ficha-interna.png`, fullPage: true });

  // state transitions on the DISPOSABLE copy only (SQL flip, restored below). They exercise the DOCUMENT's state-dependent wording, not the confirmation action.
  console.log("\n-- transiciones sobre la copia desechable (estado forzado por SQL, restaurado al final)");
  try {
    psql("update public.ventas set estado='pendiente' where numero_contrato='DTM-0005'");
    await usdChecks("/contrato/DTM-0005", sa, "interno · PENDIENTE (mínimo vigente)", { total: "1,000", pagado: "300", saldo: "700", minimo: true });
    await sa.page.screenshot({ path: `${OUT}/DTM-0005-interno-pendiente.png`, fullPage: true });
    psql("update public.ventas set estado='confirmado' where numero_contrato='DTM-0005'");
    psql("update public.abonos set monto_cop = 0, valor_abono = 0 where numero_contrato='DTM-0005'");
    await usdChecks("/contrato/DTM-0005", sa, "interno · confirmado, pago revertido (0)", { total: "1,000", pagado: "0", saldo: "1,000", minimo: false });
    await sa.page.screenshot({ path: `${OUT}/DTM-0005-interno-pago-revertido.png`, fullPage: true });
  } finally {
    psql("update public.abonos set monto_cop = 1230000, valor_abono = 1230000 where numero_contrato='DTM-0005'");
    psql("update public.ventas set estado='confirmado' where numero_contrato='DTM-0005'");
    ok(psql("select estado||'/'||(select sum(monto_cop) from public.abonos where numero_contrato='DTM-0005') from public.ventas where numero_contrato='DTM-0005'") === "confirmado/1230000.00", "DTM-0005 restaurado (confirmado, abono COP 1.230.000)");
  }

  // ---------------------------------------------------------------- PDFs
  console.log("\n-- PDF (impresión)");
  for (const [ruta, ctx, nombre] of [["/contrato/DTM-0003", sa, "DTM-0003"], ["/contrato/DTM-0004", sa, "DTM-0004"], ["/contrato/DTM-0005", sa, "DTM-0005"], ["/cotizacion/5", sa, "C-0005"], ["/contrato/DTM-10606", sa, "DTM-10606-NETO"]]) {
    await ctx.page.goto(APP + ruta, { waitUntil: "networkidle" });
    await ctx.page.emulateMedia({ media: "print" });
    const pdf = await ctx.page.pdf({ format: "Letter", printBackground: true });
    writeFileSync(`${OUT}/pdf-${nombre}.pdf`, pdf);
    const paginas = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    ok(paginas >= 1, `PDF ${nombre}: ${paginas} página(s) → ${OUT}/pdf-${nombre}.pdf`);
    await ctx.page.emulateMedia({ media: "screen" });
  }

  // ---------------------------------------------------------------- requests: load + idle 30 s
  console.log("\n-- solicitudes: carga e inactividad (30 s)");
  for (const [ruta, ctx, et] of [["/contrato/DTM-0005", sa, "documento USD"], ["/contrato/DTM-0003", sa, "documento niño gratis"]]) {
    const hechas = [];
    const alPedir = (rq) => hechas.push(`${rq.method()} ${rq.url().replace(APP, "").slice(0, 70)}`);
    ctx.page.on("request", alPedir);
    await ctx.page.goto(APP + ruta, { waitUntil: "networkidle" });
    const carga = hechas.length;
    const rest = ctx.cuenta.rest;
    hechas.length = 0;
    await ctx.page.waitForTimeout(30000);
    ctx.page.off("request", alPedir);
    ok(hechas.length === 0, `${et}: ${carga} solicitudes de navegador en la carga; ${hechas.length} en 30 s de inactividad ${hechas.length ? JSON.stringify(hechas) : ""} (rest/v1 desde el navegador acumuladas: ${rest})`);
  }
} finally {
  await browser.close();
}
process.exit(cerrar());
