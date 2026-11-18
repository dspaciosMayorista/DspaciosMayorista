// Capturas de la revisión LOCAL de #106 con Edge sin interfaz (CDP, WebSocket nativo de Node, sin dependencias). SOLO LOCAL (loopback).
// Inicia sesión con un usuario SINTÉTICO por el GoTrue local (grant password), inyecta la cookie de sesión de @supabase/ssr y captura cada ruta en escritorio y móvil.
// Uso: node captura_106.mjs <config.json> <carpeta_salida> [usuario=superadmin@local106.test] <ruta|etiqueta> [...]
//   Cada pedido: "ruta" o "etiqueta=ruta"; añade ":movil" al final de la etiqueta para 390 px (por defecto: escritorio 1366 px). Una acción opcional tras "::" se evalúa en la página
//   (por ejemplo: "pagina=/dashboard/gestion-contratos?saldo=con_saldo::document.querySelector('button')?.click()").
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [cfgRuta, salida, ...resto] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(cfgRuta, "utf8"));
const usuario = resto[0]?.includes("@") ? resto.shift() : "superadmin@local106.test";
const APP = process.env.APP ?? "http://127.0.0.1:3056";
const SUPA = "http://127.0.0.1:54356";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PUERTO = 9266;
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
fs.mkdirSync(salida, { recursive: true });

const login = await (await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: cfg.anonKey, "content-type": "application/json" }, body: JSON.stringify({ email: usuario, password: "Local106!" }) })).json();
if (!login.access_token) { console.error("login fallido", login); process.exit(1); }
const valor = "base64-" + Buffer.from(JSON.stringify(login)).toString("base64url");
const trozos = valor.match(/.{1,3180}/g);
const cookies = (trozos.length === 1 ? [[`sb-127-auth-token`, valor]] : trozos.map((x, i) => [`sb-127-auth-token.${i}`, x])).map(([name, v]) => ({ name, value: v, domain: "127.0.0.1", path: "/", httpOnly: false }));

const perfil = path.join(process.env.TEMP ?? ".", `edge106_${Date.now()}`);
const proc = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${perfil}`, "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PUERTO}/json/version`)).ok) break; } catch { /* aún no */ } await espera(250); }

async function capturar(ruta, png, ancho, accion) {
  const t = await (await fetch(`http://127.0.0.1:${PUERTO}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  let id = 0; const pend = new Map(); const eventos = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method) eventos.push(d); };
  const cmd = (method, params = {}) => new Promise((ok) => { const n = ++id; pend.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
  const movil = ancho < 600;
  await cmd("Network.enable"); await cmd("Network.setCookies", { cookies });
  await cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: 900, deviceScaleFactor: 1, mobile: movil });
  await cmd("Page.enable"); await cmd("Runtime.enable");
  const nav = await cmd("Page.navigate", { url: `${APP}${ruta}` });
  if (nav.result?.errorText) console.error("navegación:", nav.result.errorText);
  // El primer acceso a una ruta en dev compila la página (decenas de segundos): se espera al documento real (no about:blank) ya cargado.
  const t0 = Date.now();
  for (;;) {
    const r = await cmd("Runtime.evaluate", { expression: "location.href + ' ' + document.readyState", returnByValue: true });
    const v = r.result?.result?.value ?? "";
    if (v.startsWith("http") && v.endsWith("complete")) break;
    if (Date.now() - t0 > 120_000) { console.error("tiempo agotado esperando", ruta, v); break; }
    await espera(500);
  }
  await espera(3500);
  let resultado = null;
  if (accion) { const r = await cmd("Runtime.evaluate", { expression: accion, awaitPromise: true, returnByValue: true }); resultado = r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? null; await espera(2500); }
  const errores = eventos.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params?.exceptionDetails?.exception?.description ?? e.params?.exceptionDetails?.text).slice(0, 5);
  const m = await cmd("Page.getLayoutMetrics");
  const alto = Math.min(Number(process.env.ALTO_MAX ?? 7000), Math.ceil(m.result?.cssContentSize?.height ?? 900));
  const anchoReal = Math.ceil(m.result?.cssContentSize?.width ?? ancho);
  const url = (await cmd("Runtime.evaluate", { expression: "location.pathname + location.search", returnByValue: true })).result?.result?.value;
  await cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: 1, mobile: movil });
  await espera(500);
  const s = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(png, Buffer.from(s.result.data, "base64"));
  ws.close(); await fetch(`http://127.0.0.1:${PUERTO}/json/close/${t.id}`).catch(() => {});
  return { url, alto, anchoReal, desbordaHorizontal: anchoReal > ancho + 1, errores, resultado };
}

try {
  for (const pedido of resto) {
    const [izq, accion] = pedido.split("::");
    const [etq, ruta] = izq.includes("=") ? izq.split(/=(.*)/s).slice(0, 2) : [izq.replace(/[^a-z0-9]+/gi, "_"), izq];
    const movil = etq.endsWith(":movil");
    const nombre = etq.replace(":movil", "");
    const png = path.join(salida, `${nombre}${movil ? "_movil" : ""}.png`);
    const r = await capturar(ruta, png, movil ? 390 : 1366, accion);
    console.log(JSON.stringify({ png, ...r }));
  }
} finally { try { proc.kill(); } catch { /* ya cerrado */ } }
