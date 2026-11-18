// RECORRIDO NAVEGADO de #1 (personas de TODA cotización en el CRM) en la app COMPILADA (`next start`) con sesiones y base LOCALES (entorno_1_local.sh en marcha): el visitante pide cotización
// de un hotel bajo solicitud, el personal la ve en el CRM antes de cualquier contrato (escritorio y 390 px), la valora desde su ficha, y se comprueban acceso, aislamiento por agencia y errores de consola.
// Se maneja Edge sin interfaz por CDP (WebSocket nativo de Node). Env: HUMO_SALIDA (carpeta con env.json). Escribe capturas y informe.json en esa carpeta.
import { spawn, execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";

const SALIDA = process.env.HUMO_SALIDA;
const ENV = JSON.parse(fs.readFileSync(`${SALIDA}/env.json`, "utf8"));
const { app: APP, secreto: SECRETO, db: DB, contenedor: CT } = ENV;
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PUERTO_CDP = 9271;
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

try {
  // ── 0. Acceso: sin sesión y como aliado B2B el CRM no se abre ──
  {
    const anon = await pestana();
    await anon.ir("/crm/personas-cotizacion");
    check("sin sesión el CRM redirige al ingreso", /\/login/.test(await anon.url()), await anon.url());
    await anon.cerrar();
  }

  // ── 1. El VISITANTE pide la cotización de un hotel bajo solicitud (sin sesión) ──
  const visitante = await pestana({ ancho: 1280 });
  const r1 = await solicitar(visitante, celdas.visitante, "Visitante");
  await visitante.foto("1_visitante_solicitud_enviada");
  const cot = sql(`select id || '|' || estado || '|' || coalesce(creado_por_id::text, '') from public.cotizaciones where cliente_documento = '${celdas.visitante}'`).split("|");
  check("el visitante genera UNA cotización pendiente de tarifa", cot[1] === "pendiente_tarifa", cot.join("|"));
  const id1 = Number(cot[0]);
  check("la cotización queda sin autor (visitante)", cot[2] === "");
  check("el titular quedó registrado como puesto desde que pide (sin contrato)", sql(`select count(*) from public.cotizacion_participantes where cotizacion_id = ${id1} and rol = 'titular' and activo`) === "1");
  check("no se creó contrato ni venta", sql("select count(*) from public.ventas") === "0");
  check("el envío del navegador es una sola solicitud POST (Server Action)", r1.posts === 1, `POST del navegador: ${r1.posts}`);
  check("sin errores de consola del visitante", visitante.errores().length === 0, visitante.errores().join(" | "));
  await visitante.cerrar();

  // ── 2. El PERSONAL lo ve en el CRM antes de cualquier contrato: escritorio y móvil ──
  for (const [nombre, cfg] of [["escritorio", { ancho: 1280, movil: false }], ["movil390", { ancho: 390, movil: true }]]) {
    const s = await pestana({ ...cfg, uid: U.staff });
    await s.ir("/crm/personas-cotizacion");
    const t = await buscar(s, celdas.visitante);
    check(`${nombre}: el CRM lista al visitante con la etiqueta «Pendiente de tarifa»`, t.includes(celdas.visitante) && /Pendiente de tarifa/.test(t), t.slice(0, 240));
    check(`${nombre}: no se muestra el código crudo pendiente_tarifa`, !/pendiente_tarifa/.test(t));
    check(`${nombre}: una sola persona encontrada`, t.includes("1 persona(s)"), t.slice(0, 120));
    check(`${nombre}: la ficha del visitante es provisional (sin tipo de documento)`, /rovisional/i.test(t), t.slice(0, 300));
    check(`${nombre}: sin desborde horizontal`, !(await s.desborda()));
    await s.foto(`2_crm_${nombre}`);
    check(`${nombre}: sin errores de consola`, s.errores().length === 0, s.errores().join(" | "));
    await s.cerrar();
  }

  // ── 3. Desde la ficha el personal valora la solicitud: sigue UN puesto y el CRM lo conserva ──
  {
    const s = await pestana({ ancho: 1280, uid: U.staff });
    await s.ir(`/dashboard/cotizaciones/${id1}`);
    const t = await s.texto();
    check("la ficha de una solicitud pendiente abre", t.includes(celdas.visitante) || /Solicitud|Pendiente/i.test(t), t.slice(0, 160));
    check("la ficha NO muestra el aviso de personas pendientes (el registro quedó completo)", !/quedaron pendientes de registrar/.test(t));
    await s.foto("3_ficha_pendiente_tarifa");
    await s.esperar(`!!document.querySelector('#neta-hotel')`, "el formulario de neta de la solicitud");
    await s.poner("#neta-hotel", "1200000");
    await espera(500);
    await s.clic("Cargar neta y valorar");
    await s.esperar(`!document.body.innerText.includes('Calculando')`, "el fin del cálculo", 40000);
    await espera(2500);
    const est = sql(`select estado from public.cotizaciones where id = ${id1}`);
    check("valorar la solicitud desde su ficha la abre (sin contrato)", est === "abierta" && sql("select count(*) from public.ventas") === "0", est);
    check("valorar NO duplica ni pierde el puesto del titular", sql(`select count(*) from public.cotizacion_participantes where cotizacion_id = ${id1} and rol = 'titular' and activo`) === "1");
    await s.ir(`/dashboard/cotizaciones/${id1}`);
    check("la ficha ya abierta no muestra aviso de personas pendientes", !/quedaron pendientes de registrar/.test(await s.texto()));
    await s.foto("3_ficha_valorada");
    check("sin errores de consola en la ficha", s.errores().length === 0, s.errores().join(" | "));
    await s.cerrar();
  }

  // ── 4. Un aliado B2B con sesión pide la misma clase de solicitud: queda a SU nombre; el CRM le muestra solo lo suyo ──
  {
    const a = await pestana({ ancho: 1280, uid: U.agencia1 });
    const r = await solicitar(a, celdas.aliado, "Aliado");
    const fila = sql(`select id || '|' || coalesce(creado_por_id::text, '') from public.cotizaciones where cliente_documento = '${celdas.aliado}'`).split("|");
    check("la solicitud del aliado B2B queda sellada a su nombre", fila[1] === U.agencia1, fila.join("|"));
    check("la solicitud del aliado tiene su titular registrado", sql(`select count(*) from public.cotizacion_participantes where cotizacion_id = ${fila[0]} and rol = 'titular' and activo`) === "1");
    check("el envío del aliado es una sola solicitud POST del navegador", r.posts === 1, `POST: ${r.posts}`);
    check("sin errores de consola del aliado", a.errores().length === 0, a.errores().join(" | "));
    await a.cerrar();
    const propia = await pestana({ ancho: 1280, uid: U.agencia1 });
    await propia.ir("/crm/personas-cotizacion");
    let t = await buscar(propia, celdas.aliado);
    check("el aliado ve en el CRM la persona de SU solicitud", t.includes(celdas.aliado), t.slice(0, 200));
    t = await buscar(propia, celdas.visitante);
    check("el aliado NO ve a la persona del visitante", !t.includes(celdas.visitante), t.slice(0, 200));
    await propia.foto("4_crm_aliado_propio");
    await propia.cerrar();
    const otra = await pestana({ ancho: 1280, uid: U.agencia2 });
    await otra.ir("/crm/personas-cotizacion");
    t = await buscar(otra, celdas.aliado);
    check("otro aliado NO ve la persona de la solicitud de la primera agencia", !t.includes(celdas.aliado), t.slice(0, 200));
    await otra.cerrar();
    const s = await pestana({ ancho: 1280, uid: U.staff });
    await s.ir("/crm/personas-cotizacion");
    t = await buscar(s, celdas.aliado);
    check("el personal autorizado ve la solicitud del aliado", t.includes(celdas.aliado), t.slice(0, 200));
    await s.cerrar();
  }


  // ── 5. Aislamiento por agencia: un administrador de MINORISTA no ve las personas de MAYORISTA ──
  {
    const m = await pestana({ ancho: 1280, uid: U.adminMin });
    await m.ir("/crm/personas-cotizacion");
    const t1 = await buscar(m, celdas.visitante), t2 = await buscar(m, celdas.aliado);
    check("minorista no ve a los visitantes ni a los aliados de mayorista", !t1.includes(celdas.visitante) && !t2.includes(celdas.aliado), (t1 + t2).slice(0, 200));
    await m.foto("5_crm_minorista_aislamiento");
    await m.cerrar();
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
