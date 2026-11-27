// Convierte CADA página de uno o varios PDF a PNG para inspeccionarla (sin poppler): pdf.js dentro de Edge (Playwright) sobre un servidor HTTP local efímero. Solo local.
// Uso:  PDFJS_DIR=<carpeta con node_modules/pdfjs-dist> node supabase/scripts/r3_pantallas/pdf_a_png.mjs <carpeta_salida> <a.pdf> [b.pdf ...]
//   (PDFJS_DIR: npm i pdfjs-dist@4.10.38 en una carpeta ajena al repositorio.) Escribe <salida>/<nombre>_p<N>.png a 1.4x y imprime el número de páginas REAL de cada PDF.
import http from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const [salida, ...pdfs] = process.argv.slice(2);
const PDFJS = process.env.PDFJS_DIR;
if (!salida || !pdfs.length || !PDFJS) throw new Error("Uso: PDFJS_DIR=… node pdf_a_png.mjs <salida> <pdf…>");
mkdirSync(salida, { recursive: true });
const HTML = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888"><canvas id="c"></canvas>
<script type="module">
import * as pdfjs from "/pdfjs/build/pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.min.mjs";
window.cargar = async (url) => { window.doc = await pdfjs.getDocument(url).promise; return window.doc.numPages; };
window.pagina = async (n) => { const p = await window.doc.getPage(n); const v = p.getViewport({ scale: 1.4 }); const c = document.getElementById("c"); c.width = v.width; c.height = v.height; await p.render({ canvasContext: c.getContext("2d"), viewport: v }).promise; return [v.width, v.height]; };
window.listo = true;
</script>`;
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent((req.url ?? "").split("?")[0]);
  try {
    if (u === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(HTML); return; }
    if (u.startsWith("/pdfjs/")) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(readFileSync(path.join(PDFJS, "node_modules/pdfjs-dist", u.slice(7)))); return; }
    if (u.startsWith("/pdf/")) { res.writeHead(200, { "content-type": "application/pdf" }); res.end(readFileSync(pdfs[Number(u.slice(5))])); return; }
  } catch { /* 404 */ }
  res.writeHead(404); res.end();
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 200)));
await page.goto(base + "/");
await page.waitForFunction(() => window.listo === true, null, { timeout: 30000 });
const resumen = [];
for (let i = 0; i < pdfs.length; i++) {
  const n = await page.evaluate((u) => window.cargar(u), `${base}/pdf/${i}`);
  const nombre = path.basename(pdfs[i], ".pdf");
  for (let p = 1; p <= n; p++) {
    await page.evaluate((k) => window.pagina(k), p);
    await page.locator("#c").screenshot({ path: path.join(salida, `${nombre}_p${p}.png`) });
  }
  resumen.push({ pdf: path.basename(pdfs[i]), paginas: n });
  console.log(`${path.basename(pdfs[i])}: ${n} páginas → ${salida}/${nombre}_p1..p${n}.png`);
}
writeFileSync(path.join(salida, "paginas.json"), JSON.stringify(resumen, null, 2));
await browser.close(); srv.close();
