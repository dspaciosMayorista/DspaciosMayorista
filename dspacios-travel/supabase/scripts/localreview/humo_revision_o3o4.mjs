// O3 + O4 sobre la fuente INTEGRADA, Edge real (Playwright), escritorio y móvil, build de producción local de la revisión consolidada.
//   O3  edades OBLIGATORIAS del hotel: solo adultos sigue; con menores el motivo es accionable y ningún hotel se omite en silencio; advertencia en la configuración del hotel;
//       guardar un hotel sin edades se rechaza con el campo que falta; Adults Only exento.
//   O4  la noche adicional es una REFERENCIA: etiqueta, explicación, botón «Extender el regreso … y recalcular la estadía completa» (UNA solicitud, mismos viajeros y filtros),
//       límite de temporada, umbral por duración («4 noches, 1 gratis») y noche no disponible.
// ESCRIBE datos de prueba (completa las edades de un hotel): corre `localreview.ps1 restaurar` después.
// Uso (desde dspacios-travel/): node supabase/scripts/localreview/humo_revision_o3o4.mjs <carpeta_capturas>
import { join } from "node:path";
import { lanzar, abrirConLogin, APP, texto, sinDesborde, crearInforme, reiniciar, mkdirSync } from "./revision_comun.mjs";

const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const { ok, cerrar } = crearInforme("O3 · O4");
const dinero = (n) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);
const H = { OK: "O3 · Hotel con edades completas", SIN: "O3 · Hotel SIN edades configuradas", AO: "O3 · Hotel solo adultos", INV: "O3 · Hotel con edades inválidas", OVR: "O3 · Hotel sin edades, con override en la tarifa", PROMO: "O4 · Hotel promoción 4 noches, 1 gratis" };
const b = await lanzar();

const campo = (page, etiqueta) => page.locator(`label:text-is("${etiqueta}")`).locator("xpath=..").locator("input").first();
async function abrirTabla(page) {
  await page.goto(`${APP}/tarifario`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Vista tabla" }).click();
  await page.getByRole("button", { name: /Porción terrestre/ }).first().click(); await page.waitForTimeout(800);
  await page.locator('button[role="combobox"]').first().click();
  await page.getByRole("option", { name: "CARTAGENA O3" }).click();
}
async function buscar(page, cuenta, { ida = "10/06/2030", regreso = "13/06/2030", adultos = "2", menores = [] } = {}) {
  await page.getByRole("textbox", { name: "Ida", exact: true }).fill(ida); await page.getByRole("textbox", { name: "Ida", exact: true }).blur();
  await page.getByRole("textbox", { name: "Regreso", exact: true }).fill(regreso); await page.getByRole("textbox", { name: "Regreso", exact: true }).blur();
  await campo(page, "Adultos").fill(adultos);
  await campo(page, "Habitaciones").fill("1");
  await page.getByLabel(/Menores \(0–17 años\)/).fill(String(menores.length));
  for (let i = 0; i < menores.length; i++) await campo(page, `Edad menor ${i + 1}`).fill(String(menores[i]));
  reiniciar(cuenta);
  await page.getByRole("button", { name: /Buscar hoteles/ }).click();
  await page.waitForSelector('button:has-text("Buscar hoteles")', { timeout: 30000 });
  await page.waitForTimeout(1500);
}
const fila = async (page, hotel, seccion) => (await page.locator(`section[aria-labelledby="${seccion}"] tbody tr`, { hasText: hotel }).first().innerText()).replace(/\s+/g, " ");
const hayFila = async (page, hotel, seccion = "sec-estadia") => (await page.locator(`section[aria-labelledby="${seccion}"] tbody tr`, { hasText: hotel }).count()) > 0;

for (const vista of ["escritorio", "movil"]) {
  console.log(`\n######## ${vista}`);
  const { ctx, page, cuenta } = await abrirConLogin(b, "administracion@revision.test", vista);
  await abrirTabla(page);

  // ── O3: solo adultos sigue ───────────────────────────────────────────────────────────────────────────
  await buscar(page, cuenta);
  for (const h of [H.OK, H.SIN, H.INV, H.OVR, H.PROMO, H.AO]) ok(await hayFila(page, h) && (await fila(page, h, "sec-estadia")).includes(dinero(750000)), `O3 solo adultos: «${h}» se cotiza (${dinero(750000)})`);
  ok((await texto(page)).includes("no se pudieron cotizar") === false && (await page.locator('[data-testid="hoteles-en-revision"]').count()) === 0, "O3 solo adultos: no aparece ningún aviso de hoteles sin cotizar");
  await page.screenshot({ path: join(OUT, `o3-solo-adultos-${vista}.png`), fullPage: true });

  // ── O3: con un menor de 5 años ───────────────────────────────────────────────────────────────────────
  await buscar(page, cuenta, { menores: [5] });
  ok(await hayFila(page, H.OK) && (await fila(page, H.OK, "sec-estadia")).includes(dinero(900000)), `O3 con menor: «${H.OK}» se cotiza con Niño 1 (${dinero(900000)})`);
  ok(await hayFila(page, H.PROMO), "O3 con menor: el hotel de la promoción (edades completas) también se cotiza");
  for (const h of [H.SIN, H.INV, H.OVR]) ok(!(await hayFila(page, h)), `O3 con menor: «${h}» NO se cotiza con menores`);
  const bloque = (await page.locator('[data-testid="hoteles-en-revision"]').innerText()).replace(/\s+/g, " ");
  ok(/3 hoteles no se pudieron cotizar/.test(bloque), "O3 con menor: el aviso dice cuántos hoteles no se pudieron cotizar (3)");
  ok(bloque.includes(H.SIN) && /falta: «Infante hasta \(edad\)», «Niño hasta \(edad\)»/.test(bloque), "O3 con menor: el motivo del hotel sin edades nombra el hotel y los campos que faltan");
  ok(bloque.includes(H.INV) && /valor no válido/.test(bloque), "O3 con menor: el motivo del hotel con edades inválidas dice «valor no válido»");
  ok(bloque.includes(H.OVR), "O3 con menor: el hotel con override en la tarifa pero sin edades del hotel también se explica (el override no la reemplaza)");
  ok(/Producto → Hoteles → Configuración del hotel/.test(bloque) && /solo con adultos/.test(bloque), "O3 con menor: el motivo es accionable (dónde corregirlo y que solo adultos sigue)");
  ok(!bloque.includes(H.AO), "O3 con menor: el hotel Adults Only no se mezcla con los de edades (rechaza menores por su propia regla)");
  ok(await sinDesborde(page), `O3: sin desbordamiento horizontal (${vista})`);
  await page.screenshot({ path: join(OUT, `o3-con-menor-${vista}.png`), fullPage: true });

  // ── O4: la noche adicional es una referencia ────────────────────────────────────────────────────────
  await buscar(page, cuenta);
  const seccion = (await page.locator('section[aria-labelledby="sec-noche"]').innerText()).replace(/\s+/g, " ");
  ok(await page.locator('[data-testid="noche-referencial"]').count() === 1 && /valor referencial/i.test(seccion), "O4: la sección lleva la etiqueta «Valor referencial»");
  ok(/Es solo una referencia/.test(seccion) && /no se suma al total de la estadía ni se reserva/.test(seccion) && /recalculando la estadía completa de 4 noches/.test(seccion) && /fechas, la disponibilidad y las promociones/.test(seccion), "O4: explica que el total final recalcula la estadía completa (fechas, disponibilidad y promociones)");
  ok((await fila(page, H.OK, "sec-noche")).includes(dinero(250000)), `O4: referencia del hotel normal = ${dinero(250000)}`);
  ok(/\$\s?0\b/.test(await fila(page, H.PROMO, "sec-noche")), "O4: referencia del hotel con «4 noches, 1 gratis» = $0 (la cuarta noche no suma)");
  const boton = page.locator('[data-testid="extender-regreso"]');
  ok(await boton.count() === 1 && /Extender el regreso a 14\/06\/30 y recalcular la estadía completa/.test(await boton.innerText()), "O4: botón «Extender el regreso a 14/06/30 y recalcular la estadía completa»");
  ok(await sinDesborde(page), `O4: sin desbordamiento horizontal con el botón (${vista})`);
  await page.screenshot({ path: join(OUT, `o4-referencia-${vista}.png`), fullPage: true });
  reiniciar(cuenta);
  await boton.click();
  await page.waitForSelector('button:has-text("Buscar hoteles")', { timeout: 30000 });
  await page.waitForTimeout(2000);
  ok(cuenta.acciones === 1, `O4: extender = UNA solicitud al servidor (${cuenta.acciones})`);
  const regreso = await page.getByRole("textbox", { name: "Regreso", exact: true }).inputValue();
  ok(regreso === "14/06/2030", `O4: el formulario muestra el regreso extendido (${regreso}) con los mismos viajeros`);
  ok((await fila(page, H.OK, "sec-estadia")).includes(dinero(1000000)), `O4: estadía COMPLETA de 4 noches recalculada = ${dinero(1000000)} (no «750.000 + 250.000» calculado en el navegador)`);
  ok((await fila(page, H.PROMO, "sec-estadia")).includes(dinero(750000)), "O4: con la promoción, 4 noches cuestan lo mismo que 3 (750.000): el total sale del recálculo completo");
  ok(/estadía de 5 noches/.test((await page.locator('section[aria-labelledby="sec-noche"]').innerText()).replace(/\s+/g, " ")), "O4: la nueva referencia ya es para la noche 5");
  await page.waitForTimeout(3000);
  ok(cuenta.acciones === 1, `O4: en reposo no hay solicitudes adicionales (${cuenta.acciones})`);
  await page.screenshot({ path: join(OUT, `o4-extendida-${vista}.png`), fullPage: true });

  // ── O4: límite de temporada ─────────────────────────────────────────────────────────────────────────
  await buscar(page, cuenta, { ida: "28/06/2030", regreso: "01/07/2030" });
  ok((await fila(page, H.OK, "sec-noche")).includes(dinero(150000)), `O4 límite de temporada: la noche del 1/7 vale la BAJA (${dinero(150000)}), no la ALTA`);
  await page.locator('[data-testid="extender-regreso"]').click();
  await page.waitForSelector('button:has-text("Buscar hoteles")', { timeout: 30000 }); await page.waitForTimeout(1500);
  ok((await fila(page, H.OK, "sec-estadia")).includes(dinero(900000)), `O4 límite de temporada: la estadía extendida a 02/07 se recalcula completa (${dinero(900000)})`);

  // ── O4: noche adicional no disponible ──────────────────────────────────────────────────────────────
  await buscar(page, cuenta, { ida: "29/12/2030", regreso: "01/01/2031" });
  ok(/no tiene tarifa vigente/.test(await fila(page, H.OK, "sec-noche")), "O4 no disponible: la noche del 1/1/2031 se declara sin tarifa vigente (no se inventa precio)");
  await page.locator('[data-testid="extender-regreso"]').click();
  await page.waitForSelector('button:has-text("Buscar hoteles")', { timeout: 30000 }); await page.waitForTimeout(1500);
  ok(!(await hayFila(page, H.OK)), "O4 no disponible: al extender hasta una noche sin tarifa el hotel ya no se vende (el recálculo completo lo dice)");
  await ctx.close();
}

// ── O3: configuración del hotel (escritorio) ───────────────────────────────────────────────────────────
{
  console.log("\n######## configuración del hotel");
  const { ctx, page } = await abrirConLogin(b, "administracion@revision.test");
  await page.goto(`${APP}/dashboard/producto/hoteles/10302`, { waitUntil: "networkidle" });
  const aviso = page.locator('[data-testid="aviso-config-edades"]');
  const textoAviso = (await aviso.innerText()).replace(/\s+/g, " ");
  ok(await aviso.count() === 1 && /Configuración de edades incompleta/.test(textoAviso) && /Falta: «Infante hasta \(edad\)», «Niño hasta \(edad\)»/.test(textoAviso), "O3 config: advertencia visible que identifica los campos que faltan");
  ok(/no se puede cotizar con menores ni publicar/.test(textoAviso) && /Adults Only/.test(textoAviso) && /solo con adultos siguen funcionando/.test(textoAviso), "O3 config: dice el efecto, la salida (completar o Adults Only) y que adultos sigue");
  await page.screenshot({ path: join(OUT, "o3-config-advertencia.png"), fullPage: false });
  await page.getByRole("button", { name: /Configuración del hotel/ }).click();
  await page.getByRole("button", { name: /^Guardar/ }).first().click();
  await page.waitForTimeout(1500);
  ok(/Completa la configuración de edades del hotel antes de guardarlo/.test(await texto(page)), "O3 config: guardar sin edades se rechaza con el mensaje accionable");
  await page.locator('[data-testid="cfg-inf-max"]').fill("2"); await page.locator('[data-testid="cfg-nino-max"]').fill("10");
  await page.getByRole("button", { name: /^Guardar/ }).first().click();
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: "networkidle" });
  ok(await page.locator('[data-testid="aviso-config-edades"]').count() === 0, "O3 config: con las edades completas guardadas la advertencia desaparece");
  // hotel NUEVO: no hay valores por defecto
  await page.goto(`${APP}/dashboard/producto/hoteles/nuevo`, { waitUntil: "networkidle" });
  ok((await page.locator('[data-testid="hotel-inf-max"]').inputValue()) === "" && (await page.locator('[data-testid="hotel-nino-max"]').inputValue()) === "", "O3 hotel nuevo: «Infante hasta» y «Niño hasta» nacen vacíos (sin 2/10 por defecto)");
  await page.locator('[data-testid="hotel-adults-only"]').check();
  ok(await page.locator('[data-testid="hotel-inf-max"]').count() === 0, "O3 hotel nuevo: Adults Only oculta las edades (exento)");
  await ctx.close();
}
await b.close();
process.exit(cerrar());
