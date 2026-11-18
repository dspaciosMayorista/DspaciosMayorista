// VERIF-2 — búsqueda por fechas del hotel Dubai ACTIVO (912512) y de su gemelo Mixta (912503) en el build FINAL (SOLO LEE). Expectativas calculadas a mano en el informe.
import { lanzar, APP, abrirConLogin, texto, crearInforme, reiniciar } from "./revision_comun.mjs";
const { ok, cerrar } = crearInforme("VERIF-2 Dubai búsqueda");
const b = await lanzar();
const campo = (page, e) => page.locator(`label:text-is("${e}")`).locator("xpath=..").locator("input").first();
const ESC = JSON.parse(process.env.ESC ?? "[]");
const { ctx, page, cuenta } = await abrirConLogin(b, "administracion@revision.test", "escritorio");
for (const e of ESC) {
  await page.goto(`${APP}/tarifario`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Vista Booking/ }).first().click(); await page.waitForTimeout(500);
  await page.getByRole("button", { name: /Porción terrestre/ }).first().click(); await page.waitForTimeout(700);
  await page.getByRole("combobox").filter({ hasText: /Selecciona un destino|CARTAGENA|DEMO/ }).first().click();
  await page.getByRole("option", { name: "DEMO 125" }).click();
  const f = async (n, v) => { const t = page.getByRole("textbox", { name: n, exact: true }); await t.fill(v); await t.blur(); };
  await f("Ida", e.ida); await f("Regreso", e.regreso);
  await campo(page, "Adultos").fill("2"); await campo(page, "Habitaciones").fill("1");
  await page.getByLabel(/Menores \(0–17 años\)/).fill(String(e.menores.length));
  for (let i = 0; i < e.menores.length; i++) await campo(page, `Edad menor ${i + 1}`).fill(String(e.menores[i]));
  await page.getByRole("button", { name: /Buscar hoteles/ }).click();
  await page.waitForSelector('button:has-text("Buscar hoteles")'); await page.waitForTimeout(3500);
  const card = page.locator("div").filter({ hasText: new RegExp(`Hotel ${e.hotel}`) }).filter({ has: page.getByRole("button", { name: /Agregar al carrito/ }) }).last();
  const out = [];
  for (const reg of e.regimenes) {
    const sel = card.locator("select").nth(1);
    await sel.selectOption({ label: reg }).catch(() => {}); await page.waitForTimeout(500);
    out.push(`${reg}: ${(await card.innerText()).replace(/\s+/g, " ").replace(/^.*?TARIFA POR PERSONA/, "TARIFA POR PERSONA").slice(0, 420)}`);
  }
  console.log(`[${e.id}] ${e.nombre}\n   ` + out.join("\n   "));
}
await b.close();
process.exit(cerrar());
