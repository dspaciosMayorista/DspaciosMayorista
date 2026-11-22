// #127 — rendered walkthrough on the FINAL local production build (real login through GoTrue, synthetic data, desktop + mobile).
// Usage (from dspacios-travel/):  node supabase/scripts/localreview127/humo_127.mjs <carpeta_capturas> [base_url]
// Needs entorno_127_local.sh preparar (variables in $REV127_DIR/entorno.env, exported to this process by the caller) and `next start -p 3081`.
// Counts the server-action POSTs of each step (no polling, no retries) and fails (exit 1) on any unmet expectation.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SALIDA = process.argv[2], BASE = process.argv[3] ?? "http://127.0.0.1:3081";
const CLAVE = process.env.REV127_CLAVE_USUARIOS, PG = process.env.REV127_PG ?? "pg127", DB = process.env.REV127_DB ?? "rev127";
if (!SALIDA || !CLAVE) { console.error("uso: humo_127.mjs <carpeta> [base]; exporta REV127_CLAVE_USUARIOS/REV127_PG/REV127_DB (entorno.env)"); process.exit(2); }
mkdirSync(SALIDA, { recursive: true });
const psql = (q) => execSync(`docker exec -i -e PGPASSWORD=postgres ${PG} psql -h 127.0.0.1 -U supabase_admin -d ${DB} -X -q -t -A -v ON_ERROR_STOP=1`, { input: q, encoding: "utf8" }).trim();
let fallos = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };

const navegador = await chromium.launch({ channel: "msedge", headless: true });
const VISTAS = [
  { nombre: "desktop", viewport: { width: 1366, height: 900 } },
  { nombre: "tablet", viewport: { width: 820, height: 1180 } }, // intermediate width where columns and the regeneration warning can collide
  { nombre: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];

async function entrar(page) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", "admin127@revision.test");
  await page.fill("#password", CLAVE);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
}
// The «Generar tarifario» button lives in the «Tarifario resultado» tab of the package.
async function buscarSalida(page, etiqueta) {
  await page.goto(`${BASE}/tarifario`);
  const sel = page.locator("select");
  await sel.nth(3).selectOption({ label: "BOGOTÁ" });
  await sel.nth(4).selectOption({ label: "CARTAGENA 127" });
  const opciones = await sel.nth(5).locator("option").allTextContents();
  await sel.nth(5).selectOption({ label: opciones.find((o) => o.includes(etiqueta)) });
  await page.waitForTimeout(2500);
}
// The checkout page streams: wait until it shows either the offer or the closure message.
async function abrirCheckout(page, enlace) {
  await page.goto(enlace);
  await page.waitForFunction(() => document.querySelector('[data-testid="hotel-cerrado"]') || /Reservar — GRAND SIRENIS/.test(document.body.innerText), null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(500);
}
async function generar(page, paquete = 12701) {
  await page.goto(`${BASE}/dashboard/paquetes/${paquete}`);
  await page.getByText("Tarifario resultado", { exact: true }).first().click();
  await page.getByRole("button", { name: /Generar tarifario/ }).first().click();
  await page.waitForFunction(() => !/Generando…/.test(document.body.innerText), null, { timeout: 120000 });
  await page.waitForTimeout(500);
}
// Saves a general closure from the REAL admin screen (real server action: insert + bounded regeneration).
async function guardarCierre(page, hotel, ini, fin) {
  await page.goto(`${BASE}/dashboard/producto/hoteles/${hotel}`);
  await page.getByRole("button", { name: /Black out general/ }).click();
  const fechas = page.locator('input[placeholder="dd/mm/aaaa"]');
  await fechas.nth(0).fill(ini); await fechas.nth(0).press("Tab");
  await fechas.nth(1).fill(fin); await fechas.nth(1).press("Tab");
  await page.getByRole("button", { name: "Agregar cierre" }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].some((b) => b.textContent === "…"), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(800);
}
const sinDesborde = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// Departure card labels as the storefront prints them (fmtFecha = dd/mm/aa).
const SALIDAS = { A: "30/12/26–02/01/27", B: "26/12/26–29/12/26", D: "10/01/27–13/01/27" };
const HOTEL_CERRADO = "GRAND SIRENIS CARTAGENA 127", HOTEL_OTRO = "HOTEL OTRO CARTAGENA 127";

for (const vista of VISTAS) {
  console.log(`\n=== ${vista.nombre} ===`);
  const ctx = await navegador.newContext({ viewport: vista.viewport, isMobile: vista.isMobile, hasTouch: vista.hasTouch, locale: "es-CO" });
  const page = await ctx.newPage();
  const acciones = { n: 0 };
  page.on("request", (r) => { if (r.method() === "POST" && r.headers()["next-action"]) acciones.n++; });
  // Clean state for this viewport: no closures, regenerated tariffs through the real button.
  psql("delete from public.hotel_blackouts where hotel_id = 12701");
  await entrar(page);
  await generar(page);
  const tarifarioListo = async () => psql("select count(*) from public.tarifario_resultado_publicable where paquete_id = 12701 and hotel_id = 12701");
  ok(Number(await tarifarioListo()) > 0, "published tariff exists for the closed-to-be hotel before any closure");

  // 1) Before: the owner stay is offered (storefront Vista Booking: origin → destination → flight departure).
  await buscarSalida(page, SALIDAS.A);
  ok(await page.getByText(HOTEL_CERRADO).first().isVisible(), `${vista.nombre}: before the closure the owner stay (${SALIDAS.A}) lists ${HOTEL_CERRADO}`);
  await page.screenshot({ path: join(SALIDA, `${vista.nombre}-1-antes-booking.png`), fullPage: true });
  ok(await sinDesborde(page), `${vista.nombre}: no horizontal overflow (before)`);

  // 2) The closure is saved from the real admin screen (real server action: insert + bounded regeneration).
  await page.goto(`${BASE}/dashboard/producto/hoteles/12701`);
  await page.getByRole("button", { name: /Black out general/ }).click();
  const fechas = page.locator('input[placeholder="dd/mm/aaaa"]');
  await fechas.nth(0).fill("29/12/2026"); await fechas.nth(0).press("Tab");
  await fechas.nth(1).fill("09/01/2027"); await fechas.nth(1).press("Tab");
  acciones.n = 0;
  await page.getByRole("button", { name: "Agregar cierre" }).click();
  await page.getByText(/29\/12\/2026|2026-12-29/).first().waitFor({ timeout: 120000 }).catch(() => {});
  await page.waitForFunction(() => !/…/.test([...document.querySelectorAll("button")].map((b) => b.textContent).join("")), null, { timeout: 120000 }).catch(() => {});
  await page.screenshot({ path: join(SALIDA, `${vista.nombre}-2-cierre-guardado.png`), fullPage: true });
  ok(Number(psql("select count(*) from public.hotel_blackouts where hotel_id = 12701 and fecha_inicio = '2026-12-29' and fecha_fin = '2027-01-09' and total")) === 1, `${vista.nombre}: the closure was stored from the UI`);
  console.log(`      server-action POSTs for save+regenerate: ${acciones.n}`);
  ok(acciones.n <= 2, `${vista.nombre}: saving a closure costs at most 2 server-action requests (save + refresh)`);
  ok(Number(psql("select count(*) from public.tarifario_resultado_publicable where paquete_id = 12701 and hotel_id = 12701 and bloqueo_id = 12701")) === 0, `${vista.nombre}: the closed stay no longer exists in the published view after saving`);

  // 3) After: the storefront no longer offers the closed hotel on the owner stay; the unaffected hotel and the other stays remain.
  await buscarSalida(page, SALIDAS.A);
  ok(!(await page.getByText(HOTEL_CERRADO).first().isVisible().catch(() => false)), `${vista.nombre}: ${HOTEL_CERRADO} is NOT offered on ${SALIDAS.A}`);
  ok(await page.getByText(HOTEL_OTRO).first().isVisible(), `${vista.nombre}: the unaffected hotel is still offered on ${SALIDAS.A}`);
  await page.screenshot({ path: join(SALIDA, `${vista.nombre}-3-despues-booking-cerrada.png`), fullPage: true });
  await buscarSalida(page, SALIDAS.B);
  ok(await page.getByText(HOTEL_CERRADO).first().isVisible(), `${vista.nombre}: ${HOTEL_CERRADO} is still offered on ${SALIDAS.B} (check-out on the first closed day)`);
  await page.screenshot({ path: join(SALIDA, `${vista.nombre}-3-despues-booking-abierta.png`), fullPage: true });
  await buscarSalida(page, SALIDAS.D);
  ok(await page.getByText(HOTEL_CERRADO).first().isVisible(), `${vista.nombre}: ${HOTEL_CERRADO} is still offered on ${SALIDAS.D} (first night after the closure)`);
  ok(await sinDesborde(page), `${vista.nombre}: no horizontal overflow (after)`);

  // 4) A cart/link opened BEFORE the closure, with the closure present but the tariffs NOT regenerated (stale rows): the checkout page refuses it.
  psql("delete from public.hotel_blackouts where hotel_id = 12701");
  await generar(page);
  const enlace = `${BASE}/dashboard/reservar/nuevo?paquete=12701&hotel=12701&bloqueo=12701&modulo=bloqueo`;
  await abrirCheckout(page, enlace);
  ok(await page.getByText(/Reservar — GRAND SIRENIS/).first().isVisible().catch(() => false), `${vista.nombre}: the checkout link works while the hotel is open (double room $1.250.000 = 2 × 625.000 visible)`);
  await page.screenshot({ path: join(SALIDA, `${vista.nombre}-4-checkout-abierto.png`), fullPage: true });
  psql("set session_replication_role = replica; insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total) values (12701, '2026-12-29', '2027-01-09', true)");
  await abrirCheckout(page, enlace);
  ok(await page.getByTestId("hotel-cerrado").isVisible(), `${vista.nombre}: the stale link now shows the closure message instead of the offer`);
  await page.screenshot({ path: join(SALIDA, `${vista.nombre}-5-checkout-cerrado.png`), fullPage: true });
  ok(await sinDesborde(page), `${vista.nombre}: no horizontal overflow (checkout closed)`);
  // 5) Reopening from the real screen restores the offer.
  psql("delete from public.hotel_blackouts where hotel_id = 12701");
  await generar(page);
  await abrirCheckout(page, enlace);
  ok(await page.getByText(/Reservar — GRAND SIRENIS/).first().isVisible().catch(() => false), `${vista.nombre}: after reopening and regenerating the checkout link works again`);

  // 6) G1 — porción «from» price. The porción tab is a LIVE search (origin-free: destination + dates), fed by the published rows only to know which hotels exist; the published «desde» price
  //    is verified at the data layer (psql on the published view). The closure covers only the cheap BAJA dates (29-Dec → 09-Jan): the old 225.000 must never stay public.
  psql("delete from public.hotel_blackouts where hotel_id = 12704");
  await generar(page, 12702);
  const vistaDesde = () => psql("select coalesce(min(precio_pvp), 0) from public.tarifario_resultado_publicable where paquete_id = 12702 and hotel_id = 12704 and acomodacion = 'doble'");
  ok(vistaDesde() === "225000.00" || vistaDesde() === "225000", `${vista.nombre}: published porción «desde» is 225.000 before any closure (got ${vistaDesde()})`);
  const buscarPorcion = async (ida, regreso) => {
    await page.goto(`${BASE}/tarifario`);
    await page.waitForTimeout(1500);
    await page.getByText("Porción terrestre", { exact: true }).first().click();
    await page.waitForTimeout(1200);
    // the destination may already be remembered from the previous search
    const sd = page.getByText("Selecciona un destino").first();
    if (await sd.isVisible().catch(() => false)) {
      await sd.click();
      const op = page.getByRole("option", { name: /CARTAGENA 127/ }).first();
      // Fail closed: while a stale row cannot be proven, the whole destination can disappear from the search until the verified regeneration.
      if (!(await op.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false))) { await page.keyboard.press("Escape"); return "DESTINO_NO_OFRECIDO"; }
      await op.click();
    }
    const f = page.locator('input[placeholder="dd/mm/aaaa"]');
    await f.nth(0).fill(ida); await f.nth(0).press("Tab");
    await f.nth(1).fill(regreso); await f.nth(1).press("Tab");
    await page.getByRole("button", { name: "BUSCAR HOTELES" }).click();
    await page.waitForTimeout(4500);
    return page.locator("body").innerText();
  };
  let t = await buscarPorcion("30/12/2026", "02/01/2027");
  ok(/HOTEL PORCION CARTAGENA 127/.test(t) && /225\.000/.test(t), `${vista.nombre}: before the closure the BAJA stay is offered at $225.000 c/u`);
  await page.screenshot({ path: join(SALIDA, `${vista.nombre}-6-porcion-antes.png`), fullPage: true });
  psql("set session_replication_role = replica; insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total) values (12704, '2026-12-29', '2027-01-09', true)");
  ok(vistaDesde() !== "0", `${vista.nombre}: (precondition) the stale row is still physically published, no regeneration happened`);
  t = await buscarPorcion("30/12/2026", "02/01/2027");
  ok(!/225\.000/.test(t) && !/HOTEL PORCION CARTAGENA 127/.test(t), `${vista.nombre}: stale closure, no regeneration: the closed stay is not offered and $225.000 is not advertised (destination offered: ${t !== "DESTINO_NO_OFRECIDO"})`);
  await page.screenshot({ path: join(SALIDA, `${vista.nombre}-6-porcion-cerrada-stale.png`), fullPage: true });
  t = await buscarPorcion("10/01/2027", "13/01/2027");
  ok(!/225\.000/.test(t), `${vista.nombre}: stale closure, no regeneration: even an open stay never shows the stale $225.000 (fail closed: ${t === "DESTINO_NO_OFRECIDO" ? "the destination is withdrawn until the verified regeneration" : "offered at its live price"})`);
  psql("delete from public.hotel_blackouts where hotel_id = 12704");
  await generar(page, 12702);
  await guardarCierre(page, 12704, "29/12/2026", "09/01/2027");
  ok(Number(vistaDesde()) === 375000, `${vista.nombre}: after the REAL save (insert + regeneration) the published «desde» is 375.000 (got ${vistaDesde()})`);
  ok(psql("select string_agg(distinct desde_entrada::text, ',') from public.tarifario_resultado where paquete_id = 12702 and hotel_id = 12704 and acomodacion = 'doble'") === "2026-12-01", `${vista.nombre}: the published row carries its sellable witness (2026-12-01)`);
  t = await buscarPorcion("10/01/2027", "13/01/2027");
  ok(/375\.000/.test(t) && !/225\.000/.test(t), `${vista.nombre}: after the real save, an open stay still shows $375.000 c/u`);
  await page.screenshot({ path: join(SALIDA, `${vista.nombre}-6-porcion-abierta-regenerado.png`), fullPage: true });
  ok(await sinDesborde(page), `${vista.nombre}: no horizontal overflow (porción search)`);
  psql("delete from public.hotel_blackouts where hotel_id = 12704");
  await generar(page, 12702);
  ok(Number(vistaDesde()) === 225000, `${vista.nombre}: reopening + regeneration restores the true 225.000 (got ${vistaDesde()})`);

  // 7) Unit-priced hotel: an accommodation-only closure cannot be applied to a unit tariff — reported, never silently reinterpreted.
  await page.goto(`${BASE}/dashboard/producto/hoteles/12703`);
  await page.getByRole("button", { name: /Black out general/ }).click();
  await page.getByRole("checkbox", { name: /Cierre total/ }).uncheck(); // the note lives in the partial-closure form
  await page.getByTestId("cierre-unidad-nota").waitFor({ timeout: 30000 });
  ok(await page.getByTestId("cierre-unidad-nota").isVisible(), `${vista.nombre}: unit hotel: the form explains that only total / category closures apply`);
  ok(await page.getByText("Marca al menos una categoría.", { exact: true }).isVisible(), `${vista.nombre}: unit hotel: the helper text only asks for a category (no accommodation option offered)`);
  ok(await page.getByTestId("cierre-no-aplica").first().isVisible(), `${vista.nombre}: unit hotel: the stored accommodation-only closure is flagged «No aplica: tarifa por unidad»`);
  await page.screenshot({ path: join(SALIDA, `${vista.nombre}-7-hotel-unidad.png`), fullPage: true });
  ok(await sinDesborde(page), `${vista.nombre}: no horizontal overflow (unit hotel)`);

  // 8) Regeneration warning: the closure IS saved, but the regeneration cannot run → the operator is told, in this width too.
  psql("revoke execute on function public.iniciar_generacion_tarifario(bigint) from authenticated");
  try {
    await guardarCierre(page, 12701, "20/02/2027", "21/02/2027");
    const aviso = page.getByText(/no se regeneró el tarifario/);
    await aviso.first().waitFor({ timeout: 30000 }).catch(() => {});
    ok(await aviso.first().isVisible().catch(() => false), `${vista.nombre}: the regeneration warning is visible after saving a closure whose regeneration failed`);
    const caja = await aviso.first().boundingBox();
    ok(!!caja && caja.x >= 0 && caja.x + caja.width <= vista.viewport.width + 1, `${vista.nombre}: the warning stays inside the viewport (x=${caja ? Math.round(caja.x) : "?"}, w=${caja ? Math.round(caja.width) : "?"})`);
    await page.screenshot({ path: join(SALIDA, `${vista.nombre}-8-aviso-regeneracion.png`), fullPage: true });
    ok(await sinDesborde(page), `${vista.nombre}: no horizontal overflow (warning)`);
  } finally {
    psql("grant execute on function public.iniciar_generacion_tarifario(bigint) to authenticated");
    psql("delete from public.hotel_blackouts where hotel_id = 12701");
  }
  await ctx.close();
}
await navegador.close();
console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTODO OK");
process.exit(fallos ? 1 : 0);
