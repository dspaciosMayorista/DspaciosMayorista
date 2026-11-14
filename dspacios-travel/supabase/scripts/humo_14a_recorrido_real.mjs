// RECORRIDO #14-A en la app COMPILADA con tarifas sintéticas REALES (motor de precios sin simular): formulario → revisión → generar → conversión → documento y liquidación, con tres escenarios:
//   1) venta asistida con recobro y distribución · 2) aliado directo bajo comisión con recobro · 3) NETO (venta asistida) con 2 adultos, 1 niño y un servicio adicional.
// Se maneja el navegador (Edge sin interfaz, CDP) con sesiones REALES de la base local; los importes se verifican contra la base y contra los documentos. Uso: entorno_14a_real.sh en marcha.
// Env: HUMO_SALIDA (carpeta con env.json), HUMO_ESCENARIOS (por defecto 1,2,3).
import { spawn, execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";

const SALIDA = process.env.HUMO_SALIDA;
const ENV = JSON.parse(fs.readFileSync(`${SALIDA}/env.json`, "utf8"));
const { app: APP, secreto: SECRETO, db: DB, contenedor: CT } = ENV;
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const U = { staff: "00000000-0000-0000-0000-00000014a001", aliado: "00000000-0000-0000-0000-00000014a002", aliadoNeto: "00000000-0000-0000-0000-00000014a003" };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s).toString("base64url");
const jwt = (p) => { const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })); const c = b64(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + 14400 })); return `${h}.${c}.${createHmac("sha256", SECRETO).update(`${h}.${c}`).digest("base64url")}`; };
const tokenDe = (uid) => jwt({ role: "authenticated", sub: uid, session_id: uid.replace(/^00000000/, "5e550000"), aud: "authenticated" });
const cookieDe = (uid) => { const t = tokenDe(uid); const s = JSON.stringify({ access_token: t, token_type: "bearer", expires_in: 14400, expires_at: Math.floor(Date.now() / 1000) + 14400, refresh_token: "x", user: { id: uid, aud: "authenticated", role: "authenticated", email: `${uid}@humo.test` } }); return { name: "sb-127-auth-token", value: "base64-" + Buffer.from(s).toString("base64url") }; };

// ── SQL (docker exec) ──
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const json = (q) => JSON.parse(sql(q));
const num = (x) => Number(x);

// ── Navegador ──
fs.mkdirSync(SALIDA, { recursive: true });
const proc = spawn(EDGE, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--remote-debugging-port=9263", `--user-data-dir=${SALIDA}/perfil-real`, "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { if ((await fetch("http://127.0.0.1:9263/json/version")).ok) break; } catch { /* aún no */ } await espera(250); }
async function pestana() {
  const t = await (await fetch("http://127.0.0.1:9263/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((ok) => (ws.onopen = ok));
  let id = 0; const pend = new Map(); const ev = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else ev.push(d); };
  const cmd = (method, params = {}) => new Promise((ok) => { const k = ++id; pend.set(k, ok); ws.send(JSON.stringify({ id: k, method, params })); });
  const evalJs = async (expression) => { const r = await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500)); return r.result?.result?.value; };
  await cmd("Page.enable"); await cmd("Network.enable"); await cmd("Runtime.enable");
  await cmd("Emulation.setDeviceMetricsOverride", { width: 1100, height: 1500, deviceScaleFactor: 1, mobile: false });
  const p = {
    cmd, evalJs, ev,
    sesion: (uid) => cmd("Network.setCookie", { ...cookieDe(uid), url: APP }),
    ir: async (ruta) => { ev.length = 0; await cmd("Page.navigate", { url: `${APP}${ruta}` }); const t0 = Date.now(); while (Date.now() - t0 < 30000 && !ev.some((e) => e.method === "Page.loadEventFired")) await espera(150); await espera(800); },
    esperar: async (expr, que, ms = 40000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await evalJs(expr)) return; } catch { /* navegando */ } await espera(250); } throw new Error(`tiempo agotado: ${que} · ${String((await evalJs("document.body.innerText.replace(/\\s+/g,' ')").catch(() => "")) ).slice(-600)}`); },
    texto: () => evalJs("document.body.innerText.replace(/\\s+/g, ' ')"),
    escribir: (sel, valor) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(valor)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`),
    boton: (texto) => evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((x) => ${typeof texto === "string" ? `x.textContent.trim() === ${JSON.stringify(texto)}` : `${texto}.test(x.textContent)`}); if (!b) return false; b.click(); return true; })()`),
    foto: async (nombre) => { const m = await cmd("Page.getLayoutMetrics"); const h = Math.min(Math.ceil(m.result.cssContentSize.height), 5000); await cmd("Emulation.setDeviceMetricsOverride", { width: 1100, height: h, deviceScaleFactor: 1, mobile: false }); const s = await cmd("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${SALIDA}/${nombre}.png`, Buffer.from(s.result.data, "base64")); await cmd("Emulation.setDeviceMetricsOverride", { width: 1100, height: 1500, deviceScaleFactor: 1, mobile: false }); },
    cerrar: async () => { ws.close(); await fetch(`http://127.0.0.1:9263/json/close/${t.id}`).catch(() => {}); },
  };
  return p;
}

const informe = { escenarios: {}, errores: [] };
const fmt = (n) => Math.round(n).toLocaleString("es-CO"); // 1100000 → «1.100.000»
const checks = [];
function check(escenario, nombre, ok, detalle = "") { checks.push({ escenario, nombre, ok: !!ok, detalle }); if (!ok) informe.errores.push(`${escenario}: ${nombre} ${detalle}`); }
const tiene = (texto, n) => texto.includes(fmt(n));

const ITEM = (extra = {}) => ({
  id: "h1", tipo: "hotel", modulo: "porcion_terrestre", paqueteId: 9101, hotelId: 9101, bloqueoId: null, hotelNombre: "Hotel Real 14A", destino: "CARTAGENA 14A", fotoUrl: null,
  categoria: "Estandar", regimen: "Desayuno", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0,
  pax: 2, precio: 750000, edadesMenores: [], moneda: "COP", ...extra,
});
const TOUR = (pax) => ({ id: "t1", tipo: "tour", paqueteId: 9101, servicioId: 9101, nombre: "Tour Islas 14A", destino: "CARTAGENA 14A", fotoUrl: null, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", noches: 3, pax, precio: 50000 * pax, moneda: "COP", hotelItemId: "h1" });

async function cargarCheckout(p, uid, carrito) {
  await p.sesion(uid);
  await p.ir("/tarifario");
  await p.evalJs(`localStorage.setItem('dspacios_cart_v1', ${JSON.stringify(JSON.stringify(carrito))}); true`);
  await p.ir("/tarifario/checkout");
}
async function llenarTitular(p) {
  const por = async (etiqueta, valor) => p.evalJs(`(() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent === ${JSON.stringify(etiqueta)}); if (!l) return false; const i = l.parentElement.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(valor)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await por("Nombres *", "Ana"); await por("Apellidos *", "Pérez");
  if (!(await por("Número de documento *", "12345"))) await por("Documento *", "12345");
  await por("Teléfono / WhatsApp *", "3000000000");
}
const generarHabilitado = (p) => p.evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Generar cotización y enviar solicitud/.test(x.textContent)); return !!b && !b.disabled; })()`);
const planDe = (id) => json(`select (payload->'b2bAsistido')::text from public.cotizaciones where id = ${id}`);
const cotDeCodigo = (codigo) => json(`select row_to_json(t)::text from (select id, codigo, share_token, precio_venta, detalle->'resumenPrecios' is not null as tiene_resumen from public.cotizaciones where codigo = '${codigo}') t`);
const ventaDe = (n) => json(`select row_to_json(t)::text from (select numero_contrato, share_token, estado, precio_venta, impuesto, comision_b2b, comision_estado, modo_compra, recobro_total, recobro_empresa, recobro_aliado, canal, tipo_asesor, aliado_id from public.ventas where numero_contrato = '${n}') t`);
const sumaItems = (n) => num(sql(`select coalesce(sum(adultos * tarifa_adulto + ninos * tarifa_nino), 0) from public.contrato_items where numero_contrato = '${n}'`));

async function convertir(p, cotId) {
  await p.ir(`/dashboard/cotizaciones/${cotId}`);
  await p.esperar(`[...document.querySelectorAll('button')].some((b) => /Confirmar → generar contrato/.test(b.textContent))`, "el botón de conversión");
  await p.boton(/Confirmar → generar contrato/);
  await p.esperar(`[...document.querySelectorAll('button')].some((b) => /Generar contrato\\(s\\)/.test(b.textContent))`, "el formulario de conversión");
  // Moneda de cobro: COP; asesor: el primero disponible; pasajeros: el titular ya viene; se completan los demás con datos ficticios.
  await p.evalJs(`(() => { const s = document.querySelector('#moneda-cobro-carrito-select'); if (s) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'COP'); s.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
  await p.evalJs(`(() => { const sel = [...document.querySelectorAll('select')].find((s) => /Asesor|asesor/.test(s.parentElement.textContent)); if (sel && sel.options.length > 1 && !sel.value) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, sel.options[1].value); sel.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
  return p.texto();
}


/** Tipo de venta asistida: elige el aliado, la modalidad y el recobro/distribución; espera la revisión con el recobro y devuelve el texto de la revisión. */
async function asistida(p, { modo, recobro, dist }) {
  await p.esperar(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Aliado (B2B)')`, "tipo de venta");
  await p.boton("Aliado (B2B)");
  await p.esperar(`!!document.querySelector('#asist-aliado')`, "buscador de aliado");
  await p.escribir("#asist-aliado", "Agencia Real 14A · Agencia");
  await p.esperar(`!!document.querySelector('[data-testid="recobro-dist"]')`, "campos de recobro");
  if (modo === "neta") await p.boton("NETO");
  if (recobro === null) { await p.esperar(`/Total exigible/.test(document.body.innerText)`, "la revisión de términos sin recobro", 60000); return p.texto(); }
  await p.escribir('[data-testid="recobro-total"]', recobro);
  await p.escribir('[data-testid="recobro-dist"]', dist);
  await p.esperar(`/Recobro incluido/.test(document.body.innerText)`, "la revisión de términos con el recobro", 60000);
  return p.texto();
}
async function generar(p) {
  await llenarTitular(p);
  await p.esperar(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Generar cotización y enviar solicitud/.test(x.textContent)); return !!b && !b.disabled; })()`, "Generar habilitado");
  await p.boton(/Generar cotización y enviar solicitud/);
  await p.esperar(`/¡Cotización generada!/.test(document.body.innerText)`, "cotización generada", 60000);
  const t = await p.texto();
  const codigo = /Tu cotización:\s*(\S+)/.exec(t)?.[1];
  if (!codigo) throw new Error(`sin código de cotización en: ${t.slice(0, 300)}`);
  return codigo;
}

const out = {};

/** Números de un texto: «Etiqueta … $ 1.234.567» → 1234567. */
const importeDe = (texto, etiqueta) => { const m = new RegExp(etiqueta.source + "[^$]{0,80}\\$\\s*([\\d.]+)").exec(texto); return m ? Number(m[1].replace(/\./g, "")) : null; };
const entre = (texto, desde, hasta) => { const a = texto.indexOf(desde); if (a < 0) return ""; const b = texto.indexOf(hasta, a); return texto.slice(a, b < 0 ? undefined : b); };

/** Llena el formulario de conversión: asesor, moneda, pasajeros (todos los datos) y genera. Devuelve el número de contrato. */
async function generarContrato(p, cotId, pasajeros, costosManuales = []) {
  await p.ir(`/dashboard/cotizaciones/${cotId}`);
  await p.esperar(`[...document.querySelectorAll('button')].some((b) => /Confirmar → generar contrato/.test(b.textContent))`, "el botón de conversión");
  await p.boton(/Confirmar → generar contrato/);
  await p.esperar(`[...document.querySelectorAll('button')].some((b) => /Generar contrato\\(s\\)/.test(b.textContent))`, "el formulario de conversión");
  await p.evalJs(`(() => {
    const set = (el, v, ev) => { Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event(ev, { bubbles: true })); };
    const mon = document.querySelector('#moneda-cobro-carrito-select'); if (mon) set(mon, 'COP', 'change');
    const ase = [...document.querySelectorAll('select')].find((s) => /Asesor/.test(s.parentElement.textContent)); if (ase && ase.options.length > 1) set(ase, ase.options[1].value, 'change');
    return true; })()`);
  const filas = await p.evalJs("[...document.querySelectorAll('div.rounded-lg.bg-gray-50')].filter((d) => /Nombres/.test(d.textContent)).length");
  if (filas !== pasajeros.length) throw new Error(`el formulario trae ${filas} filas de pasajeros y la prueba ${pasajeros.length}`);
  for (let k = 0; k < pasajeros.length; k++) {
    const x = pasajeros[k];
    await p.evalJs(`(() => {
      const fila = [...document.querySelectorAll('div.rounded-lg.bg-gray-50')].filter((d) => /Nombres/.test(d.textContent))[${k}];
      const campo = (et) => { const l = [...fila.querySelectorAll('label')].find((z) => z.textContent.trim() === et); return l ? l.parentElement.querySelector('input,select') : null; };
      const set = (el, v, ev) => { if (!el) return; Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event(ev, { bubbles: true })); };
      set(campo('Nombres'), ${JSON.stringify(x.nombres)}, 'input'); set(campo('Apellidos'), ${JSON.stringify(x.apellidos)}, 'input');
      set(campo('Tipo doc'), ${JSON.stringify(x.tipoDoc)}, 'change'); set(campo('N° doc'), ${JSON.stringify(x.doc)}, 'input');
      set(campo('Nacimiento'), ${JSON.stringify(x.nacimiento)}, 'input'); set(campo('Nacimiento'), ${JSON.stringify(x.nacimiento)}, 'change');
      set(campo('Nacionalidad'), 'Colombiana', 'input');
      return true; })()`);
  }
  // Servicios manuales: el personal captura el costo neto y el proveedor al convertir (la cotización no los guarda).
  for (let k = 0; k < costosManuales.length; k++) {
    await p.evalJs(`(() => { const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('#man-costo-${k}'), ${JSON.stringify(String(costosManuales[k].costo))}); set(document.querySelector('#man-prov-${k}'), ${JSON.stringify(costosManuales[k].proveedor)}); return true; })()`);
  }
  await p.boton("Generar contrato(s)");
  await espera(7000);
  const rojo = await p.evalJs("[...document.querySelectorAll('p.bg-red-50')].map((x) => x.textContent).join(' | ')");
  if (rojo && !(await p.evalJs("/\\/dashboard\\/contratos\\/[A-Z]+-\\d+/.test(location.pathname)"))) throw new Error("la conversión respondió: " + rojo);
  await p.esperar("/\\/dashboard\\/contratos\\/[A-Z]+-\\d+/.test(location.pathname)", "la ficha del contrato", 90000);
  return (await p.evalJs("location.pathname")).split("/").pop();
}

async function aplicarSesion(p, uid) { await p.sesion(uid); }
async function confirmar(numero) {
  const r = await fetch(`${ENV.rest}/rpc/confirmar_venta`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokenDe(U.staff)}` }, body: JSON.stringify({ p_numero: numero }) });
  if (!r.ok) throw new Error(`confirmar_venta ${numero}: ${r.status} ${await r.text()}`);
}
async function textoDe(p, uid, ruta) { if (uid) await p.sesion(uid); await p.ir(ruta); await espera(1200); return p.texto(); }

async function escenario(nombre, def) {
  const e = { pasos: [] };
  out[nombre] = e;
  const p = await pestana();
  try { await def(p, e); } catch (err) { check(nombre, "el recorrido termina sin excepciones", false, String(err?.message ?? err).slice(0, 500)); e.error = String(err?.stack ?? err).slice(0, 1500); await p.foto(`error-${nombre}`).catch(() => {}); }
  await p.cerrar();
}

const PAX_ADULTOS = [{ nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", doc: "12345", nacimiento: "1990-01-01" }, { nombres: "Luis", apellidos: "Gómez", tipoDoc: "CC", doc: "456", nacimiento: "1988-05-05" }];
const PAX_FAMILIA = [...PAX_ADULTOS, { nombres: "Nico", apellidos: "Pérez", tipoDoc: "TI", doc: "789", nacimiento: "2020-01-01" }];

/** Verificaciones comunes de un contrato PVP con recobro ya convertido y confirmado. */
async function verificarContratoPVP(p, e, nombre, { numero, pvp, impuesto, recobro, part, pct, ordinaria }) {
  const v = ventaDe(numero);
  check(nombre, "contrato: precio_venta = PVP con recobro", num(v.precio_venta) === pvp, `${v.precio_venta} vs ${pvp}`);
  check(nombre, "contrato: comisión de la venta = ordinaria", num(v.comision_b2b) === ordinaria, `${v.comision_b2b} vs ${ordinaria}`);
  check(nombre, "contrato: recobro total / aliado / empresa", num(v.recobro_total) === recobro && num(v.recobro_aliado) === part && num(v.recobro_empresa) === recobro - part, JSON.stringify(v));
  check(nombre, "contrato: la suma de las líneas del documento = precio", sumaItems(numero) === pvp, String(sumaItems(numero)));
  const plan = json(`select row_to_json(t)::text from (select recobro_total, recobro_aliado, base_comision, comision_ordinaria, total_aliado from public.comision_plan where numero_contrato = '${numero}') t`);
  check(nombre, "plan de comisión del contrato: base, ordinaria y total", num(plan.base_comision) === pvp - impuesto - recobro && num(plan.comision_ordinaria) === ordinaria && num(plan.total_aliado) === ordinaria + part, JSON.stringify(plan));
  await confirmar(numero);
  const fila = json(`select row_to_json(t)::text from (select base_comision, pct_comision, recobro_total, pct_recobro_aliado, estado, descontada_en_precio from public.aliados_b2b where numero_contrato = '${numero}') t`);
  check(nombre, "liquidación (fila de comisión al confirmar): base, %, recobro y su participación", num(fila.base_comision) === pvp - impuesto - recobro && num(fila.pct_comision) === pct && num(fila.recobro_total) === recobro && Math.abs(num(fila.pct_recobro_aliado) - part / recobro) < 1e-9 && fila.descontada_en_precio === false, JSON.stringify(fila));
  const doc = await textoDe(p, U.staff, `/contrato/${numero}`);
  check(nombre, "documento del contrato: total correcto y sin «recobro»", tiene(doc, pvp) && !/recobro/i.test(doc), "");
  const pub = await textoDe(p, null, `/c/${v.share_token}`);
  check(nombre, "enlace público del contrato: total correcto y sin «recobro»", tiene(pub, pvp) && !/recobro/i.test(pub), "");
  return { v, doc, pub };
}

try {
  const cuales = (process.env.HUMO_ESCENARIOS ?? "1,2,3").split(",");

  if (cuales.includes("1")) await escenario("1-venta-asistida-recobro", async (p) => {
    const N = "1-venta-asistida-recobro";
    await cargarCheckout(p, U.staff, [ITEM()]);
    const rev = await asistida(p, { modo: "comisionable", recobro: "100.000", dist: "50.000" });
    const bloque = entre(rev, "Venta B2B asistida Vista", "Recobro Opcional");
    // Esperado desde las tarifas sintéticas: 2 adultos × 375.000 = 750.000 + recobro 100.000; impuesto 2 × 40.000; con participación el recobro sale de la base.
    const esp = { pvp: 850000, impuesto: 80000, base: 670000, ordinaria: 67000, total: 117000 };
    check(N, "revisión: PVP con recobro", importeDe(bloque, /PVP \(con el recobro/) === esp.pvp, bloque.slice(0, 200));
    check(N, "revisión: impuesto, base, participación, ordinaria, comisión total y exigible", importeDe(bloque, /Impuesto no comisionable/) === esp.impuesto && importeDe(bloque, /Base comisionable/) === esp.base
      && importeDe(bloque, /Recobro incluido/) === 100000 && importeDe(bloque, /Participación del aliado en el recobro/) === 50000 && importeDe(bloque, /Comisión ordinaria/) === esp.ordinaria
      && importeDe(bloque, /ordinaria \+ participación/) === esp.total && importeDe(bloque, /Total exigible \(PVP\)/) === esp.pvp, bloque);
    await p.foto("1-revision");
    const codigo = await generar(p);
    const c = cotDeCodigo(codigo); const plan = planDe(c.id);
    check(N, "cotización: plan sellado = revisión", plan.pvp === esp.pvp && plan.impuesto === esp.impuesto && plan.base === esp.base && plan.comision === esp.total && plan.total_exigible === esp.pvp && plan.recobro.participacion === 50000 && plan.origen === "asistida", JSON.stringify(plan));
    const cot = await textoDe(p, null, `/cot/${c.share_token}`);
    check(N, "documento de la cotización: total correcto, tarifa de adulto con el recobro dentro (425.000) y sin «recobro»", tiene(cot, esp.pvp) && tiene(cot, 425000) && !/recobro/i.test(cot) && !/comisi/i.test(cot.replace(/COMISIONISTA/gi, "")), cot.slice(cot.indexOf("Valores y Pagos"), cot.indexOf("Valores y Pagos") + 400));
    const numero = await generarContrato(p, c.id, PAX_ADULTOS);
    out[N].numero = numero;
    await p.foto("1-contrato");
    await verificarContratoPVP(p, out[N], N, { numero, pvp: esp.pvp, impuesto: esp.impuesto, recobro: 100000, part: 50000, pct: 0.1, ordinaria: 67000 });
  });

  if (cuales.includes("2")) await escenario("2-aliado-directo-recobro", async (p) => {
    const N = "2-aliado-directo-recobro";
    await cargarCheckout(p, U.aliado, [ITEM()]);
    await p.esperar("!!document.querySelector('[data-testid=\"recobro-total\"]')", "el campo de recobro del aliado directo");
    check(N, "el aliado NO tiene campo de distribución y ve su participación (solo lectura)", !(await p.evalJs("!!document.querySelector('[data-testid=\"recobro-dist\"]')")) && /50 %/.test(await p.evalJs("document.querySelector('[data-testid=\"recobro-participacion-sistema\"]').textContent")), "");
    await p.escribir('[data-testid="recobro-total"]', "100.000");
    await p.esperar("/Recobro incluido/.test(document.body.innerText)", "la revisión con el recobro", 60000);
    const rev = await p.texto();
    const bloque = entre(rev, "Venta B2B del aliado", "Recobro Opcional");
    check(N, "revisión del aliado: participación del sistema 50.000, ordinaria 67.000, total aliado 117.000, exigible 850.000 y SIN la parte de la empresa", importeDe(bloque, /Participación del aliado en el recobro/) === 50000 && importeDe(bloque, /Comisión ordinaria/) === 67000 && importeDe(bloque, /ordinaria \+ participación/) === 117000
      && importeDe(bloque, /Total exigible \(PVP\)/) === 850000 && !/para la empresa/.test(bloque), bloque);
    await p.foto("2-revision");
    const codigo = await generar(p);
    const c = cotDeCodigo(codigo); const plan = planDe(c.id);
    check(N, "cotización: origen aliado_directo, participación del parámetro y mismos importes", plan.origen === "aliado_directo" && plan.recobro.participacion === 50000 && plan.recobro.origen_participacion === "parametro" && plan.comision === 117000 && plan.total_exigible === 850000, JSON.stringify(plan));
    // La conversión la hace el personal.
    const numero = await generarContrato(p, (await (async () => { await p.sesion(U.staff); return c.id; })()), PAX_ADULTOS);
    out[N].numero = numero;
    const r = await verificarContratoPVP(p, out[N], N, { numero, pvp: 850000, impuesto: 80000, recobro: 100000, part: 50000, pct: 0.1, ordinaria: 67000 });
    // Liquidación del aliado: su cuenta de cobro muestra su comisión y su participación (único lugar donde aparece el recobro).
    const cuenta = await textoDe(p, U.aliado, `/portal/comision/${numero}`);
    out[N].cuenta = cuenta.slice(0, 1200);
    check(N, "cuenta de cobro del aliado: comisión 117.000 (67.000 + 50.000 de participación)", tiene(cuenta, 117000), cuenta.slice(0, 500));
    await p.foto("2-cuenta-cobro");
  });

  // 5) Páginas REALES del MISMO navegador (mismo perfil: localStorage y Web Locks reales): doble envío entre pestañas, pestaña antigua tras el éxito (con el reloj de esa pestaña adelantado 61 min),
  //    «Es otra compra» sin convertir en compra nueva a las pestañas abiertas antes, y una pestaña abierta después. Sin deduplicación entre navegadores (alcance: pestañas e intención).
  if (cuales.includes("5")) await escenario("5-paginas-mismo-navegador", async (p1) => {
    const N = "5-paginas-mismo-navegador";
    const otras = [];
    try {
      const total = () => num(sql("select count(*) from public.cotizaciones"));
      const hecho = `/¡Cotización generada!/.test(document.body.innerText)`;
      const dup = `!!document.querySelector('[data-testid="envio-duplicado"]')`;
      const listo = (p) => p.esperar(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Generar cotización y enviar solicitud/.test(x.textContent)); return !!b && !b.disabled; })()`, "Generar habilitado");
      const resultado = async (p) => { await p.esperar(`${hecho} || ${dup}`, "respuesta del envío", 60000); return (await p.evalJs(dup)) ? "duplicado" : "generada"; };
      await cargarCheckout(p1, U.staff, [ITEM()]);
      await p1.evalJs("localStorage.removeItem('dspacios_envio_v3'); true");
      const p2 = await pestana(), p3 = await pestana(), p4 = await pestana(); otras.push(p2, p3, p4);
      for (const p of [p2, p3, p4]) { await p.sesion(U.staff); await p.ir("/tarifario/checkout"); }
      for (const p of [p1, p2, p3, p4]) { await llenarTitular(p); await listo(p); }
      const clicEnviar = (p) => p.boton(/Generar cotización y enviar solicitud/);
      const antes = total();
      // 1) p1 y p2 envían a la vez con el almacén vacío: UNA cotización; la otra página muestra «ya generada».
      await Promise.all([clicEnviar(p1), clicEnviar(p2)]);
      const [r1, r2] = [await resultado(p1), await resultado(p2)];
      check(N, "envío simultáneo desde dos páginas con el almacén vacío: UNA cotización", total() - antes === 1, `${total() - antes} · ${r1}/${r2}`);
      check(N, "una página genera y la otra muestra «ya generada»", [r1, r2].sort().join() === "duplicado,generada", `${r1}/${r2}`);
      const claves = sql("select string_agg(distinct clave_envio::text, ',') from public.cotizaciones where clave_envio is not null and id > (select coalesce(max(id), 0) - 1 from public.cotizaciones)");
      // 2) p3 (abierta antes, con el reloj adelantado 61 min) envía después del éxito: reconoce la intención cumplida.
      await p3.evalJs("(() => { const o = Date.now.bind(Date); Date.now = () => o() + 61 * 60000; return true; })()");
      await clicEnviar(p3);
      check(N, "la página antigua (reloj +61 min) reconoce la intención cumplida: ya generada, sin otra cotización", (await resultado(p3)) === "duplicado" && total() - antes === 1, "");
      // 3) «Es otra compra» desde la página que mostró el aviso de duplicado: una intención nueva SOLO para esa página.
      const quien = r1 === "duplicado" ? p1 : p2;
      await quien.evalJs(`document.querySelector('[data-testid="otra-compra"]').click(); true`);
      await quien.esperar(`!document.querySelector('[data-testid="envio-duplicado"]')`, "el aviso desaparece");
      await listo(quien);
      await clicEnviar(quien);
      check(N, "«Es otra compra» desde esa página crea la segunda cotización", (await resultado(quien)) === "generada" && total() - antes === 2, `${total() - antes}`);
      // 4) p4 se abrió ANTES de la compra nueva y nunca envió: sigue siendo la intención original (ya generada), NO una compra nueva.
      await clicEnviar(p4);
      check(N, "la página abierta antes de «Es otra compra» NO se vuelve una compra nueva", (await resultado(p4)) === "duplicado" && total() - antes === 2, `${total() - antes}`);
      // 5) una página abierta DESPUÉS usa la intención nueva (ya generada por `quien`).
      const p5 = await pestana(); otras.push(p5);
      // El éxito de la primera página limpió el carrito (localStorage común): quien abre otra página después vuelve a agregar el mismo hotel.
      await p5.sesion(U.staff); await p5.ir("/tarifario");
      await p5.evalJs(`localStorage.setItem('dspacios_cart_v1', ${JSON.stringify(JSON.stringify([ITEM()]))}); true`);
      await p5.ir("/tarifario/checkout"); await llenarTitular(p5); await listo(p5);
      await clicEnviar(p5);
      check(N, "la página abierta después usa la intención nueva: ya generada, sin tercera cotización", (await resultado(p5)) === "duplicado" && total() - antes === 2, `${total() - antes}`);
      check(N, "dos cotizaciones, dos claves distintas, un solo usuario", sql("select count(distinct clave_envio) || '/' || count(distinct actor_envio) from (select * from public.cotizaciones order by id desc limit 2) t") === "2/1", claves);
    } finally { for (const p of otras) await p.cerrar().catch(() => {}); }
  });

  // 6) REGLA DEL DUEÑO sobre el redondeo, de punta a punta: un servicio manual de 400.000 que NO divide exacto entre 3 pasajeros. Las tarifas del documento conservan su precisión de cálculo (una por tipo), el total es el
  //    exacto y cotización, contrato, resumen congelado, documentos y la base de la liquidación (ventas.precio_venta) mantienen el MISMO importe; sin fila de ajuste ni sublistas.
  if (cuales.includes("6")) await escenario("6-redondeo-regla-del-dueno", async (p) => {
    const N = "6-redondeo-regla-del-dueno";
    const MANUAL = { id: "m1", tipo: "manual", clase: "otro", nombre: "Traslado privado", origen: null, destino: null, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", tramo: null, hotelRef: null, hotelEtiqueta: null, pax: 3, precio: 400000, impuestoNoComisionable: 0, moneda: "COP", fotoUrl: null, noches: null };
    await cargarCheckout(p, U.staff, [ITEM({ ninos: 1, pax: 3, precio: 938000, edadesMenores: [8] }), MANUAL]);
    const codigo = await generar(p);
    const c = cotDeCodigo(codigo);
    const TOTAL = 938000 + 400000;
    check(N, "cotización: precio_venta = hotel + servicio (1.338.000), sin recobro", num(c.precio_venta) === TOTAL, String(c.precio_venta));
    const resumen = json(`select (detalle->'resumenPrecios')::text from public.cotizaciones where id = ${c.id}`);
    const grupos = resumen.unidades.flatMap((u) => u.grupos);
    check(N, "resumen guardado: estructura en centavos enteros que suma EXACTAMENTE el total y trae la tarifa con su precisión", resumen.totalCentavos === TOTAL * 100 && grupos.reduce((x, g) => x + g.subtotalCentavos, 0) === TOTAL * 100 && grupos.every((g) => Number.isInteger(g.tarifaCentavos) && g.subtotalCentavos === g.cantidad * g.tarifaCentavos && typeof g.tarifaExactaCentavos === "number") && resumen.unidades.every((u) => u.ajusteCentavos === 0), JSON.stringify(grupos).slice(0, 300));
    const exA = grupos.filter((g) => g.tipo === "adulto"); const exN = grupos.filter((g) => g.tipo !== "adulto");
    const tarifaA = exA.reduce((x, g) => x + g.tarifaExactaCentavos * g.cantidad, 0) / exA.reduce((x, g) => x + g.cantidad, 0) / 100;
    const tarifaN = exN.reduce((x, g) => x + g.tarifaExactaCentavos * g.cantidad, 0) / exN.reduce((x, g) => x + g.cantidad, 0) / 100;
    const fmt = (n) => n.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cot = await textoDe(p, null, `/cot/${c.share_token}`);
    check(N, "documento de la cotización: total exacto, UNA tarifa por tipo con su precisión, sin sublistas ni «Ajuste por redondeo»", tiene(cot, TOTAL) && cot.includes(fmt(tarifaA)) && cot.includes(fmt(tarifaN)) && !/ × \$|Ajuste (de|por) redondeo/.test(cot) && /Servicios incluidos/.test(cot), `${fmt(tarifaA)} / ${fmt(tarifaN)}`);
    const numero = await generarContrato(p, c.id, PAX_FAMILIA, [{ costo: 300000, proveedor: "Receptivo 14A" }]);
    out[N].numero = numero;
    const v = ventaDe(numero);
    check(N, "contrato: precio_venta (base de la liquidación y de la rentabilidad) = el de la cotización", num(v.precio_venta) === TOTAL, String(v.precio_venta));
    const resCont = json(`select resumen::text from public.contrato_resumen_precios where numero_contrato = '${numero}'`);
    check(N, "resumen congelado en el contrato = el de la cotización (mismo total, mismas tarifas exactas)", resCont.totalCentavos === TOTAL * 100 && JSON.stringify(resCont.unidades.flatMap((u) => u.grupos).map((g) => [g.cantidad, g.tarifaCentavos, g.tarifaExactaCentavos])) === JSON.stringify(grupos.map((g) => [g.cantidad, g.tarifaCentavos, g.tarifaExactaCentavos])), JSON.stringify(resCont).slice(0, 200));
    await confirmar(numero);
    const doc = await textoDe(p, U.staff, `/contrato/${numero}`);
    check(N, "documento del contrato: mismo total, tarifa exacta por tipo y sin sublistas ni ajuste", tiene(doc, TOTAL) && doc.includes(fmt(tarifaA)) && !/ × \$|Ajuste (de|por) redondeo/.test(doc), "");
    const pub = await textoDe(p, null, `/c/${v.share_token}`);
    check(N, "enlace público del contrato: mismo total", tiene(pub, TOTAL) && !/Ajuste (de|por) redondeo/.test(pub), "");
    const cartera = num(sql(`select coalesce(sum(precio_venta), 0) from public.ventas where numero_contrato = '${numero}'`));
    check(N, "base de la liquidación (ventas) = total del documento", cartera === TOTAL, String(cartera));
  });

  // 7) CASO DE LA CAPTURA: NETO, 2 adultos con la MISMA tarifa y un traslado manual que cubre a ambos, sin recobro. El desglose por pasajero debe salir 2 × 498.520 = 997.040 con el traslado en «Servicios incluidos».
  const neto2Adultos = (id, nombre, precioManual, recobro, dist) => async (p) => {
    const N = nombre;
    const MANUAL = { id: "m1", tipo: "manual", clase: "otro", nombre: "Traslado privado", origen: null, destino: null, fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", tramo: null, hotelRef: null, hotelEtiqueta: null, pax: 2, precio: precioManual, impuestoNoComisionable: 0, moneda: "COP", fotoUrl: null, noches: null };
    await cargarCheckout(p, U.staff, [ITEM(), MANUAL]);
    const rev = await asistida(p, { modo: "neta", recobro, dist });
    const exig = importeDe(rev, /Total exigible \(NETO\)/);
    check(N, "revisión NETO: total exigible 997.040", exig === 997040, String(exig));
    const codigo = await generar(p);
    const c = cotDeCodigo(codigo);
    const pendiente = sql(`select coalesce(detalle->>'resumenPendiente', '') from public.cotizaciones where id = ${c.id}`);
    check(N, "cotización: resumen por pasajero GENERADO (sin motivo pendiente)", c.tiene_resumen === true && !pendiente, pendiente);
    const resumen = c.tiene_resumen ? json(`select (detalle->'resumenPrecios')::text from public.cotizaciones where id = ${c.id}`) : null;
    const grupos = resumen ? resumen.unidades.flatMap((u) => u.grupos) : [];
    check(N, "resumen: UN grupo de 2 adultos a 498.520 (997.040) con el traslado", grupos.length === 1 && grupos[0].cantidad === 2 && grupos[0].tarifaCentavos === 49852000 && grupos[0].subtotalCentavos === 99704000 && JSON.stringify(grupos[0].incluye) === JSON.stringify(["Traslado privado"]), JSON.stringify(grupos));
    const verTexto = (t) => tiene(t, 997040) && t.includes("498.520") && /Servicios incluidos/.test(t) && /Traslado privado/.test(t) && !/Ajuste (de|por) redondeo/.test(t) && !/ × \$/.test(t);
    const cotPub = await textoDe(p, null, `/cot/${c.share_token}`);
    check(N, "documento PÚBLICO de la cotización: 2 × 498.520 = 997.040 y traslado en Servicios incluidos", verTexto(cotPub), cotPub.slice(0, 600));
    const cotInt = await textoDe(p, U.staff, `/cotizacion/${c.id}`);
    check(N, "documento INTERNO de la cotización: mismo desglose", verTexto(cotInt), cotInt.slice(0, 600));
    const numero = await generarContrato(p, c.id, PAX_ADULTOS, [{ costo: 300000, proveedor: "Receptivo 14A" }]);
    out[N].numero = numero;
    const v = ventaDe(numero);
    check(N, "contrato: precio_venta = 997.040 (exigible)", num(v.precio_venta) === 997040 && v.modo_compra === "neta", JSON.stringify(v));
    const resCont = json(`select resumen::text from public.contrato_resumen_precios where numero_contrato = '${numero}'`);
    check(N, "resumen congelado en el contrato = el de la cotización", resCont.totalCentavos === 99704000 && JSON.stringify(resCont.unidades.flatMap((u) => u.grupos).map((g) => [g.cantidad, g.tarifaCentavos])) === JSON.stringify(grupos.map((g) => [g.cantidad, g.tarifaCentavos])), JSON.stringify(resCont).slice(0, 300));
    const docInt = await textoDe(p, U.staff, `/contrato/${numero}`);
    check(N, "documento INTERNO del contrato: 2 × 498.520 = 997.040 con el traslado", verTexto(docInt), docInt.slice(0, 600));
    const docPub = await textoDe(p, null, `/c/${v.share_token}`);
    check(N, "documento PÚBLICO del contrato: mismo desglose", verTexto(docPub), docPub.slice(0, 600));
  };
  if (cuales.includes("7")) await escenario("7-neto-2-adultos-traslado", neto2Adultos(7, "7-neto-2-adultos-traslado", 348933, null, null));
  if (cuales.includes("8")) await escenario("8-neto-2-adultos-traslado-recobro", neto2Adultos(8, "8-neto-2-adultos-traslado-recobro", 293378, "100.000", "50.000"));

  if (cuales.includes("3")) await escenario("3-neto-adultos-nino-servicio", async (p) => {
    const N = "3-neto-adultos-nino-servicio";
    await cargarCheckout(p, U.staff, [ITEM({ ninos: 1, pax: 3, precio: 938000, edadesMenores: [8] }), TOUR(3)]);
    const rev = await asistida(p, { modo: "neta", recobro: "100.000", dist: "50.000" });
    const bloque = entre(rev, "Venta B2B asistida Vista", "Recobro Opcional");
    const pvp = importeDe(bloque, /PVP \(con el recobro/), imp = importeDe(bloque, /Impuesto no comisionable/), base = importeDe(bloque, /Base comisionable/);
    const ord = importeDe(bloque, /Comisión ordinaria/), tot = importeDe(bloque, /ordinaria \+ participación/), exig = importeDe(bloque, /Total exigible \(NETO\)/);
    // Reglas aprobadas (#97): con participación el recobro sale de la base; ordinaria = round(base × 10 %); NETO exigible = PVP con recobro − (ordinaria + participación).
    check(N, "revisión NETO: base = PVP − impuesto − recobro; ordinaria = 10 % de la base; exigible = PVP − (ordinaria + 50.000)", base === pvp - imp - 100000 && ord === Math.round(base * 0.1) && tot === ord + 50000 && exig === pvp - tot, bloque);
    await p.foto("3-revision");
    const codigo = await generar(p);
    const c = cotDeCodigo(codigo); const plan = planDe(c.id);
    check(N, "cotización NETO: plan sellado = revisión", plan.pvp === pvp && plan.comision === tot && plan.total_exigible === exig && plan.modo_compra === "neta" && plan.origen === "asistida", JSON.stringify(plan));
    const resumen = json(`select (detalle->'resumenPrecios')::text from public.cotizaciones where id = ${c.id}`);
    const sumaGrupos = resumen.unidades.flatMap((u) => u.grupos).reduce((x, g) => x + g.subtotalCentavos, 0) + resumen.unidades.reduce((x, u) => x + u.ajusteCentavos, 0);
    check(N, "resumen NETO por pasajero guardado: modalidad neto y suma EXACTAMENTE el exigible", resumen.modalidad === "neto" && sumaGrupos === exig * 100 && resumen.totalCentavos === exig * 100, JSON.stringify(resumen).slice(0, 400));
    const tarifas = resumen.unidades.flatMap((u) => u.grupos).map((g) => g.tarifaCentavos / 100);
    const cot = await textoDe(p, null, `/cot/${c.share_token}`);
    check(N, "documento de la cotización: total exigible NETO, cada tarifa por adulto/niño del resumen y sin «recobro»", tiene(cot, exig) && tarifas.every((t) => cot.includes(Math.round(t).toLocaleString("es-CO"))) && !/recobro/i.test(cot), `tarifas ${tarifas}`);
    const numero = await generarContrato(p, c.id, PAX_FAMILIA);
    out[N].numero = numero;
    await p.foto("3-contrato");
    const v = ventaDe(numero);
    check(N, "contrato NETO: precio_venta = exigible, modalidad neta y recobro", num(v.precio_venta) === exig && v.modo_compra === "neta" && num(v.recobro_total) === 100000 && num(v.recobro_aliado) === 50000 && num(v.recobro_empresa) === 50000, JSON.stringify(v));
    check(N, "contrato NETO: la suma de las líneas = PVP con recobro (antes de descontar la comisión)", sumaItems(numero) === pvp, `${sumaItems(numero)} vs ${pvp}`);
    const resCont = json(`select resumen::text from public.contrato_resumen_precios where numero_contrato = '${numero}'`);
    check(N, "resumen congelado en el contrato = el de la cotización (mismas tarifas, mismo total)", resCont.totalCentavos === exig * 100 && JSON.stringify(resCont.unidades.flatMap((u) => u.grupos).map((g) => g.tarifaCentavos)) === JSON.stringify(resumen.unidades.flatMap((u) => u.grupos).map((g) => g.tarifaCentavos)), "");
    const fila = json(`select row_to_json(t)::text from (select base_comision, recobro_total, pct_recobro_aliado, estado, descontada_en_precio from public.aliados_b2b where numero_contrato = '${numero}') t`);
    check(N, "liquidación NETO: fila descontada con base, recobro y su participación", num(fila.base_comision) === base && num(fila.recobro_total) === 100000 && Math.abs(num(fila.pct_recobro_aliado) - 0.5) < 1e-9 && fila.descontada_en_precio === true, JSON.stringify(fila));
    const doc = await textoDe(p, U.staff, `/contrato/${numero}`);
    check(N, "documento del contrato NETO: total exigible, tarifas del resumen y sin «recobro»", tiene(doc, exig) && tarifas.every((t) => doc.includes(Math.round(t).toLocaleString("es-CO"))) && !/recobro/i.test(doc), "");
    const pub = await textoDe(p, null, `/c/${v.share_token}`);
    check(N, "enlace público del contrato NETO: total exigible y sin «recobro»", tiene(pub, exig) && !/recobro/i.test(pub), "");
  });
} catch (e) {
  informe.errores.push(String(e?.stack ?? e));
}
fs.writeFileSync(`${SALIDA}/informe-recorrido.json`, JSON.stringify({ informe, checks, out }, null, 1));
proc.kill();
const malos = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? "OK  " : "FALLA"} [${c.escenario}] ${c.nombre}${c.ok ? "" : " — " + c.detalle.slice(0, 300)}`);
console.log(`recorrido: ${checks.filter((c) => c.ok).length}/${checks.length} verificaciones OK${informe.errores.length ? " · ERRORES: " + informe.errores.join(" | ") : ""}`);
process.exit(malos.length || informe.errores.length ? 1 : 0);
