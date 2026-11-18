// VERIF-2 (2026-11-18) — items 3 y 4 sobre el build FINAL, Edge real. Búsqueda en Vista tabla y Vista Booking: unidad (U1/O3), 2027 vacío, 5 adultos sin reparto, niño gratis (#125).
// SOLO LEE (no escribe datos). Uso (desde dspacios-travel/): node supabase/scripts/localreview/humo_verif_busqueda_2611.mjs <carpeta_capturas> [vistas: escritorio,tablet,movil]
import { join } from "node:path";
import { lanzar, APP, SUPA, abrirConLogin, texto, sinDesborde, crearInforme, reiniciar, mkdirSync } from "./revision_comun.mjs";

const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const { ok, cerrar } = crearInforme("VERIF-2 búsqueda");
const b = await lanzar();
const campo = (page, etiqueta) => page.locator(`label:text-is("${etiqueta}")`).locator("xpath=..").locator("input").first();
const SIZES = { escritorio: { width: 1366, height: 900 }, tablet: { width: 900, height: 900 }, movil: { width: 390, height: 844 } };
// DEST_U1: destino donde se elige el hotel por unidad. Por defecto «CARTAGENA U1» (build con el arreglo del selector de la tabla). Con un build ANTERIOR al arreglo solo se puede alcanzar en tabla si comparte destino con filas persona.
const DEST_U1 = process.env.DEST_U1 ?? "CARTAGENA U1";
const vistas = (process.argv[3] ?? "escritorio,tablet,movil").split(",");
const corto = (s, n = 1400) => s.replace(/\s+/g, " ").slice(0, n);

async function abrirBuscador(page, { modo, destino, modulo = "Porción terrestre" }) {
  await page.goto(`${APP}/tarifario`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: new RegExp(`^${modo === "tabla" ? "Vista tabla" : "Vista Booking"}`) }).first().click(); await page.waitForTimeout(600);
  await page.getByRole("button", { name: new RegExp(modulo) }).first().click(); await page.waitForTimeout(800);
  await page.getByRole("combobox").filter({ hasText: /Selecciona un destino|CARTAGENA|DEMO/ }).first().click();
  await page.getByRole("option", { name: destino }).click();
}
async function buscar(page, cuenta, { ida, regreso, adultos = 2, habitaciones = 1, menores = [], espera = 3500 }) {
  const f = async (n, v) => { const t = page.getByRole("textbox", { name: n, exact: true }); await t.fill(v); await t.blur(); };
  await f("Ida", ida); await f("Regreso", regreso);
  await campo(page, "Adultos").fill(String(adultos));
  await campo(page, "Habitaciones").fill(String(habitaciones));
  await page.getByLabel(/Menores \(0–17 años\)/).fill(String(menores.length));
  for (let i = 0; i < menores.length; i++) await campo(page, `Edad menor ${i + 1}`).fill(String(menores[i]));
  reiniciar(cuenta);
  await page.getByRole("button", { name: /Buscar hoteles/ }).click();
  await page.waitForSelector('button:has-text("Buscar hoteles")', { timeout: 45000 });
  await page.waitForTimeout(espera);
  return { acciones: cuenta.acciones, rest: cuenta.rest };
}

for (const vista of vistas) {
  console.log(`\n######## ${vista}`);
  const ctx0 = await abrirConLogin(b, "administracion@revision.test", "escritorio");
  const { ctx, page, cuenta } = ctx0;
  await page.setViewportSize(SIZES[vista]);
  const shot = (n) => page.screenshot({ path: join(OUT, `${n}-${vista}.png`), fullPage: true });

  // ───── A1: U1 TABLA, 2 adultos 1 hab, 10–13 jun 2030
  await abrirBuscador(page, { modo: "tabla", destino: DEST_U1 });
  let r = await buscar(page, cuenta, { ida: "10/06/2030", regreso: "13/06/2030" });
  let t = await texto(page);
  console.log(`  [A1 tabla U1 2ad] acciones=${r.acciones} rest=${r.rest} :: ${corto(t.slice(t.indexOf("Alojamientos por unidad") >= 0 ? t.indexOf("Alojamientos por unidad") : 0), 900)}`);
  ok(r.acciones === 2, `A1 ${vista}: 2 server actions por clic en Vista tabla (obtenido ${r.acciones})`);
  ok((await page.locator('[data-testid="tabla-unidad"]').count()) === 1, `A1 ${vista}: la sección «Alojamientos por unidad» aparece en Vista tabla`);
  ok(!/No hay hoteles con tarifa/.test(t), `A1 ${vista}: no muestra el vacío`);
  ok(!/no incluye los alojamientos por unidad/i.test(t), `A1 ${vista}: ya no dice que la tabla no incluye unidad`);
  ok(await sinDesborde(page), `A1 ${vista}: sin desborde horizontal`);
  const unidad = (await page.locator('[data-testid="tabla-unidad"]').first().innerText().catch(() => "")).replace(/\s+/g, " ");
  console.log(`  [A1 sección] ${unidad.slice(0, 1200)}`);
  await shot("A1-tabla-U1-2adultos");
  // idle 30 s
  reiniciar(cuenta); await page.waitForTimeout(30000);
  ok(cuenta.acciones === 0 && cuenta.rest === 0, `A1 ${vista}: 0 acciones y 0 /rest en reposo 30 s (acciones=${cuenta.acciones}, rest=${cuenta.rest})`);

  // ───── A1b: mismo en Vista Booking (paridad)
  await abrirBuscador(page, { modo: "booking", destino: DEST_U1 });
  r = await buscar(page, cuenta, { ida: "10/06/2030", regreso: "13/06/2030" });
  const tb = await texto(page);
  console.log(`  [A1b booking U1 2ad] acciones=${r.acciones} :: ${corto(tb, 900)}`);
  ok(r.acciones === 2, `A1b ${vista}: 2 server actions por clic en Vista Booking (obtenido ${r.acciones})`);
  ok(tb.includes("U1 · Hotel por unidad con edades") && tb.includes("U1 · Hotel por unidad SIN edades"), `A1b ${vista}: Booking lista ambos hoteles de unidad`);
  await shot("A1b-booking-U1-2adultos");

  // ───── A2: U1 TABLA con un menor de 5 años
  await abrirBuscador(page, { modo: "tabla", destino: DEST_U1 });
  r = await buscar(page, cuenta, { ida: "10/06/2030", regreso: "13/06/2030", menores: [5] });
  t = await texto(page);
  const rev = (await page.locator('[data-testid="hoteles-en-revision"]').count()) ? (await page.locator('[data-testid="hoteles-en-revision"]').innerText()).replace(/\s+/g, " ") : "";
  const sec = (await page.locator('[data-testid="tabla-unidad"]').first().innerText().catch(() => "")).replace(/\s+/g, " ");
  console.log(`  [A2 tabla U1 menor5] acciones=${r.acciones} revisión=«${rev.slice(0, 400)}» sección=«${sec.slice(0, 700)}»`);
  ok(/no se pudo cotizar|no se pudieron cotizar/.test(rev) && rev.includes("U1 · Hotel por unidad SIN edades"), `A2 ${vista}: hotel SIN edades queda en el bloque de revisión`);
  ok(sec.includes("U1 · Hotel por unidad con edades") && !sec.includes("SIN edades"), `A2 ${vista}: la sección lista solo el hotel con edades configuradas`);
  ok(/5 años/.test(sec), `A2 ${vista}: la fila muestra al menor de 5 años`);
  await shot("A2-tabla-U1-menor5");

  // ───── A3: O3 regresión (modelo persona)
  await abrirBuscador(page, { modo: "tabla", destino: "CARTAGENA O3" });
  r = await buscar(page, cuenta, { ida: "10/06/2030", regreso: "13/06/2030" });
  t = await texto(page);
  console.log(`  [A3 tabla O3] acciones=${r.acciones} :: ${corto(t, 900)}`);
  ok(!/No hay hoteles con tarifa/.test(t), `A3 ${vista}: O3 devuelve resultados por persona`);
  await shot("A3-tabla-O3");

  // ───── A4: 2027 (captura del dueño) → vacío
  await abrirBuscador(page, { modo: "tabla", destino: DEST_U1 });
  r = await buscar(page, cuenta, { ida: "10/06/2027", regreso: "13/06/2027" });
  t = await texto(page);
  console.log(`  [A4 tabla U1 2027] :: ${corto(t, 600)}`);
  ok(/No hay hoteles con tarifa/.test(t) && (await page.locator('[data-testid="tabla-unidad"]').count()) === 0, `A4 ${vista}: junio 2027 vacío (la fecha, no la vista)`);
  await shot("A4-tabla-U1-2027");

  // ───── A5: 5 adultos 1 habitación → sin reparto
  await abrirBuscador(page, { modo: "tabla", destino: DEST_U1 });
  r = await buscar(page, cuenta, { ida: "10/06/2030", regreso: "13/06/2030", adultos: 5, habitaciones: 1 });
  t = await texto(page);
  console.log(`  [A5 tabla U1 5ad] :: ${corto(t, 700)}`);
  ok(/reparto|sin una distribución|no se evaluaron|no se pudo repartir/i.test(t), `A5 ${vista}: explica que no hay reparto estándar (no dice «sin hoteles por unidad»)`);
  await shot("A5-tabla-U1-5adultos");
  await ctx.close();
}
await b.close();
process.exit(cerrar());
