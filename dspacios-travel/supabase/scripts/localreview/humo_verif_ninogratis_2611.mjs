// VERIF-2 (2026-11-18) — item 4 sobre el build FINAL: presentación de la promoción «un niño gratis por habitación» en la BÚSQUEDA (Vista tabla y Vista Booking).
// SOLO LEE. Uso (desde dspacios-travel/): node supabase/scripts/localreview/humo_verif_ninogratis_2611.mjs <carpeta_capturas> [vistas]
import { join } from "node:path";
import { lanzar, APP, abrirConLogin, texto, sinDesborde, crearInforme, reiniciar, mkdirSync } from "./revision_comun.mjs";

const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const { ok, cerrar } = crearInforme("VERIF-2 niño gratis (búsqueda)");
const b = await lanzar();
const campo = (page, etiqueta) => page.locator(`label:text-is("${etiqueta}")`).locator("xpath=..").locator("input").first();
const SIZES = { escritorio: { width: 1366, height: 900 }, tablet: { width: 900, height: 900 }, movil: { width: 390, height: 844 } };
const vistas = (process.argv[3] ?? "escritorio,tablet,movil").split(",");
const DEST = "DEMO 125";

async function abrirBuscador(page, modo) {
  await page.goto(`${APP}/tarifario`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: new RegExp(`^${modo === "tabla" ? "Vista tabla" : "Vista Booking"}`) }).first().click(); await page.waitForTimeout(600);
  await page.getByRole("button", { name: /Porción terrestre/ }).first().click(); await page.waitForTimeout(800);
  await page.getByRole("combobox").filter({ hasText: /Selecciona un destino|CARTAGENA|DEMO/ }).first().click();
  await page.getByRole("option", { name: DEST }).click();
}
async function buscar(page, cuenta, { ida, regreso, adultos = 2, habitaciones = 1, menores = [] }) {
  const f = async (n, v) => { const t = page.getByRole("textbox", { name: n, exact: true }); await t.fill(v); await t.blur(); };
  await f("Ida", ida); await f("Regreso", regreso);
  await campo(page, "Adultos").fill(String(adultos));
  await campo(page, "Habitaciones").fill(String(habitaciones));
  await page.getByLabel(/Menores \(0–17 años\)/).fill(String(menores.length));
  for (let i = 0; i < menores.length; i++) await campo(page, `Edad menor ${i + 1}`).fill(String(menores[i]));
  reiniciar(cuenta);
  await page.getByRole("button", { name: /Buscar hoteles/ }).click();
  await page.waitForSelector('button:has-text("Buscar hoteles")', { timeout: 45000 });
  await page.waitForTimeout(3500);
  return { acciones: cuenta.acciones };
}
const ESC = [
  { id: "a", nombre: "5 noches 4→9 dic, niño de 8 (todo dentro de la promoción)", ida: "04/12/2026", regreso: "09/12/2026", menores: [8] },
  { id: "b", nombre: "5 noches 4→9 dic, niños de 8 y 5 (solo uno es gratis)", ida: "04/12/2026", regreso: "09/12/2026", menores: [8, 5] },
  { id: "c", nombre: "5 noches 6→11 dic, niño de 8 (gratis solo 3 de 5 noches)", ida: "06/12/2026", regreso: "11/12/2026", menores: [8] },
  { id: "d", nombre: "2 noches 1→3 dic, niño de 8 (fuera de la promoción)", ida: "01/12/2026", regreso: "03/12/2026", menores: [8] },
];

for (const vista of vistas) {
  console.log(`\n######## ${vista}`);
  for (const modo of ["tabla", "booking"]) {
    const { ctx, page, cuenta } = await abrirConLogin(b, "administracion@revision.test", "escritorio");
    await page.setViewportSize(SIZES[vista]);
    for (const e of ESC) {
      await abrirBuscador(page, modo);
      const r = await buscar(page, cuenta, e);
      const t = await texto(page);
      const i = t.indexOf("PRE BF 125 ACTIVO");
      const bloque = i >= 0 ? t.slice(Math.max(0, i - 200), i + 1700) : "(hotel 912503 no aparece)";
      console.log(`  [${modo} ${e.id}] ${e.nombre} acciones=${r.acciones}\n     ${bloque}`);
      const gratis = (t.match(/Niño gratis/g) ?? []).length;
      const regular = (t.match(/Tarifa regular/g) ?? []).length;
      const resta = /tarifa \$?\s?[\d.]+ ?[−-] ?\$?\s?[\d.]+/.test(t);
      console.log(`     «Niño gratis»=${gratis} «Tarifa regular»=${regular} aritmética=${resta}`);
      ok(!resta, `${modo} ${e.id} ${vista}: sin aritmética «tarifa X − Y»`);
      ok(await sinDesborde(page), `${modo} ${e.id} ${vista}: sin desborde horizontal`);
      await page.screenshot({ path: join(OUT, `ng-${modo}-${e.id}-${vista}.png`), fullPage: true });
    }
    await ctx.close();
  }
}
await b.close();
process.exit(cerrar());
