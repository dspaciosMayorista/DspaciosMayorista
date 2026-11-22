// Screenshots + print-to-PDF of the views rendered by visual_b2b_render.ts, using the COMPILED app CSS (.next/static/chunks/*.css) in Edge. Not part of any suite.
// Usage: node pruebas/support/visual_b2b_shots.mjs <dir with *.body.html> [outDir]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const dir = process.argv[2];
const out = process.argv[3] ?? path.join(dir, "shots");
fs.mkdirSync(out, { recursive: true });
const cssDir = path.resolve(".next/static/chunks");
const css = fs.readdirSync(cssDir).filter((f) => f.endsWith(".css")).map((f) => `<link rel="stylesheet" href="${pathToFileURL(path.join(cssDir, f)).href}">`).join("\n");
const ENVOLTURA = { "cuenta-aceptada": "cuenta", "cuenta-sin-aceptar": "cuenta" };
const pagina = (k, body) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body class="bg-gray-100">` +
  (k.startsWith("portal-") ? body : ENVOLTURA[k] === "cuenta"
    ? `<div class="min-h-screen bg-gray-100 py-6"><div class="mx-auto max-w-3xl px-4 print:max-w-none print:px-0"><div class="cuenta-doc rounded-xl bg-white p-6 shadow-sm print:rounded-none print:p-0 print:shadow-none">${body}</div></div></div>`
    : `<div class="mx-auto max-w-4xl p-4">${body}</div>`) + `</body></html>`;

const browser = await chromium.launch({ channel: "msedge" });
const resumen = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".body.html")).sort()) {
  const k = f.replace(".body.html", "");
  const html = path.join(dir, `${k}.html`);
  fs.writeFileSync(html, pagina(k, fs.readFileSync(path.join(dir, f), "utf8")));
  for (const w of [1280, 820, 390]) {
    const p = await browser.newPage({ viewport: { width: w, height: 900 } });
    await p.goto(pathToFileURL(html).href);
    await p.waitForLoadState("load");
    const m = await p.evaluate(() => {
      const de = document.documentElement; const vw = de.clientWidth;
      const fuera = [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1); }).length;
      const imgsRotas = [...document.querySelectorAll("img")].filter((i) => !i.complete || i.naturalWidth === 0).length;
      return { scrollW: de.scrollWidth, vw, fuera, imgs: document.images.length, imgsRotas };
    });
    await p.screenshot({ path: path.join(out, `${k}_${w}.png`), fullPage: true });
    resumen.push({ vista: k, ancho: w, ...m, sinDesborde: m.scrollW <= m.vw && m.fuera === 0 });
    await p.close();
  }
  if (!k.startsWith("perfil") && !k.startsWith("portal-")) {
    const p = await browser.newPage();
    await p.goto(pathToFileURL(html).href);
    await p.emulateMedia({ media: "print" });
    await p.pdf({ path: path.join(out, `${k}.pdf`), format: "Letter", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
    await p.close();
  }
}
await browser.close();
console.table(resumen);
