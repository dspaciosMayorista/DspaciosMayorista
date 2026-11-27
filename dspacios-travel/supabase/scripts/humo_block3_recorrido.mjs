// RECORRIDO NAVEGADO del bloque 3 (#11 presencia reciente de personal y aliados, #13 avisos en la campana global sin correo con progreso por pasadas (B3-3), límite de presencia por identidad (B3-4), #36 estado de publicación + B3-1/B3-2) en la app COMPILADA (`next start`) con sesiones y base LOCALES
// (entorno_block3_local.sh en marcha, con su proxy que cuenta las llamadas y responde CORS). Se maneja Edge sin interfaz por CDP (WebSocket nativo de Node). Env: HUMO_SALIDA (carpeta con env.json). Escribe capturas e informe.json ahí.
import { spawn, execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";

const SALIDA = process.env.HUMO_SALIDA;
const ENV = JSON.parse(fs.readFileSync(`${SALIDA}/env.json`, "utf8"));
const { app: APP, secreto: SECRETO, db: DB, contenedor: CT } = ENV;
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PUERTO_CDP = 9292;
const U = { superadmin: "00000000-0000-0000-0000-000000000b01", gerencia: "00000000-0000-0000-0000-000000000b02", operaciones: "00000000-0000-0000-0000-000000000b03", venta: "00000000-0000-0000-0000-000000000b04", contabilidad: "00000000-0000-0000-0000-000000000b07", agencia: "00000000-0000-0000-0000-000000000b09", freelance: "00000000-0000-0000-0000-000000000b0a" };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 14400 })); return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const cookieDe = (uid) => {
  const t = jwt({ role: "authenticated", sub: uid, session_id: uid.replace(/^00000000/, "5e550000"), aud: "authenticated" });
  const s = JSON.stringify({ access_token: t, token_type: "bearer", expires_in: 14400, expires_at: Math.floor(Date.now() / 1000) + 14400, refresh_token: "x", user: { id: uid, aud: "authenticated", role: "authenticated", email: `${uid}@humo.test` } });
  return { name: "sb-127-auth-token", value: "base64-" + Buffer.from(s).toString("base64url") };
};
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();

fs.mkdirSync(SALIDA, { recursive: true });
const proc = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${PUERTO_CDP}`, `--user-data-dir=${SALIDA}/perfil`, "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/version`)).ok) break; } catch { /* aún no */ } await espera(250); }

async function pestana({ ancho = 1280, movil = false, uid = null } = {}) {
  const t = await (await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((ok) => (ws.onopen = ok));
  let id = 0; const pend = new Map(); const ev = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else ev.push(d); };
  const cmd = (method, params = {}) => new Promise((ok) => { const k = ++id; pend.set(k, ok); ws.send(JSON.stringify({ id: k, method, params })); });
  const js = async (expression) => { const r = await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
  await cmd("Page.enable"); await cmd("Network.enable"); await cmd("Runtime.enable");
  await cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: 900, deviceScaleFactor: 1, mobile: movil });
  await cmd("Network.clearBrowserCookies");
  if (uid) await cmd("Network.setCookie", { ...cookieDe(uid), url: APP });
  const p = {
    js, ev, cmd,
    ir: async (ruta) => { ev.length = 0; await cmd("Page.navigate", { url: ruta.startsWith("http") ? ruta : `${APP}${ruta}` }); const t0 = Date.now(); while (Date.now() - t0 < 30000 && !ev.some((e) => e.method === "Page.loadEventFired")) await espera(150); await espera(1200); },
    esperar: async (expr, que, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await js(expr)) return; } catch { /* navegando */ } await espera(250); } throw new Error(`tiempo agotado: ${que} · ${String(await js("document.body.innerText.replace(/\\s+/g,' ')").catch(() => "")).slice(0, 500)}`); },
    texto: () => js("document.body.innerText.replace(/\\s+/g, ' ')"),
    url: () => js("location.pathname + location.search"),
    desborda: () => js("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"),
    errores: () => ev.filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error")).map((e) => JSON.stringify(e.params).slice(0, 300)),
    posts: () => ev.filter((e) => e.method === "Network.requestWillBeSent" && e.params.request.method === "POST").length,
    foto: async (nombre) => { const m = await cmd("Page.getLayoutMetrics"); const h = Math.min(Math.ceil(m.result.cssContentSize.height), 4500); await cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: h, deviceScaleFactor: 1, mobile: movil }); await espera(300); const s = await cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${SALIDA}/${nombre}.png`, Buffer.from(s.result.data, "base64")); await cmd("Emulation.setDeviceMetricsOverride", { width: ancho, height: 900, deviceScaleFactor: 1, mobile: movil }); },
    poner: (sel, valor) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(valor)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`),
    ponerEnEtiqueta: (etiqueta, valor) => js(`(() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(etiqueta)})); const el = l && l.querySelector('input,textarea,select'); if (!el) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(valor)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`),
    clic: (texto) => js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => ${typeof texto === "string" ? `x.textContent.trim() === ${JSON.stringify(texto)}` : `${texto}.test(x.textContent)`}); if (!b) return false; b.click(); return true; })()`),
    cerrar: async () => { ws.close(); await fetch(`http://127.0.0.1:${PUERTO_CDP}/json/close/${t.id}`).catch(() => {}); },
  };
  return p;
}

const checks = [];
const check = (nombre, ok, detalle = "") => { checks.push({ nombre, ok: !!ok, detalle: String(detalle).slice(0, 300) }); console.log(`${ok ? "OK   " : "FALLA"} ${nombre}${ok ? "" : ` · ${String(detalle).slice(0, 300)}`}`); };

const ANCHOS = [["escritorio_1280", { ancho: 1280, movil: false }], ["intermedio_768", { ancho: 768, movil: false }], ["movil_390", { ancho: 390, movil: true }]];
const peticiones = (s) => s.ev.filter((e) => e.method === "Network.requestWillBeSent" && ["Fetch", "XHR"].includes(e.params.type)).length;

try {
  const proxy = async () => (await fetch("http://127.0.0.1:54481/__conteo")).json();
  const pings = async () => (await proxy())["POST /rpc/registrar_presencia"] ?? 0;
  const version = (n) => sql(`select coalesce(xmin::text, '') from public.presencia_usuario where usuario_id = '00000000-0000-0000-0000-000000000${n}'`);   // cambia SOLO con una escritura real de esa fila
  const visto = (n) => sql(`select coalesce(visto_en::text, '') from public.presencia_usuario where usuario_id = '00000000-0000-0000-0000-000000000${n}'`);
  const resembrar = () => sql(`delete from public.presencia_usuario where usuario_id <> '00000000-0000-0000-0000-000000000b03';
    insert into public.presencia_usuario (usuario_id, visto_en) select ('00000000-0000-0000-0000-000000000' || n)::uuid, now() - m * interval '1 minute' from (values ('b01', 3), ('b09', 4), ('b07', 8), ('b02', 120), ('b05', 1500), ('b0a', 4320)) v(n, m)`);
  const sinSesionPrevia = (s) => s.cmd("Storage.clearDataForOrigin", { origin: APP, storageTypes: "local_storage" });
  const campanaVisible = (s) => s.js(`(() => { const b = [...document.querySelectorAll('button[aria-label^="Avisos"]')].find((x) => x.offsetParent !== null); return b ? b.getAttribute('aria-label') : null; })()`);
  const abrirCampana = (s) => s.js(`(() => { const b = [...document.querySelectorAll('button[aria-label^="Avisos"]')].find((x) => x.offsetParent !== null); if (!b) return false; b.click(); return true; })()`);
  const panelCampana = (s) => s.js(`(() => { const r = document.querySelector('[role=region][aria-label=Avisos]'); if (!r) return null; const b = r.getBoundingClientRect(); return { dentro: b.left >= -1 && b.right <= window.innerWidth + 1, items: [...r.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), texto: a.innerText.replace(/\\s+/g, ' ') })) }; })()`);
  const esperaCampana = (s, re, ms = 40000) => s.esperar(`(() => { const b = [...document.querySelectorAll('button[aria-label^="Avisos"]')].find((x) => x.offsetParent !== null); return !!b && ${re}.test(b.getAttribute('aria-label')); })()`, "el contador de la campana", ms);
  const evento = (s, tipo) => s.js(`document.dispatchEvent(new ${tipo === "keydown" ? "KeyboardEvent('keydown', { key: 'a', bubbles: true })" : "PointerEvent('pointerdown', { bubbles: true })"})`);

  // ── 1. #11 · Presencia reciente (personal interno Y aliados), solo superadmin ───────────────────────────────────
  for (const [nombre, cfg] of ANCHOS) {
    resembrar();
    const esperadoB07 = sql(`select to_char(visto_en at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') from public.presencia_usuario where usuario_id = '${U.contabilidad}'`);
    const s = await pestana({ ...cfg, uid: U.superadmin });
    await s.ir("/dashboard");
    await s.esperar(`!!document.querySelector('[data-testid=actividad-reciente]')`, "el informe de presencia", 60000);
    const t = await s.texto();
    const filas = await s.js(`[...document.querySelectorAll('[data-testid=actividad-fila]')].map((f) => ({ nivel: f.dataset.nivel, rol: f.dataset.rol, texto: f.innerText.replace(/\\s+/g, ' '), dentro: f.getBoundingClientRect().right <= window.innerWidth + 1 && f.getBoundingClientRect().left >= -1 }))`);
    const grupos = await s.js(`[...document.querySelectorAll('[data-testid=presencia-grupo]')].map((g) => g.querySelector('h3').innerText)`);
    check(`presencia ${nombre}: dos grupos — Personal interno (7) y Aliados B2B (2); el usuario desactivado no aparece`, grupos.length === 2 && /Personal interno \(7\)/i.test(grupos[0]) && /Aliados B2B.*\(2\)/i.test(grupos[1]) && !/Usuario Desactivado/.test(t), JSON.stringify(grupos));
    check(`presencia ${nombre}: dentro de la ventana de 10 min: 2 del personal (b01, b07) y 1 aliado (b09); los demás NO son «recientes»`, /2 del personal · 1 aliado/.test(await s.js(`document.querySelector('[data-testid=presencia-resumen]').innerText`)) && filas.filter((f) => f.nivel === "reciente").length === 3, filas.map((f) => f.nivel).join(","));
    check(`presencia ${nombre}: la agencia aliada se identifica (rol y ficha) y su observación es reciente`, filas.some((f) => f.rol === "agencia" && /Agencia · Humo Viajes S\.A\.S\./.test(f.texto) && f.nivel === "reciente" && /hace [45] min/.test(f.texto)), filas.find((f) => f.rol === "agencia")?.texto);
    check(`presencia ${nombre}: la hora es la de Bogotá (${esperadoB07}) y el ingreso/cambio van aparte como contexto`, t.includes(esperadoB07) && /Último ingreso:/.test(t) && /Último cambio guardado:/.test(t));
    check(`presencia ${nombre}: sin observación todavía se dice así (b03, b04, b06), sin inventar actividad`, filas.filter((f) => f.nivel === "ninguna").length >= 3 && /Sin actividad observada todavía/.test(t));
    check(`presencia ${nombre}: define la ventana y no afirma conexión continua`, /Se considera reciente lo observado en los últimos 10 min/.test(t) && /como máximo una vez cada 5 min/.test(t) && /no una conexión continua/.test(t) && !/(^|[^a-z])(está en l[ií]nea|conectado|online)/i.test(t));
    check(`presencia ${nombre}: nada se sale del ancho de la pantalla; sin desborde; nombre largo completo`, filas.every((f) => f.dentro) && !(await s.desborda()) && /Administración y Operaciones Regionales de la Costa Caribe y San Andrés/.test(t));
    check(`presencia ${nombre}: sin errores de consola`, s.errores().length === 0, s.errores().join(" | "));
    await s.foto(`11_presencia_${nombre}`);
    await s.cerrar();
  }
  for (const quien of ["gerencia", "operaciones", "venta"]) {
    const s = await pestana({ ancho: 1280, uid: U[quien] });
    await s.ir("/dashboard");
    await s.esperar(`document.body.innerText.length > 200`, "el tablero", 60000);
    check(`presencia: el rol ${quien} NO ve el informe (solo superadmin) y el tablero carga sin error`, !(await s.js(`!!document.querySelector('[data-testid=actividad-reciente]')`)) && !/Presencia reciente/.test(await s.texto()) && s.errores().length === 0, s.errores().join(" | "));
    await s.cerrar();
  }

  // ── 1b. #11 · El aviso REAL del navegador: acotado, solo con pestaña visible y uso real, sin temporizadores ────────────────────────────────
  {
    resembrar(); sql(`delete from public.presencia_usuario where usuario_id = '${U.operaciones}'`);
    const p0 = await pings();
    const s = await pestana({ ancho: 1280, uid: U.operaciones });
    await sinSesionPrevia(s);
    await s.ir("/dashboard");
    await s.esperar(`document.body.innerText.length > 200`, "el tablero de operaciones", 60000);
    for (let i = 0; i < 40 && !visto("b03"); i++) await espera(250);
    const p1 = await pings(), v1 = version("b03");
    check("ping: la primera carga con la pestaña visible registra la presencia (1 llamada del navegador, fila creada)", p1 - p0 === 1 && v1 !== "" && !!visto("b03"), `llamadas ${p1 - p0}, fila ${v1}`);
    for (let i = 0; i < 10; i++) { await evento(s, "pointerdown"); await evento(s, "keydown"); }
    await espera(1500);
    const p2 = await pings();
    check("ping: 20 gestos (clics y teclas) seguidos NO envían nada más (a lo sumo uno cada 5 min por navegador)", p2 === p1, `llamadas nuevas ${p2 - p1}`);
    await s.ir("/dashboard/contratos"); await s.esperar(`document.body.innerText.length > 150`, "contratos", 60000); await espera(1500);
    check("ping: navegar a otra pantalla dentro de la ventana no envía nada (el último envío se comparte por almacenamiento local)", (await pings()) === p1);
    // Pestaña OCULTA: aunque haya gestos y el último envío sea antiguo, no cuenta como actividad.
    await sinSesionPrevia(s);
    await s.js(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));`);
    await espera(2500);
    check("ping: con la pestaña OCULTA no se envía nada, aunque haya gestos y no exista envío previo", (await pings()) === p1, `llamadas nuevas ${(await pings()) - p1}`);
    // Vuelve a ser visible: se envía, pero la base NO escribe (la observación de hace <4 min sigue vigente).
    const vAntes = version("b03");
    await s.js(`delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'));`);
    for (let i = 0; i < 20 && (await pings()) === p1; i++) await espera(250);
    await espera(800); const p3 = await pings(), v3 = version("b03");
    check("ping: al volver a ser visible el navegador avisa (1 llamada) pero la base declina escribir porque la observación tiene menos de 4 min (la fila no cambia)", p3 - p1 === 1 && v3 === vAntes, `llamadas ${p3 - p1}, versión ${vAntes} → ${v3}`);
    // Observación antigua + nuevo gesto: ahora SÍ escribe y avanza el instante.
    sql(`update public.presencia_usuario set visto_en = now() - interval '6 minutes' where usuario_id = '${U.operaciones}'`);
    const antes = visto("b03"); await s.js(`{ const o = Date.now.bind(Date); Date.now = () => o() + 6 * 60000; }`); await evento(s, "pointerdown");   // el reloj de la PÁGINA avanza 6 min (el límite del navegador también vive en memoria)
    for (let i = 0; i < 20 && visto("b03") === antes; i++) await espera(250);
    await espera(800); const v4 = version("b03");
    check("ping: con la observación de hace 6 min y un gesto real, la base escribe y el instante avanza", v4 !== v3 && new Date(visto("b03")).getTime() > new Date(antes).getTime() + 300_000, `versión ${v3} → ${v4}`);
    // Reposo: sin gestos, ningún temporizador envía nada.
    const p5 = await pings(); await espera(20000);
    check("ping: 20 s de reposo con la pestaña abierta y sin gestos = 0 llamadas (no hay temporizador ni sondeo de presencia)", (await pings()) === p5);
    check("ping: sin errores de consola", s.errores().length === 0, s.errores().join(" | "));
    await s.cerrar();
    // Aliado (freelance) desde su portal.
    const pf = await pings(); const sf = await pestana({ ancho: 390, movil: true, uid: U.freelance });
    await sinSesionPrevia(sf);
    await sf.ir("/portal/b2b");
    await sf.esperar(`document.body.innerText.length > 100`, "el portal del aliado", 60000);
    for (let i = 0; i < 40 && new Date(visto("b0a") || 0).getTime() < Date.now() - 120_000; i++) await espera(250);
    check("ping: un aliado (freelance) desde su portal también deja su observación (la fila pasó de hace 3 días a ahora)", new Date(visto("b0a")).getTime() > Date.now() - 120_000 && (await pings()) - pf === 1, visto("b0a"));
    await sf.cerrar();
    // Usuario inactivo: no deja fila y es devuelto al inicio de sesión.
    const si = await pestana({ ancho: 1280, uid: "00000000-0000-0000-0000-000000000b08" });
    await si.ir("/dashboard"); await espera(2500);
    check("ping: un usuario desactivado es devuelto a /login y no deja observación", /\/login/.test(await si.url()) && visto("b08") === "", await si.url());
    await si.cerrar();
  }

  // ── 1c. B3-4 · el límite de envío es de UNA identidad, no del navegador (mismo perfil y mismo almacenamiento local) ─────────────────────────────────
  {
    const claves = (s) => s.js(`Object.keys(localStorage).filter((k) => k.startsWith('presencia:ultimo-envio')).sort()`);
    const esperaFila = async (n) => { for (let i = 0; i < 40 && !visto(n); i++) await espera(250); };
    sql(`delete from public.presencia_usuario where usuario_id in ('${U.operaciones}', '${U.contabilidad}')`);
    const s = await pestana({ ancho: 1280, uid: U.operaciones });
    await sinSesionPrevia(s);
    const p0 = await pings();
    await s.ir("/dashboard"); await s.esperar(`document.body.innerText.length > 200`, "el tablero de A", 60000); await esperaFila("b03");
    const vA = version("b03");
    check("B3-4 browser: A (operaciones) envía en su primera carga y su límite queda guardado bajo SU id", (await pings()) - p0 === 1 && !!visto("b03") && JSON.stringify(await claves(s)) === JSON.stringify([`presencia:ultimo-envio:${U.operaciones}`]), JSON.stringify(await claves(s)));
    // B entra en el MISMO navegador a los pocos segundos
    await s.cmd("Network.setCookie", { ...cookieDe(U.contabilidad), url: APP });
    await s.ir("/dashboard"); await s.esperar(`document.body.innerText.length > 200`, "el tablero de B", 60000); await esperaFila("b07");
    const p1 = await pings();
    check("B3-4 browser: B entra dentro de los 5 min de A y su primera actividad SÍ se registra (antes la suprimía la clave compartida); la fila de A no cambia", p1 - p0 === 2 && !!visto("b07") && version("b03") === vA, `llamadas ${p1 - p0}, fila A ${vA} → ${version("b03")}`);
    check("B3-4 browser: ambos conservan su límite (A y B) bajo claves propias; no hay clave global", JSON.stringify(await claves(s)) === JSON.stringify([`presencia:ultimo-envio:${U.operaciones}`, `presencia:ultimo-envio:${U.contabilidad}`].sort()), JSON.stringify(await claves(s)));
    for (let i = 0; i < 10; i++) { await evento(s, "pointerdown"); await evento(s, "keydown"); }
    await espera(1200);
    check("B3-4 browser: 20 gestos de B no envían nada (ninguna llamada por gesto)", (await pings()) === p1, `llamadas nuevas ${(await pings()) - p1}`);
    // A vuelve a los pocos segundos: su límite sigue vigente, no reenvía
    await s.cmd("Network.setCookie", { ...cookieDe(U.operaciones), url: APP });
    await s.ir("/dashboard"); await s.esperar(`document.body.innerText.length > 200`, "el tablero de A otra vez", 60000); await espera(2000);
    check("B3-4 browser: A→B→A en pocos segundos = 2 llamadas en total (una por persona); el regreso de A no reenvía", (await pings()) - p0 === 2, `llamadas ${(await pings()) - p0}`);
    // Otra pestaña de la MISMA persona comparte el límite
    const s2 = await pestana({ ancho: 1280, uid: U.operaciones });
    await s2.ir("/dashboard"); await s2.esperar(`document.body.innerText.length > 200`, "la segunda pestaña de A", 60000); await espera(2000);
    check("B3-4 browser: una segunda pestaña de la misma persona no envía (comparten el límite)", (await pings()) - p0 === 2, `llamadas ${(await pings()) - p0}`);
    await s2.cerrar();
    // La cuenta cambia en OTRA pestaña (aquí: cookie de B) y esta pestaña no recibe evento: al volver a la pestaña relee la sesión y la actividad se atribuye a B
    sql(`delete from public.presencia_usuario where usuario_id = '${U.contabilidad}'`);
    await s.js(`Object.keys(localStorage).filter((k) => k.endsWith('${U.contabilidad}')).forEach((k) => localStorage.removeItem(k))`);
    await s.cmd("Network.setCookie", { ...cookieDe(U.contabilidad), url: APP });
    const p2 = await pings();
    await s.js(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'));`);
    await esperaFila("b07"); await espera(800);
    check("B3-4 browser: cambio de cuenta hecho en otra pestaña: al volver a esta pestaña la sesión se relee y la presencia se atribuye a B (no a A)", (await pings()) - p2 === 1 && !!visto("b07"), `llamadas ${(await pings()) - p2}, fila B '${visto("b07")}'`);
    // Cierre de sesión real (botón del tablero): se borran las claves y nada se envía sin sesión
    await s.cmd("Network.setCookie", { ...cookieDe(U.operaciones), url: APP });
    await s.ir("/dashboard"); await s.esperar(`document.body.innerText.length > 200`, "el tablero de A para cerrar sesión", 60000);
    check("B3-4 browser: antes de cerrar sesión hay claves guardadas", (await claves(s)).length >= 1, JSON.stringify(await claves(s)));
    const cerrado = await s.js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent !== null && /Cerrar sesión/.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);
    await s.esperar("location.pathname.startsWith('/tarifario')", "el tarifario público tras cerrar sesión", 60000);
    check("B3-4 browser: el cierre de sesión real borra las claves de presencia (no quedan ids guardados) y sale al tarifario público", cerrado === true && (await claves(s)).length === 0, `${cerrado} ${JSON.stringify(await claves(s))}`);
    const p3 = await pings(); await espera(1500);
    check("B3-4 browser: sin sesión (tarifario público) no se envía nada", (await pings()) === p3);
    check("B3-4 browser: sin errores de consola", s.errores().length === 0, s.errores().join(" | "));
    await s.cerrar();
  }

  // ── 2. #13 · Avisos en la campana GLOBAL (sin correo): desde cualquier pantalla ───────────────────────────────────────────────────────
  for (const [nombre, cfg] of ANCHOS) {
    sql(`update public.avisos set leido_en = null, notificado_en = null where tipo = 'compra_por_vencer'`);
    const s = await pestana({ ...cfg, uid: U.gerencia });
    await s.ir("/dashboard/cotizaciones");   // NO es la pantalla de Paquetes
    await esperaCampana(s, "/Avisos, 6 sin leer/");
    check(`campana ${nombre}: en una pantalla que NO es Paquetes (Cotizaciones) la campana muestra los 6 avisos de compra por vencer`, /Avisos, 6 sin leer/.test(await campanaVisible(s)), await campanaVisible(s));
    await abrirCampana(s); await espera(700);
    const pn = await panelCampana(s);
    const hrefs = (pn?.items ?? []).map((i) => i.href).sort();
    check(`campana ${nombre}: cada aviso enlaza a SU vigencia (paquete, paquete total, salida dinámica en Vuelos, empaquetado)`, JSON.stringify(hrefs) === JSON.stringify(["/dashboard/paquetes/12001?tab=config", "/dashboard/paquetes/12004?tab=config", "/dashboard/paquetes/12009?tab=vuelos", "/dashboard/paquetes/12011?tab=config", "/dashboard/paquetes/total/12001", "/dashboard/vuelos/empaquetados/12001"]), JSON.stringify(hrefs));
    const txt = (pn?.items ?? []).map((i) => i.texto).join(" | ");
    check(`campana ${nombre}: el texto da el plazo a HOY (Bogotá): hoy, mañana, 2, 3, 4 y 5 días`, /Villa de Leyva.*Vence hoy/.test(txt) && /Punta Cana.*Vence mañana/.test(txt) && /Vence en 2 días/.test(txt) && /salida.*Vence en 3 días/i.test(txt) && /Empaquetado|MDE - CTG - MDE.*Vence en 4 días/.test(txt) && /Vence en 5 días/.test(txt), txt.slice(0, 300));
    check(`campana ${nombre}: el panel cabe en pantalla y sin desborde horizontal`, !!pn && pn.dentro && !(await s.desborda()));
    await s.foto(`13_campana_${nombre}`);
    check(`campana ${nombre}: sin errores de consola`, s.errores().length === 0, s.errores().join(" | "));
    await s.cerrar();
  }
  {
    // Abrir un aviso: navega a la pantalla correcta y baja SOLO el contador de esa persona.
    sql(`update public.avisos set leido_en = null, notificado_en = null where tipo = 'compra_por_vencer'`);
    const s = await pestana({ ancho: 1280, uid: U.operaciones });
    await s.ir("/dashboard/contratos"); await esperaCampana(s, "/Avisos, 6 sin leer/");
    await abrirCampana(s); await espera(500);
    await s.js(`[...document.querySelectorAll('[role=region][aria-label=Avisos] a')].find((a) => /empaquetados\\/12001/.test(a.getAttribute('href'))).click()`);
    await s.esperar(`location.pathname === '/dashboard/vuelos/empaquetados/12001'`, "la pantalla del empaquetado", 60000);
    for (let i = 0; i < 30 && Number(sql(`select count(*) from public.avisos where tipo = 'compra_por_vencer' and usuario_id = '${U.operaciones}' and leido_en is not null`)) < 1; i++) await espera(250);
    check("campana: abrir el aviso del empaquetado lleva a su pantalla y lo marca leído SOLO para esa persona", Number(sql(`select count(*) from public.avisos where tipo = 'compra_por_vencer' and usuario_id = '${U.operaciones}' and leido_en is not null`)) === 1 && Number(sql(`select count(*) from public.avisos where tipo = 'compra_por_vencer' and usuario_id <> '${U.operaciones}' and leido_en is not null`)) === 0);
    await s.ir("/crm");
    await esperaCampana(s, "/Avisos, 5 sin leer/");
    check("campana: también aparece en el CRM (otro cascarón) con el contador de esa persona (5)", /Avisos, 5 sin leer/.test(await campanaVisible(s)), await campanaVisible(s));
    await s.cerrar();
    // Quien no escribe paquetes no ve avisos de compra, aunque conserve uno; el aliado tampoco.
    sql(`insert into public.avisos (usuario_id, tipo, numero_contrato, ventana_tipo, ventana_id, ventana_ref, ventana_titulo, compra_fin) values ('${U.venta}', 'compra_por_vencer', 'paquete:12001', 'paquete', 12001, 12001, 'P', public.fecha_negocio() + 2), ('${U.agencia}', 'compra_por_vencer', 'paquete:12001', 'paquete', 12001, 12001, 'P', public.fecha_negocio() + 2)`);
    for (const [quien, ruta] of [["venta", "/dashboard"], ["agencia", "/portal/b2b"]]) {
      const v = await pestana({ ancho: 1280, uid: U[quien] });
      await v.ir(ruta); await v.esperar(`document.body.innerText.length > 100`, "la pantalla", 60000); await espera(2500);
      check(`campana: ${quien} NO ve ni cuenta avisos de compra por vencer (permiso de quien escribe paquetes)`, !/Avisos, \d+ sin leer/.test((await campanaVisible(v)) ?? ""), String(await campanaVisible(v)));
      await v.cerrar();
    }
    sql(`delete from public.avisos where usuario_id in ('${U.venta}', '${U.agencia}')`);
  }
  {
    // Sin duplicados y con reconciliación visible en la campana: fecha que cambia, paquete que se desactiva, ejecución repetida.
    sql(`update public.avisos set leido_en = null where tipo = 'compra_por_vencer'`);
    const gen = () => sql(`select public.generar_avisos_compra()`);
    const vivosDe = (id) => Number(sql(`select count(*) from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null and usuario_id = '${U.gerencia}'`));
    check("avisos: ejecutar el generador de nuevo NO duplica nada (6 vigentes para gerencia)", (gen(), gen(), vivosDe() === 6), String(vivosDe()));
    sql(`update public.armado_paquetes set fecha_compra_fin = public.fecha_negocio() + 3 where id = 12001`);
    check("avisos: al cambiar la fecha de fin, el aviso de la fecha anterior se archiva al instante (5 vigentes hasta que el cron cree el nuevo)", vivosDe() === 5, String(vivosDe()));
    gen();
    const s = await pestana({ ancho: 1280, uid: U.gerencia });
    await s.ir("/dashboard/cotizaciones"); await esperaCampana(s, "/Avisos, 6 sin leer/");
    await abrirCampana(s); await espera(500);
    const pn = await panelCampana(s);
    check("campana: tras el cambio de fecha sigue habiendo 6 (no 7): el viejo desapareció y el nuevo dice «Vence en 3 días»", pn.items.length === 6 && pn.items.some((i) => /Cartagena 4 noches.*Vence en 3 días/.test(i.texto)) && !pn.items.some((i) => /Cartagena 4 noches.*Vence en 2 días/.test(i.texto)), pn.items.map((i) => i.texto.slice(0, 70)).join(" | "));
    sql(`update public.armado_paquetes set activo = false where id = 12011`);
    await s.ir("/dashboard/cotizaciones"); await esperaCampana(s, "/Avisos, 5 sin leer/");
    check("campana: al desactivar un paquete su aviso deja de contarse y la ejecución diaria no lo revive", /Avisos, 5 sin leer/.test(await campanaVisible(s)) && (gen(), vivosDe() === 5));
    sql(`update public.armado_paquetes set activo = true where id = 12011`); gen();
    sql(`update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true, tarifario_generacion_publicada = 1 where id = 12011`);   // reactivar INVALIDA el tarifario (comportamiento real); se restablece el estado de la semilla
    sql(`update public.armado_paquetes set fecha_compra_fin = public.fecha_negocio() + 2 where id = 12001`); gen();
    await s.cerrar();
  }

  // ── 3. #36 + #13 · Listado de Paquetes ───────────────────────────────────────────────────────────────────────
  const ESPERADO = [
    ["Cartagena 4 noches porción terrestre", "publicado", "por_vencer", /Tarifas publicadas/, /2 combinaciones publicadas/],
    ["San Andrés 5 noches", "pendiente", null, /Pendiente de generar/, /Aún no se ha publicado/],
    ["Santa Marta 3 noches", "error", null, /Error de generación/, /no tiene temporadas que cubran/],
    ["Villa de Leyva cabañas por unidad", "cotizacion_unidad", "vence_hoy", /Cotización por unidad/, /Se cotiza por unidad/],
    ["Hotel boutique bajo solicitud", "bajo_solicitud", null, /Bajo solicitud/, /bajo solicitud/],
    ["Cali inactivo con tarifas generadas", "publicado_oculto", null, /Publicado, no visible/, /inactivo/],
    ["Cartagena bloqueado por cambios de fuentes", "desactualizado", "vencida", /Desactualizado/, /Cambiaron las fuentes/],
    ["Eje cafetero combinado persona y unidad", "publicado", null, /Tarifas publicadas/, /combinaciones publicadas/],
    ["Paquete sin oferta vendible", "sin_oferta", null, /Publicado sin oferta vendible/, /no dejó combinaciones vendibles/],
    ["Cartagena activo en promoción cercana", "publicado", "por_vencer", /Tarifas publicadas/, /combinaciones publicadas/],
  ];
  for (const [nombre, cfg] of ANCHOS) {
    const s = await pestana({ ...cfg, uid: U.operaciones });
    await s.ir("/dashboard/paquetes?tipo=porcion_terrestre");
    await s.esperar(`document.querySelectorAll('[data-testid=publicacion-paquete]').length >= 10`, "las tarjetas de paquetes", 60000);
    const n0 = peticiones(s); await espera(5000);
    check(`paquetes ${nombre}: en reposo no hace peticiones (sin sondeo)`, peticiones(s) - n0 === 0, String(peticiones(s) - n0));
    const tarjetas = await s.js(`[...document.querySelectorAll('[data-testid=publicacion-paquete]')].map((b) => { const c = b.closest('div.flex.flex-col'); const r = c.getBoundingClientRect(); const chips = [...b.querySelectorAll('span')].map((x) => x.getBoundingClientRect()); return { nombre: c.querySelector('h2').innerText, estado: b.querySelector('[data-estado]')?.dataset.estado, etiqueta: b.querySelector('[data-estado]')?.innerText.trim(), compra: b.querySelector('[data-compra]')?.dataset.compra ?? null, secundarias: [...b.querySelectorAll('span')].filter((x) => !x.dataset.estado && !x.dataset.compra).map((x) => x.innerText.trim()), texto: c.innerText.replace(/\\s+/g, ' '), dentro: chips.every((q) => q.left >= r.left - 1 && q.right <= r.right + 1), cardDentro: r.right <= window.innerWidth + 1 }; })`);
    for (const [pref, estado, compra, reEtiqueta, reDetalle] of ESPERADO) {
      const t = tarjetas.find((x) => x.nombre.startsWith(pref));
      check(`paquetes ${nombre}: «${pref}» → ${estado}${compra ? ` + compra ${compra}` : ""}`, !!t && t.estado === estado && reEtiqueta.test(t.etiqueta) && reDetalle.test(t.texto) && (t.compra ?? null) === compra && t.dentro && t.cardDentro, t ? `${t.estado}/${t.etiqueta}/${t.compra}/${t.dentro}` : "no está");
    }
    const unidad8 = tarjetas.find((x) => x.nombre.startsWith("Eje cafetero"));
    check(`paquetes ${nombre}: persona + unidad muestra «Tarifas publicadas» y la secundaria «Cotización por unidad»`, !!unidad8 && unidad8.secundarias.includes("Cotización por unidad"), JSON.stringify(unidad8?.secundarias));
    const cali = tarjetas.find((x) => x.nombre.startsWith("Cali inactivo"));
    check(`paquetes ${nombre}: un paquete INACTIVO sigue marcado «Inactivo», no dice «Sin publicar» y no muestra chip de compra`, !!cali && /Inactivo/.test(cali.texto) && !/Sin publicar/.test(cali.texto) && cali.compra === null, cali?.texto.slice(0, 120));
    check(`paquetes ${nombre}: ninguna tarjeta dice «Sin publicar» (la etiqueta genérica anterior)`, !tarjetas.some((x) => /Sin publicar/.test(x.texto)));
    const panel = await s.js(`(() => { const p = document.querySelector('[data-testid=avisos-compra]'); if (!p) return null; const r = p.getBoundingClientRect(); return { texto: p.innerText.replace(/\\s+/g, ' '), filas: [...p.querySelectorAll('[data-testid=aviso-compra]')].map((f) => ({ texto: f.innerText.replace(/\\s+/g, ' '), href: f.querySelector('a').getAttribute('href'), dentro: f.getBoundingClientRect().right <= window.innerWidth + 1 })), dentro: r.right <= window.innerWidth + 1 }; })()`);
    check(`paquetes ${nombre}: panel de vigencias de compra con las 6 fuentes y en orden (hoy, mañana, +2, +3, +4, +5)`, !!panel && panel.filas.length === 6 && /Vence hoy/.test(panel.filas[0].texto) && /Villa de Leyva/.test(panel.filas[0].texto) && /Vence mañana/.test(panel.filas[1].texto) && /Punta Cana/.test(panel.filas[1].texto) && /Vence en 2 días/.test(panel.filas[2].texto) && /Salida dinámica/.test(panel.filas[3].texto) && /Empaquetado/.test(panel.filas[4].texto) && /MDE - CTG - MDE/.test(panel.filas[4].texto) && /Vence en 5 días/.test(panel.filas[5].texto), JSON.stringify(panel?.filas?.map((f) => f.texto.slice(0, 50))));
    check(`paquetes ${nombre}: enlaces correctos a cada vigencia`, !!panel && panel.filas[0].href === "/dashboard/paquetes/12004?tab=config" && panel.filas[1].href === "/dashboard/paquetes/total/12001" && panel.filas[3].href === "/dashboard/paquetes/12009?tab=vuelos" && panel.filas[4].href === "/dashboard/vuelos/empaquetados/12001", JSON.stringify(panel?.filas?.map((f) => f.href)));
    check(`paquetes ${nombre}: el panel y sus filas caben en pantalla; sin desborde horizontal`, !!panel && panel.dentro && panel.filas.every((f) => f.dentro) && !(await s.desborda()));
    check(`paquetes ${nombre}: sin errores de consola`, s.errores().length === 0, s.errores().join(" | "));
    await s.foto(`36_paquetes_${nombre}`);
    await s.cerrar();
  }
  {
    const s = await pestana({ ancho: 1280, uid: U.operaciones });
    await s.ir("/dashboard/paquetes?tipo=dinamico");
    await s.esperar(`document.querySelectorAll('[data-testid=publicacion-paquete]').length >= 1`, "la pestaña de dinámicos", 60000);
    const t = await s.js(`[...document.querySelectorAll('[data-testid=publicacion-paquete]')].map((b) => b.closest('div.flex.flex-col').innerText.replace(/\\s+/g, ' '))`);
    check("paquetes: la variante DINÁMICO se rotula con su estado real (Miami: pendiente de generar)", t.length === 1 && /Miami dinámico/.test(t[0]) && /Pendiente de generar/.test(t[0]), t.join(" | "));
    await s.cerrar();
  }


  // ── 3b. B3-1: la lectura de la oferta por unidad FALLA en la página compilada ──────────────────────────────────────────────────────────
  for (const [nombre, cfg] of [ANCHOS[0], ANCHOS[2]]) {
    sql(`alter table public.hotel_tarifas_unidad rename to hotel_tarifas_unidad_x`); sql(`notify pgrst, 'reload schema'`); await espera(1500);
    try {
      const s = await pestana({ ...cfg, uid: U.operaciones });
      await s.ir("/dashboard/paquetes?tipo=porcion_terrestre");
      await s.esperar(`document.querySelectorAll('[data-testid=publicacion-paquete]').length >= 10`, "las tarjetas con la lectura de unidad rota", 60000);
      const t = await s.js(`Object.fromEntries([...document.querySelectorAll('[data-testid=publicacion-paquete]')].map((b) => { const c = b.closest('div.flex.flex-col'); return [c.querySelector('h2').innerText.slice(0, 30), { estado: b.querySelector('[data-estado]').dataset.estado, texto: c.innerText.replace(/\\s+/g, ' ') }]; }))`);
      const de = (pref) => Object.entries(t).find(([k]) => k.startsWith(pref))?.[1];
      check(`B3-1 ${nombre}: aviso global de verificación fallida y «Paquete sin oferta vendible» pasa a «Oferta sin verificar» (no afirma que no haya oferta)`, !!(await s.js(`!!document.querySelector('[data-testid=oferta-sin-verificar]')`)) && de("Paquete sin oferta")?.estado === "oferta_sin_verificar" && /no se puede afirmar/.test(de("Paquete sin oferta").texto), JSON.stringify(de("Paquete sin oferta")));
      check(`B3-1 ${nombre}: la cotización por unidad que no se pudo leer no se afirma ni se niega («Oferta sin verificar»), y la evidencia conocida se conserva («Bajo solicitud» + «Unidad sin verificar»)`, de("Villa de Leyva")?.estado === "oferta_sin_verificar" && de("Hotel boutique")?.estado === "bajo_solicitud" && /Unidad sin verificar/.test(de("Hotel boutique").texto) && /Tarifas publicadas.*Unidad sin verificar|Unidad sin verificar.*Tarifas publicadas/.test(de("Eje cafetero").texto), `${de("Villa de Leyva")?.estado} / ${de("Hotel boutique")?.estado}`);
      check(`B3-1 ${nombre}: un paquete inactivo conserva su estado y los estados autoritativos (error, pendiente) no cambian; sin desborde`, de("Cali inactivo")?.estado === "publicado_oculto" && de("Santa Marta")?.estado === "error" && de("San Andrés")?.estado === "pendiente" && !(await s.desborda()));
      await s.foto(`36_b31_${nombre}`);
      await s.cerrar();
    } finally { sql(`alter table public.hotel_tarifas_unidad_x rename to hotel_tarifas_unidad`); sql(`notify pgrst, 'reload schema'`); await espera(1500); }
  }

  // ── 3c. B3-2: más de 200 vigencias elegibles → el panel lo dice y no se rompe ─────────────────────────────────────────────────────────────
  {
    sql(`insert into public.salidas_dinamicas (id, paquete_id, fecha_ida, fecha_regreso, compra_fin, activo) select 20000 + g, 12009, public.fecha_negocio() + 60, public.fecha_negocio() + 64, public.fecha_negocio() + 2, true from generate_series(1, 205) g`);
    for (const [nombre, cfg] of [ANCHOS[0], ANCHOS[2]]) {
      const s = await pestana({ ...cfg, uid: U.operaciones });
      await s.ir("/dashboard/paquetes?tipo=porcion_terrestre");
      await s.esperar(`!!document.querySelector('[data-testid=avisos-compra]')`, "el panel con muchas vigencias", 60000);
      const panel = await s.js(`(() => { const p = document.querySelector('[data-testid=avisos-compra]'); const r = p.getBoundingClientRect(); return { texto: p.innerText.replace(/\\s+/g, ' '), visibles: p.querySelectorAll('[data-testid=aviso-compra]').length, dentro: r.right <= window.innerWidth + 1 }; })()`);
      check(`B3-2 ${nombre}: con más de 200 vigencias el panel declara que hay más de las listadas, agrupa el resto en «Ver N más» y cabe en pantalla`, /Hay más vigencias de las listadas/.test(panel.texto) && /Ver \d+ más/.test(panel.texto) && panel.dentro && !(await s.desborda()), panel.texto.slice(0, 160));
      if (nombre === "movil_390") await s.foto("13_b32_truncado_movil_390");
      await s.cerrar();
    }
    sql(`delete from public.salidas_dinamicas where id between 20000 and 20999`);
  }

  // ── 3. Los enlaces del panel llevan a la pantalla donde se corrige cada vigencia ────────────────────────────
  {
    const s = await pestana({ ancho: 1280, uid: U.operaciones });
    for (const [ruta, re, que] of [["/dashboard/paquetes/12004?tab=config", /Villa de Leyva cabañas por unidad/, "configuración del paquete"], ["/dashboard/paquetes/12009?tab=vuelos", /Miami dinámico/, "pestaña Vuelos del paquete dinámico"], ["/dashboard/vuelos/empaquetados/12001", /MDE - CTG - MDE|Empaquetado/, "empaquetado"], ["/dashboard/paquetes/total/12001", /Punta Cana/, "paquete dinámico total"]]) {
      await s.ir(ruta);
      await s.esperar(`document.body.innerText.length > 150`, que, 60000);
      const t = await s.texto();
      check(`enlace ${ruta}: abre ${que}`, re.test(t) && !/This page could not be found|Application error/i.test(t) && (await s.url()).startsWith(ruta.split("?")[0]), t.slice(0, 120));
    }
    await s.cerrar();
  }


  // ── 3d. B3-3 · más de 500 ventanas con la misma fecha: el cron del compilado avanza por pasadas hasta cubrirlo todo, archiva lo obsoleto y la campana sigue acotada ───────────────────────────────────────────────────
  {
    const AV = "tipo = 'compra_por_vencer'";
    sql(`insert into public.armado_paquetes (id, nombre, destino_id, activo, tipo, noches, fecha_compra_fin) select 30000 + g, 'masivo ' || g, 12001, true, 'porcion_terrestre', 3, public.fecha_negocio() + 1 from generate_series(1, 499) g;
         insert into public.avisos (usuario_id, tipo, numero_contrato, ventana_tipo, ventana_id, ventana_ref, ventana_titulo, compra_fin) values ('${U.gerencia}', 'compra_por_vencer', 'paquete:99991', 'paquete', 99991, 99991, 'obsoleto', public.fecha_negocio() + 2)`);
    const antes = Number(sql(`select count(*) from public.avisos where ${AV} and archivado_en is null`));
    const r = await fetch(`${APP}/api/cron/notificaciones`, { headers: { authorization: "Bearer humo-b3" } });
    const c = (await r.json()).avisosCompra;
    check("B3-3 browser: el cron con 505 ventanas elegibles el mismo día cubre TODO en una ejecución por pasadas (5 pasadas: 2.495 pares pendientes), archiva el obsoleto y no deja pendientes", r.status === 200 && c.ok && c.pasadas === 5 && c.creados === 2495 && c.archivados === 1 && c.pendientes === 0 && c.truncado === false && c.ventanas === 505, JSON.stringify(c));
    check("B3-3 browser: 505 ventanas × 5 destinatarios = 2.525 avisos vivos, sin duplicados, 505 ventanas cubiertas", Number(sql(`select count(*) from public.avisos where ${AV} and archivado_en is null`)) === 2525 && Number(sql(`select count(*) from (select distinct usuario_id, ventana_tipo, ventana_id, compra_fin from public.avisos where ${AV} and archivado_en is null) x`)) === 2525 && Number(sql(`select count(distinct ventana_tipo || ventana_id) from public.avisos where ${AV} and archivado_en is null`)) === 505, String(antes));
    const r2 = await fetch(`${APP}/api/cron/notificaciones`, { headers: { authorization: "Bearer humo-b3" } });
    const c2 = (await r2.json()).avisosCompra;
    check("B3-3 browser: repetir el cron no crea ni archiva nada (idempotente, 1 pasada)", c2.ok && c2.pasadas === 1 && c2.creados === 0 && c2.archivados === 0 && c2.pendientes === 0, JSON.stringify(c2));
    for (const [nombre, cfg] of [ANCHOS[0], ANCHOS[2]]) {
      sql(`update public.avisos set leido_en = null, notificado_en = null where ${AV} and usuario_id = '${U.gerencia}'`);
      const s = await pestana({ ...cfg, uid: U.gerencia });
      await s.ir("/dashboard/cotizaciones");
      await esperaCampana(s, "/Avisos, 505 sin leer/");
      await abrirCampana(s); await espera(700);
      const pn = await panelCampana(s);
      check(`B3-3 browser ${nombre}: con 505 avisos la campana cuenta 505, la lista queda acotada (≤10 recientes) y el panel cabe en pantalla`, !!pn && pn.items.length <= 12 && pn.dentro && !(await s.desborda()), JSON.stringify({ items: pn?.items.length, dentro: pn?.dentro }));
      if (nombre === "movil_390") await s.foto("13_b33_505_avisos_movil_390");
      check(`B3-3 browser ${nombre}: sin errores de consola`, s.errores().length === 0, s.errores().join(" | "));
      await s.cerrar();
    }
    sql(`delete from public.avisos where ${AV}; delete from public.armado_paquetes where id >= 30000; select public.generar_avisos_compra();`);
    check("B3-3 browser: limpieza: vuelven las 30 notificaciones de la semilla", Number(sql(`select count(*) from public.avisos where ${AV} and archivado_en is null`)) === 30);
  }

  // ── 4. #13 sin correo: la configuración de notificaciones NO ofrece paquetes y el cron diario crea avisos, no correos ──────────────────────────
  {
    const s = await pestana({ ancho: 1280, uid: U.superadmin });
    await s.ir("/dashboard/configuracion");
    await s.esperar(`/Notificaciones por correo/.test(document.body.innerText)`, "la configuración", 60000);
    const t = await s.texto();
    check("config: la configuración de correo conserva sus categorías de siempre y NO tiene casilla de paquetes", /Pagos a proveedores/.test(t) && /Cobros a clientes/.test(t) && /Bloqueos \(devolución\/emisión\)/.test(t) && !/vigencia de compra|Paquetes \(fin/.test(t));
    await s.foto("13_config_sin_paquetes");
    await s.cerrar();
    const sinSecreto = await fetch(`${APP}/api/cron/notificaciones`);
    const antes = Number(sql(`select count(*) from public.avisos where tipo = 'compra_por_vencer'`));
    const conSecreto = await fetch(`${APP}/api/cron/notificaciones`, { headers: { authorization: "Bearer humo-b3" } });
    const cuerpo = await conSecreto.json().catch(() => ({}));
    check("cron diario: sin secreto 401; con secreto genera avisos de forma idempotente (0 nuevos) y no envía ningún correo (sin clave de Resend)", sinSecreto.status === 401 && cuerpo.avisosCompra?.ok === true && cuerpo.avisosCompra.creados === 0 && Number(sql(`select count(*) from public.avisos where tipo = 'compra_por_vencer'`)) === antes, JSON.stringify(cuerpo));
  }
} catch (e) {
  check("el recorrido terminó sin excepción", false, e.stack ?? e.message);
} finally {
  fs.writeFileSync(`${SALIDA}/informe.json`, JSON.stringify({ checks }, null, 2));
  try { proc.kill(); } catch { /* ya cerrado */ }
  const mal = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - mal.length}/${checks.length} comprobaciones OK${mal.length ? ` · FALLAN: ${mal.map((c) => c.nombre).join("; ")}` : ""}`);
  process.exit(mal.length ? 1 : 0);
}
