// U1 sobre la fuente INTEGRADA, Edge real (Playwright), escritorio y móvil, build de producción local de la revisión consolidada.
//   Hoteles por UNIDAD (modelo Bernalo): la configuración de edades del hotel es obligatoria con menores, aunque la tarifa publicada traiga reglas de edad explícitas.
//   Solo adultos cotiza ambos hoteles; con un menor el hotel «SIN edades» queda EN REVISIÓN con motivo accionable (no se omite en silencio) y el configurado sigue disponible.
// Solo LEE (no escribe datos de prueba). Destino sintético «CARTAGENA U1» (semilla_revision_u1.sql).
// Uso (desde dspacios-travel/): node supabase/scripts/localreview/humo_revision_u1.mjs <carpeta_capturas>
import { join } from "node:path";
import { lanzar, abrirConLogin, APP, texto, sinDesborde, crearInforme, reiniciar, mkdirSync } from "./revision_comun.mjs";

const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const { ok, cerrar } = crearInforme("U1 · hoteles por unidad");
const H = { OK: "U1 · Hotel por unidad con edades", SIN: "U1 · Hotel por unidad SIN edades" };
const b = await lanzar();

const campo = (page, etiqueta) => page.locator(`label:text-is("${etiqueta}")`).locator("xpath=..").locator("input").first();
async function abrir(page) {
  await page.goto(`${APP}/tarifario`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Porción terrestre/ }).first().click(); await page.waitForTimeout(800);
  await page.locator('button[role="combobox"]').first().click();
  await page.getByRole("option", { name: "CARTAGENA U1" }).click();
}
async function buscar(page, cuenta, { menores = [] } = {}) {
  await page.getByRole("textbox", { name: "Ida", exact: true }).fill("10/06/2030"); await page.getByRole("textbox", { name: "Ida", exact: true }).blur();
  await page.getByRole("textbox", { name: "Regreso", exact: true }).fill("13/06/2030"); await page.getByRole("textbox", { name: "Regreso", exact: true }).blur();
  await campo(page, "Adultos").fill("2");
  await campo(page, "Habitaciones").fill("1");
  await page.getByLabel(/Menores \(0–17 años\)/).fill(String(menores.length));
  for (let i = 0; i < menores.length; i++) await campo(page, `Edad menor ${i + 1}`).fill(String(menores[i]));
  reiniciar(cuenta);
  await page.getByRole("button", { name: /Buscar hoteles/ }).click();
  await page.waitForSelector('button:has-text("Buscar hoteles")', { timeout: 30000 });
  await page.waitForTimeout(2500);
}

for (const vista of ["escritorio", "movil"]) {
  console.log(`\n######## ${vista}`);
  const { ctx, page, cuenta } = await abrirConLogin(b, "administracion@revision.test", vista);
  await abrir(page);

  // Solo adultos: ambos hoteles por unidad se cotizan y no hay aviso de hoteles sin cotizar.
  await buscar(page, cuenta);
  let t = await texto(page);
  ok(t.includes(H.OK), `U1 solo adultos: «${H.OK}» aparece`);
  ok(t.includes(H.SIN), `U1 solo adultos: «${H.SIN}» también aparece (la falta de edades no afecta a solo adultos)`);
  ok((await page.locator('[data-testid="hoteles-en-revision"]').count()) === 0, "U1 solo adultos: no hay aviso de hoteles sin cotizar");
  await page.screenshot({ path: join(OUT, `u1-solo-adultos-${vista}.png`), fullPage: true });

  // Con un menor de 5 años: el hotel sin edades se explica; el configurado sigue.
  await buscar(page, cuenta, { menores: [5] });
  t = await texto(page);
  const hayBloque = (await page.locator('[data-testid="hoteles-en-revision"]').count()) === 1;
  ok(hayBloque, "U1 con menor: aparece el aviso de hoteles que no se pudieron cotizar");
  const bloque = hayBloque ? (await page.locator('[data-testid="hoteles-en-revision"]').innerText()).replace(/\s+/g, " ") : "";
  ok(/1 hotel no se pudo cotizar/.test(bloque), "U1 con menor: el aviso dice que 1 hotel no se pudo cotizar");
  ok(bloque.includes(H.SIN) && /falta: «Infante hasta \(edad\)», «Niño hasta \(edad\)»/.test(bloque), "U1 con menor: el motivo nombra el hotel por unidad y los campos que faltan");
  ok(/Producto → Hoteles → Configuración del hotel/.test(bloque) && /solo con adultos/.test(bloque), "U1 con menor: el motivo es accionable (dónde corregirlo y que solo adultos sigue)");
  const fuera = t.replace(bloque, "");
  ok(fuera.includes(H.OK), `U1 con menor: «${H.OK}» sigue disponible (su configuración de edades es válida)`);
  ok(!fuera.includes(H.SIN), `U1 con menor: «${H.SIN}» no aparece como disponible fuera del aviso`);
  ok(await sinDesborde(page), `U1: sin desbordamiento horizontal (${vista})`);
  await page.screenshot({ path: join(OUT, `u1-con-menor-${vista}.png`), fullPage: true });
  await ctx.close();
}
await b.close();
process.exit(cerrar());
