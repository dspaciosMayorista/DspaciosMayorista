// Image-delivery measurements with raw Chrome DevTools Protocol (no dependency; Node 24 global WebSocket).
// LOOPBACK ONLY: app on 127.0.0.1:3047, synthetic images on 127.0.0.1:54371. One Edge instance (RAM is shared).
//
// Usage: node medir_cdp.mjs <etiqueta> <salida.json> [escenarios,separados,por,coma]
// Scenario id = <catalogo>.<dispositivo>.<red>.<cache>  e.g. programas.desktop.libre.frio
//   catalogo   programas | receptivos
//   dispositivo desktop (1366x768, DPR 1) | mobile (390x844, DPR 3, touch)
//   red        libre | 4g (9 Mbps, 60 ms) | 3g (1.6 Mbps, 150 ms)
//   cache      frio (cleared cache) | tibio (second navigation, cache kept)
// Per scenario it records: image requests (start, TTFB, end, bytes, status, cache hit), peak concurrency, time to the
// first image shown and to all images inside the first viewport, layout shift (CLS), LCP, requests/bytes before and after
// scrolling to the bottom, and the number of <img> that ended broken. It performs NO retries of its own.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [etiqueta, salida, filtro] = process.argv.slice(2);
if (!etiqueta || !salida) throw new Error("uso: node medir_cdp.mjs <etiqueta> <salida.json> [escenarios]");
const APP = process.env.APP_URL ?? "http://127.0.0.1:3047";
const IMG_HOST = "127.0.0.1:54371";
const EDGE = process.env.EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const REDES = { libre: null, "4g": { latency: 60, down: 9e6 / 8, up: 3e6 / 8 }, "3g": { latency: 150, down: 1.6e6 / 8, up: 0.75e6 / 8 } };
const DISP = { desktop: { width: 1366, height: 768, dpr: 1, mobile: false }, mobile: { width: 390, height: 844, dpr: 3, mobile: true } };
const todos = [];
for (const c of ["programas", "receptivos", "busqueda"]) for (const d of ["desktop", "mobile"]) for (const r of ["libre", "4g", "3g"]) for (const k of ["frio", "tibio"]) todos.push(`${c}.${d}.${r}.${k}`);
const VENTANA = { libre: 30000, '4g': 60000, '3g': 45000 }; // time-boxed: a slow network is reported as «what arrived inside the window»
const escenarios = filtro ? filtro.split(",") : todos;

const perfil = mkdtempSync(join(tmpdir(), "edge-img-"));
const edge = spawn(EDGE, ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${perfil}`, "--disable-gpu", "--no-first-run",
  "--disable-extensions", "--disable-background-networking", "--disable-component-update", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function ws() {
  for (let i = 0; i < 60; i++) { try { const j = await (await fetch("http://127.0.0.1:9333/json/version")).json(); return j.webSocketDebuggerUrl; } catch { await dormir(500); } }
  throw new Error("Edge no respondió");
}
const url = await ws();
const sock = new WebSocket(url);
await new Promise((r) => sock.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map(); const handlers = new Set();
sock.addEventListener("message", (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { const { res, rej } = pend.get(d.id); pend.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
  else for (const h of handlers) h(d);
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params, sessionId })); });

const OBSERVADOR = `(() => {
  const m = window.__m = { cls: 0, shifts: [], lcp: null, vistas: {}, t0: performance.now() };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { m.cls += e.value; m.shifts.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4) }); } }).observe({ type: 'layout-shift', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { const e = l.getEntries().at(-1); m.lcp = { t: Math.round(e.startTime), url: (e.url || '').slice(0, 90), size: e.size }; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  const ciclo = () => { for (const i of document.images) { const s = i.currentSrc || i.src; if (!s) continue; const r = i.getBoundingClientRect();
      const ok = i.complete && i.naturalWidth > 0, roto = i.complete && i.naturalWidth === 0;
      const v = m.vistas[s] ?? (m.vistas[s] = { desde: Math.round(performance.now()), loading: i.getAttribute('loading'), prio: i.getAttribute('fetchpriority'), nat: null, ren: null, ok: false, roto: false, enVista0: null });
      if (v.enVista0 === null) v.enVista0 = r.top < innerHeight && r.bottom > 0 && !m.scrolled;
      if ((ok || roto) && !v.ok && !v.roto) { v.ok = ok; v.roto = roto; v.t = Math.round(performance.now()); v.nat = [i.naturalWidth, i.naturalHeight]; v.ren = [Math.round(r.width), Math.round(r.height)]; }
    } requestAnimationFrame(ciclo); };
  addEventListener('DOMContentLoaded', () => requestAnimationFrame(ciclo));
})();`;

async function medir(esc) {
  const [cat, disp, red, cache] = esc.split(".");
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: s } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, s);
  await S("Network.enable"); await S("Page.enable"); await S("Runtime.enable");
  await S("Network.setCacheDisabled", { cacheDisabled: false });
  const D = DISP[disp];
  await S("Emulation.setDeviceMetricsOverride", { width: D.width, height: D.height, deviceScaleFactor: D.dpr, mobile: D.mobile });
  if (D.mobile) await S("Emulation.setTouchEmulationEnabled", { enabled: true });
  const R = REDES[red];
  await S("Network.emulateNetworkConditions", R ? { offline: false, latency: R.latency, downloadThroughput: R.down, uploadThroughput: R.up } : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await S("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVADOR });
  const reqs = new Map(); const abiertas = new Set(); let pico = 0; let t0 = 0;
  const h = (d) => {
    if (d.sessionId !== s) return; const p = d.params;
    if (d.method === "Network.requestWillBeSent" && p.request.url.includes(IMG_HOST)) {
      reqs.set(p.requestId, { url: p.request.url.replace(/^http:\/\/127\.0\.0\.1:54371/, ""), t: p.timestamp * 1000, prio: p.request.initialPriority, tipo: p.type, ini: p.initiator?.type });
      abiertas.add(p.requestId); pico = Math.max(pico, abiertas.size);
    }
    const r = reqs.get(p.requestId); if (!r) return;
    if (d.method === "Network.responseReceived") { r.status = p.response.status; r.ttfb = p.timestamp * 1000 - r.t; r.cacheDisco = !!p.response.fromDiskCache; r.proto = p.response.protocol; r.cl = p.response.headers["content-length"] ?? p.response.headers["Content-Length"]; }
    if (d.method === "Network.requestServedFromCache") r.cacheMem = true;
    if (d.method === "Network.loadingFinished") { r.fin = p.timestamp * 1000 - r.t; r.bytes = p.encodedDataLength; abiertas.delete(p.requestId); }
    if (d.method === "Network.loadingFailed") { r.fallo = p.errorText; r.fin = p.timestamp * 1000 - r.t; abiertas.delete(p.requestId); }
  };
  handlers.add(h);
  const ev = async (expr) => (await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const esperarQuieto = async (max, quieto = 1500) => { const ini = Date.now(); let ult = Date.now(), n = reqs.size, ab = abiertas.size; while (Date.now() - ini < max) { await dormir(250); if (reqs.size !== n || abiertas.size !== ab) { n = reqs.size; ab = abiertas.size; ult = Date.now(); } else if (abiertas.size === 0 && Date.now() - ult > quieto) break; } };
  const pestana = cat === "programas" ? "Programas" : "Receptivos";
  const buscar = `(async () => { const esp = (ms) => new Promise(r => setTimeout(r, ms));
    const campo = (et) => [...document.querySelectorAll('label')].find(l => l.textContent.trim() === et)?.parentElement.querySelector('input,select');
    const poner = (el, v) => { const p = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    for (let i = 0; i < 40 && !campo('Ida'); i++) await esp(250);
    poner(campo('Destino'), 'CARTAGENA'); poner(campo('Ida'), '2027-02-01'); poner(campo('Regreso'), '2027-02-04'); poner(campo('Pax'), '2'); await esp(300);
    const b = [...document.querySelectorAll('button')].find(b => /Buscar receptivos/.test(b.textContent)); if (!b) return 'sin-boton-buscar'; b.click(); return 'ok'; })()`;
  const abrirPestana = `(async () => { const esp = (ms) => new Promise(r => setTimeout(r, ms));
      const btn = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
      for (let i = 0; i < 120 && !btn(${JSON.stringify(pestana)}); i++) await esp(250);
      const b = btn(${JSON.stringify(pestana)}); if (!b) return 'sin-boton'; b.click(); return 'ok'; })()`;
  async function una() {
    reqs.clear(); abiertas.clear(); pico = 0;
    const t = Date.now();
    await S("Page.navigate", { url: `${APP}/tarifario` });
    for (let i = 0; i < 80; i++) { await dormir(250); if ((await ev("document.readyState")) === "complete") break; }
    const tNav = Date.now() - t;
    let abierta = await ev(abrirPestana);
    if (abierta === 'ok' && cat === 'busqueda') abierta = await ev(buscar);
    const textoSiFalla = abierta === 'ok' ? undefined : await ev("document.body.innerText.slice(0, 400)");
    await esperarQuieto(VENTANA[red]);
    const ini = await ev(`(() => { window.__m.scrolled = true; return { reqs: 0 }; })()`);
    const antes = { reqs: reqs.size, bytes: [...reqs.values()].reduce((a, r) => a + (r.bytes ?? 0), 0) };
    // Scroll to the bottom in viewport-sized steps (lazy-loaded images below the fold must start only when approached).
    const alto = await ev("document.documentElement.scrollHeight"); const paso = D.height * 0.8;
    for (let y = 0; y < alto; y += paso) { await ev(`window.scrollTo(0, ${y})`); await dormir(500); }
    await esperarQuieto(VENTANA[red]);
    const estado = await ev(`(() => ({ m: window.__m, total: document.images.length, rotas: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
       cuerpoAlto: document.documentElement.scrollHeight, enVista: [...document.images].filter(i => { const r = i.getBoundingClientRect(); return false; }).length }))()`);
    if (process.env.SHOTS) { await ev(process.env.SHOT_Y === "bottom" ? "window.scrollTo(0, document.documentElement.scrollHeight)" : "window.scrollTo(0, 0)"); await dormir(700); const { data } = await S("Page.captureScreenshot", { format: "png" }); writeFileSync(join(process.env.SHOTS, `${etiqueta}-${esc}.png`), Buffer.from(data, "base64")); }
    // Idle check: after everything settled, nothing may keep requesting (no retry loops, no polling).
    const antesReposo = reqs.size; await dormir(10000); const enReposo = reqs.size - antesReposo;
    const lista = [...reqs.values()];
    const bytes = lista.reduce((a, r) => a + (r.bytes ?? 0), 0);
    const mostradas = Object.entries(estado.m.vistas).filter(([u, v]) => v.ok && u.includes(IMG_HOST)).map(([u, v]) => ({ u: u.replace(/^http:\/\/127\.0\.0\.1:54371/, ""), t: v.t, ren: v.ren, nat: v.nat, enVista0: v.enVista0, loading: v.loading, prio: v.prio }));
    const vista0 = mostradas.filter((m) => m.enVista0);
    return {
      abierta, textoSiFalla, textoPestana: await ev("document.body.innerText.slice(-700)"), tNavMs: tNav, imgsEnDom: estado.total, imgsRotas: estado.rotas,
      peticionesEnReposo10s: enReposo, peticiones: lista.length, bytes, abiertasAlFinal: abiertas.size, ventanaMs: VENTANA[red], picoConcurrencia: pico,
      peticionesAntesDeScroll: antes.reqs, bytesAntesDeScroll: antes.bytes,
      maxPorUrl: Math.max(0, ...Object.values(lista.reduce((a, r) => (a[r.url] = (a[r.url] ?? 0) + 1, a), {}))), alturaTotal: estado.cuerpoAlto, noOk: lista.filter((r) => r.status && r.status >= 400).length, fallidas: lista.filter((r) => r.fallo).length,
      cacheHits: lista.filter((r) => r.cacheDisco || r.cacheMem).length, conditional304: lista.filter((r) => r.status === 304).length,
      primeraImagenMs: mostradas.length ? Math.min(...mostradas.map((m) => m.t)) : null,
      todasEnVista0Ms: vista0.length ? Math.max(...vista0.map((m) => m.t)) : null, imgsEnVista0: vista0.length,
      cls: +estado.m.cls.toFixed(4), shifts: estado.m.shifts.slice(0, 8), lcp: estado.m.lcp,
      imagenes: mostradas.map((m) => [m.u.split("?")[0].slice(-14), m.t, m.enVista0 ? 1 : 0, m.ren?.join("x"), m.nat?.join("x"), m.loading, m.prio]), ejemploRender: mostradas.slice(0, 2), ejemploPeticion: lista.slice(0, 3).map((r) => ({ url: r.url, prio: r.prio, status: r.status, ttfb: Math.round(r.ttfb ?? -1), fin: Math.round(r.fin ?? -1), bytes: r.bytes })),
      imgsRotasLista: Object.entries(estado.m.vistas).filter(([u, v]) => v.roto && u.includes(IMG_HOST)).map(([u]) => u.split("?")[0].slice(-18)), sinDimension: Object.values(estado.m.vistas).filter((v) => v.ren && (v.ren[0] === 0 || v.ren[1] === 0)).length,
    };
  }
  let resultado;
  if (cache === "frio") { await S("Network.clearBrowserCache"); resultado = await una(); }
  else { await S("Network.clearBrowserCache"); await una(); resultado = await una(); }
  handlers.delete(h);
  await send("Target.closeTarget", { targetId });
  return resultado;
}

const salidaJson = { etiqueta, fecha: new Date().toISOString(), app: APP, resultados: {} };
try {
  for (const e of escenarios) {
    await send("Storage.clearDataForOrigin", { origin: APP, storageTypes: "all" }).catch(() => {});
    try { salidaJson.resultados[e] = await medir(e); } catch (err) { salidaJson.resultados[e] = { error: String(err.message ?? err) }; }
    const r = salidaJson.resultados[e];
    console.log(e, r.error ? `ERROR ${r.error}` : `reqs=${r.peticiones} MB=${(r.bytes / 1048576).toFixed(1)} pico=${r.picoConcurrencia} 1ª=${r.primeraImagenMs}ms vista0=${r.todasEnVista0Ms}ms rotas=${r.imgsRotas} cls=${r.cls}`);
    writeFileSync(salida, JSON.stringify(salidaJson, null, 1));
  }
} finally {
  try { await send("Browser.close"); } catch { /* already closing */ }
  edge.kill(); await dormir(500); try { rmSync(perfil, { recursive: true, force: true }); } catch { /* profile in use */ }
}
