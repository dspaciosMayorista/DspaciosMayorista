// VERIF-2 (2026-11-18) — item 7 + matriz completa en «Tarifas generadas» y en la calculadora (Mixta y Dubai) sobre el build FINAL, Edge real. SOLO LEE.
// Uso (desde dspacios-travel/): node supabase/scripts/localreview/humo_verif_promo_2611.mjs <carpeta_capturas> [vistas]
import { join } from "node:path";
import { lanzar, APP, abrirConLogin, texto, sinDesborde, crearInforme, reiniciar, mkdirSync } from "./revision_comun.mjs";

const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const { ok, cerrar } = crearInforme("VERIF-2 promo / matriz");
const b = await lanzar();
const SIZES = { escritorio: { width: 1366, height: 900 }, tablet: { width: 900, height: 900 }, movil: { width: 390, height: 844 } };
const vistas = (process.argv[3] ?? "escritorio,tablet,movil").split(",");
const hotelUrl = (id, tab) => `${APP}/dashboard/producto/hoteles/${id}?tab=${tab}`;
const abrirCalc = async (page) => { await page.getByText(/Tarifa por fórmula \(calculadora\)/).first().click(); await page.waitForTimeout(900); };
const HOTELES = { mixtaConfigurar: 912501, mixtaActivo: 912503, dubaiConfigurar: 912511, dubaiActivo: 912512, obsoleto: 12401 };

for (const vista of vistas) {
  console.log(`\n######## ${vista}`);
  const { ctx, page, cuenta } = await abrirConLogin(b, "administracion@revision.test", "escritorio");
  await page.setViewportSize(SIZES[vista]);
  const shot = async (n, full = true) => page.screenshot({ path: join(OUT, `${n}-${vista}.png`), fullPage: full });

  for (const [clave, id] of Object.entries(HOTELES)) {
    // ── pestaña Temporadas: calculadora + sección de cruce de bases
    reiniciar(cuenta);
    await page.goto(hotelUrl(id, "temporadas"), { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
    const cargaAcciones = cuenta.acciones;
    await abrirCalc(page);
    const sec = page.locator("#cruce-bases");
    const hay = (await sec.count()) === 1;
    const tSec = hay ? (await sec.innerText()).replace(/\s+/g, " ") : "";
    console.log(`  [${clave} ${id}] cruce-bases=${hay} :: ${tSec.slice(0, 1100)}`);
    ok(hay, `${clave} ${vista}: la sección #cruce-bases existe al abrir la calculadora`);
    if (hay) { await sec.scrollIntoViewIfNeeded(); await sec.screenshot({ path: join(OUT, `cruce-${clave}-${vista}.png`) }); }
    // Casillas editables en cero (filas de promoción por noche) → ninguna
    const ceros = await page.locator('input[type="number"], input[inputmode="numeric"]').evaluateAll((els) => els.filter((e) => e.value === "0" || e.value === "").length);
    console.log(`     inputs vacíos/cero en el editor: ${ceros}; acciones al cargar=${cargaAcciones}`);
    await shot(`temporadas-${clave}`);
    // reposo 30 s con el editor abierto
    const reposoMs = clave === "mixtaConfigurar" ? 31000 : 3000;
    reiniciar(cuenta); await page.waitForTimeout(reposoMs);
    // Línea base medida: TODA página del panel (incluida la lista de hoteles) hace 1 acción cada 30 s por la campana de avisos del shell (CampanaAvisos, #443). La calculadora no añade nada.
    ok(cuenta.acciones <= Math.ceil(reposoMs / 30000) && cuenta.rest === 0, `${clave} ${vista}: reposo ${reposoMs / 1000} s sin solicitudes propias (acciones=${cuenta.acciones} ≤ sondeo del shell, rest=${cuenta.rest})`);
    ok(await sinDesborde(page), `${clave} ${vista}: sin desborde horizontal (Temporadas)`);

    // ── pestaña Tarifas generadas
    reiniciar(cuenta);
    await page.goto(hotelUrl(id, "tarifas"), { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
    const t = await texto(page);
    const dyn = t.includes("Promociones dinámicas por grupo");
    console.log(`  [${clave}] tarifas generadas: matriz derivada=${dyn}; acciones al cargar=${cuenta.acciones}; rest=${cuenta.rest}`);
    if (dyn) {
      const ver = page.getByRole("button", { name: "Ver tarifas" });
      const n = await ver.count();
      const textos = [];
      for (let i = 0; i < n; i++) { await ver.nth(i).click(); await page.waitForTimeout(400); const d = page.locator('[role="dialog"], [aria-modal="true"], .fixed.inset-0').last(); textos.push((await d.innerText()).replace(/\s+/g, " ")); if (i === 0) await page.screenshot({ path: join(OUT, `modal-${clave}-${vista}.png`) }); await page.keyboard.press("Escape"); await page.waitForTimeout(250); }
      console.log(`     modales=${n}`); textos.forEach((x, i) => console.log(`     M${i}: ${x.slice(0, 1700)}`));
    }
    await shot(`tarifas-${clave}`);
    ok(await sinDesborde(page), `${clave} ${vista}: sin desborde horizontal (Tarifas generadas)`);
  }
  await ctx.close();
}
await b.close();
process.exit(cerrar());
