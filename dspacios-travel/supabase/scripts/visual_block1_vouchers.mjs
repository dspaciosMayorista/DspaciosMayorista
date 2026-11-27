// VISUAL + PDF inspection of the COMPILED app for the ADL-041/042 amendments (PNR per leg on the paid air voucher, one voucher per CONTRACTED service independent of the PNR, issued links through their transitions, «updated» signal in Gestión de contratos).
// Derived from visual_block1.mjs (same harness); launched by recorrido_block1.sh with RB1_SCRIPT=supabase/scripts/visual_block1_vouchers.mjs RB1_SEMILLA=supabase/scripts/semilla_visual_block1_vouchers.sql
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
const USUARIOS = { SUPER: { n: "108", email: "b1-super@x.test" }, ALIADO: { n: "109", email: "b1-aliado@x.test" }, ADMIN: { n: "103", email: "b1-admin@x.test" }, VENTA_DUENO: { n: "104", email: "b1-venta-dueno@x.test" }, CONTROL_VUELO: { n: "106", email: "b1-control-vuelo@x.test" } };
for (const u of Object.values(USUARIOS)) u.id = U(u.n);
const ANON = jwt({ role: "anon" }), SERVICE = jwt({ role: "service_role" });
const sql = (q) => execSync(`${PS} -c "${q.replace(/\s*\n\s*/g, " ").replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const medidas = []; let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };

// ── proxy: REST passthrough (anon key swapped for a valid JWT) + minimal GoTrue ──
const destino = new URL(REST);
globalThis.__conteo = {}; // request counter at the proxy: METHOD + first two path segments (measurement of added requests)
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
  { const k = `${req.method} /${ruta.split("?")[0].split("/").slice(1, 3).join("/")}`; globalThis.__conteo[k] = (globalThis.__conteo[k] ?? 0) + 1; }
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
const admin = await pestana("ADMIN");
const aliado = await pestana("ALIADO");
const superad = await pestana("SUPER");
const claves = (n) => sql(`select servicio_clave || ':' || share_token from public.vouchers where numero_contrato = '${n}' and tipo = 'vuelo' order by id`).split("\n").filter(Boolean).map((l) => l.split(":"));
const rev = (n) => sql(`select string_agg(revision::text, ',' order by id) from public.vouchers where numero_contrato = '${n}' and tipo = 'vuelo'`);
const clicGenerar = async (n) => {
  await admin.ir(`${APP}/dashboard/contratos/${n}`, 3500);
  const clic = await admin.eval(`(() => { const b = document.querySelector('[data-testid="generar-voucher-vuelo"]'); if (!b) return 'sin boton'; if (b.disabled) return 'deshabilitado'; b.click(); return 'ok'; })()`);
  await dormir(4500);
  return clic;
};
const rest = () => ({ ...globalThis.__conteo });
const delta = (a, b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v - (a[k] ?? 0)]).filter(([, v]) => v));
const peticiones = [];
const medirPagina = async (pest, etiqueta, url) => { const a = rest(); await pest.ir(url, 2500); const d = delta(a, rest()); const total = Object.values(d).reduce((s, v) => s + v, 0); peticiones.push({ etiqueta, total, porTipo: d }); console.log(`   requests [${etiqueta}]: ${total} ${JSON.stringify(d)}`); return d; };

// ── 1. REAL button of the compiled contract page generates the air voucher(s) ──
const nVouchers = {};
for (const n of ["DTM-9801", "DTM-9802", "DTM-9803", "DTM-9804", "DTM-9805"]) {
  const clic = await clicGenerar(n);
  nVouchers[n] = claves(n);
  ok(clic === "ok" && nVouchers[n].length === (n === "DTM-9803" || n === "DTM-9805" ? 2 : 1), `${n}: the real "Voucher de vuelo" button created ${nVouchers[n].length} air voucher(s) (${clic})`);
}
ok(new Set(nVouchers["DTM-9803"].map((c) => c[1])).size === 2, "DTM-9803 (two saved services, 3 passengers): two vouchers with DISTINCT public links — never one per passenger");
ok(new Set(nVouchers["DTM-9805"].map((c) => c[1])).size === 2, "DTM-9805: two services that share the SAME PNR (SAME00) stay TWO vouchers — the PNR does not define the service");

console.log("\n-- contract page: the two services are listed separately");
for (const a of ANCHOS) { await admin.ir(`${APP}/dashboard/contratos/DTM-9803`, 3000); const med = await admin.captura("contrato-DTM-9803-dos-servicios", a); ok(!med.desbordaHorizontal, `contract page 9803 @${a}px: no horizontal overflow (${med.scrollWidth}/${med.innerWidth})`); }
const rutas = await admin.eval(`Array.from(document.querySelectorAll('[data-testid="voucher-vuelo-ruta"]')).map((e) => e.textContent)`);
ok(Array.isArray(rutas) && rutas.length === 2 && rutas[0] !== rutas[1], `the panel shows one card per service with its own route (${JSON.stringify(rutas)})`);

// ── 2. the ally opens the PAID voucher with the PNR; the unpaid one is a 404 ──
console.log("\n-- ally, paid contract (9801)");
const t9801 = nVouchers["DTM-9801"][0][1], t9802 = nVouchers["DTM-9802"][0][1], t9804 = nVouchers["DTM-9804"][0][1];
const dAliado = await medirPagina(aliado, "ally opens paid voucher 9801", `${APP}/voucher/${t9801}`);
const txtA = await aliado.texto();
ok(/ABC123/.test(txtA) && /PNR \/ C.DIGO DE RESERVA/i.test(txtA), "paid + saved PNR: the ally sees the PNR on the voucher (label is rendered upper-case by CSS)");
ok(!(dAliado["POST /rpc/contratos_pagados_completos"] > 1), `the ally view adds no payment lookup beyond the existing access check (${dAliado["POST /rpc/contratos_pagados_completos"] ?? 0})`);
for (const a of ANCHOS) { await aliado.ir(`${APP}/voucher/${t9801}`, 2500); const med = await aliado.captura("voucher-vuelo-pnr-aliado-DTM-9801", a); ok(!med.desbordaHorizontal, `voucher 9801 (ally, PNR) @${a}px: no horizontal overflow (${med.scrollWidth}/${med.innerWidth})`); }
await aliado.ir(`${APP}/voucher/${t9801}`, 2500);
const pgA = await aliado.pdf("voucher-vuelo-pnr-aliado-DTM-9801"); ok(pgA >= 1 && pgA <= 2, `voucher 9801 with PNR: ${pgA} PDF page(s)`);
await aliado.ir(`${APP}/voucher/${t9802}`, 2500);
const txtA2 = await aliado.texto();
console.log("   ally on the unpaid voucher, page text:", JSON.stringify(txtA2.slice(0, 160)));
ok(!/AV223|Cliente sin pago|Ana Ruiz|SECRET9802/.test(txtA2) && !/Servicio a.reo/i.test(txtA2), "unpaid contract (9802): the ally gets NO voucher content (the 404 page: no legs, no passengers, no PNR)");

// ── 3. internal preview of the UNPAID contract: no PNR anywhere in the page, internal note only ──
console.log("\n-- internal preview, unpaid contract (9802)");
await medirPagina(admin, "admin opens unpaid voucher 9802 (has PNR)", `${APP}/voucher/${t9802}`);
const htmlI = await admin.eval("document.documentElement.outerHTML");
const txtI = await admin.texto();
ok(!/SECRET9802/.test(htmlI) && !/SECRET9802/.test(txtI), "the PNR is not in the page text NOR in its HTML/RSC payload (it never leaves the server)");
ok(/se mostrará en el voucher cuando el contrato esté 100 % pagado/.test(txtI), "the internal note explains why the PNR is not shown");
await admin.cmd("Emulation.setEmulatedMedia", { media: "print" });
const notaImprime = await admin.eval(`(() => { const e = document.querySelector('[data-testid="pnr-pendiente-pago"]'); return e ? getComputedStyle(e).display : 'sin nota'; })()`);
await admin.cmd("Emulation.setEmulatedMedia", { media: "screen" });
ok(notaImprime === "none", `the note is not printed (display in print = ${notaImprime})`);
for (const a of ANCHOS) { await admin.ir(`${APP}/voucher/${t9802}`, 2500); const med = await admin.captura("voucher-vuelo-impago-interno-DTM-9802", a); ok(!med.desbordaHorizontal, `voucher 9802 (internal, unpaid) @${a}px: no horizontal overflow`); }

// ── 4. no PNR saved: the voucher exists and looks complete ──
console.log("\n-- generation without a saved PNR (9804)");
const d9804 = await medirPagina(admin, "admin opens voucher 9804 (no PNR)", `${APP}/voucher/${t9804}`);
const txt4 = await admin.texto();
console.log("   9804 text:", JSON.stringify(txt4.slice(0, 700)));
ok(/AV501/.test(txt4) && !/PNR/i.test(txt4) && (txt4.match(/No registrado/g) ?? []).length === 2, `9804: the voucher renders with its legs, NO PNR cell, and the only «No registrado» are the two baggage values (${(txt4.match(/No registrado/g) ?? []).length}) — the absent PNR is not reported as a missing datum`);
ok(!(d9804["POST /rpc/contratos_pagados_completos"]), "no PNR → no payment lookup for the internal preview (zero added requests)");
for (const a of ANCHOS) { await admin.ir(`${APP}/voucher/${t9804}`, 2500); const med = await admin.captura("voucher-vuelo-sin-pnr-DTM-9804", a); ok(!med.desbordaHorizontal, `voucher 9804 @${a}px: no horizontal overflow`); }

// ── 5. two services: each voucher has ITS legs and ITS PNR; internal preview of a PAID contract shows the PNR ──
console.log("\n-- two services (9803, paid)");
const dI = await medirPagina(admin, "admin opens paid voucher with PNR (9803 #1)", `${APP}/voucher/${nVouchers["DTM-9803"][0][1]}`);
console.log(`   internal preview of a paid PNR voucher adds: ${dI["POST /rpc/contratos_pagados_completos"] ?? 0} payment lookup(s)`);
for (const [i, [clave, tok]] of nVouchers["DTM-9803"].entries()) {
  await admin.ir(`${APP}/voucher/${tok}`, 2500);
  const t = await admin.texto();
  const propio = i === 0 ? ["AAA111", "ZZZ999", "AV301", "AV302"] : ["BBB222", "LA401", "LA402"], ajeno = i === 0 ? ["BBB222", "LA401", "LA402"] : ["AAA111", "ZZZ999", "AV301", "AV302"];
  ok(propio.every((x) => t.includes(x)) && ajeno.every((x) => !t.includes(x)), `service ${i + 1} (key ${clave}): shows only ITS PNR and legs (${propio.join(", ")}), none of the other service`);
  ok(/Carla Mora/.test(t) && /Juan Mora/.test(t) && /Eva Mora/.test(t) && /no hay registrada una asignación de pasajero a tramo/.test(t), `service ${i + 1}: the 3 contract passengers are listed once; the note says no passenger-to-segment assignment is registered`);
  for (const a of ANCHOS) { await admin.ir(`${APP}/voucher/${tok}`, 2500); const med = await admin.captura(`voucher-vuelo-servicio${i + 1}-DTM-9803`, a); ok(!med.desbordaHorizontal, `voucher 9803 service ${i + 1} @${a}px: no horizontal overflow`); }
  await admin.ir(`${APP}/voucher/${tok}`, 2500);
  const pg = await admin.pdf(`voucher-vuelo-servicio${i + 1}-DTM-9803`); ok(pg >= 1 && pg <= 2, `voucher 9803 service ${i + 1}: ${pg} PDF page(s)`);
}

// ── 6. Gestión de contratos: the internal «updated» signal ──
console.log("\n-- Gestión de contratos signal");
const antesRev = rev("DTM-9803");
sql(`insert into public.contrato_seguimiento (numero_contrato, contrato_uid, tenant, tipo, accion, canal, referencia, actor_id, actor_email, actor_nombre)
  select numero_contrato, contrato_uid, tenant, 'voucher_entregado', 'marcar', 'correo', jsonb_build_object('n', 2, 'max_id', (select max(id) from public.vouchers where numero_contrato = 'DTM-9803'), 'rev', 0), '${USUARIOS.SUPER.id}', 'b1-super@x.test', 'B1 Superadmin'
    from public.ventas where numero_contrato = 'DTM-9803'`);
await superad.ir(`${APP}/dashboard/gestion-contratos?numero=DTM-9803`, 4000);
const g0 = await superad.texto();
const cuenta = (s) => (s.match(/Entrega registrada manualmente/g) ?? []).length;
ok(cuenta(g0) >= 2 && !/Voucher actualizado/.test(g0), "before any change: the registered delivery shows as registered (manual acknowledgment), no «updated» signal");
sql("update public.contrato_vuelos set hora_salida = '10:30' where numero_contrato = 'DTM-9803' and numero_vuelo = 'LA401'");
await superad.ir(`${APP}/dashboard/gestion-contratos?numero=DTM-9803`, 4000);
const gPre = await superad.texto();
ok(/Voucher actualizado: comunicación pendiente/.test(gPre) && /vuelo desactualizado/.test(gPre), "the leg change ALONE (before anyone regenerates) already shows «Voucher actualizado: comunicación pendiente» and «vuelo desactualizado» in Gestión");
await admin.ir(`${APP}/dashboard/contratos/DTM-9803`, 3500);
const tpPre = await admin.texto();
ok(/Desactualizado: volver a generar/i.test(tpPre), "the contract page marks the affected service «Desactualizado: volver a generar» before regenerating");
ok((await clicGenerar("DTM-9803")) === "ok" && rev("DTM-9803") !== antesRev, `the real button regenerated 9803 after a real change: revisions ${antesRev} → ${rev("DTM-9803")}`);
const idsAntes = nVouchers["DTM-9803"].map((c) => c.join(":")).join("|");
ok(claves("DTM-9803").map((c) => c.join(":")).join("|") === idsAntes, "both public links are exactly the same as before the regeneration");
const revTras = rev("DTM-9803");
await clicGenerar("DTM-9803");
ok(rev("DTM-9803") === revTras, `pressing the real button again with no change adds nothing (revisions stay ${revTras})`);
await admin.ir(`${APP}/dashboard/contratos/DTM-9803`, 3500);
const tp = await admin.texto();
ok(/Actualizado \(2\)/.test(tp), "the contract page marks ONLY the changed service as «Actualizado (2)» (one change flagged it, one regenerated it)");
ok((tp.match(/Actualizado \(/g) ?? []).length === 1, "…and exactly one card carries the mark");
await superad.ir(`${APP}/dashboard/gestion-contratos?numero=DTM-9803`, 4000);
const g1 = await superad.texto();
ok(/Voucher actualizado: comunicación pendiente/.test(g1), "Gestión de contratos shows «Voucher actualizado: comunicación pendiente»");
ok(cuenta(g1) === cuenta(g0) - 1, `…and the row no longer presents the earlier delivery as current (the phrase remains only in the page legend: ${cuenta(g0)} → ${cuenta(g1)})`);
ok(/no indica que el cliente haya recibido, leído ni aceptado/.test(g1), "…and says plainly that it is an internal signal, not proof about the customer");
for (const a of ANCHOS) { await superad.ir(`${APP}/dashboard/gestion-contratos?numero=DTM-9803`, 4000); const med = await superad.captura("gestion-voucher-actualizado-DTM-9803", a); ok(!med.desbordaHorizontal, `Gestión @${a}px: no horizontal overflow (${med.scrollWidth}/${med.innerWidth})`); }
await admin.ir(`${APP}/dashboard/gestion-contratos?numero=DTM-9803`, 3500);
ok(!/Voucher actualizado/.test(await admin.texto()), "administración cannot see Gestión (no signal, no data)");

// ── 7. the customer contract never shows the PNR ──
const pub = await pestana(null);
const tokContrato = sql("select share_token from public.ventas where numero_contrato = 'DTM-9801'");
await pub.ir(`${APP}/c/${tokContrato}`, 3000);
const tc = await pub.texto();
ok(/María Fernanda Pérez/.test(tc) && !/ABC123/.test(tc) && !/PNR/.test(tc), "customer contract /c/<token>: rendered, and NO PNR");
medidas.push(await pub.captura("contrato-documento-sin-pnr-DTM-9801", 1280));

// ── 8. an ISSUED link walks through the transitions (9806: paid ally contract, ONE service) ──
console.log("\n-- transitions of an issued link (9806)");
ok((await clicGenerar("DTM-9806")) === "ok" && claves("DTM-9806").length === 1, "9806: the real button generated the single air voucher");
const [[k6, t6]] = claves("DTM-9806");
await aliado.ir(`${APP}/voucher/${t6}`, 2500);
const v0 = await aliado.texto();
ok(/AV601/.test(v0) && /AV602/.test(v0) && /ZZZ601/.test(v0), "before any change the ally opens it: both legs and the PNR on each leg");
sql("delete from public.contrato_vuelos where numero_contrato = 'DTM-9806' and numero_vuelo = 'AV601'"); // the lowest-id («anchor») leg
await aliado.ir(`${APP}/voucher/${t6}`, 2500);
const v1 = await aliado.texto();
ok(/Voucher en actualización/.test(v1) && !/AV601|AV602|ZZZ601|Nora Vega|Iván Vega/.test(v1), "after the anchor leg was removed the OLD link shows «Voucher en actualización» to the ally: no old itinerary, no passengers, no PNR");
for (const a of ANCHOS) { await aliado.ir(`${APP}/voucher/${t6}`, 2500); const med = await aliado.captura("voucher-vuelo-en-actualizacion-aliado-DTM-9806", a); ok(!med.desbordaHorizontal, `not-current notice (ally) @${a}px: no horizontal overflow`); }
await admin.ir(`${APP}/voucher/${t6}`, 2500);
const v1i = await admin.texto();
ok(/Desactualizado: los vuelos del servicio cambiaron/.test(v1i) && /AV602/.test(v1i), "internal staff see the stale document WITH the explicit «Desactualizado» banner (not hidden, not current)");
await admin.cmd("Emulation.setEmulatedMedia", { media: "print" });
const bannerImprime = await admin.eval(`(() => { const e = document.querySelector('[data-testid="voucher-desactualizado"]'); return e ? getComputedStyle(e).display : 'sin banner'; })()`);
await admin.cmd("Emulation.setEmulatedMedia", { media: "screen" });
ok(bannerImprime !== "none" && bannerImprime !== "sin banner", `the banner IS printed, so a stale paper copy cannot pass as current (display in print = ${bannerImprime})`);
for (const a of ANCHOS) { await admin.ir(`${APP}/voucher/${t6}`, 2500); const med = await admin.captura("voucher-vuelo-desactualizado-interno-DTM-9806", a); ok(!med.desbordaHorizontal, `stale preview (internal) @${a}px: no horizontal overflow`); }
await admin.ir(`${APP}/dashboard/contratos/DTM-9806`, 3500);
ok(/Desactualizado: volver a generar/i.test(await admin.texto()), "the contract page flags the voucher «Desactualizado: volver a generar»");
ok((await clicGenerar("DTM-9806")) === "ok", "the staff regenerate with the real button");
ok(claves("DTM-9806").length === 1 && claves("DTM-9806")[0][1] === t6, "…the SAME link (same service) is kept");
await aliado.ir(`${APP}/voucher/${t6}`, 2500);
const v2 = await aliado.texto();
ok(/AV602/.test(v2) && !/AV601/.test(v2) && !/Voucher en actualización/.test(v2), "…and now it serves the UPDATED itinerary (only the remaining leg)");
sql("delete from public.contrato_vuelos where numero_contrato = 'DTM-9806'");
await aliado.ir(`${APP}/voucher/${t6}`, 2500);
const v3 = await aliado.texto();
ok(/Comunícate con tu asesor/.test(v3) && /Voucher retirado/.test(v3) && !/Voucher en actualización/.test(v3) && !/AV602|ZZZ601|Nora Vega/.test(v3), "when the whole service disappears the ally still gets NO itinerary (the link answers with the not-current notice)");
await admin.ir(`${APP}/voucher/${t6}`, 2500);
const v3i = await admin.texto();
ok(/Voucher retirado/.test(v3i) && !/AV602|ZZZ601|Nora Vega/.test(v3i), "internal staff see «Voucher retirado»: no itinerary of a service that no longer exists");
for (const a of ANCHOS) { await admin.ir(`${APP}/voucher/${t6}`, 2500); const med = await admin.captura("voucher-vuelo-retirado-interno-DTM-9806", a); ok(!med.desbordaHorizontal, `retired notice (internal) @${a}px: no horizontal overflow`); }
await admin.ir(`${APP}/dashboard/contratos/DTM-9806`, 3500);
const tr = await admin.texto();
ok(/Retirado \(servicio ya no existe\)/.test(tr), "the contract page keeps the retired voucher as history, labelled «Retirado (servicio ya no existe)»");
await superad.ir(`${APP}/dashboard/gestion-contratos?numero=DTM-9806`, 4000);
ok(/vuelo desactualizado/.test(await superad.texto()), "Gestión keeps reporting the retired air voucher as «vuelo desactualizado»");
for (const a of ANCHOS) { await superad.ir(`${APP}/dashboard/gestion-contratos?numero=DTM-9806`, 4000); const med = await superad.captura("gestion-vuelo-desactualizado-DTM-9806", a); ok(!med.desbordaHorizontal, `Gestión (retired) @${a}px: no horizontal overflow`); }

// ── 9. V5-2: a LEGACY single-row itinerary: any rendered legacy field invalidates the issued URL; regeneration restores the update at the SAME link ──
console.log("\n-- legacy single-row itinerary (9807)");
ok((await clicGenerar("DTM-9807")) === "ok" && claves("DTM-9807").length === 1, "9807: the real button generated the voucher from a legacy row");
const [[, t7]] = claves("DTM-9807");
await aliado.ir(`${APP}/voucher/${t7}`, 2500);
const l0 = await aliado.texto();
ok(/LG100/.test(l0) && /LG200/.test(l0) && /LEGPNR1/.test(l0), "before any change the ally sees both legs of the legacy row (LG100 out, LG200 back) and the PNR");
sql("update public.contrato_vuelos set vuelo_ida = 'LG111', hora_salida_reg = '20:00', fecha_regreso = '2027-06-12' where numero_contrato = 'DTM-9807'");
await aliado.ir(`${APP}/voucher/${t7}`, 2500);
const l1 = await aliado.texto();
ok(/Voucher en actualización/.test(l1) && !/LG100|LG200|LG111|LEGPNR1|Rosa Luna/.test(l1), "after a change of ONLY legacy fields (outbound flight number, return time, return date) the OLD link is non-current for the ally: no itinerary, no PNR, no passengers");
for (const a of ANCHOS) { await aliado.ir(`${APP}/voucher/${t7}`, 2500); const med = await aliado.captura("voucher-vuelo-heredado-en-actualizacion-aliado-DTM-9807", a); ok(!med.desbordaHorizontal, `legacy not-current notice (ally) @${a}px: no horizontal overflow`); }
await admin.ir(`${APP}/voucher/${t7}`, 2500);
const l1i = await admin.texto();
ok(/Desactualizado: los vuelos del servicio cambiaron/.test(l1i) && /LG100/.test(l1i), "staff see the stale document with the «Desactualizado» banner");
await admin.ir(`${APP}/dashboard/contratos/DTM-9807`, 3500);
ok(/Desactualizado: volver a generar/i.test(await admin.texto()), "the contract page flags the legacy voucher «Desactualizado: volver a generar»");
ok((await clicGenerar("DTM-9807")) === "ok" && claves("DTM-9807").length === 1 && claves("DTM-9807")[0][1] === t7, "regenerated with the real button: the SAME link");
await aliado.ir(`${APP}/voucher/${t7}`, 2500);
const l2 = await aliado.texto();
ok(/LG111/.test(l2) && /LG200/.test(l2) && !/LG100/.test(l2) && /20:00/.test(l2) && /12 de junio de 2027/.test(l2), "the same link now shows the UPDATED legacy values: outbound LG111, return 20:00, return date 12 de junio de 2027");
for (const a of ANCHOS) { await aliado.ir(`${APP}/voucher/${t7}`, 2500); const med = await aliado.captura("voucher-vuelo-heredado-actualizado-aliado-DTM-9807", a); ok(!med.desbordaHorizontal, `regenerated legacy voucher (ally) @${a}px: no horizontal overflow`); }
await aliado.ir(`${APP}/voucher/${t7}`, 2500);
const pgL = await aliado.pdf("voucher-vuelo-heredado-actualizado-aliado-DTM-9807"); ok(pgL >= 1 && pgL <= 2, `regenerated legacy voucher: ${pgL} PDF page(s)`);

fs.writeFileSync(path.join(OUT, "visual_vouchers_adl041.json"), JSON.stringify({ build: fs.readFileSync(".next/BUILD_ID", "utf8"), medidas, peticiones, erroresPagina: admin.errores() }, null, 1));
console.log(`\n=== ${fallos} fallo(s); ${medidas.length} measurements in ${OUT}`);
console.log("--- server log tail ---\n" + logApp.slice(-1500));
limpiar();
process.exit(fallos ? 1 : 0);
