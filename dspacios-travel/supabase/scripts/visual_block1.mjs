// VISUAL + PDF inspection of the COMPILED app for block 1 (Codex F4): launched by recorrido_block1.sh with RB1_SCRIPT=supabase/scripts/visual_block1.mjs
// (which prepares the disposable DB + PostgREST and applies fixture + semilla_visual_block1.sql). The app is the production build (`next start`) whose
// NEXT_PUBLIC_SUPABASE_URL points at this script's proxy (127.0.0.1:54399/__): REST goes to the throwaway PostgREST, /auth/v1/user is a minimal GoTrue.
// Edge headless is driven over CDP (no dependencies). Output: PNG per page × width, PDFs, and visual_block1.json with the measurements.
import { createHmac } from "node:crypto";
import { execSync, spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const REST = process.env.RB1_REST, SECRETO = process.env.RB1_SECRETO, PS = process.env.RB1_PS, SALIDA = process.env.RB1_SALIDA || "docs/tecnico/evidence-block1-r2";
const OUT = path.join(SALIDA, "visual"); fs.mkdirSync(OUT, { recursive: true });
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const APP = "http://127.0.0.1:3099", PUERTO_PROXY = 54399;
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 7200 }));
  return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const U = (n) => `00000000-0000-4000-8000-00000000b${n}`, S = (n) => `00000000-0000-4000-8000-00000000c${n}`;
const USUARIOS = { ADMIN: { n: "103", email: "b1-admin@x.test" }, VENTA_DUENO: { n: "104", email: "b1-venta-dueno@x.test" }, CONTROL_VUELO: { n: "106", email: "b1-control-vuelo@x.test" } };
for (const u of Object.values(USUARIOS)) u.id = U(u.n);
const ANON = jwt({ role: "anon" }), SERVICE = jwt({ role: "service_role" });
const sql = (q) => execSync(`${PS} -c "${q.replace(/\s*\n\s*/g, " ").replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const medidas = []; let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };

// ── proxy: REST passthrough (anon key swapped for a valid JWT) + minimal GoTrue ──
const destino = new URL(REST);
const proxy = http.createServer((req, res) => {
  if (req.url.startsWith("/__/auth/v1/user")) {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer /i, "");
    let sub = null; try { sub = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString()).sub; } catch { /* anon */ }
    const u = Object.values(USUARIOS).find((x) => x.id === sub);
    if (!u) { res.writeHead(401, { "content-type": "application/json" }); res.end("{}"); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: {} })); return;
  }
  const ruta = req.url.replace(/^\/__\/rest\/v1/, "").replace(/^\/__/, "") || "/";
  const headers = { ...req.headers, host: destino.host };
  if (headers.authorization === "Bearer anon-local-block1") headers.authorization = `Bearer ${ANON}`;
  if (headers.apikey === "anon-local-block1") headers.apikey = ANON;
  const p = http.request({ host: destino.hostname, port: destino.port, path: ruta, method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
});
proxy.keepAliveTimeout = 65_000;
await new Promise((ok2) => proxy.listen(PUERTO_PROXY, "127.0.0.1", ok2));

// ── the compiled app ──
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3099", "-H", "127.0.0.1"], {
  env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=1024", NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PUERTO_PROXY}/__`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-local-block1", SUPABASE_SERVICE_ROLE_KEY: SERVICE, PORT: "3099" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logApp = ""; app.stdout.on("data", (d) => (logApp += d)); app.stderr.on("data", (d) => (logApp += d));
const limpiar = () => { try { app.kill(); } catch { /* gone */ } try { proxy.close(); } catch { /* gone */ } try { edge?.kill(); } catch { /* gone */ } };
process.on("exit", limpiar);
for (let i = 0; i < 60; i++) { try { const r = await fetch(`${APP}/login`, { redirect: "manual" }); if (r.status < 500) break; } catch { /* not yet */ } await dormir(500); }
console.log("compiled app answering on", APP, "· BUILD_ID", fs.readFileSync(".next/BUILD_ID", "utf8"));

// ── Edge over CDP ──
const perfil = fs.mkdtempSync(path.join(process.env.TEMP || ".", "edge-b1-"));
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--remote-debugging-port=9244", `--user-data-dir=${perfil}`, "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { const r = await fetch("http://127.0.0.1:9244/json/version"); if (r.ok) break; } catch { /* not yet */ } await dormir(250); }

async function pestana(quien) {
  const t = await (await fetch(`http://127.0.0.1:9244/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const eventos = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method) eventos.push(d); };
  const cmd = (method, params = {}) => new Promise((res) => { const n = ++id; pend.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  await cmd("Page.enable"); await cmd("Runtime.enable"); await cmd("Network.enable");
  // All tabs of one Edge profile SHARE the cookie jar: each tab re-asserts ITS user's session before every navigation (otherwise the last tab created wins).
  const fijarSesion = async () => {
    if (!quien) { await cmd("Network.deleteCookies", { name: "sb-127-auth-token", url: APP }); return; }
    const u = USUARIOS[quien];
    const token = jwt({ role: "authenticated", sub: u.id, session_id: S(u.n), aud: "authenticated" });
    const sesion = JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, refresh_token: "x", user: { id: u.id, aud: "authenticated", role: "authenticated" } });
    await cmd("Network.setCookie", { name: "sb-127-auth-token", value: "base64-" + Buffer.from(sesion).toString("base64url"), url: APP });
  };
  await fijarSesion();
  const api = {
    cmd, eventos,
    async ir(url, esperaMs = 2500) {
      await cmd("Page.bringToFront"); await fijarSesion(); await api.vista(1280); eventos.length = 0; await cmd("Page.navigate", { url });
      const t0 = Date.now(); while (Date.now() - t0 < 30000 && !eventos.some((e) => e.method === "Page.loadEventFired")) await dormir(150);
      await dormir(esperaMs);
    },
    async eval(expr) { const r = await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) return `__ERROR__ ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`; return r.result?.result?.value; },
    async texto() { for (let i = 0; i < 10; i++) { await cmd("Page.bringToFront"); const t = await api.eval("document.body ? (document.body.innerText || document.body.textContent) : ''"); if (typeof t === 'string' && t.length > 40) return t; await dormir(500); } return ''; },
    async vista(ancho, alto = 900) { await cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: 1, mobile: ancho < 600 }); await dormir(400); },
    async captura(nombre, ancho) {
      await cmd("Page.bringToFront");
      await api.vista(ancho);
      const m = await cmd("Page.getLayoutMetrics");
      const alto = Math.min(6000, Math.ceil(m.result?.cssContentSize?.height ?? 900));
      await cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: 1, mobile: ancho < 600 }); await dormir(400);
      const s = await cmd("Page.captureScreenshot", { format: "png" });
      const archivo = path.join(OUT, `${nombre}-${ancho}.png`); fs.writeFileSync(archivo, Buffer.from(s.result.data, "base64"));
      const dim = await api.eval("({sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth})");
      const med = { nombre, ancho, archivo, alto, scrollWidth: dim?.sw, innerWidth: dim?.iw, desbordaHorizontal: (dim?.sw ?? 0) > (dim?.iw ?? 0) + 1 }; medidas.push(med); return med;
    },
    async pdf(nombre) {
      const r = await cmd("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
      const archivo = path.join(OUT, `${nombre}.pdf`); const buf = Buffer.from(r.result.data, "base64"); fs.writeFileSync(archivo, buf);
      const paginas = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length; medidas.push({ nombre: `${nombre}.pdf`, paginas }); return paginas;
    },
    errores() { return eventos.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => e.params?.exceptionDetails?.exception?.description ?? e.params?.exceptionDetails?.text).slice(0, 5); },
    async cerrar() { ws.close(); await fetch(`http://127.0.0.1:9244/json/close/${t.id}`).catch(() => {}); },
  };
  return api;
}
const ANCHOS = [1280, 820, 390];

// ── 1. contract page as administración: generate the air voucher through the REAL button of the compiled app ──
const admin = await pestana("ADMIN");
const tokens = {};
for (const n of ["DTM-9701", "DTM-9702", "DTM-9703"]) {
  await admin.vista(1280);
  await admin.ir(`${APP}/dashboard/contratos/${n}`, 3500);
  const clic = await admin.eval(`(() => { const b = document.querySelector('[data-testid="generar-voucher-vuelo"]'); if (!b) return 'sin boton'; if (b.disabled) return 'deshabilitado'; b.click(); return 'ok'; })()`);
  await dormir(4000);
  tokens[n] = sql(`select share_token from public.vouchers where numero_contrato = '${n}' and tipo = 'vuelo'`);
  ok(clic === "ok" && !!tokens[n], `${n}: real "Voucher de vuelo" button of the compiled page created the voucher (${clic}; token ${tokens[n] ? "present" : "MISSING"})`);
  if (n === "DTM-9701") {
    for (const a of ANCHOS) { await admin.ir(`${APP}/dashboard/contratos/${n}`, 3000); const med = await admin.captura(`contrato-${n}`, a); ok(!med.desbordaHorizontal, `contract page ${n} @${a}px: no horizontal overflow (${med.scrollWidth}/${med.innerWidth})`); }
  }
}

if (process.env.RB1_DEBUG === "1") {
  const rest = async (ruta, jwtToken) => { const r = await fetch(`http://127.0.0.1:${PUERTO_PROXY}/__/rest/v1/${ruta}`, { headers: { authorization: `Bearer ${jwtToken}`, apikey: jwtToken } }); return `${r.status} ${(await r.text()).slice(0, 300)}`; };
  console.log("DEBUG usuarios (service):", await rest(`usuarios?select=rol,tenant,nombre,activo,aliado_id,acceso_legacy_nombre&id=eq.${USUARIOS.ADMIN.id}`, SERVICE));
  console.log("DEBUG voucher (service):", await rest(`vouchers?select=id,numero_contrato,tipo&share_token=eq.${tokens["DTM-9701"]}`, SERVICE));
  console.log("DEBUG ventas (service):", await rest(`ventas?select=tenant,b2b_usuario_id,aliado_id,agencia_nombre,freelance_nombre&numero_contrato=eq.DTM-9701`, SERVICE));
  const uTok = jwt({ role: "authenticated", sub: USUARIOS.ADMIN.id, session_id: S(USUARIOS.ADMIN.n), aud: "authenticated" });
  console.log("DEBUG voucher (admin session):", await rest(`vouchers?select=id&share_token=eq.${tokens["DTM-9701"]}`, uTok));
  await admin.ir(`${APP}/voucher/${tokens["DTM-9701"]}`, 2500);
  console.log("DEBUG página:", JSON.stringify((await admin.texto()).slice(0, 200)));
  console.log("DEBUG logApp:", logApp.slice(-1500));
  limpiar(); process.exit(0);
}

// ── 2. link to the editor + navigation, per eligibility ──
const enlace = async (pest, n) => { await pest.ir(`${APP}/dashboard/contratos/${n}`, 3000); return pest.eval(`(() => { const a = document.querySelector('[data-testid="enlace-editor-vuelos"]'); return a ? a.getAttribute('href') : null; })()`); };
const href9701 = await enlace(admin, "DTM-9701");
ok(href9701 === "/dashboard/vuelos/contrato/DTM-9701", `administración sees the editor link on the dynamic contract with saved legs (${href9701})`);
ok((await enlace(admin, "DTM-9702")) !== null, "saved legs but no airline/times (9702): link present (same predicate as the list/editor)");
ok((await enlace(admin, "DTM-9704")) === null, "land-only contract (9704): NO link");
await admin.ir(`${APP}/dashboard/contratos/DTM-9701`, 3000);
await admin.eval(`document.querySelector('[data-testid="enlace-editor-vuelos"]').click()`);
await dormir(4500);
const urlEditor = await admin.eval("location.pathname"), h1 = await admin.eval("document.querySelector('h1')?.textContent ?? ''");
ok(urlEditor === "/dashboard/vuelos/contrato/DTM-9701" && /DTM-9701/.test(h1), `clicking the link navigates to the operational editor (${urlEditor}, h1 "${h1}")`);
for (const a of ANCHOS) { const med = await admin.captura("editor-vuelos-DTM-9701", a); ok(!med.desbordaHorizontal, `editor @${a}px: no horizontal overflow (${med.scrollWidth}/${med.innerWidth})`); }
const cv = await pestana("CONTROL_VUELO");
await cv.ir(`${APP}/dashboard/vuelos/contrato/DTM-9701`, 3500);
ok(/DTM-9701/.test(await cv.eval("document.querySelector('h1')?.textContent ?? ''")), "control_vuelo opens the editor directly");
const venta = await pestana("VENTA_DUENO");
ok((await enlace(venta, "DTM-9705")) === null, "venta (owner of 9705): the editor link is NOT offered");
await venta.ir(`${APP}/dashboard/contratos/DTM-9705`, 3000);
medidas.push(await venta.captura("contrato-venta-DTM-9705", 1280));

// ── 3. the public voucher page, 3 variants × 3 widths + PDF pages ──
const pub = await pestana(null);
for (const n of ["DTM-9701", "DTM-9702", "DTM-9703"]) {
  const url = `${APP}/voucher/${tokens[n]}`;
  // The page requires a session (#53): internal staff may open it (preview). Use administración.
  for (const a of ANCHOS) {
    await admin.ir(url, 2500);
    const med = await admin.captura(`voucher-vuelo-${n}`, a);
    ok(!med.desbordaHorizontal, `voucher ${n} @${a}px: no horizontal overflow (${med.scrollWidth}/${med.innerWidth})`);
  }
  await admin.ir(url, 2500);
  const texto = await admin.texto();
  console.log(`   ${n}: page text length ${texto.length}: ${JSON.stringify(texto.slice(0, 120))}`);
  ok(!/PNR\d{4}/.test(texto), `voucher ${n}: the PNR is not on the page`);
  ok(!/aplican a la reserva completa/i.test(texto) && /no hay registrada una asignación de pasajero a tramo/i.test(texto), `voucher ${n}: no claim that every passenger flies every segment; separate-lists note present`);
  const faltan = (texto.match(/No registrado/g) ?? []).length;
  console.log(`   ${n}: 'No registrado' ×${faltan}`);
  if (n === "DTM-9702") ok(faltan >= 8, "9702 (missing data): every absent value is shown explicitly as 'No registrado'");
  if (n === "DTM-9701") ok(/AV123/.test(texto) && /08:15/.test(texto) && /María Pérez/.test(texto), "9701: saved legs, times and passengers are printed");
  const pg = await admin.pdf(`voucher-vuelo-${n}`);
  console.log(`   ${n}: PDF pages = ${pg}`);
  ok(pg >= 1 && pg <= (n === "DTM-9703" ? 4 : 2), `voucher ${n}: ${pg} PDF page(s)`);
}

// ── 4. #17 documents: contract (no flight numbers/times) vs quotation (HH:mm + notice) ──
const tokContrato = sql("select share_token from public.ventas where numero_contrato = 'DTM-9701'");
await pub.ir(`${APP}/c/${tokContrato}`, 3000);
const tc = await pub.texto();
ok(/María Fernanda Pérez/.test(tc) && /CARTAGENA/.test(tc), "contract document /c/<token> actually rendered (client and destination present)");
ok(!/AV123/.test(tc) && !/08:15/.test(tc) && !/PNR9701/.test(tc), "contract document /c/<token>: NO flight number, times or PNR");
medidas.push(await pub.captura("contrato-documento-DTM-9701", 1280)); console.log("   contract document PDF pages:", await pub.pdf("contrato-documento-DTM-9701"));
await pub.ir(`${APP}/cot/11111111-1111-4111-8111-111111111111`, 3000);
const tq = await pub.texto();
ok(/Cliente Cotización/.test(tq), "quotation /cot/<token> actually rendered");
ok(/AV123/.test(tq) && /08:15/.test(tq) && /09:45/.test(tq), "quotation /cot/<token>: flight number and HH:mm times ARE shown");
ok((tq.match(/sujetos a cambio|sujeto a cambio/gi) ?? []).length <= 2, "quotation: the flight-change notice is not repeated per leg");
for (const a of ANCHOS) { const med = await pub.captura("cotizacion-documento", a); ok(!med.desbordaHorizontal, `quotation @${a}px: no horizontal overflow`); }
console.log("   quotation PDF pages:", await pub.pdf("cotizacion-documento"));

// ── 5. destination delete modal ──
const abrirModal = async (id) => {
  await admin.ir(`${APP}/dashboard/producto/destinos`, 5000);
  console.log(`   click ${id}:`, await admin.eval(`(() => { const b = document.querySelector('[data-destino-tarjeta="${id}"] button[aria-label="Eliminar destino"]'); if (!b) return 'sin boton'; b.click(); return 'ok'; })()`));
  for (let i = 0; i < 4; i++) {
    await dormir(2500);
    if (await admin.eval("!!document.querySelector('[data-uso-destino]')")) break;
    await admin.eval(`(() => { const b = document.querySelector('[data-destino-tarjeta="${id}"] button[aria-label="Eliminar destino"]'); if (b) b.click(); })()`);
  }
  await dormir(1500);
  return admin.eval(`(() => { const u = document.querySelector('[data-uso-destino]'); return u ? '[modo=' + u.getAttribute('data-modo-eliminacion') + '] ' + (u.closest('.fixed')?.innerText ?? u.innerText) : ''; })()`);
};
const modalAlt = await abrirModal(9405);
console.log("   modal (alternative-only destination):", JSON.stringify(modalAlt).slice(0, 400));
ok(/alternativ/i.test(modalAlt), "the delete modal of a destination used only as an alternative air destination REPORTS that use");
ok(/fusion|mover|a qué destino|destino de llegada/i.test(modalAlt), "…and asks for a destination to merge into instead of offering a plain delete");
for (const a of ANCHOS) { await admin.vista(a); await dormir(500); const med = await admin.captura("modal-eliminar-destino-alternativo", a); ok(!med.desbordaHorizontal, `delete modal @${a}px: no horizontal overflow`); }
const modalLibre = await abrirModal(9406);
ok(!/alternativ/i.test(modalLibre), "a destination with no use: plain-delete modal (no alternatives text)");
medidas.push(await admin.captura("modal-eliminar-destino-sin-uso", 1280));

fs.writeFileSync(path.join(OUT, "visual_block1.json"), JSON.stringify({ build: fs.readFileSync(".next/BUILD_ID", "utf8"), medidas, erroresPagina: admin.errores() }, null, 1));
console.log(`\n=== ${fallos} fallo(s); ${medidas.length} measurements in ${OUT}`);
console.log("--- server log tail ---\n" + logApp.slice(-2500));
limpiar();
process.exit(fallos ? 1 : 0);
