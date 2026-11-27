// RECORRIDO NAVEGADO de #76 (referidos) y #78 (aviso de cotización pública + «atendida») en la app COMPILADA (`next start`) con sesiones y base LOCALES (entorno_block2_local.sh en marcha): el visitante pide la cotización de un hotel bajo
// solicitud; reciben aviso quienes pueden generar/asistir cotizaciones; «Atendida» = convertida; pantalla Referidos y aprobación B2B con código (escritorio, 768 y 390 px); consumo en reposo.
// Se maneja Edge sin interfaz por CDP (WebSocket nativo de Node). Env: HUMO_SALIDA (carpeta con env.json). Escribe capturas e informe.json en esa carpeta.
import { spawn, execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";

const SALIDA = process.env.HUMO_SALIDA;
const ENV = JSON.parse(fs.readFileSync(`${SALIDA}/env.json`, "utf8"));
const { app: APP, secreto: SECRETO, db: DB, contenedor: CT } = ENV;
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PUERTO_CDP = 9291;
const U = { staff: "00000000-0000-0000-0000-000000000a01", venta: "00000000-0000-0000-0000-000000000a02", agencia1: "00000000-0000-0000-0000-000000000a03", agencia2: "00000000-0000-0000-0000-000000000a04", adminMin: "00000000-0000-0000-0000-000000000a05" };
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
const DOC = (n) => `77${n}`;
const celdas = { visitante: DOC("10001"), aliado: DOC("10002") };

// El CRM busca al escribir (sin botón): un solo cambio de texto = una consulta.
async function buscar(p, texto) {
  await p.esperar(`!!document.querySelector('#buscar-personas-cotizacion')`, "el buscador del CRM");
  await p.poner("#buscar-personas-cotizacion", texto);
  await espera(3000);
  return p.texto();
}

async function solicitar(p, doc, nombres) {
  await p.ir("/tarifario");
  // La portada abre en la vista de tabla: las tarjetas de hoteles bajo solicitud viven en «Vista Booking».
  await p.clic(/Vista Booking/); await espera(1000); await p.clic(/^Porción terrestre$/); await espera(1500);
  if (process.env.HUMO_DEBUG) { await p.foto("debug_tarifario"); console.log((await p.texto()).slice(0, 1500)); }
  await p.esperar(`[...document.querySelectorAll('button')].some((b) => /Solicitar cotización/.test(b.textContent))`, "la tarjeta del hotel bajo solicitud");
  await p.clic(/Solicitar cotización/);
  await p.esperar(`!!document.querySelector('[role=dialog]')`, "el formulario de solicitud");
  // Fechas dentro del viaje del paquete (mayo de 2030), habitaciones: 1 doble, sin menores.
  await p.js(`(() => { const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }; const i = document.querySelector('[role=dialog] input[aria-label="Ida"]'); const r = document.querySelector('[role=dialog] input[aria-label="Regreso"]'); if (i) set(i, '2030-05-10'); if (r) set(r, '2030-05-13'); return !!i && !!r; })()`);
  await espera(400);
  await p.js(`(() => { const n = [...document.querySelectorAll('[role=dialog] input[type=number]')][0]; if (n) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, '1'); n.dispatchEvent(new Event('input', { bubbles: true })); } const no = document.querySelector('[role=dialog] input[type=radio][value=no]'); if (no) no.click(); return true; })()`);
  await p.ponerEnEtiqueta("Nombres", nombres); await p.ponerEnEtiqueta("Apellidos", "Humo");
  await p.ponerEnEtiqueta("Número de documento", doc); await p.ponerEnEtiqueta("WhatsApp", "3115550000");
  await espera(600);
  const antes = p.posts();
  await p.clic("Enviar solicitud");
  await p.esperar(`/COT-|Solicitud enviada|ya la tenemos|cotización/i.test(document.body.innerText) && !/Enviando/.test(document.body.innerText)`, "la confirmación de la solicitud", 40000);
  return { posts: p.posts() - antes };
}


const docVisitante = DOC("78001");
const campanaVisible = (p) => p.js(`(() => { const b = [...document.querySelectorAll('button[aria-label^="Avisos"]')].find((x) => x.offsetParent !== null); return b ? b.getAttribute('aria-label') : null; })()`);
const abrirCampana = (p) => p.js(`(() => { const b = [...document.querySelectorAll('button[aria-label^="Avisos"]')].find((x) => x.offsetParent !== null); if (!b) return false; b.click(); return true; })()`);
const panel = (p) => p.js(`(() => { const r = document.querySelector('[role=region][aria-label=Avisos]'); if (!r) return null; const b = r.getBoundingClientRect(); return { texto: r.innerText.replace(/\\s+/g, ' '), izq: Math.round(b.left), der: Math.round(b.right), ancho: window.innerWidth, hrefs: [...r.querySelectorAll('a')].map((a) => a.getAttribute('href')) }; })()`);
const U2 = { ...U, gerencia: "00000000-0000-0000-0000-000000000a06", oper: "00000000-0000-0000-0000-000000000a07" };
const avisosDe = (cot) => sql(`select coalesce(string_agg(usuario_id::text, ',' order by usuario_id::text), '') from public.avisos where tipo = 'cotizacion_publica' and cotizacion_id = ${cot}`).split(",").filter(Boolean);
const TARJETA = (n) => `([...document.querySelectorAll('span.font-semibold')].find((x) => x.textContent.trim() === ${JSON.stringify(n)})?.closest('div.rounded-xl'))`;
const dentro = (pn) => !!pn && pn.izq >= 0 && pn.der <= pn.ancho;

try {
  // ── 1. #78 · El VISITANTE (sin sesión) pide la cotización de un hotel bajo solicitud ──
  const visitante = await pestana({ ancho: 1280 });
  const r1 = await solicitar(visitante, docVisitante, "Visitante");
  await visitante.foto("1_visitante_solicitud_enviada");
  const cot = sql(`select id || '|' || estado || '|' || coalesce(creado_por, '') || '|' || codigo from public.cotizaciones where cliente_documento = '${docVisitante}'`).split("|");
  const idCot = Number(cot[0]); const codigo = cot[3];
  check("el visitante genera UNA cotización pendiente de tarifa, sin autor", cot[1] === "pendiente_tarifa" && cot[2] === "", cot.join("|"));
  check("el envío del navegador es UNA sola solicitud POST (el aviso lo crea el servidor)", r1.posts === 1, `POST del navegador: ${r1.posts}`);
  const esperadosIds = [U2.staff, U2.gerencia, U2.oper, U.venta].sort();
  check("avisos: exactamente quienes pueden generar/asistir cotizaciones en mayorista (administración, gerencia, operaciones y venta)", JSON.stringify(avisosDe(idCot)) === JSON.stringify(esperadosIds), avisosDe(idCot).join(","));
  check("no reciben: el administrador de minorista (otra agencia) ni el aliado, aunque el aliado figure en la lista antigua de correos", !avisosDe(idCot).includes(U.adminMin) && !avisosDe(idCot).includes(U.agencia1));
  check("no se creó contrato", sql("select count(*) from public.ventas where numero_contrato not like 'DTM-70%'") === "0");
  check("sin errores de consola del visitante", visitante.errores().length === 0, visitante.errores().join(" | "));
  await visitante.cerrar();

  // ── 2. Consumo en reposo, una pestaña a la vez (comparten la sesión del navegador): CON aviso y SIN aviso durante ~65 s cada una ──
  {
    const idle = async (uid, esperaAviso) => {
      const s = await pestana({ ancho: 1280, uid });
      await s.ir("/dashboard");
      if (esperaAviso) await s.esperar(`[...document.querySelectorAll('button[aria-label^="Avisos"]')].some((b) => /1 sin leer/.test(b.getAttribute('aria-label')) && b.offsetParent !== null)`, "el contador de avisos", 45000);
      await espera(2000);
      const p0 = s.posts(); const t0 = Date.now();
      await espera(65000);
      const n = s.posts() - p0; const seg = Math.round((Date.now() - t0) / 1000);
      const etiqueta = (await campanaVisible(s)) ?? "";
      await s.cerrar();
      return { n, seg, etiqueta };
    };
    const con = await idle(U2.staff, true);
    const sin = await idle(U.adminMin, false);
    check(`reposo ${con.seg} s: con aviso y sin aviso hacen el mismo número de sondeos (el aviso no añade solicitudes)`, con.n === sin.n && con.n <= 3, `con aviso: ${con.n} POST · sin aviso: ${sin.n} POST`);
    console.log(`  [consumo] sondeo de avisos en reposo: ${con.n} POST con aviso / ${sin.n} POST sin aviso en ${con.seg} s (intervalo configurado 30 s)`);
    check("quien NO es destinatario (administrador de minorista) ve «sin pendientes»", /sin pendientes/.test(sin.etiqueta), sin.etiqueta);
    check("el destinatario sigue viendo «1 sin leer» tras el reposo (el sondeo no lo consume)", /1 sin leer/.test(con.etiqueta), con.etiqueta);
  }

  // ── 3. La campana de quien puede asistir, en escritorio, intermedio y móvil de 390 px (sin leer todavía) ──
  for (const [nombre, cfg, quien] of [["escritorio_1280", { ancho: 1280, movil: false }, U2.staff], ["intermedio_768", { ancho: 768, movil: false }, U2.gerencia], ["movil_390", { ancho: 390, movil: true }, U2.oper]]) {
    const s = await pestana({ ...cfg, uid: quien });
    await s.ir("/dashboard");
    await s.esperar(`[...document.querySelectorAll('button[aria-label^="Avisos"]')].some((b) => /1 sin leer/.test(b.getAttribute('aria-label')) && b.offsetParent !== null)`, "el contador visible de avisos", 45000);
    check(`${nombre}: contador «1 sin leer»`, /1 sin leer/.test((await campanaVisible(s)) ?? ""));
    check(`${nombre}: se abre la campana`, await abrirCampana(s) === true);
    await espera(500);
    const pn = await panel(s);
    check(`${nombre}: el aviso dice «Nueva cotización de un visitante del tarifario» con el código ${codigo} y NO muestra «Atendida»`, !!pn && pn.texto.includes("Nueva cotización de un visitante del tarifario") && pn.texto.includes(codigo) && !/Atendida/.test(pn.texto), pn?.texto);
    check(`${nombre}: sin datos del cliente (nombre, documento, teléfono)`, !!pn && !pn.texto.includes(docVisitante) && !/Visitante|3115550000/.test(pn.texto), pn?.texto);
    check(`${nombre}: enlaza a la ficha de la cotización`, !!pn && pn.hrefs.includes(`/dashboard/cotizaciones/${idCot}`), JSON.stringify(pn?.hrefs));
    check(`${nombre}: el panel queda dentro de la pantalla`, dentro(pn), JSON.stringify(pn && { izq: pn.izq, der: pn.der, ancho: pn.ancho }));
    check(`${nombre}: sin desborde horizontal`, !(await s.desborda()));
    await s.foto(`3_campana_${nombre}`);
    check(`${nombre}: sin errores de consola`, s.errores().length === 0, s.errores().join(" | "));
    await s.cerrar();
  }

  // ── 4. Abrir el aviso lleva a la FICHA y lo marca leído SOLO para esa persona — también un asesor de ventas (rol venta) puede abrirla ──
  for (const [nombre, quien] of [["administracion", U2.staff], ["venta", U.venta]]) {
    const s = await pestana({ ancho: 1280, uid: quien });
    await s.ir("/dashboard");
    await s.esperar(`[...document.querySelectorAll('button[aria-label^="Avisos"]')].some((b) => /1 sin leer/.test(b.getAttribute('aria-label')) && b.offsetParent !== null)`, "el contador", 45000);
    await abrirCampana(s); await espera(400);
    await s.js(`(() => { const a = document.querySelector('[role=region][aria-label=Avisos] a[href="/dashboard/cotizaciones/${idCot}"]'); a.click(); })()`);
    await s.esperar(`location.pathname === '/dashboard/cotizaciones/${idCot}'`, "la ficha de la cotización", 30000);
    await s.esperar(`document.body.innerText.includes(${JSON.stringify(codigo)})`, "el código en la ficha", 30000);
    const t = await s.texto();
    check(`${nombre}: la ficha de la cotización abre y muestra su código`, t.includes(codigo));
    check(`${nombre}: la ficha muestra el estado pendiente de tarifa (no el código crudo)`, !/pendiente_tarifa/.test(t) && /endiente/.test(t), t.slice(0, 160));
    if (nombre === "administracion") await s.foto("4_ficha_cotizacion_desde_aviso");
    await espera(2500);
    check(`${nombre}: el aviso quedó leído para quien lo abrió`, sql(`select count(*) from public.avisos where cotizacion_id = ${idCot} and usuario_id = '${quien}' and leido_en is not null`) === "1");
    check(`${nombre}: sin errores de consola en la ficha`, s.errores().length === 0, s.errores().join(" | "));
    await s.cerrar();
  }
  check("los avisos de los DEMÁS destinatarios siguen sin leer (leer es por persona)", sql(`select count(*) from public.avisos where cotizacion_id = ${idCot} and leido_en is null`) === "2");

  // ── 5. «ATENDIDA» = convertida a contrato: se ve en la campana (los 3 anchos) y no depende de haber leído ──
  sql(`set session_replication_role = replica; update public.cotizaciones set estado = 'convertida', numero_contrato = '00-7899' where id = ${idCot}; set session_replication_role = origin;`);
  for (const [nombre, cfg, quien] of [["escritorio_1280", { ancho: 1280, movil: false }, U2.staff], ["intermedio_768", { ancho: 768, movil: false }, U2.gerencia], ["movil_390", { ancho: 390, movil: true }, U2.oper]]) {
    const s = await pestana({ ...cfg, uid: quien });
    await s.ir("/dashboard");
    await s.esperar(`[...document.querySelectorAll('button[aria-label^="Avisos"]')].some((b) => b.offsetParent !== null)`, "la campana", 45000);
    await abrirCampana(s); await espera(600);
    const pn = await panel(s);
    check(`atendida ${nombre}: la campana marca «Atendida · convertida a contrato»`, !!pn && /Atendida · convertida a contrato/.test(pn.texto), pn?.texto);
    check(`atendida ${nombre}: el panel cabe y no hay desborde`, dentro(pn) && !(await s.desborda()));
    if (nombre === "movil_390") check("atendida: leído/no leído sigue siendo aparte (oper aún no lo había leído y el contador lo refleja)", /1 sin leer/.test((await campanaVisible(s)) ?? ""), String(await campanaVisible(s)));
    await s.foto(`5_atendida_${nombre}`);
    await s.cerrar();
  }

  // ── 6. #76 · «Referidos» (CRM): lo que ve cada rol, en los tres anchos ──
  for (const [nombre, cfg] of [["escritorio_1280", { ancho: 1280, movil: false }], ["intermedio_768", { ancho: 768, movil: false }], ["movil_390", { ancho: 390, movil: true }]]) {
    const s = await pestana({ ...cfg, uid: U2.gerencia });
    await s.ir("/crm/referidos");
    await s.esperar(`document.body.innerText.includes('Contratos con participación de referido')`, "la pantalla de referidos", 45000);
    const t = await s.texto();
    check(`referidos ${nombre} (gerencia): estados «Pagable», «Pendiente de pago del contrato», «Contrato cancelado», el NETO con su base original y la falta de evidencia (sin cero)`, /Pagable/.test(t) && /Pendiente de pago del contrato/.test(t) && /Contrato cancelado/.test(t) && /NETO · base original/.test(t) && !/pendiente de decisión/.test(t) && /Falta la base de la comisión del aliado/.test(t) && /Sin evidencia/.test(t), t.slice(0, 300));
    check(`referidos ${nombre}: el NETO (PVP original 1.000.000, cobra 890.000) calcula 2 % sobre la base ORIGINAL = 20.000, no sobre lo cobrado (17.800) ni sobre la comisión del aliado (2.200)`, /DTM-7004/.test(t) && /20.000/.test(t) && !/17.800/.test(t) && !/2.200/.test(t));
    check(`referidos ${nombre}: referidor, aliado, porcentaje y contrato visibles`, /Odair Referidor/.test(t) && /Agencia Humo Uno/.test(t) && /Freelance Humo Dos/.test(t) && /DTM-7001/.test(t) && /1 %/.test(t) && /2 %/.test(t));
    check(`referidos ${nombre}: totales SEPARADOS por moneda (COP y USD)`, await s.js(`(() => { const d = [...document.querySelectorAll('dl > div')].map((x) => x.innerText.replace(/\\s+/g, ' ')); return d.length === 2 && d.some((x) => x.startsWith('COP')) && d.some((x) => x.startsWith('USD')); })()`));
    check(`referidos ${nombre}: las cifras son las de la base comisionable (8.000 al 1 % de 800.000; 60.000 al 2 %; USD 25)`, /8\.000/.test(t) && /60\.000/.test(t) && /25/.test(t));
    check(`referidos ${nombre}: gerencia ve los formularios de gestión`, await s.js(`!![...document.querySelectorAll('button')].find((b) => /Asignar/.test(b.textContent)) && !![...document.querySelectorAll('button')].find((b) => /Guardar referidor/.test(b.textContent))`));
    check(`referidos ${nombre}: la tarifa solo se elige entre 1 % y 2 % (sin campo libre)`, await s.js(`(() => { const sel = [...document.querySelectorAll("select[aria-label='Porcentaje']")]; return sel.length >= 2 && sel.every((x) => [...x.options].map((o) => o.textContent.trim()).join('|') === '1 %|2 %') && document.querySelectorAll('input[type=number]').length === 0; })()`));
    check(`referidos ${nombre}: sin desborde horizontal`, !(await s.desborda()));
    if (nombre === "movil_390") check("referidos movil_390: la lista de contratos se muestra como fichas (no una tabla recortada)", await s.js(`(() => { const t = document.querySelector('section table'); const lista = document.querySelector('ul.md\\\\:hidden'); return (!t || t.offsetParent === null) && !!lista && lista.offsetParent !== null; })()`));
    await s.foto(`6_referidos_${nombre}`);
    check(`referidos ${nombre}: sin errores de consola`, s.errores().length === 0, s.errores().join(" | "));
    await s.cerrar();
  }
  {
    const adm = await pestana({ ancho: 1280, uid: U2.staff });
    await adm.ir("/crm/referidos");
    await adm.esperar(`document.body.innerText.includes('Contratos con participación de referido')`, "referidos como administración", 45000);
    const t = await adm.texto();
    check("referidos (administración): consulta SIN formularios ni botones de cambio", /Solo superadmin y gerencia pueden asignarlos o cambiarlos/.test(t) && (await adm.js(`document.querySelectorAll('main form:not([role=search])').length === 0 && ![...document.querySelectorAll('button')].some((b) => /Terminar asignación|Guardar|Aplicar código/.test(b.textContent))`)));
    await adm.foto("6_referidos_administracion");
    await adm.cerrar();
    for (const [nombre, quien] of [["operaciones", U2.oper], ["venta", U.venta]]) {
      const s = await pestana({ ancho: 1280, uid: quien });
      await s.ir("/crm/referidos"); await espera(2500);
      const tx = await s.texto();
      check(`referidos (${nombre}): «Módulo no disponible», sin datos`, /Módulo no disponible para tu usuario/.test(tx) && !/Odair|DTM-70/.test(tx), tx.slice(0, 160));
      await s.cerrar();
    }
    const aliado = await pestana({ ancho: 1280, uid: U.agencia1 });
    await aliado.ir("/crm/referidos"); await espera(3000);
    const ta = await aliado.texto();
    check("referidos (aliado B2B): no ve nada del CRM (ni su propio referidor ni los de otros)", /Módulo no disponible para tu usuario/.test(ta) && !/Odair|DTM-70|Contratos con participación|Códigos de registro por confirmar|Asignar un aliado/.test(ta), `${await aliado.url()} · ${ta.slice(0, 200)}`);
    await aliado.cerrar();
  }

  // ── 7. #76 · Acciones por la interfaz (móvil 390 px): asignar, aplicar código y terminar ──
  {
    const s = await pestana({ ancho: 390, movil: true, uid: U2.gerencia });
    await s.ir("/crm/referidos");
    await s.esperar(`document.body.innerText.includes('Asignar un aliado a un referidor')`, "el formulario de asignación", 45000);
    await s.js(`(() => { const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
      const f = [...document.querySelectorAll('form')].find((x) => /Asignar un aliado|Agencia o freelance referido/.test(x.parentElement.innerText) && /Asignar$/.test(x.querySelector('button')?.textContent.trim() ?? ''));
      const [al, re] = f.querySelectorAll('select'); set(al, '9803'); set(re, '9901'); set(f.querySelector("select[aria-label='Porcentaje']"), '0.02'); })()`);
    const antes = sql("select count(*) from public.aliado_referidores");
    await s.js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Asignar').click()`);
    await s.esperar(`/Asignación creada/.test(document.body.innerText)`, "la confirmación de asignación", 30000);
    check("asignar por la pantalla (390 px): se crea UNA asignación vigente al 2 % para el aliado elegido", sql("select count(*) from public.aliado_referidores") === String(Number(antes) + 1) && sql("select pct || '|' || origen from public.aliado_referidores where aliado_id = 9803 and vigente_hasta is null") === "0.0200|manual");
    await s.foto("7_asignar_movil_390");
    await s.js(`(() => { const f = [...document.querySelectorAll('form')].find((x) => /Aplicar código/.test(x.innerText));
      const set = (el, v, tipo) => { Object.getOwnPropertyDescriptor(tipo === 'sel' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event(tipo === 'sel' ? 'change' : 'input', { bubbles: true })); };
      set(f.querySelector('select'), '9805', 'sel'); set(f.querySelector('input'), 'odair-1', 'inp'); })()`);
    await s.js(`[...document.querySelectorAll('button')].find((b) => /Aplicar código/.test(b.textContent)).click()`);
    await s.esperar(`/Asignación creada por el código/.test(document.body.innerText)`, "la confirmación del código", 30000);
    check("aplicar un código por la pantalla (gerencia): referidor y 1 % salen de la regla guardada (origen código)", sql("select pct || '|' || origen || '|' || codigo || '|' || referidor_id from public.aliado_referidores where aliado_id = 9805 and vigente_hasta is null") === "0.0100|codigo|ODAIR-1|9901");
    await s.js(`(() => { const f = [...document.querySelectorAll('form')].find((x) => /Aplicar código/.test(x.innerText));
      const set = (el, v, tipo) => { Object.getOwnPropertyDescriptor(tipo === 'sel' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event(tipo === 'sel' ? 'change' : 'input', { bubbles: true })); };
      set(f.querySelector('select'), '9803', 'sel'); set(f.querySelector('input'), 'noexiste', 'inp'); })()`);
    await s.js(`[...document.querySelectorAll('button')].find((b) => /Aplicar código/.test(b.textContent)).click()`);
    await s.esperar(`/El código de referido no es válido/.test(document.body.innerText)`, "el rechazo del código inválido", 30000);
    check("un código inválido no cambia nada y se explica", sql("select pct from public.aliado_referidores where aliado_id = 9803 and vigente_hasta is null") === "0.0200");
    await s.js(`(() => { const li = [...document.querySelectorAll('li')].find((x) => /Agencia Humo Tres/.test(x.innerText) && /Terminar asignación/.test(x.innerText)); [...li.querySelectorAll('button')].find((b) => /Terminar asignación/.test(b.textContent)).click(); })()`);
    await s.esperar(`/Asignación terminada/.test(document.body.innerText)`, "la confirmación de terminar", 30000);
    check("terminar la asignación la cierra y conserva el historial", sql("select count(*) from public.aliado_referidores where aliado_id = 9803 and vigente_hasta is not null") === "1" && sql("select count(*) from public.aliado_referidores where aliado_id = 9803 and vigente_hasta is null") === "0");
    check("las acciones (390 px): sin desborde y sin errores de consola", !(await s.desborda()) && s.errores().length === 0, s.errores().join(" | "));
    await s.cerrar();
  }

  // ── 8. #76 · Códigos del registro POR CONFIRMAR en CRM → Referidos: lo que ve gerencia y lo que ve administración (3 anchos) ──
  for (const [nombre, cfg] of [["escritorio_1280", { ancho: 1280, movil: false }], ["intermedio_768", { ancho: 768, movil: false }], ["movil_390", { ancho: 390, movil: true }]]) {
    const s = await pestana({ ...cfg, uid: U2.gerencia });
    await s.ir("/crm/referidos");
    await s.esperar(`document.body.innerText.includes('Códigos de registro por confirmar')`, "la sección de códigos por confirmar", 45000);
    const t = await s.texto();
    check(`códigos ${nombre} (gerencia): los tres candidatos con su resolución (válido al 1 %, inexistente, pendiente de aprobar)`, /Freelance Ya Aprobado/.test(t) && /ODAIR-1/.test(t) && /Odair Referidor/.test(t) && /NOEXISTE/.test(t) && /no corresponde hoy a un referidor activo/.test(t) && /Decide al aprobar el registro/.test(t), t.slice(0, 300));
    check(`códigos ${nombre} (gerencia): solo el registro YA aprobado y enlazado ofrece «Aplicar decisión»`, await s.js(`[...document.querySelectorAll('button')].filter((b) => /Aplicar decisión/.test(b.textContent)).length === 1`));
    check(`códigos ${nombre}: sin desborde horizontal`, !(await s.desborda()));
    await s.foto(`8_codigos_${nombre}`);
    check(`códigos ${nombre}: sin errores de consola`, s.errores().length === 0, s.errores().join(" | "));
    await s.cerrar();
  }
  {
    const adm = await pestana({ ancho: 1280, uid: U2.staff });
    await adm.ir("/crm/referidos");
    await adm.esperar(`document.body.innerText.includes('Códigos de registro por confirmar')`, "códigos por confirmar como administración", 45000);
    const t = await adm.texto();
    check("códigos (administración): VE los candidatos pero SIN opciones, SIN «Aplicar decisión» y con la explicación", /Freelance Ya Aprobado/.test(t) && /Administración puede ver esta información, pero no asignar ni cambiar referidores ni porcentajes/.test(t)
      && await adm.js(`document.querySelectorAll('input[type=radio]').length === 0 && ![...document.querySelectorAll('button')].some((b) => /Aplicar decisión/.test(b.textContent))`));
    await adm.foto("8_codigos_administracion");
    await adm.cerrar();
  }
  {
    const s = await pestana({ ancho: 390, movil: true, uid: U2.gerencia });
    await s.ir("/crm/referidos");
    await s.esperar(`[...document.querySelectorAll('button')].some((b) => /Aplicar decisión/.test(b.textContent))`, "el botón de decisión", 45000);
    check("la opción por defecto es confirmar lo que resuelve la regla guardada (Odair Referidor · 1 %)", await s.js(`(() => { const r = [...document.querySelectorAll('input[type=radio]')].find((x) => x.checked); return !!r && /Confirmar: Odair Referidor · 1 %/.test(r.parentElement.textContent); })()`));
    await s.js(`[...document.querySelectorAll('button')].find((b) => /Aplicar decisión/.test(b.textContent)).click()`);
    await s.esperar(`/Decisión aplicada/.test(document.body.innerText)`, "la confirmación de la decisión", 30000);
    check("confirmar por la pantalla: la asignación sale de la regla guardada (ficha 9804, 1 %, código ODAIR-1) y el candidato queda «confirmado»", sql("select pct || '|' || origen || '|' || codigo from public.aliado_referidores where aliado_id = 9804 and vigente_hasta is null") === "0.0100|codigo|ODAIR-1"
      && sql("select referido_estado from public.b2b_solicitudes s join public.usuarios u on u.id = s.usuario_id where u.id = '00000000-0000-0000-0000-000000000a0a'") === "confirmado");
    await s.foto("8_codigo_confirmado_movil_390");
    await s.cerrar();
  }

  // ── 9. #76 · Aprobación B2B: administración aprueba SIN decidir el referido; gerencia confirma al aprobar (escritorio y 390 px) ──
  {
    const s = await pestana({ ancho: 1280, uid: U2.staff });
    await s.ir("/dashboard/usuarios/b2b");
    await s.esperar(`document.body.innerText.includes('Freelance Aprueba Admin')`, "la tarjeta de la solicitud", 45000);
    const t = await s.texto();
    check("aprobación (administración): ve el código candidato y NO tiene opciones ni campo de texto de código", /Código de referido escrito en el registro/.test(t) && /ODAIR-1/.test(t) && /Solo superadmin o gerencia confirman el referido y el porcentaje/.test(t)
      && await s.js(`document.querySelectorAll('input[type=radio]').length === 0 && !document.querySelector("[id^='cod-ref-']")`));
    await s.foto("9_aprobacion_administracion");
    const id = sql("select s.id from public.b2b_solicitudes s join public.usuarios u on u.id = s.usuario_id where u.nombre = 'Freelance Aprueba Admin'");
    await s.js(`(() => { const card = ${TARJETA("Freelance Aprueba Admin")}; const sel = card.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'nueva'); sel.dispatchEvent(new Event('change', { bubbles: true })); [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Aprobar').click(); })()`);
    await s.esperar(`/aprobada/.test(${TARJETA("Freelance Aprueba Admin")}?.innerText ?? '')`, "la solicitud aprobada", 45000);
    check("administración APROBÓ el registro y NO asignó referido: el candidato sigue por confirmar", sql(`select referido_estado || '|' || estado from public.b2b_solicitudes where id = ${id}`) === "candidato|aprobada"
      && sql(`select count(*) from public.aliado_referidores r join public.usuarios u on u.aliado_id = r.aliado_id where u.nombre = 'Freelance Aprueba Admin'`) === "0");
    await s.cerrar();
  }
  for (const [nombre, cfg] of [["escritorio_1280", { ancho: 1280, movil: false }], ["movil_390", { ancho: 390, movil: true }]]) {
    const s = await pestana({ ...cfg, uid: U2.gerencia });
    await s.ir("/dashboard/usuarios/b2b");
    await s.esperar(`document.body.innerText.includes('Solicitante Humo')`, "la tarjeta de la solicitud", 45000);
    const t = await s.texto();
    check(`aprobación ${nombre} (gerencia): código candidato resuelto + opciones (confirmar, otro, no asignar, decidir después)`, /Corresponde a Odair Referidor al 2 %/.test(t) && await s.js(`document.querySelectorAll("input[type=radio]").length >= 4 && !document.querySelector("[id^='cod-ref-']")`));
    check(`aprobación ${nombre}: sin desborde horizontal`, !(await s.desborda()));
    await s.foto(`9_aprobacion_gerencia_${nombre}`);
    if (nombre === "movil_390") {
      const id = sql("select s.id from public.b2b_solicitudes s join public.usuarios u on u.id = s.usuario_id where u.nombre = 'Solicitante Humo'");
      await s.js(`(() => { const card = ${TARJETA("Solicitante Humo")}; const sel = card.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'nueva'); sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await espera(400);
      await s.js(`[...${TARJETA("Solicitante Humo")}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Aprobar').click()`);
      await s.esperar(`/referido asignado para las compras futuras/.test(document.body.innerText)`, "el aviso de aprobación y referido", 45000);
      check("gerencia APRUEBA y CONFIRMA en un paso: la ficha nueva queda con Odair Referidor al 2 % (código ODAIR-2) y el candidato «confirmado»", sql(`select referido_estado || '|' || estado from public.b2b_solicitudes where id = ${id}`) === "confirmado|aprobada"
        && sql(`select r.pct || '|' || r.origen || '|' || r.codigo from public.aliado_referidores r join public.usuarios u on u.aliado_id = r.aliado_id where u.nombre = 'Solicitante Humo' and r.vigente_hasta is null`) === "0.0200|codigo|ODAIR-2");
      await s.foto("9_aprobado_confirmado_movil_390");
    }
    check(`aprobación ${nombre}: sin errores de consola`, s.errores().length === 0, s.errores().join(" | "));
    await s.cerrar();
  }

  // ── 10. #76 · Formulario PÚBLICO de registro: campo de código de referido opcional (3 anchos) y validación de formato ──
  for (const [nombre, cfg] of [["escritorio_1280", { ancho: 1280, movil: false }], ["intermedio_768", { ancho: 768, movil: false }], ["movil_390", { ancho: 390, movil: true }]]) {
    const s = await pestana({ ...cfg });
    await s.ir("/portal/registro");
    await s.esperar(`!!document.querySelector('#reg-codigo-referido')`, "el campo de código de referido", 45000);
    const t = await s.texto();
    check(`registro ${nombre}: campo «Código de referido (opcional)» con su explicación, junto a los demás datos`, /Código de referido \(opcional\)/.test(t) && /Lo revisamos al aprobar tu registro; no cambia tu comisión/.test(t));
    check(`registro ${nombre}: sin desborde horizontal`, !(await s.desborda()));
    await s.foto(`10_registro_${nombre}`);
    if (nombre === "movil_390") {
      const cuentas = sql("select count(*) from auth.users");
      // En este formulario la etiqueta y el campo son HERMANOS (no el campo dentro de la etiqueta): se busca en el contenedor de la etiqueta.
      const llenar = (etiqueta, valor) => s.js(`(() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(etiqueta)})); const el = l?.parentElement?.querySelector('input,textarea,select'); if (!el) return false;
        Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(valor)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      for (const [e, v] of [["Nombre / Razón social", "Agencia Formato Mal"], ["Número de documento", "88001"], ["Correo", "formato@humo.test"], ["Contraseña *", "secreta123"], ["Repetir contraseña *", "secreta123"]]) check(`registro movil_390: campo «${e}» encontrado`, await llenar(e, v));
      await s.poner("#reg-codigo-referido", "a b");
      await s.clic(/Continuar: enviar código al correo/);
      await s.esperar(`/El código de referido usa de 4 a 20 letras, números o guiones/.test(document.body.innerText)`, "el aviso de formato", 30000);
      check("un código con formato inválido se avisa ANTES de crear la cuenta (no se creó ningún usuario ni se avanzó al paso del código)", sql("select count(*) from auth.users") === cuentas && !(await s.js(`!!document.querySelector("[data-testid=paso-codigo]")`)));
      await s.foto("10_registro_formato_invalido_movil_390");
    }
    check(`registro ${nombre}: sin errores de consola`, s.errores().length === 0, s.errores().join(" | "));
    await s.cerrar();
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
