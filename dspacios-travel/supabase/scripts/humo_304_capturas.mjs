// Capturas del HUMO de la 304 (#94): abre las páginas REALES de la aplicación compilada (`/c/[token]` y `/contrato/[numero]`) con Edge sin interfaz (CDP) y guarda
// pantalla de escritorio, móvil a 375 px, impresión y el PDF real (Page.printToPDF). También abre el PDF generado en Edge y lo captura, para verificarlo en un visor.
// Env: HUMO_APP, HUMO_SALIDA, HUMO_SECRETO, HUMO_UID, HUMO_PAGINAS (JSON [{nombre, ruta, sesion}]). Solo loopback.
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";

const APP = process.env.HUMO_APP, SALIDA = process.env.HUMO_SALIDA, SECRETO = process.env.HUMO_SECRETO, UID = process.env.HUMO_UID;
const PAGINAS = JSON.parse(process.env.HUMO_PAGINAS ?? "[]");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 })); return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const token = jwt({ role: "authenticated", sub: UID, session_id: UID.replace(/^00000000/, "5e550000"), aud: "authenticated" });
const sesion = JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "x", user: { id: UID, aud: "authenticated", role: "authenticated" } });
const COOKIE = { name: "sb-127-auth-token", value: "base64-" + Buffer.from(sesion).toString("base64url") };

fs.mkdirSync(SALIDA, { recursive: true });
const proc = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--remote-debugging-port=9261", `--user-data-dir=${SALIDA}/perfil`, "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { if ((await fetch("http://127.0.0.1:9261/json/version")).ok) break; } catch { /* aún no */ } await espera(250); }

async function pestana() {
  const t = await (await fetch("http://127.0.0.1:9261/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((ok) => (ws.onopen = ok));
  let id = 0; const pend = new Map(); const ev = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else ev.push(d); };
  const cmd = (method, params = {}) => new Promise((ok) => { const k = ++id; pend.set(k, ok); ws.send(JSON.stringify({ id: k, method, params })); });
  return { cmd, ev, cerrar: async () => { ws.close(); await fetch(`http://127.0.0.1:9261/json/close/${t.id}`).catch(() => {}); } };
}
async function abrir(p, url, ancho, medio, sesionOn) {
  await p.cmd("Page.enable"); await p.cmd("Network.enable");
  if (sesionOn) await p.cmd("Network.setCookie", { name: COOKIE.name, value: COOKIE.value, url: APP });
  await p.cmd("Emulation.setEmulatedMedia", { media: medio });
  await p.cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: 900, deviceScaleFactor: 1, mobile: ancho < 600 });
  await p.cmd("Page.navigate", { url });
  const t0 = Date.now(); while (Date.now() - t0 < 30000 && !p.ev.some((e) => e.method === "Page.loadEventFired")) await espera(200);
  await espera(1500);
}
const informe = [];
for (const pg of PAGINAS) {
  for (const [sufijo, ancho, medio] of [["escritorio", 1000, "screen"], ["movil375", 375, "screen"], ["impresion", 760, "print"]]) {
    const p = await pestana();
    await abrir(p, `${APP}${pg.ruta}`, ancho, medio, pg.sesion);
    const m = await p.cmd("Page.getLayoutMetrics");
    const alto = Math.min(Math.ceil(m.result.cssContentSize.height), 6000), anchoReal = Math.ceil(m.result.cssContentSize.width);
    await p.cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: 1, mobile: ancho < 600 }); await espera(400);
    const s = await p.cmd("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(`${SALIDA}/${pg.nombre}-${sufijo}.png`, Buffer.from(s.result.data, "base64"));
    const txt = await p.cmd("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true });
    informe.push({ pagina: pg.nombre, vista: sufijo, alto, desbordaHorizontal: anchoReal > ancho + 1, texto: String(txt.result?.result?.value ?? "").replace(/\s+/g, " ").slice(0, 100000) });
    await p.cerrar();
  }
  // PDF real (Letter, con colores) y su apertura en el visor de Edge.
  const p = await pestana();
  await abrir(p, `${APP}${pg.ruta}`, 1000, "print", pg.sesion);
  const pdf = await p.cmd("Page.printToPDF", { printBackground: true, preferCSSPageSize: false, paperWidth: 8.5, paperHeight: 11, marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4 });
  const ruta = `${SALIDA}/${pg.nombre}.pdf`; fs.writeFileSync(ruta, Buffer.from(pdf.result.data, "base64"));
  await p.cerrar();
  const v = await pestana();
  await v.cmd("Page.enable"); await v.cmd("Emulation.setDeviceMetricsOverride", { width: 900, height: 1100, deviceScaleFactor: 1, mobile: false });
  await v.cmd("Page.navigate", { url: "file:///" + ruta.replace(/\\/g, "/") }); await espera(4000);
  const sv = await v.cmd("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${SALIDA}/${pg.nombre}-visor-pdf.png`, Buffer.from(sv.result.data, "base64"));
  await v.cerrar();
}
fs.writeFileSync(`${SALIDA}/informe.json`, JSON.stringify(informe, null, 1));
proc.kill();
console.log(`capturas en ${SALIDA}: ${informe.length} vistas`);
