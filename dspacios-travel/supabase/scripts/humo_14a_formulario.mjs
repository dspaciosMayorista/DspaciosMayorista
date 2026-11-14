// HUMO del FORMULARIO del carrito (#14-A) en la aplicación COMPILADA: abre /tarifario/checkout con Edge sin interfaz (CDP) y una sesión de personal REAL de la base local, con un carrito en localStorage,
// y comprueba lo que el usuario ve y hace: el campo de recobro y la distribución en la venta asistida, el aviso de liquidación del servidor (aquí el tarifario no tiene precios reales, así que el servidor
// responde que no puede liquidar: se verifica el camino de ERROR visible y el botón bloqueado) y que el recobro no aparece en la sección «Tu selección». Guarda capturas y un informe JSON.
// Env: HUMO_APP, HUMO_SALIDA, HUMO_SECRETO, HUMO_UID, HUMO_ALIADO. Solo loopback.
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";

const APP = process.env.HUMO_APP, SALIDA = process.env.HUMO_SALIDA, SECRETO = process.env.HUMO_SECRETO, UID = process.env.HUMO_UID, ALIADO = process.env.HUMO_ALIADO ?? "";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 })); return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const token = jwt({ role: "authenticated", sub: UID, session_id: UID.replace(/^00000000/, "5e550000"), aud: "authenticated" });
const sesion = JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "x", user: { id: UID, aud: "authenticated", role: "authenticated", email: "super94@x.test" } });
const COOKIE = { name: "sb-127-auth-token", value: "base64-" + Buffer.from(sesion).toString("base64url") };

const CARRITO = [{
  id: "h1", tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 10201, hotelId: 10201, bloqueoId: null, hotelNombre: "Hotel Aurora 102", destino: "CARTAGENA", fotoUrl: null,
  categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0,
  pax: 2, precio: 1_000_000, edadesMenores: [], moneda: "COP",
}];

fs.mkdirSync(SALIDA, { recursive: true });
const proc = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--remote-debugging-port=9262", `--user-data-dir=${SALIDA}/perfil-form`, "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { if ((await fetch("http://127.0.0.1:9262/json/version")).ok) break; } catch { /* aún no */ } await espera(250); }
const t = await (await fetch("http://127.0.0.1:9262/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((ok) => (ws.onopen = ok));
let id = 0; const pend = new Map(); const eventos = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else eventos.push(d); };
const cmd = (method, params = {}) => new Promise((ok) => { const k = ++id; pend.set(k, ok); ws.send(JSON.stringify({ id: k, method, params })); });
const evalJs = async (expression) => { const r = await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
const esperarJs = async (expression, que, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evalJs(expression)) return; await espera(250); } throw new Error(`tiempo agotado: ${que}`); };
const escribir = (sel, valor) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(valor)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const clickBoton = (texto) => evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(texto)}); if (!b) return false; b.click(); return true; })()`);
const texto = () => evalJs("document.body.innerText.replace(/\\s+/g, ' ')");
const foto = async (nombre) => { await cmd("Emulation.setDeviceMetricsOverride", { width: 1000, height: 1400, deviceScaleFactor: 1, mobile: false }); const s = await cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${SALIDA}/${nombre}.png`, Buffer.from(s.result.data, "base64")); };

const informe = { pasos: [], errores: [] };
const paso = (nombre, ok, detalle = "") => { informe.pasos.push({ nombre, ok, detalle }); if (!ok) informe.errores.push(nombre); };
try {
  await cmd("Page.enable"); await cmd("Network.enable"); await cmd("Runtime.enable");
  await cmd("Network.setCookie", { name: COOKIE.name, value: COOKIE.value, url: APP });
  await cmd("Page.navigate", { url: `${APP}/tarifario` }); await espera(3000);
  await evalJs(`localStorage.setItem('dspacios_cart_v1', ${JSON.stringify(JSON.stringify(CARRITO))}); true`);
  await cmd("Page.navigate", { url: `${APP}/tarifario/checkout` });
  await esperarJs(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Aliado (B2B)')`, "el selector de tipo de venta (personal con permiso)");
  paso("personal con permiso ve «Tipo de venta»", true);

  // Cliente final: solo recobro, sin distribución.
  await esperarJs(`!!document.querySelector('[data-testid="recobro-total"]')`, "el campo de recobro a cliente final");
  paso("cliente final: campo de recobro presente", true);
  paso("cliente final: sin campo de distribución", !(await evalJs(`!!document.querySelector('[data-testid="recobro-dist"]')`)));
  await foto("formulario-cliente-final");

  // Venta asistida: elige aliado → aparece la distribución.
  await clickBoton("Aliado (B2B)");
  await esperarJs(`!!document.querySelector('#asist-aliado')`, "el buscador de aliado");
  await escribir("#asist-aliado", ALIADO);
  await esperarJs(`!!document.querySelector('[data-testid="recobro-dist"]')`, "la distribución de la venta asistida");
  paso("venta asistida: recobro + distribución", true);
  await escribir('[data-testid="recobro-total"]', "100.000");
  await escribir('[data-testid="recobro-dist"]', "50.000");
  // Tras la pausa el servidor REAL intenta liquidar. Sin precios reales en esta base responde que no puede: se ve el aviso y el botón queda bloqueado.
  await esperarJs(`!!document.querySelector('[data-testid="previa-error"]') || !!document.querySelector('[data-testid="terminos-b2b-previa"]')`, "la respuesta del servidor a la revisión de términos", 40000);
  const hayTerminos = await evalJs(`!!document.querySelector('[data-testid="terminos-b2b-previa"]')`);
  const hayError = await evalJs(`!!document.querySelector('[data-testid="previa-error"]')`);
  paso("la revisión de términos responde (liquidación o error explícito del servidor)", hayTerminos || hayError, hayTerminos ? "liquidación" : "error explícito");
  if (hayError) paso("con error de liquidación el botón Generar queda bloqueado", await evalJs(`[...document.querySelectorAll('button')].find((b) => /Generar cotización/.test(b.textContent)).disabled === true`));
  await foto("formulario-venta-asistida");
  const seleccion = await evalJs(`(() => { const s = [...document.querySelectorAll('section')].find((x) => /Tu selección/.test(x.textContent)); return s ? s.textContent : ''; })()`);
  paso("«Tu selección» (lo que ve el cliente) no nombra el recobro", !/recobro/i.test(seleccion));

  // NETO de la venta asistida SÍ admite recobro; el panel sigue.
  await clickBoton("NETO");
  await espera(500);
  paso("venta asistida en NETO sigue ofreciendo recobro", await evalJs(`!!document.querySelector('[data-testid="recobro-panel"]')`));
  informe.texto = (await texto()).slice(0, 4000);
} catch (e) {
  informe.errores.push(String(e?.message ?? e));
}
fs.writeFileSync(`${SALIDA}/informe-formulario.json`, JSON.stringify(informe, null, 1));
proc.kill();
console.log(`formulario: ${informe.pasos.filter((p) => p.ok).length}/${informe.pasos.length} pasos OK${informe.errores.length ? " · ERRORES: " + informe.errores.join(" | ") : ""}`);
process.exit(informe.errores.length ? 1 : 0);
