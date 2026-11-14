// Recorrido REAL con sesión (Chrome local vía Playwright) de #16 y #45 contra la revisión local (revision_1645.sh). Solo local, datos sintéticos.
// Uso: node supabase/scripts/recorrido_16_45.mjs <url_app> <carpeta_capturas> [16|45|todo]
import { chromium } from "@playwright/test";
import fs from "node:fs";
const [base = "http://127.0.0.1:3047", salida = "capturas_1645", parte = "todo"] = process.argv.slice(2);
fs.mkdirSync(salida, { recursive: true });
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLA"} ${m}`); if (!c) process.exitCode = 1; };
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const consola = [];
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => consola.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on("console", (m) => { if (m.type() === "error") consola.push(`console: ${m.text().slice(0, 160)}`); });
page.on("response", (r) => { if (r.status() >= 500) consola.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });

await page.goto(`${base}/login`, { waitUntil: "networkidle" });
await page.locator("#email").fill("dueno@revision43.test");
await page.locator("#password").fill("Revision43!");
await page.locator('button[type="submit"]').first().click();
await page.waitForURL(/dashboard|portal/, { timeout: 60000 });
ok(true, `sesión iniciada → ${new URL(page.url()).pathname}`);

if (parte === "16" || parte === "todo") {
  await page.goto(`${base}/dashboard/contratos/nuevo`, { waitUntil: "networkidle" });
  const val = (etq, i = 0) => page.getByLabel(etq, { exact: true }).nth(i).inputValue();
  // Fechas compactas: 15112026 → 15/11/2026 (y un día imposible no se reinterpreta).
  const campoSalida = page.getByLabel("Fecha de salida (viaje)", { exact: true });
  await campoSalida.fill("15112026"); await campoSalida.blur();
  ok((await campoSalida.inputValue()) === "15/11/2026", "fecha compacta 15112026 → 15/11/2026");
  await campoSalida.fill("151126"); await campoSalida.blur();
  ok((await campoSalida.inputValue()) === "15/11/2026", "fecha compacta con año corto 151126 → 15/11/2026");
  await campoSalida.fill("31022026"); await campoSalida.blur();
  ok((await campoSalida.inputValue()) !== "31/02/2026", "31022026 (día imposible) no se acepta como otra fecha");
  await page.getByLabel("Fecha de salida (viaje)", { exact: true }).fill("15/10/2026");
  await page.getByLabel("Fecha de regreso", { exact: true }).fill("18/10/2026");
  await page.getByRole("button", { name: /Agregar hotel/ }).click();
  ok((await val("Ingreso al hotel")) === "15/10/2026" && (await val("Fecha de salida", 0)) === "18/10/2026", "hotel nuevo hereda 15/10 → 18/10");
  await page.getByRole("button", { name: /Agregar tramo/ }).click();
  await page.screenshot({ path: `${salida}/16_a_hotel_y_tramo.png`, fullPage: true });
  // El tramo nuevo parte de la ida del viaje; el regreso, del regreso.
  const fechasVuelo = await page.locator('input[aria-label="Fecha de este tramo"]').evaluateAll((els) => els.map((e) => e.value));
  console.log("fechas de vuelo visibles:", JSON.stringify(fechasVuelo));
  ok(fechasVuelo.includes("15/10/2026"), "tramo nuevo parte de la salida del viaje");
  await page.getByRole("button", { name: /Agregar regreso/ }).first().click();
  const f2 = await page.locator('input[aria-label="Fecha de este tramo"]').evaluateAll((els) => els.map((e) => e.value));
  console.log("tras «Agregar regreso»:", JSON.stringify(f2));
  ok(f2.includes("18/10/2026"), "tramo de regreso parte del regreso del viaje");
  // Conservación: editar el hotel y luego cambiar el viaje no pisa lo editado.
  await page.getByLabel("Ingreso al hotel", { exact: true }).fill("16/10/2026");
  await page.getByLabel("Fecha de salida (viaje)", { exact: true }).fill("20/10/2026");
  ok((await val("Ingreso al hotel")) === "16/10/2026", "el ingreso editado a mano (16/10) se conserva al cambiar el viaje");
  await page.getByRole("button", { name: /Agregar hotel/ }).click();
  ok((await val("Ingreso al hotel", 1)) === "20/10/2026", "un hotel posterior toma la nueva salida (20/10)");
  await page.screenshot({ path: `${salida}/16_b_conservacion.png`, fullPage: true });
}

if (parte === "45" || parte === "todo") {
  const guardarTexto = async (hotelId, categoria, descripcion, incluye) => {
    await page.goto(`${base}/dashboard/producto/hoteles/${hotelId}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Categorías de habitación y regímenes/ }).click();
    const fila = page.locator("li, div").filter({ hasText: categoria }).filter({ has: page.getByRole("button", { name: /Editar/ }) }).last();
    await fila.getByRole("button", { name: /Editar/ }).first().click();
    await page.getByLabel("Descripción", { exact: true }).fill(descripcion);
    await page.getByLabel(/Qué incluye/).fill(incluye);
    const editor = page.locator("div").filter({ has: page.getByLabel("Descripción", { exact: true }) }).filter({ has: page.getByRole("button", { name: "Cancelar" }) }).last();
    await editor.getByRole("button", { name: "Guardar" }).click();
    await page.waitForTimeout(1500);
  };
  await guardarTexto(9310, "Superior", "Habitación de 32 m² con balcón y vista parcial al mar.", ["Minibar", "Caja fuerte", "Wi-Fi"].join("\n"));
  await guardarTexto(9310, "Estándar", "Habitación interior de 24 m², sin balcón.", "Wi-Fi");
  await guardarTexto(9306, "Estándar", "Habitación exterior con vista a la piscina.", "Desayuno buffet");
  await page.goto(`${base}/dashboard/producto/hoteles/9310`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Categorías de habitación y regímenes/ }).click();
  const seccion = await page.locator("body").innerText();
  ok(seccion.includes("Habitación de 32 m² con balcón") , "9310 Superior: la descripción persiste tras recargar");
  await page.screenshot({ path: `${salida}/45_a_editor_guardado.png`, fullPage: true });

  // Ficha del tarifario: Vista Booking → Porción terrestre → «Buscar alojamiento».
  await page.goto(`${base}/tarifario`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Vista Booking" }).click();
  await page.getByRole("button", { name: "Porción terrestre" }).click();
  const buscador = page.locator("div").filter({ hasText: "Buscar alojamiento" }).filter({ has: page.getByRole("button", { name: /buscar hoteles/i }) }).last();
  await buscador.getByText("Selecciona un destino").first().click();
  await page.getByRole("option", { name: /T293 DESTINO/ }).first().click();
  await buscador.getByLabel("Ida", { exact: true }).fill("27/06/2027");
  await buscador.getByLabel("Regreso", { exact: true }).fill("30/06/2027");
  await buscador.getByRole("button", { name: /buscar hoteles/i }).click();
  await page.waitForTimeout(4000);
  const cuerpo = await page.locator("body").innerText();
  console.log("hoteles en resultados:", [...cuerpo.matchAll(/R43 [A-ZÁÉÍÓÚ ]+/g)].map((m) => m[0].trim()).filter((v, i, a) => a.indexOf(v) === i));
  ok(cuerpo.includes("Habitación exterior con vista a la piscina."), "la ficha de R43 HABITACION muestra SU descripción bajo el selector de categoría");
  ok(!cuerpo.includes("Habitación interior de 24 m²"), "no muestra el texto de otro hotel con la misma categoría");
  await page.screenshot({ path: `${salida}/45_b_busqueda.png`, fullPage: true });
}
console.log(consola.length ? `Consola/red (${consola.length}):\n  ${consola.join("\n  ")}` : "Sin errores de consola ni 5xx");
await browser.close();
