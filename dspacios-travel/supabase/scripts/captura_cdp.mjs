// Captura de páginas con Edge sin interfaz por el protocolo de depuración (CDP), con el WebSocket nativo de Node (sin dependencias).
// `--screenshot` captura antes de pintar cuando la navegación queda abierta (vídeos/conexiones largas); aquí se fija el dispositivo
// (ancho, móvil), se navega, se espera a que la página se pinte y se captura la altura completa.
import { spawn } from "node:child_process";
import fs from "node:fs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

export async function abrirEdge(perfil, puerto = 9233) {
  const proc = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${puerto}`, `--user-data-dir=${perfil}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${puerto}/json/version`); if (r.ok) break; } catch { /* aún no */ }
    await espera(250);
  }
  return {
    async capturar(url, png, ancho, altoMax = 4000, esperaMs = 6000, accion = null) {
      const t = await (await fetch(`http://127.0.0.1:${puerto}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
      let id = 0; const pendientes = new Map(); const eventos = [];
      ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pendientes.has(d.id)) { pendientes.get(d.id)(d); pendientes.delete(d.id); } else if (d.method) eventos.push(d); };
      const cmd = (method, params = {}) => new Promise((ok) => { const n = ++id; pendientes.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
      const movil = ancho < 600;
      await cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: 900, deviceScaleFactor: 1, mobile: movil });
      await cmd("Page.enable"); await cmd("Runtime.enable");
      await cmd("Page.navigate", { url });
      const t0 = Date.now();
      while (Date.now() - t0 < 20_000 && !eventos.some((e) => e.method === "Page.loadEventFired")) await espera(200);
      await espera(esperaMs);   // datos del cliente y animaciones
      // Acción opcional en la página (p. ej. abrir una pestaña) antes de capturar; su resultado se devuelve.
      let resultadoAccion = null;
      if (accion) { const r = await cmd("Runtime.evaluate", { expression: accion, awaitPromise: true, returnByValue: true }); resultadoAccion = r.result?.result?.value ?? null; await espera(esperaMs); }
      const errores = eventos.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params?.exceptionDetails?.exception?.description ?? e.params?.exceptionDetails?.text).slice(0, 5);
      const m = await cmd("Page.getLayoutMetrics");
      const alto = Math.min(altoMax, Math.ceil(m.result?.cssContentSize?.height ?? m.result?.contentSize?.height ?? 900));
      const anchoReal = Math.ceil(m.result?.cssContentSize?.width ?? ancho);
      await cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: 1, mobile: movil });
      await espera(500);
      const s = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(png, Buffer.from(s.result.data, "base64"));
      ws.close();
      await fetch(`http://127.0.0.1:${puerto}/json/close/${t.id}`).catch(() => {});
      return { resultadoAccion, alto, anchoReal, desbordaHorizontal: anchoReal > ancho, errores, cargo: eventos.some((e) => e.method === "Page.loadEventFired") };
    },
    cerrar() { try { proc.kill(); } catch { /* ya cerrado */ } },
  };
}
