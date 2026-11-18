// #106 sobre la fuente INTEGRADA, Edge real (Playwright), escritorio y móvil: acceso por rol, contenido de la pantalla con los acuerdos del dueño
// (factura emitida = validada en la DIAN; saldo = pendientes y confirmados, sin cancelados; entrega de voucher que un voucher nuevo limpia) y el registro/retiro de un acuse.
// ESCRIBE un acuse de prueba (y lo retira): corre `localreview.ps1 restaurar` antes de la revisión del dueño si lo ejecutas tú.
// Uso (desde dspacios-travel/): node supabase/scripts/localreview/humo_revision_106.mjs <carpeta_capturas>
import { join } from "node:path";
import { lanzar, abrir, APP, texto, sinDesborde, crearInforme, reiniciar, mkdirSync } from "./revision_comun.mjs";

const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const { ok, cerrar } = crearInforme("#106");
const b = await lanzar();
const fila = (page, n) => page.locator(`article[aria-label="Contrato ${n}"]`);
const txt = async (loc) => (await loc.innerText()).replace(/\s+/g, " ");

// 1) Acceso por rol (solo superadmin)
for (const [email, esperaAcceso] of [["superadmin@revision.test", true], ["gerencia@revision.test", false], ["administracion@revision.test", false], ["operaciones@revision.test", false], ["venta@revision.test", false], ["aliado@revision.test", false]]) {
  const { ctx, page } = await abrir(b, { email });
  await page.goto(`${APP}/dashboard/gestion-contratos`, { waitUntil: "networkidle" });
  const dentro = new URL(page.url()).pathname.startsWith("/dashboard/gestion-contratos");
  ok(dentro === esperaAcceso, `${email.split("@")[0]}: ${esperaAcceso ? "entra" : "NO entra"} (queda en ${new URL(page.url()).pathname})`);
  await ctx.close();
}

for (const vista of ["escritorio", "movil"]) {
  console.log(`\n######## ${vista}`);
  const { ctx, page, cuenta } = await abrir(b, { email: "superadmin@revision.test", vista });
  reiniciar(cuenta);
  await page.goto(`${APP}/dashboard/gestion-contratos?numero=-106`, { waitUntil: "networkidle" });
  const t = await texto(page);
  ok(/17 contratos/.test(t) || /Contratos[^.]{0,40}17/.test(t) || (await page.locator("article[aria-label^='Contrato DTM-106']").count()) >= 17 - 0, "filtro «-106»: 17 contratos de Mayorista (primera página)");
  ok(await sinDesborde(page), "sin desbordamiento horizontal");
  await page.screenshot({ path: join(OUT, `106-lista-${vista}.png`), fullPage: true });

  // Disposición por ancho: ningún bloque de una fila se monta sobre otro ni desborda su celda (incluye los anchos intermedios del owner).
  if (vista === "escritorio") {
    for (const ancho of [768, 900, 1024, 1180, 1280, 1344, 1440, 1920]) {
      await page.setViewportSize({ width: ancho, height: 900 });
      const r = await page.evaluate(() => {
        const mal = [];
        for (const art of document.querySelectorAll("article[aria-label^='Contrato ']")) {
          const hijos = [...art.children].filter((c) => c.tagName !== "NAV");
          const caja = hijos.map((c) => c.getBoundingClientRect());
          for (let i = 0; i < caja.length; i++) {
            if (hijos[i].scrollWidth > hijos[i].clientWidth + 1) mal.push(`${art.getAttribute("aria-label")}: bloque ${i} desborda`);
            for (let j = i + 1; j < caja.length; j++) {
              const a = caja[i], c = caja[j];
              if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) mal.push(`${art.getAttribute("aria-label")}: bloques ${i}/${j} se montan`);
            }
          }
        }
        return { mal: mal.slice(0, 5), cols: getComputedStyle(document.querySelector("article[aria-label^='Contrato ']")).gridTemplateColumns.split(" ").length, scroll: document.documentElement.scrollWidth <= window.innerWidth + 2 };
      });
      ok(r.mal.length === 0 && r.scroll, `ancho ${ancho}px (${r.cols} columnas): sin montajes ni desborde ${r.mal.join(" | ")}`);
      await page.screenshot({ path: join(OUT, `106-lista-${ancho}.png`), fullPage: false });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // Factura emitida = DIAN
  let f = await txt(fila(page, "DTM-10601")); ok(/Emitida \(validada por la DIAN\)/.test(f) && /Envío registrado manualmente/.test(f), "DTM-10601: factura «Emitida (validada por la DIAN)» con envío registrado");
  f = await txt(fila(page, "DTM-10602")); ok(/Pendiente de validación DIAN/.test(f) && !/Emitida/.test(f), "DTM-10602: número antiguo SIN DIAN → «Pendiente de validación DIAN» (no «Emitida»)");
  f = await txt(fila(page, "DTM-10606")); ok(/Pendiente de validación DIAN/.test(f) && /asiento contable/.test(f), "DTM-10606: asiento contable SIN DIAN → «Pendiente de validación DIAN»");
  f = await txt(fila(page, "DTM-10609")); ok(/Emitida \(validada por la DIAN\)/.test(f) && /Envío sin registrar/.test(f), "DTM-10609: DIAN validada, envío sin registrar");
  // Voucher de reemplazo
  f = await txt(fila(page, "DTM-10604")); ok(/Entrega sin registrar \(voucher nuevo\)/.test(f) && /historial/.test(f), "DTM-10604: voucher nuevo después de la entrega → entrega limpia (pendiente) y el acuse anterior queda como historial");
  f = await txt(fila(page, "DTM-10601")); ok(/Entrega registrada manualmente/.test(f), "DTM-10601: entrega registrada vigente");
  f = await txt(fila(page, "DTM-10602")); ok(/Generado \(\d+\)[\s\S]*Entrega sin registrar/.test(f), "DTM-10602: voucher preparado, entrega sin registrar");

  // Saldo: pendientes y confirmados con deuda; cancelados fuera
  await page.goto(`${APP}/dashboard/gestion-contratos?numero=-106&saldo=con_saldo`, { waitUntil: "networkidle" });
  const con = await page.locator("article[aria-label^='Contrato ']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace("Contrato ", "")));
  ok(con.includes("DTM-10602") && con.includes("DTM-10603"), `«Con saldo» incluye confirmados (DTM-10602) y pendientes (DTM-10603)`);
  ok(!con.includes("DTM-10605") && !con.includes("DTM-10601"), "«Con saldo» excluye el cancelado (DTM-10605) y el pagado (DTM-10601)");
  await page.goto(`${APP}/dashboard/gestion-contratos?numero=-106&estado=cancelado`, { waitUntil: "networkidle" });
  ok((await page.locator("article[aria-label='Contrato DTM-10605']").count()) === 1, "el cancelado sigue accesible por el filtro de estado");
  await page.goto(`${APP}/dashboard/gestion-contratos?numero=-106&factura=emitida`, { waitUntil: "networkidle" });
  const em = await page.locator("article[aria-label^='Contrato ']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace("Contrato ", "")));
  ok(em.includes("DTM-10601") && em.includes("DTM-10609") && !em.includes("DTM-10602") && !em.includes("DTM-10606"), `filtro «Factura emitida (validada DIAN)»: ${em.join(", ")}`);
  await page.screenshot({ path: join(OUT, `106-factura-emitida-${vista}.png`), fullPage: true });

  await ctx.close();
}
{
  const { ctx, page } = await abrir(b, { email: "superadmin@revision.test" });
  // Acuse: marcar y retirar (cambia datos de prueba; va al FINAL para no alterar las lecturas de arriba)
  {
    await page.goto(`${APP}/dashboard/gestion-contratos?numero=DTM-10603`, { waitUntil: "networkidle" });
    let f = await txt(fila(page, "DTM-10603")); ok(!/Registrar entrega/.test(f), "DTM-10603 (sin voucher): no ofrece registrar entrega");
    await page.goto(`${APP}/dashboard/gestion-contratos?numero=DTM-10604`, { waitUntil: "networkidle" });
    const art = fila(page, "DTM-10604");
    await art.getByRole("button", { name: "Registrar entrega" }).click();
    await art.locator("select").first().selectOption({ label: "Correo" }).catch(async () => art.locator("select").first().selectOption("correo"));
    await art.getByRole("button", { name: "Guardar acuse" }).click();
    await page.waitForTimeout(1500);
    f = await txt(fila(page, "DTM-10604")); ok(/Entrega registrada manualmente/.test(f), "DTM-10604: se registra la entrega del voucher NUEVO");
    await fila(page, "DTM-10604").getByRole("button", { name: "Retirar acuse de entrega" }).click();
    await fila(page, "DTM-10604").getByRole("button", { name: "Retirar acuse" }).click();
    await page.waitForTimeout(1500);
    f = await txt(fila(page, "DTM-10604")); ok(/voucher nuevo|Generado/.test(f) && !/Entrega registrada manualmente/.test(f), "DTM-10604: el acuse se retira y vuelve a «entrega sin registrar»");
  }
  await ctx.close();
}
await b.close();
process.exit(cerrar());
