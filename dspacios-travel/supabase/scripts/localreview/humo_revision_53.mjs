// #53 sobre la fuente INTEGRADA, Edge real (Playwright): documentos de contrato/cotización (COP, manual, USD, histórico SIN ítems), vista de impresión (PDF real)
// y reglas del voucher del aliado. SOLO LECTURA (no cambia datos). La cotización USD queda abierta: aquí NO se elige moneda ni se escribe la TRM.
// Uso (desde dspacios-travel/): node supabase/scripts/localreview/humo_revision_53.mjs <carpeta_salida>
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { lanzar, abrirConLogin, APP, texto, sinDesborde, crearInforme, mkdirSync } from "./revision_comun.mjs";

const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const { ok, cerrar } = crearInforme("#53");
const b = await lanzar();

const DOCS = [
  ["DTM-5301", "/contrato/DTM-5301", [/Este contrato no tiene detalle de ítems \(registro histórico\)/, /TOTAL DEL CONTRATO \$ 1\.000\.000/, /SALDO PENDIENTE \$ 750\.000/, /Pago mínimo requerido: \$300\.000 COP/], "histórico SIN ítems (fallback)"],
  ["DTM-0001", "/contrato/DTM-0001", [/Estandar · Desayuno/, /TOTAL DEL CONTRATO \$ 1\.200\.000/, /Marta Ejemplo/], "contrato COP creado por la acción real"],
  ["DTM-0002", "/contrato/DTM-0002", [/TOTAL DEL CONTRATO \$ 2\.500\.000/, /Laura Ejemplo Manual/, /Calle 10 # 20-30/], "contrato MANUAL (sin condiciones congeladas)"],
  ["COT-2", "/cotizacion/2", [/TOTAL DEL CONTRATO USD \$1,000/, /MONEDA USD/, /Usd1 Ejemplo/, /1 hab Doble \(2 pax\)/], "cotización USD abierta"],
];
for (const vista of ["escritorio", "movil"]) {
  console.log(`\n######## ${vista}`);
  const { ctx, page } = await abrirConLogin(b, "superadmin@revision.test", vista);
  for (const [clave, ruta, patrones, desc] of DOCS) {
    const r = await page.goto(`${APP}${ruta}`, { waitUntil: "networkidle" });
    const t = await texto(page);
    ok(r.status() === 200 && !/Application error|Unhandled/.test(t), `${clave} (${desc}): carga sin error`);
    for (const p of patrones) ok(p.test(t), `${clave}: ${p}`);
    ok(await sinDesborde(page), `${clave}: sin desbordamiento horizontal (${vista})`);
    await page.screenshot({ path: join(OUT, `53-${clave}-${vista}.png`), fullPage: true });
    if (vista === "escritorio") {
      await page.emulateMedia({ media: "print" });
      const botonVisible = await page.getByText("Imprimir / Guardar PDF").first().isVisible().catch(() => false);
      ok(!botonVisible, `${clave}: en impresión se oculta el botón «Imprimir / Guardar PDF»`);
      const pdf = await page.pdf({ format: "Letter", printBackground: true });
      writeFileSync(join(OUT, `53-${clave}.pdf`), pdf);
      const paginas = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      ok(pdf.length > 5000 && paginas >= 1, `${clave}: PDF real generado (${paginas} página(s), ${Math.round(pdf.length / 1024)} KB)`);
      await page.emulateMedia({ media: "screen" });
    }
  }
  // La cotización USD sigue ABIERTA y SIN TRM: quien revisa la convierte
  await page.goto(`${APP}/dashboard/cotizaciones/2`, { waitUntil: "networkidle" });
  const t = await texto(page);
  ok(/abierta/.test(t) && /debes ingresar la tasa/.test(t), "cotización USD: sigue abierta y pide la TRM (la escribe quien revisa)");
  ok(/Composición del precio \(guardada al cotizar\)/.test(t) && /La composición cuadra con el precio de la cotización/.test(t), "cotización USD: composición guardada cuadra con el precio");
  await ctx.close();
}

// Voucher del aliado: solo con el contrato 100 % pagado y del propio aliado
{
  const { ctx, page } = await abrirConLogin(b, "aliado@revision.test");
  await page.goto(`${APP}/portal/b2b/documentos`, { waitUntil: "networkidle" });
  const t = await texto(page);
  ok(/DTM-5322 Imprimir \/ Guardar PDF Voucher hotel/.test(t), "aliado Uno: voucher de DTM-5322 (100 % pagado) disponible");
  ok(/DTM-5321 Imprimir \/ Guardar PDF Disponible cuando el contrato esté 100 % pagado/.test(t), "aliado Uno: DTM-5321 con saldo → «Disponible cuando el contrato esté 100 % pagado»");
  ok(!/DTM-5323/.test(t), "aliado Uno: NO ve DTM-5323 (pagado, pero de otro aliado)");
  const href = await page.locator("a[href^='/voucher/']").first().getAttribute("href");
  const r = await page.goto(`${APP}${href}`, { waitUntil: "networkidle" });
  const v = await texto(page);
  ok(r.status() === 200 && /Hotel Demo Cartagena/.test(v), "el enlace del voucher abre el documento");
  await page.screenshot({ path: join(OUT, "53-voucher-aliado-escritorio.png"), fullPage: true });
  await ctx.close();
}
await b.close();
process.exit(cerrar());
