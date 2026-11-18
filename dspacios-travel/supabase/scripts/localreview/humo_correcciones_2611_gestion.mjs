// Owner corrections 2026-11-18 · item 6 (#106) — INDEPENDENT layout check on the final production build (disposable copy of the review data only).
// Unlike the executor's sweep, this compares the rects of EVERY text fragment of every contract card pairwise (not only the card's direct children),
// checks each fragment lies inside its card, checks page-level horizontal overflow, with the sidebar expanded AND collapsed, and reads states/wording.
// Read-only (no acknowledgment is written). Usage: node humo_correcciones_2611_gestion.mjs [simularNota]
import { mkdirSync } from "node:fs";
import { lanzar, abrir, APP, crearInforme } from "./revision_comun.mjs";

const OUT = "C:/tmp/vcorr/gestion";
mkdirSync(OUT, { recursive: true });
const { ok, cerrar } = crearInforme("correcciones 2026-11-18 · #106 layout y estados");
const b = await lanzar();
const ANCHOS = [390, 600, 768, 900, 1024, 1180, 1280, 1344, 1440];

const medir = (page) => page.evaluate(() => {
  const problemas = [];
  const arts = [...document.querySelectorAll("article[aria-label^='Contrato ']")];
  let fragmentos = 0;
  for (const art of arts) {
    const ra = art.getBoundingClientRect();
    const rects = [];
    const walker = document.createTreeWalker(art, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (q.width > 1 && q.height > 1) rects.push({ q, el: n.parentElement, t: n.textContent.trim().slice(0, 28) });
    }
    fragmentos += rects.length;
    for (const f of rects) {
      if (f.q.left < ra.left - 1 || f.q.right > ra.right + 1) problemas.push(`${art.getAttribute("aria-label")}: «${f.t}» fuera de la tarjeta (${Math.round(f.q.left)}–${Math.round(f.q.right)} vs ${Math.round(ra.left)}–${Math.round(ra.right)})`);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], c = rects[j];
      if (a.el.contains(c.el) || c.el.contains(a.el)) continue;
      const ox = Math.min(a.q.right, c.q.right) - Math.max(a.q.left, c.q.left), oy = Math.min(a.q.bottom, c.q.bottom) - Math.max(a.q.top, c.q.top);
      if (ox > 2 && oy > 3) problemas.push(`${art.getAttribute("aria-label")}: «${a.t}» y «${c.t}» se montan (${Math.round(ox)}×${Math.round(oy)} px)`);
    }
  }
  const cols = arts[0] ? getComputedStyle(arts[0]).gridTemplateColumns.split(" ").length : 0;
  return { tarjetas: arts.length, fragmentos, problemas: problemas.slice(0, 6), total: problemas.length, cols, scrollPagina: document.documentElement.scrollWidth, anchoVentana: window.innerWidth };
});

// Compiled build still has the pre-fix note (source fixed after this build). `simularNota` wraps the note's text in one <span> in the DOM, exactly what the source fix does, to prove nothing else overflows.
const simularNota = process.argv[2] === "simularNota";
const arreglarNota = (page) => page.evaluate(() => {
  const p = [...document.querySelectorAll("p")].find((x) => x.textContent.includes("Cada voucher y cada factura se leen"));
  if (!p || p.querySelector(":scope > span")) return;
  const span = document.createElement("span");
  [...p.childNodes].filter((n) => !(n.nodeType === 1 && n.tagName.toLowerCase() === "svg")).forEach((n) => span.appendChild(n));
  p.appendChild(span);
});

for (const colapsado of [false, true]) {
  const { ctx, page, cuenta } = await abrir(b, { email: "superadmin@revision.test" });
  for (const ancho of ANCHOS) {
    await page.setViewportSize({ width: ancho, height: 900 });
    await page.goto(`${APP}/dashboard/gestion-contratos?numero=-106`, { waitUntil: "networkidle" });
    if (colapsado && ancho >= 768) {
      const boton = page.getByRole("button", { name: /Recoger menú|Expandir menú/ }).first();
      if (await boton.count()) { if (/Recoger/.test((await boton.getAttribute("aria-label")) ?? "")) await boton.click(); await page.waitForTimeout(400); }
    }
    if (simularNota) await arreglarNota(page);
    const r = await medir(page);
    const sin = r.problemas.length === 0;
    const etiqueta = `${colapsado ? "menú recogido" : "menú abierto"} ${ancho}px (${r.cols} col.; ${r.tarjetas} tarjetas, ${r.fragmentos} fragmentos de texto)`;
    ok(r.tarjetas >= 17 && sin, `${etiqueta}: sin montajes ni texto fuera de su tarjeta ${r.problemas.join(" | ")}`);
    ok(r.scrollPagina <= r.anchoVentana + 2, `${etiqueta}: sin desborde horizontal de la página (scrollWidth ${r.scrollPagina} / ventana ${r.anchoVentana})${simularNota ? " [nota arreglada en el DOM]" : ""}`);
    await page.screenshot({ path: `${OUT}/v-${colapsado ? "recogido" : "abierto"}-${ancho}${simularNota ? "-nota" : ""}.png`, fullPage: false });
  }
  await ctx.close();
}

// states & wording (read-only): which cards show which step
const { ctx, page, cuenta } = await abrir(b, { email: "superadmin@revision.test" });
await page.goto(`${APP}/dashboard/gestion-contratos?numero=-106`, { waitUntil: "networkidle" });
const t = async (n) => (await page.locator(`article[aria-label="Contrato ${n}"]`).innerText()).replace(/\s+/g, " ");
const esperados = [
  ["DTM-10601", [/Entrega registrada manualmente/, /Emitida \(validada por la DIAN\)/, /Envío registrado manualmente/, /no prueba que el cliente/]],
  ["DTM-10602", [/Generado \(\d+\)/, /Entrega sin registrar/, /Pendiente de validación DIAN/]],
  ["DTM-10603", [/No generado|Sin voucher/]],
  ["DTM-10604", [/Entrega sin registrar \(voucher nuevo\)/, /Esa entrega sigue en el historial/]],
  ["DTM-10606", [/Pendiente de validación DIAN/]],
  ["DTM-10609", [/Emitida \(validada por la DIAN\)/, /Envío sin registrar/]],
];
for (const [n, pats] of esperados) {
  const x = await t(n);
  for (const p of pats) ok(p.test(x), `${n}: ${p} → «${x.slice(0, 0)}${(x.match(p) ?? ["NO ENCONTRADO"])[0]}»`);
  // honest wording: a manual acknowledgment must carry the disclaimer; an unregistered step must say it is not on record. (Quoted staff notes such as «Enviado al cliente por WhatsApp» are the acknowledgment's own text, not a system claim.)
  if (/registrad[ao] manualmente/.test(x)) ok(/Acuse del personal: no prueba que el cliente (lo|la) recibiera ni (lo|la) aceptara/.test(x), `${n}: todo acuse manual lleva el aviso «no prueba que el cliente … recibiera ni … aceptara»`);
  if (/sin registrar/.test(x)) ok(/No consta que se haya (entregado|enviado)|no consta que se haya enviado|sigue en el historial; registra la del voucher nuevo/.test(x), `${n}: lo no registrado dice «no consta…»`);
}
// idle: no requests for 30 s on the list
const pedidas = []; page.on("request", (rq) => pedidas.push(rq.url()));
await page.waitForTimeout(30000);
ok(pedidas.length <= 1, `lista de gestión: ${pedidas.length} solicitud(es) en 30 s de inactividad (esperado ≤ 1: el sondeo de 30 s de la campana de avisos del shell, #86, ya existente; la lista no sondea) ${pedidas.slice(0, 3).join(" ")}`);
await page.screenshot({ path: `${OUT}/estados-escritorio.png`, fullPage: true });
await ctx.close();
await b.close();
process.exit(cerrar());
