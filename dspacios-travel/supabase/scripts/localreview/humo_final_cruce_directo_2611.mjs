// Corrección del dueño 2026-11-18 · #cruce-bases por ENLACE DIRECTO (sin pulsar nada) en el build final; solo base desechable. Uso: node humo_final_cruce_directo_2611.mjs <carpeta de capturas>
import { mkdirSync } from "node:fs";
import { lanzar, abrirConLogin, APP, crearInforme, sinDesborde } from "./revision_comun.mjs";
const OUT = process.argv[2] ?? "C:/tmp/vfinal/cruce"; mkdirSync(OUT, { recursive: true });
const { ok, cerrar } = crearInforme("enlace directo #cruce-bases (build final)");
const b = await lanzar();
const casos = [["912511", "Dubai por configurar"], ["912512", "Dubai activo"], ["912501", "Mixta por configurar"], ["912503", "Mixta activo"]];
for (const vista of ["escritorio", "movil"]) {
  const { page, cuenta } = await abrirConLogin(b, "administracion@revision.test", vista);
  for (const [id, nombre] of casos) {
    await page.goto(`${APP}/dashboard/producto/hoteles/${id}?tab=temporadas#cruce-bases`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const sec = page.locator("#cruce-bases");
    const existe = (await sec.count()) > 0;
    ok(existe, `${nombre} ${vista}: la sección #cruce-bases existe con solo el enlace directo`);
    if (existe) {
      const caja = await sec.first().boundingBox();
      const vh = page.viewportSize().height;
      ok(!!caja && caja.y < vh && caja.y + caja.height > 0, `${nombre} ${vista}: la sección queda a la vista (y=${Math.round(caja?.y ?? -1)}, ventana ${vh})`);
      ok(await sec.first().isVisible(), `${nombre} ${vista}: visible`);
    }
    ok(await sinDesborde(page), `${nombre} ${vista}: sin desborde horizontal`);
    await page.screenshot({ path: `${OUT}/cruce-${id}-${vista}.png` });
  }
  await page.context().close();
}
await b.close();
process.exit(cerrar());
