// HUMO de #126 sobre el build de producción LOCAL, Edge real (Playwright), base DESECHABLE (REV_DB_VERIF), datos sintéticos. Nunca contra la base de revisión del dueño ni contra producción.
// Cubre 126-A (pagos USD con TRM propia, documentos, reportes provisional/definitivo, compatibilidad DTM-0005), 126-B (menores en unidad), 126-C (grupo solo-infante) y 126-D (etiqueta de promoción)
// en escritorio (1366), intermedio (1024) y móvil (390). Cuenta las llamadas al servidor por acción y comprueba que, terminada la acción, no hay más solicitudes.
// Uso (desde dspacios-travel/): node supabase/scripts/localreview/humo_126.mjs <carpeta_capturas> [url_app=http://127.0.0.1:3070]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { CFG, SUPA, APP as APP0, cookieSesion } from "./revision_comun.mjs";

const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const APP = process.argv[3]?.startsWith("http") ? process.argv[3] : APP0;
void CFG;
let fallos = 0, aciertos = 0, omitidos = 0;
const omitir = (m) => { console.log(`OMITIDO ${m}`); omitidos++; };
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (c) aciertos++; else fallos++; };
const VISTAS = { escritorio: { width: 1366, height: 900 }, intermedio: { width: 1024, height: 800 }, movil: { width: 390, height: 844 } };
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();

const browser = await chromium.launch({ channel: "msedge", headless: true });
async function sesion(email, vista = "escritorio") {
  const ctx = await browser.newContext({ viewport: VISTAS[vista], isMobile: vista === "movil", hasTouch: vista === "movil", locale: "es-CO" });
  await ctx.addCookies(await cookieSesion(email));
  const page = await ctx.newPage();
  const cuenta = { posts: 0, rest: 0 };
  page.on("request", (rq) => { if (rq.method() === "POST" && rq.url().startsWith(APP)) cuenta.posts++; if (rq.url().startsWith(`${SUPA}/rest/v1`)) cuenta.rest++; });
  page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));
  return { ctx, page, cuenta };
}
async function capturarElemento(page, loc, ruta) { const h = await loc.first().elementHandle(); if (!h) return; await h.evaluate((e) => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(250); const b = await h.boundingBox(); if (b) await page.screenshot({ path: ruta, clip: { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), width: Math.min(b.width + 8, page.viewportSize().width), height: Math.min(b.height + 8, page.viewportSize().height) } }); }
import { readFileSync as leer } from 'node:fs';
const paginasPdf = (ruta) => (leer(ruta, 'latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
async function pdfComoImagen(page, ruta) { await page.emulateMedia({ media: 'print' }); const ancho = page.viewportSize(); await page.setViewportSize({ width: 816, height: 1056 }); await page.screenshot({ path: ruta, fullPage: true }); await page.setViewportSize(ancho); await page.emulateMedia({ media: 'screen' }); }
const texto = async (page) => norm(await page.locator("body").innerText());
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
async function inactivo(page, cuenta, ms = 4000) { const a = cuenta.posts + cuenta.rest; await page.waitForTimeout(ms); return cuenta.posts + cuenta.rest === a; }

// ═══ 126-A · contrato USD cobrado en USD (DTM-12601): dos pagos con su TRM ══════════════════════════════════════
{
  const { ctx, page, cuenta } = await sesion("administracion@revision.test");
  await page.goto(`${APP}/dashboard/contratos/DTM-12601`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Cartera/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  const form = page.locator("form", { has: page.getByRole("button", { name: "Registrar abono" }) }).first();
  ok(await form.count() === 1, "A · el formulario «Registrar abono» está en la ficha del contrato (pestaña Cartera)");
  let t = norm(await form.innerText());
  ok(/TRM de este pago/.test(t) && /Pesos \(COP\)/.test(t) && /Dólares \(USD\)/.test(t), "A · pide la TRM de ESTE pago y ofrece pesos o dólares");
  const trmInput = form.locator('input[placeholder="COP por 1 USD"]');
  const valorInput = form.locator('input[type="number"]').first();
  ok((await trmInput.inputValue()) === "", "A · la TRM no viene prellenada");
  // TRM inválida
  await valorInput.fill("1230000"); await trmInput.fill("1");
  t = norm(await form.innerText());
  ok(/TRM/.test(t) && !/Acredita USD/.test(t), "A · TRM 1: la vista previa avisa y NO calcula con una tasa inventada");
  await form.getByRole("button", { name: "Registrar abono" }).click(); await page.waitForTimeout(800);
  ok(/TRM del pago debe ser/.test(await texto(page)), "A · TRM 1 rechazada con mensaje (sin escribir nada)");
  // primer pago
  await trmInput.fill("4.100");   // F1 de Codex: formato colombiano; debe previsualizarse Y enviarse como 4100
  t = norm(await form.innerText());
  ok(/Acredita\s+USD\s?\$?\s?300/.test(t) && /saldo después del pago:\s*USD\s?\$?\s?700/.test(t), "A · vista previa: COP 1.230.000 a 4.100 acredita USD 300 y deja saldo USD 700");
  await page.screenshot({ path: join(OUT, "A1-contrato-formulario-1366.png"), fullPage: false });
  cuenta.posts = 0; cuenta.rest = 0;
  await form.getByRole("button", { name: "Registrar abono" }).click();
  await page.waitForSelector('[data-testid="resumen-cop-usd"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  console.log(`  [consumo] registrar un pago: ${cuenta.posts} POST al servidor, ${cuenta.rest} solicitudes REST del navegador`);
  ok(cuenta.posts <= 2, `A · un clic en «Registrar abono» = ${cuenta.posts} llamada(s) al servidor`);
  ok(await inactivo(page, cuenta), "A · terminada la acción no hay más solicitudes (sin sondeo ni bucles)");
  t = await texto(page);
  ok(/Cobrado en pesos \(real\)/i.test(t) && /1\.230\.000/.test(t), "A · panel: cobrado en pesos (real) = 1.230.000");
  ok(/Equivalente del saldo \(provisional\)/i.test(t) && /≈\s?\$\s?2\.870\.000/.test(t), "A · saldo USD 700 abierto: equivalente PROVISIONAL ≈ 2.870.000 (700 × 4.100), rotulado como estimado");
  await capturarElemento(page, page.locator('[data-testid="resumen-cop-usd"]'), join(OUT, "A2b-panel-real-vs-provisional-1-pago.png"));
  await page.screenshot({ path: join(OUT, "A2-contrato-cartera-1-pago-1366.png"), fullPage: true });
  // rentabilidad con saldo abierto → provisional
  const r1 = await page.context().newPage();
  await r1.goto(`${APP}/dashboard/rentabilidad`, { waitUntil: "networkidle" });
  const fila = r1.locator("tr", { hasText: "Cliente 126 USD por pago" }).first();
  ok((await fila.locator('[data-testid="ingreso-provisional"]').count()) === 1, "A · Rentabilidad: la fila con saldo USD abierto marca su ingreso en COP como «provisional» sin expandir");
  await fila.locator("button").first().click(); await r1.waitForTimeout(500);
  const tr = await texto(r1);
  ok(/COP provisional/i.test(tr), "A · Rentabilidad: el desglose explica el COP provisional del contrato con saldo USD abierto");
  await r1.screenshot({ path: join(OUT, "A3-rentabilidad-provisional-1366.png"), fullPage: false });
  await r1.close();
  // segundo pago con OTRA TRM
  await valorInput.fill("2940000"); await trmInput.fill("4200");
  t = norm(await form.innerText());
  ok(/Acredita\s+USD\s?\$?\s?700/.test(t) && /saldo después del pago:\s*USD\s?\$?\s?0/.test(t), "A · segundo pago: COP 2.940.000 a 4.200 acredita USD 700 y el saldo queda en 0");
  await form.getByRole("button", { name: "Registrar abono" }).click();
  await page.waitForTimeout(2500);
  t = await texto(page);
  ok(/Total cobrado en pesos/i.test(t) && /4\.170\.000/.test(t) && !/Equivalente del saldo \(provisional\)/i.test(t), "A · saldo 0: «Total cobrado en pesos» = 4.170.000 (definitivo, sin aviso provisional)");
  await capturarElemento(page, page.locator('[data-testid="resumen-cop-usd"]'), join(OUT, "A4b-panel-definitivo-2-pagos.png"));
  await page.screenshot({ path: join(OUT, "A4-contrato-cartera-2-pagos-1366.png"), fullPage: true });
  await ctx.close();
}
// dólares RECIBIDOS: DTM-12603, pago nativo en USD con TRM «4.100»; los documentos no llaman «pesos recibidos» al equivalente contable
{
  const { ctx, page } = await sesion("administracion@revision.test");
  await page.goto(`${APP}/dashboard/contratos/DTM-12603`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Cartera/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  const form = page.locator("form", { has: page.getByRole("button", { name: "Registrar abono" }) }).first();
  await form.getByRole("button", { name: "Dólares (USD)" }).click();
  await form.locator('input[type="number"]').first().fill("300");
  await form.locator('input[placeholder="COP por 1 USD"]').fill("4.100");
  const t0 = norm(await form.innerText());
  ok(/Acredita\s+USD\s?\$?\s?300/.test(t0) && /equivale a \$\s?1\.230\.000/.test(t0), "N · dólares nativos: la vista previa acredita USD 300 y muestra el equivalente 1.230.000");
  await form.getByRole("button", { name: "Registrar abono" }).click();
  await page.waitForSelector('[data-testid="pago-usd-recibido"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const t1 = await texto(page);
  ok(/Recibido en USD/i.test(t1) && /equiv\. contable/i.test(t1), "N · ficha del contrato: la fila del pago dice «Recibido en USD» con su equivalente contable (no «Pagado (COP)»)");
  ok(/Cobrado en pesos \(real\)\s*\$\s?0/i.test(t1) && /Más USD\s?\$?\s?300 recibidos en dólares/i.test(t1), "N · panel: pesos recibidos $0 y «USD 300 recibidos en dólares (equiv. contable …; no son pesos recibidos)»");
  await capturarElemento(page, page.locator('[data-testid="resumen-cop-usd"]'), join(OUT, "N1-panel-dolares-recibidos.png"));
  const href = await page.locator('a[href^="/recibo/"]').first().getAttribute("href");
  await page.goto(`${APP}${href}`, { waitUntil: "networkidle" });
  const tr = await texto(page);
  ok(/Pago recibido en dólares/i.test(tr) && /no se recibieron pesos/i.test(tr) && !/Pago recibido en pesos/i.test(tr), "N · recibo: «Pago recibido en dólares … el equivalente es solo contable: no se recibieron pesos»; nunca «recibido en pesos»");
  ok(/USD\s?\$?\s?300 recibidos/.test(tr) && /1\.230\.000/.test(tr) && /4\.100/.test(tr), "N · recibo: USD 300 recibidos, equivalente contable 1.230.000 a TRM 4.100");
  await page.screenshot({ path: join(OUT, "N2-recibo-dolares-recibidos-1366.png"), fullPage: true });
  await pdfComoImagen(page, join(OUT, "N2-recibo-dolares-impresion.png"));
  const num = href.split("/").pop();
  await page.goto(`${APP}/estado-cuenta/DTM-12603`, { waitUntil: "networkidle" });
  const te = await texto(page);
  ok(/Recibido en USD/i.test(te) && /nota-usd-recibidos|Incluye USD\s?\$?\s?300 recibidos en dólares/i.test(te), "N · estado de cuenta: «Recibido en USD» y nota de que «Pagado (COP)» suma solo pesos recibidos");
  await page.screenshot({ path: join(OUT, "N3-estado-cuenta-dolares-recibidos-1366.png"), fullPage: true });
  void num;
  await ctx.close();
}
// formulario de pago en intermedio y móvil (contrato pendiente aparte, DTM-12602, sin registrar nada)
for (const vista of ['intermedio', 'movil']) {
  const { ctx, page } = await sesion('administracion@revision.test', vista);
  await page.goto(`${APP}/dashboard/contratos/DTM-12602`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Cartera/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  const form = page.locator('form', { has: page.getByRole('button', { name: 'Registrar abono' }) }).first();
  await form.locator('input[type="number"]').first().fill('1230000');
  await form.locator('input[placeholder="COP por 1 USD"]').fill('4100');
  const t = norm(await form.innerText());
  ok(/Acredita\s+USD\s?\$?\s?300/.test(t) && /saldo después del pago/.test(t), `A · formulario de pago (${vista}): vista previa visible`);
  const cajas = await form.locator('input, select, button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width }; }));
  ok(cajas.every((c) => c.w > 0 && c.r <= (vista === 'movil' ? 390 : 1024) + 1 && c.l >= -1), `A · formulario de pago (${vista}): ningún control queda fuera de la pantalla`);
  await form.screenshot({ path: join(OUT, `A8-formulario-pago-${VISTAS[vista].width}.png`) });
  await ctx.close();
}
// documentos del cliente en los tres anchos
let idAbono = null;
for (const vista of Object.keys(VISTAS)) {
  const { ctx, page } = await sesion("administracion@revision.test", vista);
  await page.goto(`${APP}/estado-cuenta/DTM-12601`, { waitUntil: "networkidle" });
  const t = await texto(page);
  ok(/ESTADO DE CUENTA/i.test(t) && /Pagado \(COP\)/i.test(t) && (vista === 'movil' || /TRM del pago/i.test(t)), `A · estado de cuenta (${vista}): columnas de pesos y TRM por pago`);
  ok(/1\.230\.000/.test(t) && /2\.940\.000/.test(t) && /4\.100/.test(t) && /4\.200/.test(t) && /4\.170\.000/.test(t), `A · estado de cuenta (${vista}): pesos y TRM de cada pago y total 4.170.000`);
  ok(/Pagado en su totalidad/.test(t), `A · estado de cuenta (${vista}): USD pagado en su totalidad (saldo 0)`);
  ok(await sinDesborde(page), `A · estado de cuenta (${vista}): sin desborde horizontal de la página`);
  const mov = await page.evaluate(() => { const c = document.querySelector('[data-testid="movimientos-estado-cuenta"]'); if (!c) return null; const cr = c.getBoundingClientRect(); const vis = [...c.querySelectorAll('thead th')].filter((th) => getComputedStyle(th).display !== 'none'); return { sw: c.scrollWidth, cw: c.clientWidth, ths: vis.map((th) => th.textContent?.trim()), dentro: vis.every((th) => { const r = th.getBoundingClientRect(); return r.left >= cr.left - 1 && r.right <= cr.right + 1; }) }; });
  ok(!!mov && mov.dentro && mov.sw <= mov.cw + 2, `A · estado de cuenta (${vista}): todas las columnas visibles quedan DENTRO del recuadro, sin recorte ni desplazamiento (${mov?.ths?.join(' | ')}; scroll ${mov?.sw} / ancho ${mov?.cw})`);
  ok(!!mov && (vista === 'movil' ? ['Fecha', 'Pagado (COP)', 'Abono', 'Saldo'] : ['Fecha', 'Pagado (COP)', 'TRM del pago', 'Abono', 'Saldo']).every((h) => mov.ths.some((t) => t.toLowerCase() === h.toLowerCase())), `A · estado de cuenta (${vista}): se ven las columnas del dinero`);
  if (vista === 'movil') ok(/TRM\s+\$\s?4\.100/.test(await texto(page)) && /TRM\s+\$\s?4\.200/.test(await texto(page)), 'A · estado de cuenta (movil): la TRM de cada pago se ve bajo el monto en pesos');
  await page.screenshot({ path: join(OUT, `A5-estado-cuenta-${VISTAS[vista].width}.png`), fullPage: true });
  if (vista === "escritorio") {
    const href = await page.locator('a[href^="/recibo/"]').first().getAttribute("href").catch(() => null);
    await page.pdf({ path: join(OUT, "A5-estado-cuenta.pdf"), format: "Letter", printBackground: true });
    await pdfComoImagen(page, join(OUT, "A5-estado-cuenta-impresion.png"));
    ok(paginasPdf(join(OUT, "A5-estado-cuenta.pdf")) === 1, "A · PDF del estado de cuenta: una sola página (" + paginasPdf(join(OUT, "A5-estado-cuenta.pdf")) + ")");
    const m = (await page.content()).match(/RC-0*(\d+)/); idAbono = href ? Number(href.split("/").pop()) : (m ? Number(m[1]) : null);
  }
  await ctx.close();
}
if (idAbono) {
  for (const vista of Object.keys(VISTAS)) {
    const { ctx, page } = await sesion("administracion@revision.test", vista);
    await page.goto(`${APP}/recibo/${idAbono}`, { waitUntil: "networkidle" });
    const t = await texto(page);
    ok(/RECIBO DE CAJA/i.test(t) && /Pago recibido en pesos/i.test(t) && /a TRM/i.test(t), `A · recibo (${vista}): muestra pesos recibidos y la TRM del pago`);
    ok(await sinDesborde(page), `A · recibo (${vista}): sin desborde horizontal`);
    ok(/Pagado hasta este recibo\s*USD\s?\$?\s?300/i.test(t) && /Saldo\s*USD\s?\$?\s?700/i.test(t), `A · recibo (${vista}): primer recibo coherente: valor 1.000, pagado hasta este recibo 300, saldo 700 (sin contradicción)`);
    await page.screenshot({ path: join(OUT, `A6-recibo-${VISTAS[vista].width}.png`), fullPage: true });
    if (vista === "escritorio") {
      await page.pdf({ path: join(OUT, "A6-recibo.pdf"), format: "Letter", printBackground: true });
      await pdfComoImagen(page, join(OUT, "A6-recibo-impresion.png"));
      ok(paginasPdf(join(OUT, "A6-recibo.pdf")) === 1, "A · PDF del recibo: una sola página (" + paginasPdf(join(OUT, "A6-recibo.pdf")) + ")");
    }
    await ctx.close();
  }
} else ok(false, "A · no se pudo resolver el id del primer recibo");
// compatibilidad: DTM-0005 (COP con TRM congelada) se ve como antes
{
  const { ctx, page } = await sesion("administracion@revision.test");
  await page.goto(`${APP}/estado-cuenta/DTM-0005`, { waitUntil: "networkidle" });
  const t = await texto(page);
  ok(!/TRM del pago/i.test(t) && /1\.230\.000/.test(t), "A · compatibilidad: DTM-0005 (USD cobrado en COP, TRM congelada 4.100) NO muestra columnas nuevas y conserva su pago de COP 1.230.000");
  await page.screenshot({ path: join(OUT, "A7-compat-DTM-0005-estado-cuenta-1366.png"), fullPage: true });
  await page.goto(`${APP}/dashboard/contratos/DTM-0005`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Cartera/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  ok(!(await page.locator('[data-testid="resumen-cop-usd"]').count()), "A · compatibilidad: DTM-0005 no muestra el panel de TRM por pago (su total en pesos está congelado)");
  await ctx.close();
}

// ═══ 126-C · grupo base solo-infante, paquete 912512 ═══════════════════════════════════════════════════════
for (const vista of Object.keys(VISTAS)) {
  const { ctx, page } = await sesion("administracion@revision.test", vista);
  await page.goto(`${APP}/dashboard/paquetes/912512`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /Tarifario resultado/ }).click().catch(() => {});
  await page.waitForTimeout(500);
  const cab = page.locator("button[aria-expanded]", { hasText: /Hotel Dubai 2 bases 125 ACTIVO/ }).first();
  if (await cab.count()) { await cab.click(); await page.waitForTimeout(400); }
  const t = await texto(page);
  const hayInfante = /Solo tarifa de infante/.test(t);
  ok(/Promoción/.test(t) || hayInfante, `C · 912512 (${vista}): el tarifario resultado carga sus grupos`);
  if (vista === "escritorio") {
    ok(hayInfante, "C · el grupo BASE que solo conserva el infante dice «Solo tarifa de infante»");
    ok(/Solo tarifa de infante · adultos en «Promoción · PRE BF DUBAI»/.test(t), "C · F4 caso aceptado: la promoción con los adultos de LA MISMA estadía se enlaza (las filas lo establecen)");
    ok(!/BASE A · [A-Z ]+Sin tarifa doble/.test(t), "C · ya no aparece «Sin tarifa doble» en los grupos BASE solo-infante");
  }
  ok(await sinDesborde(page), `C · 912512 (${vista}): sin desborde horizontal`);
  await page.screenshot({ path: join(OUT, `C1-paquete-912512-${VISTAS[vista].width}.png`), fullPage: true });
  if (vista === "escritorio" && hayInfante) {
    await page.locator("li", { hasText: /Solo tarifa de infante/ }).first().locator("button").first().click();
    await page.waitForTimeout(500);
    ok(/conserva su tarifa base/.test(await texto(page)), "C · la ventana del grupo explica que el infante conserva su tarifa base");
    await page.screenshot({ path: join(OUT, "C2-grupo-solo-infante-dialogo-1366.png") });
  }
  await ctx.close();
}

// ═══ 126-C F4 · el grupo solo-infante no apunta a una promoción que las filas no relacionan ═════════════════════════════════════════════════
// Se alteran filas de tarifario_resultado SOLO en la copia desechable (nombre rev_verif*) y se restauran al terminar cada caso.
import { execFileSync } from "node:child_process";
const BASE_CLON = process.env.REV_DB_VERIF ?? "";
function sqlClon(q) {
  if (!/^rev_verif/.test(BASE_CLON)) throw new Error("F4: solo en una copia desechable (REV_DB_VERIF=rev_verif_*)");
  return execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", (process.env.REV_PG ?? "pg304"), "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", BASE_CLON, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
}
async function textoGrupoBase(paquete, hotel, grupo) {
  const { ctx, page } = await sesion("administracion@revision.test");
  await page.goto(`${APP}/dashboard/paquetes/${paquete}`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /Tarifario resultado/ }).click().catch(() => {});
  await page.waitForTimeout(500);
  const cab = page.locator("button[aria-expanded]", { hasText: hotel }).first();
  if (await cab.count()) { await cab.click(); await page.waitForTimeout(400); }
  const fila = page.locator("[data-testid=grupos-tarifa] > li", { hasText: grupo }).first();
  const lineaTxt = norm(await fila.innerText());
  await fila.locator("button").first().click(); await page.waitForTimeout(600);
  const nota = norm(await page.locator("[data-testid=nota-solo-infante]").first().innerText().catch(() => ""));
  await page.screenshot({ path: join(OUT, `C3-${paquete}-${grupo.replace(/\W+/g, "_")}.png`) });
  await ctx.close();
  return { lineaTxt, nota };
}
{
  const HOTEL = /Hotel PRE BF 125/;   // el paquete 912501 solo tiene ese hotel
  // caso aceptado en la app: misma estadía → enlace
  let r = await textoGrupoBase(912501, HOTEL, "BASE A");
  ok(/Solo tarifa de infante · adultos en «Promoción · PRE BF»/.test(r.lineaTxt) && /están en «Promoción · PRE BF»/.test(r.nota), `F4 · caso aceptado (912501): enlace a la promoción de la misma estadía (${r.lineaTxt})`);
  // fechas DISJUNTAS
  sqlClon("update public.tarifario_resultado set fecha_ida = '2027-01-01', fecha_regreso = '2027-01-31' where paquete_id = 912501 and es_promocion");
  try {
    r = await textoGrupoBase(912501, HOTEL, "BASE A");
    ok(/Solo tarifa de infante/.test(r.lineaTxt) && !/adultos en/.test(r.lineaTxt) && !/están en «/.test(r.nota) && /no se publican en este grupo/.test(r.nota), `F4 · fechas disjuntas: explicación neutral, sin enlace (${r.lineaTxt} | ${r.nota.slice(0, 120)})`);
  } finally { sqlClon("update public.tarifario_resultado set fecha_ida = '2026-12-01', fecha_regreso = '2026-12-31' where paquete_id = 912501 and es_promocion"); }
  // DOS promociones candidatas con adultos en la misma estadía
  sqlClon(`do $$ declare cols text; begin
    select string_agg(quote_ident(column_name), ',' order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name <> 'id';
    execute format('insert into public.tarifario_resultado (%s) select %s from public.tarifario_resultado where paquete_id = 912501 and es_promocion and temporada_ganadora = %L', cols, replace(replace(cols, 'temporada_ganadora', quote_literal('PRE BF 2')), 'procedencia_temporadas', 'replace(procedencia_temporadas::text, ''"PRE BF"'', ''"PRE BF 2"'')::jsonb'), 'PRE BF');
  end $$`);
  try {
    r = await textoGrupoBase(912501, HOTEL, "BASE A");
    ok(/Solo tarifa de infante/.test(r.lineaTxt) && !/adultos en/.test(r.lineaTxt) && !/están en «/.test(r.nota), `F4 · dos promociones candidatas: ambiguo → neutral (${r.lineaTxt})`);
  } finally { sqlClon("delete from public.tarifario_resultado where paquete_id = 912501 and temporada_ganadora = 'PRE BF 2'"); }
  r = await textoGrupoBase(912501, HOTEL, "BASE A");
  ok(/adultos en «Promoción · PRE BF»/.test(r.lineaTxt), "F4 · restaurado: el caso aceptado vuelve a enlazar (la copia quedó como estaba)");
  ok(sqlClon("select count(*) from public.tarifario_resultado where paquete_id = 912501") === "7", "F4 · las filas del paquete 912501 quedaron como estaban (7)");
}

// ═══ 126-E · Gestión de contratos: «Viaje más reciente» = salidas de HOY (Bogotá) en adelante, la más próxima primero ═══════════════════════════════
// Contratos DTM-12611..12616 (seed126e.sql): ayer / hoy / mañana / pasado mañana / sin fecha / muy antigua. El filtro «numero» = DTM-1261 aísla ese conjunto.
const hoyBogota = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
for (const vista of ["escritorio", "movil"]) {
  const { ctx, page, cuenta } = await sesion("superadmin@revision.test", vista);
  const ver = async (qs) => { await page.goto(`${APP}/dashboard/gestion-contratos?${qs}`, { waitUntil: "networkidle" }); return { html: await page.content(), t: await texto(page) }; };
  const tiene = (html, n) => html.includes(`aria-label="Contrato ${n}"`);
  const orden = (html, ns) => ns.map((n) => html.indexOf(`aria-label="Contrato ${n}"`));
  // modo «Viaje más reciente»
  cuenta.rest = 0; cuenta.posts = 0;
  let { html, t } = await ver("orden=salida_asc&numero=DTM-1261");
  ok(new RegExp(`3 contratos con viaje desde hoy \\(${hoyBogota}, hora de Bogot`).test(t), `E · ${vista}: «3 contratos con viaje desde hoy (${hoyBogota}, hora de Bogotá)» (hoy, mañana, pasado mañana)`);
  ok(await page.locator('[data-testid="nota-viaje-reciente"]').count() === 1, `E · ${vista}: la nota explica la regla y cómo llegar al historial`);
  ok(tiene(html, "DTM-12612") && tiene(html, "DTM-12613") && tiene(html, "DTM-12614"), `E · ${vista}: entran hoy, mañana y pasado mañana`);
  ok(!tiene(html, "DTM-12611") && !tiene(html, "DTM-12615") && !tiene(html, "DTM-12616"), `E · ${vista}: NO entran ayer, el contrato sin fecha ni el muy antiguo`);
  const pos = orden(html, ["DTM-12612", "DTM-12613", "DTM-12614"]);
  ok(pos[0] > 0 && pos[0] < pos[1] && pos[1] < pos[2], `E · ${vista}: la salida más próxima primero (hoy → mañana → pasado mañana)`);
  ok(await sinDesborde(page), `E · ${vista}: sin desborde horizontal`);
  await page.screenshot({ path: join(OUT, `E1-viaje-reciente-${VISTAS[vista].width}.png`), fullPage: true });
  // el conteo del resumen es el mismo conjunto que la consulta independiente (todas las agencias, sin el filtro de número)
  ({ t } = await ver("orden=salida_asc"));
  const indep = sqlClon(`select count(*) from public.ventas where fecha_salida >= public.fecha_negocio()`);
  ok(t.includes(`${Number(indep).toLocaleString("es-CO")} contratos con viaje desde hoy`) || (Number(indep) === 1 && t.includes("1 contrato con viaje desde hoy")), `E · ${vista}: el total mostrado coincide con el conteo independiente (${indep})`);
  // historial: otro orden con el mismo filtro de número = los 6
  ({ html, t } = await ver("numero=DTM-1261"));
  ok(/6 contratos/.test(t) && [11, 12, 13, 14, 15, 16].every((n) => tiene(html, `DTM-126${n}`)), `E · ${vista}: con el orden normal están los 6 (historial y sin fecha accesibles)`);
  ok(await page.locator('[data-testid="nota-viaje-reciente"]').count() === 0, `E · ${vista}: otros órdenes no muestran la nota del modo`);
  // historial explícito: fechas de viaje elegidas mandan
  const antiguo = sqlClon(`select (public.fecha_negocio() - 500)::text`);
  ({ html, t } = await ver(`orden=salida_asc&numero=DTM-1261&salida_desde=${antiguo}`));
  ok(tiene(html, "DTM-12616") && tiene(html, "DTM-12611") && !tiene(html, "DTM-12615") && await page.locator('[data-testid="nota-viaje-explicito"]').count() === 1, `E · ${vista}: con «Viaje desde» explícito reaparecen los pasados (sin los undated) y la nota lo aclara`);
  const pos2 = orden(html, ["DTM-12616", "DTM-12611", "DTM-12612"]);
  ok(pos2[0] > 0 && pos2[0] < pos2[1] && pos2[1] < pos2[2], `E · ${vista}: dentro del rango explícito, ascendente por fecha`);
  ({ html, t } = await ver(`orden=salida_asc&numero=DTM-1261&salida_hasta=${sqlClon("select (public.fecha_negocio() - 1)::text")}`));
  ok(tiene(html, "DTM-12611") && tiene(html, "DTM-12616") && !tiene(html, "DTM-12612"), `E · ${vista}: con «Viaje hasta» ayer: solo pasados`);
  await page.screenshot({ path: join(OUT, `E2-historial-explicito-${VISTAS[vista].width}.png`), fullPage: false });
  // consumo: una carga = una RPC (1 consulta de rol + 1 RPC en el servidor); el navegador no pide nada extra en reposo
  ok(await inactivo(page, cuenta, 3000), `E · ${vista}: en reposo no hay solicitudes`);
  await ctx.close();
}

// ═══ 126-D y 126-B · buscador (Vista tabla y Vista Booking) ══════════════════════════════════════════════════
async function abrirBuscador(page, vistaTabla) {
  await page.goto(`${APP}/tarifario`, { waitUntil: "networkidle" });
  if (vistaTabla) await page.getByRole("button", { name: "Vista tabla" }).click();
  await page.getByRole("button", { name: /Porción terrestre/ }).first().click().catch(() => {}); await page.waitForTimeout(700);
}
const campo = (page, etiqueta) => page.locator(`label:text-is("${etiqueta}")`).locator("xpath=..").locator("input").first();
async function buscar(page, { destino, ida, regreso, adultos = "2", habitaciones = "1", menores = [] }) {
  await page.locator('button[role="combobox"]').first().click();
  await page.getByRole("option", { name: destino }).click();
  await page.getByRole("textbox", { name: "Ida", exact: true }).first().fill(ida); await page.getByRole("textbox", { name: "Ida", exact: true }).first().blur();
  await page.getByRole("textbox", { name: "Regreso", exact: true }).first().fill(regreso); await page.getByRole("textbox", { name: "Regreso", exact: true }).first().blur();
  await campo(page, "Adultos").fill(adultos); await campo(page, "Habitaciones").fill(habitaciones);
  await page.getByLabel(/Menores \(0–17 años\)/).fill(String(menores.length));
  for (let i = 0; i < menores.length; i++) await campo(page, `Edad menor ${i + 1}`).fill(String(menores[i]));
  await page.getByRole("button", { name: /Buscar hoteles/ }).click();
  await page.waitForSelector('button:has-text("Buscar hoteles")', { timeout: 40000 });
  await page.waitForTimeout(1500);
}
const etiquetasPromo = (page) => page.locator('[data-testid="etiqueta-promocion-hotel"]').allInnerTexts().then((a) => a.map(norm));
for (const vistaTabla of [true, false]) {
  const nombreVista = vistaTabla ? "tabla" : "booking";
  for (const vista of Object.keys(VISTAS)) {
    const { ctx, page, cuenta } = await sesion("administracion@revision.test", vista);
    // D · estadía completa dentro de la promoción
    await abrirBuscador(page, vistaTabla);
    cuenta.posts = 0;
    await buscar(page, { destino: "DEMO 125", ida: "04/12/2026", regreso: "09/12/2026" });
    let e = await etiquetasPromo(page);
    ok(e.some((x) => /^Promoción PRE BF$/.test(x)), `D · ${nombreVista} ${vista}: estadía 4→9 dic muestra «Promoción PRE BF» (${e.join(" | ") || "ninguna"})`);
    ok(cuenta.posts <= 3, `D · ${nombreVista} ${vista}: una búsqueda = ${cuenta.posts} llamada(s) al servidor (sin solicitud por tarjeta)`);
    ok(await sinDesborde(page), `D · ${nombreVista} ${vista}: sin desborde horizontal`);
    const icono = await page.locator('[data-testid="etiqueta-promocion-hotel"] svg').first().boundingBox();
    ok(!!icono && icono.width >= 10 && icono.height >= 10, `D · ${nombreVista} ${vista}: el ícono de la etiqueta no se colapsa (${icono ? Math.round(icono.width) + 'x' + Math.round(icono.height) : 'sin ícono'})`);
    await page.screenshot({ path: join(OUT, `D1-${nombreVista}-promo-completa-${VISTAS[vista].width}.png`), fullPage: true });
    if (vista === "escritorio") {
      ok(await inactivo(page, cuenta, 3500), `D · ${nombreVista}: tras buscar no hay más solicitudes en reposo`);
      await abrirBuscador(page, vistaTabla);
      await buscar(page, { destino: "DEMO 125", ida: "02/12/2026", regreso: "07/12/2026" });
      e = await etiquetasPromo(page);
      ok(e.some((x) => /solo en algunas noches/.test(x)), `D · ${nombreVista}: estadía 2→7 dic dice «solo en algunas noches» (${e.join(" | ") || "ninguna"})`);
      await page.screenshot({ path: join(OUT, `D2-${nombreVista}-promo-parcial-1366.png`), fullPage: true });
      await abrirBuscador(page, vistaTabla);
      await buscar(page, { destino: "DEMO 125", ida: "09/12/2026", regreso: "12/12/2026" });
      e = await etiquetasPromo(page);
      ok(e.length === 0, `D · ${nombreVista}: estadía 9→12 dic (fuera de la promoción) NO muestra etiqueta (${e.length})`);
      await page.screenshot({ path: join(OUT, `D3-${nombreVista}-sin-promo-1366.png`), fullPage: true });
    }
    await ctx.close();
    // B · alojamiento por unidad con menores
    const s2 = await sesion("administracion@revision.test", vista);
    await abrirBuscador(s2.page, vistaTabla);
    await buscar(s2.page, { destino: "CARTAGENA U1", ida: "10/06/2030", regreso: "13/06/2030", menores: [8, 2] });
    const tb = await texto(s2.page);
    const lista = await s2.page.locator('[data-testid="menor-unidad"]').allInnerTexts();
    ok(lista.length >= 1, `B · ${nombreVista} ${vista}: la unidad confirmada lista a cada menor (${lista.length} fila(s): ${lista.map(norm).join(" || ")})`);
    ok(lista.every((x) => /incluido|cargo propio|paga como adulto/.test(x)), `B · ${nombreVista} ${vista}: cada menor dice incluido / cargo propio / paga como adulto`);
    ok(!/c\/u|Tarifa de adulto/.test(tb) || !vistaTabla, `B · ${nombreVista} ${vista}: sin tarifa por persona inventada para el hotel por unidad`);
    ok(await sinDesborde(s2.page), `B · ${nombreVista} ${vista}: sin desborde horizontal`);
    await s2.page.screenshot({ path: join(OUT, `B1-${nombreVista}-unidad-menores-${VISTAS[vista].width}.png`), fullPage: true });
    await s2.ctx.close();
  }
}
// ═══ 126-D · superficies restantes: tarjeta con fechas, «Ver opciones» y formulario de reserva del asesor ═══════════════════════════════════
for (const vista of Object.keys(VISTAS)) {
  const { ctx, page, cuenta } = await sesion("administracion@revision.test", vista);
  await page.goto(`${APP}/tarifario`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Porción terrestre/ }).first().click().catch(() => {}); await page.waitForTimeout(900);
  let tarjetas = await page.locator('[data-testid="fechas-tarjeta"]').count();
  if (!tarjetas) { await page.locator('button[role="combobox"]').first().click().catch(() => {}); await page.getByRole("option", { name: "DEMO 125" }).click().catch(() => {}); await page.waitForTimeout(1200); tarjetas = await page.locator('[data-testid="fechas-tarjeta"]').count(); }
  // V1 (Codex ronda 2): la lista inicial de Vista Booking solo muestra ofertas RECOMENDADAS (armado_hoteles.prioridad); la copia las tenia en 0 (seed126d.sql las marca). Sin tarjetas = FALLO, no omision.
  if (!tarjetas) { ok(false, `T · ${vista}: no hay tarjetas con selector de fechas (¿falta seed126d.sql?)`); await ctx.close(); continue; }
  ok(tarjetas > 0, `T · ${vista}: hay tarjetas con selector de fechas (${tarjetas})`);
  // la tarjeta de «Hotel PRE BF 125 ACTIVO»
  const indice = await page.locator('[data-testid="fechas-tarjeta"]').evaluateAll((els) => els.findIndex((e) => { let n = e.parentElement; for (let i = 0; i < 10 && n; i++, n = n.parentElement) { if (/Hotel PRE BF 125 ACTIVO/.test(n.textContent ?? "") && n.querySelectorAll('[data-testid="fechas-tarjeta"]').length === 1) return true; } return false; }));
  ok(indice >= 0, `T · ${vista}: se localiza la tarjeta del hotel con promoción (${indice})`);
  if (indice < 0) { await ctx.close(); continue; }
  const bloque = page.locator('[data-testid="fechas-tarjeta"]').nth(indice);
  const tarjetaHotel = bloque.locator("xpath=ancestor::*[.//*[contains(text(),'Hotel PRE BF 125 ACTIVO')]][count(.//*[@data-testid='fechas-tarjeta'])=1][last()]");
  async function precio(ida, reg) {
    await bloque.locator('input[aria-label="Ida"]').fill(ida); await bloque.locator('input[aria-label="Ida"]').blur();
    await bloque.locator('input[aria-label="Regreso"]').fill(reg); await bloque.locator('input[aria-label="Regreso"]').blur();
    cuenta.posts = 0;
    await bloque.getByRole("button", { name: /Ver precio para estas fechas/ }).click();
    await page.waitForSelector('[data-testid="precio-fechas"]', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  const promoEn = (loc) => loc.locator('[data-testid="etiqueta-promocion-hotel"]').allInnerTexts().then((a) => a.map(norm));
  await precio("04/12/2026", "09/12/2026");
  let e = await promoEn(tarjetaHotel);
  ok(e.some((x) => /^Promoción PRE BF$/.test(x)), `T · ${vista}: la tarjeta con fechas 4→9 dic muestra «Promoción PRE BF» (${e.join(" | ") || "ninguna"})`);
  ok(cuenta.posts <= 2, `T · ${vista}: calcular el precio de la tarjeta = ${cuenta.posts} llamada(s) al servidor`);
  const icono = await tarjetaHotel.locator('[data-testid="etiqueta-promocion-hotel"] svg').first().boundingBox();
  ok(!!icono && icono.width >= 10, `T · ${vista}: el ícono de la etiqueta no se colapsa`);
  ok(await sinDesborde(page), `T · ${vista}: sin desborde horizontal`);
  await page.screenshot({ path: join(OUT, `T1-tarjeta-fechas-promo-${VISTAS[vista].width}.png`), fullPage: false });
  if (vista === "escritorio") {
    await precio("02/12/2026", "07/12/2026");
    e = await promoEn(tarjetaHotel);
    ok(e.some((x) => /solo en algunas noches/.test(x)), `T · tarjeta 2→7 dic: «solo en algunas noches» (${e.join(" | ") || "ninguna"})`);
    await precio("09/12/2026", "12/12/2026");
    e = await promoEn(tarjetaHotel);
    ok(e.length === 0, `T · tarjeta 9→12 dic: sin etiqueta (${e.length})`);
    // «Ver opciones» (popup de precios por fechas): estadía completa, parcial y fuera de la promoción
    const casosPopup = [
      { id: "T2-completa", ida: "04/12/2026", reg: "09/12/2026", espera: (x) => x.some((y) => /^Promoción PRE BF$/.test(y)) && !x.some((y) => /algunas noches/.test(y)), texto: "completa: repite «Promoción PRE BF» sin calificador" },
      { id: "T3-parcial", ida: "02/12/2026", reg: "07/12/2026", espera: (x) => x.some((y) => /PRE BF/.test(y) && /solo en algunas noches/.test(y)), texto: "parcial: dice «solo en algunas noches»" },
      { id: "T4-sin-promo", ida: "09/12/2026", reg: "12/12/2026", espera: (x) => x.length === 0, texto: "fuera de la promoción: sin etiqueta" },
    ];
    for (const c of casosPopup) {
      await precio(c.ida, c.reg);
      // «Ver opciones →» vive fuera del contenedor del selector de fechas: se toma por su posición entre los botones de las tarjetas (igual orden que `fechas-tarjeta`).
      await page.getByRole("button", { name: /Ver opciones/ }).nth(indice).click().catch(() => {});
      await page.waitForTimeout(1500);
      const modal = page.locator(".fixed.inset-0").last();
      const enModal = (await modal.locator('[data-testid="etiqueta-promocion-hotel"]').allInnerTexts()).map(norm);
      const hayPopup = (await page.locator(".fixed.inset-0").count()) > 0;
      ok(hayPopup, `T · «Ver opciones» ${c.id}: el popup de precios por fechas se abre`);
      ok(c.espera(enModal), `T · «Ver opciones» ${c.id} (${c.ida}→${c.reg}) ${c.texto} (${enModal.join(" | ") || "ninguna"})`);
      await page.screenshot({ path: join(OUT, `${c.id}-popup-ver-opciones-1366.png`), fullPage: false });
      await page.getByRole("button", { name: /^Cerrar/ }).first().click().catch(() => {}); await page.waitForTimeout(600);
    }
  }
  await ctx.close();
}
{
  const { ctx, page } = await sesion("administracion@revision.test");
  await page.goto(`${APP}/dashboard/reservar/nuevo?paquete=912503&hotel=912503&modulo=porcion_terrestre`, { waitUntil: "networkidle" });
  const fIda = page.getByRole("textbox", { name: "Fecha de ida" }), fReg = page.getByRole("textbox", { name: "Fecha de regreso" });
  await fIda.fill("04/12/2026"); await fIda.blur(); await fReg.fill("09/12/2026"); await fReg.blur();
  await page.getByRole("button", { name: /Ver tarifas para estas fechas/ }).click().catch(() => {});
  await page.waitForSelector('[data-testid="promocion-reserva"]', { timeout: 30000 }).catch(() => {});
  const pr = await page.locator('[data-testid="promocion-reserva"]').allInnerTexts();
  ok(pr.map(norm).some((x) => /^Promoción PRE BF$/.test(x)), `R · formulario de reserva del asesor: la cotización por fechas 4→9 dic muestra «Promoción PRE BF» (${pr.map(norm).join(" | ") || "ninguna"})`);
  await page.screenshot({ path: join(OUT, "R1-reserva-promo-1366.png"), fullPage: false });
  await fIda.fill("09/12/2026"); await fIda.blur(); await fReg.fill("12/12/2026"); await fReg.blur();
  await page.getByRole("button", { name: /Ver tarifas para estas fechas/ }).click().catch(() => {});
  await page.waitForTimeout(2500);
  ok((await page.locator('[data-testid="promocion-reserva"]').count()) === 0, "R · formulario de reserva: 9→12 dic (fuera de la promoción) sin etiqueta");
  await ctx.close();
}
// ═══ 126-A · reportes: el equivalente contable de dólares recibidos no se llama «pesos recibidos» ═════════════════════════════════════════
{
  const { ctx, page } = await sesion("administracion@revision.test");
  await page.goto(`${APP}/dashboard/flujo-caja`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Caja/ }).click().catch(() => {}); await page.waitForTimeout(700);
  const nota = await page.locator('[data-testid="nota-equivalente-dolares"]').allInnerTexts();
  ok(nota.length === 1 && /equivalente contable/.test(nota[0]) && /no son pesos recibidos/.test(nota[0]), `F · flujo de caja (Caja): nota de equivalente contable de dólares recibidos (${nota.map(norm).join(" | ") || "ninguna"})`);
  ok(/pesos recibidos en cartera más, si hay, el equivalente contable/.test(await texto(page)), "F · flujo de caja: la definición de «Caja» nombra pesos recibidos + equivalente contable");
  ok(await sinDesborde(page), "F · flujo de caja: sin desborde horizontal");
  await page.screenshot({ path: join(OUT, "F1-flujo-caja-equivalente-1366.png"), fullPage: false });
  await page.goto(`${APP}/dashboard/contabilidad/conciliaciones`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const tc = await texto(page);
  ok(/Abono cartera \(dólares\)/.test(tc) || /USD\s?300 recibidos \(equivalente contable en pesos\)/.test(tc), "F · conciliaciones: el abono recibido en dólares se rotula como tal (no como abono en pesos)");
  await page.screenshot({ path: join(OUT, "F2-conciliaciones-dolares-1366.png"), fullPage: false });
  await ctx.close();
}
await browser.close();
writeFileSync(join(OUT, "resumen.txt"), `OK ${aciertos} · FALLO ${fallos} · OMITIDO ${omitidos}\n`);
console.log(`=== humo_126: ${aciertos} OK, ${fallos} fallo(s), ${omitidos} omitido(s)`);
process.exit(fallos ? 1 : 0);
