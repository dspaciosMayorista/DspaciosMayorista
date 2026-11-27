// Rasterises the PDFs produced by visual_block1.mjs page by page with Edge's own PDF viewer over CDP (no poppler/pdf libraries on this machine).
// Usage: node supabase/scripts/pdf_paginas_block1.mjs <dir con los PDF> <nombre.pdf>:<paginas> ...   e.g.  voucher-vuelo-DTM-9703.pdf:3
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const [dir, ...pedidos] = process.argv.slice(2);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = fs.mkdtempSync(path.join(process.env.TEMP || ".", "edge-pdf-"));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--remote-debugging-port=9255", `--user-data-dir=${perfil}`, "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { if ((await fetch("http://127.0.0.1:9255/json/version")).ok) break; } catch { /* not yet */ } await dormir(250); }
for (const pedido of pedidos) {
  const [nombre, n] = pedido.split(":");
  for (let pag = 1; pag <= Number(n); pag++) {
    const t = await (await fetch(`http://127.0.0.1:9255/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
    let id = 0; const pend = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
    const cmd = (method, params = {}) => new Promise((ok) => { const k = ++id; pend.set(k, ok); ws.send(JSON.stringify({ id: k, method, params })); });
    await cmd("Emulation.setDeviceMetricsOverride", { width: 900, height: 1250, deviceScaleFactor: 1, mobile: false });
    await cmd("Page.enable");
    await cmd("Page.navigate", { url: `${pathToFileURL(path.resolve(dir, nombre)).href}#page=${pag}&toolbar=0&navpanes=0&view=Fit` });
    await dormir(4000);
    const s = await cmd("Page.captureScreenshot", { format: "png" });
    const archivo = path.join(dir, `${nombre.replace(/\.pdf$/, "")}-p${pag}.png`); fs.writeFileSync(archivo, Buffer.from(s.result.data, "base64"));
    console.log("page raster:", archivo);
    ws.close(); await fetch(`http://127.0.0.1:9255/json/close/${t.id}`).catch(() => {});
  }
}
edge.kill();
