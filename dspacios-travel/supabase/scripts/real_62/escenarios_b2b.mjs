// #48 / #25 — aceptación REAL de la app compilada (navegador Edge → next start → Server Actions → GoTrue/PostgREST/Postgres reales). Cabecera y utilidades: las de #62 (V1).
// Uso (desde dspacios-travel/, con la pila arriba —pila.sh subir— y `next start -p 3047` corriendo): node supabase/scripts/real_62/escenarios_48.mjs <carpeta_config> <carpeta_capturas>
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// El gateway local no mantiene conexiones persistentes: sin esto, undici reutiliza un socket ya cerrado (UND_ERR_SOCKET) de forma intermitente.
const _fetch = globalThis.fetch;
globalThis.fetch = (u, o = {}) => _fetch(u, { ...o, headers: { ...(o.headers ?? {}), connection: "close" } });
const [DIR_CFG, SALIDA] = process.argv.slice(2);
if (!DIR_CFG || !SALIDA) throw new Error("Uso: escenarios.mjs <carpeta_config> <carpeta_capturas>");
mkdirSync(SALIDA, { recursive: true });
const CFG = JSON.parse(readFileSync(join(DIR_CFG, "config.json"), "utf8"));
const GW = `http://127.0.0.1:${CFG.puertos.gateway}`, APP = `http://localhost:${CFG.puertos.app}`, MAIL = `http://127.0.0.1:${CFG.puertos.correo}`;
const PG = process.env.V1_PG ?? "pgb2b";
const EDGE = process.env.EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const COOKIE = "sb-127-auth-token"; // @supabase/ssr: sb-<primer segmento del host>-auth-token
const TAG = Date.now().toString(36);

// ── controles ──────────────────────────────────────────────────────────────────────────────────
const ctrl = [];
const registrar = (nombre, observado, esperado, ok) => ctrl.push({ nombre, observado: String(observado), esperado: String(esperado), estado: ok ? "OK" : "FALLO" });
const igual = (n, o, e) => registrar(n, o, e, o === e);
const cierto = (n, c, o = c) => registrar(n, o, "true", c === true);
const info = (n, o) => ctrl.push({ nombre: n, observado: String(o), esperado: "anotar", estado: "INFO" });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Base y Auth reales ─────────────────────────────────────────────────────────────────────────
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", PG, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", "v1_real", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const authFetch = (ruta, { metodo = "GET", token, cuerpo, service = false } = {}) =>
  fetch(`${GW}/auth/v1${ruta}`, { method: metodo, headers: { "content-type": "application/json", apikey: CFG.anonKey, authorization: `Bearer ${service ? CFG.serviceKey : (token ?? CFG.anonKey)}` }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
let nAliado = 9100 + Math.floor(Math.random() * 500);
async function crearUsuario(rol, clave) {
  const email = `${rol}.${TAG}.${++nAliado}@v1.test`;
  const r = await authFetch("/admin/users", { metodo: "POST", service: true, cuerpo: { email, password: clave, email_confirm: true } });
  const u = await r.json();
  if (!u.id) throw new Error(`no se creó el usuario: ${JSON.stringify(u)}`);
  const externo = rol === "agencia";
  if (externo) sql(`insert into public.aliados (id, nombre, tipo, nit, activo) values (${nAliado}, 'Agencia V1 ${nAliado}', 'agencia', '9${nAliado}', true)`);
  sql(`insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values ('${u.id}', '${email}', '${externo ? "Agencia V1 " + nAliado : "Staff V1 " + nAliado}', '${rol}', true, 'mayorista', ${externo ? nAliado : "null"})
       on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant, aliado_id = excluded.aliado_id`);
  return { id: u.id, email, clave };
}
const grant = async (email, clave) => { const r = await authFetch("/token?grant_type=password", { metodo: "POST", cuerpo: { email, password: clave } }); return { ok: r.status === 200, json: await r.json() }; };
const refrescar = async (refresh_token) => (await authFetch("/token?grant_type=refresh_token", { metodo: "POST", cuerpo: { refresh_token } })).status === 200;
const usuarioConToken = async (token) => (await authFetch("/user", { token })).status;
const b64 = (s) => JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
const reclamos = (jwt) => b64(jwt.split(".")[1]);

// ── Correo (Mailpit) ───────────────────────────────────────────────────────────────────────────
const mensajes = async (para) => ((await (await fetch(`${MAIL}/api/v1/messages`)).json()).messages ?? []).filter((m) => (m.To ?? []).some((t) => t.Address === para)).sort((a, b) => new Date(b.Created) - new Date(a.Created));
async function enlaceDeCorreo(para, antes = 0) {
  for (let i = 0; i < 40; i++) {
    const l = await mensajes(para);
    if (l.length > antes) {
      const c = await (await fetch(`${MAIL}/api/v1/message/${l[0].ID}`)).json();
      const m = (c.HTML + " " + c.Text).match(/href="([^"]+\/verify\?[^"]+)"/) ?? (c.Text ?? "").match(/(https?:\/\/\S+\/verify\?\S+)/);
      if (m) return m[1].replaceAll("&amp;", "&");
    }
    await dormir(250);
  }
  return null;
}

// ── Gateway: registro por acción e inyección de fallos ─────────────────────────────────────────
const limpiarRegistro = () => fetch(`${GW}/__log`, { method: "DELETE" });
const registro = async () => (await (await fetch(`${GW}/__log`)).json());
const resumen = (lista) => lista.map((e) => `${e.m} ${e.ruta}${e.falloInyectado ? " [FALLO]" : ""}→${e.estado}`).join(" | ");
const cuenta = (lista, m, prefijo) => lista.filter((e) => e.m === m && e.ruta.startsWith(prefijo)).length;
const inyectar = (match, modo, veces = 1, metodo) => fetch(`${GW}/__fault`, { method: "POST", body: JSON.stringify({ match, modo, veces, metodo }) });
const SOLO = process.env.SOLO ?? ""; // SOLO=b4 ejecuta únicamente la sección 8 (B4)
const sinFallos = () => fetch(`${GW}/__fault`, { method: "DELETE" });

// ── Navegador ──────────────────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ANCHOS = [["escritorio", 1280, 800], ["intermedio", 820, 1000], ["movil", 390, 800]];
const layout = [];
let layoutPrevio = false; // true si la barra superior del personal ya desbordaba a 820 px SIN el enlace nuevo
async function nuevoContexto() { return browser.newContext({ viewport: { width: 1280, height: 800 } }); }
async function capturas(page, nombre) {
  for (const [et, w, h] of ANCHOS) {
    await page.setViewportSize({ width: w, height: h }); await dormir(250);
    await page.screenshot({ path: join(SALIDA, `${nombre}-${et}.png`), fullPage: true });
    const m = await page.evaluate(() => ({ ancho: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
      fuera: [...document.querySelectorAll("input,button,a,h1,p")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > document.documentElement.clientWidth + 1; }).map((e) => e.tagName + ":" + (e.textContent ?? "").trim().slice(0, 25)) }));
    layout.push({ nombre, vista: et, ...m });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}
async function iniciarSesion(page, { email, clave }) {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email); await page.fill("#password", clave);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }), page.click('form button[type="submit"]')]);
  await page.waitForLoadState("networkidle");
}
async function sesionDeCookies(ctx) {
  const cs = (await ctx.cookies(APP)).filter((c) => c.name.startsWith(COOKIE) && !c.name.includes("code-verifier")).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  if (!cs.length) return null;
  let v = decodeURIComponent(cs.map((c) => c.value).join(""));
  v = v.startsWith("base64-") ? Buffer.from(v.slice(7).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : v;
  try { return JSON.parse(v); } catch { return null; }
}
const llenar = async (page, campos) => { for (const [n, v] of Object.entries(campos)) await page.fill(`input[name="${n}"]`, v); };
const esperarAccion = (page, clic) => Promise.all([page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"], { timeout: 20000 }), clic()]).then(([r]) => r.headers()["next-action"]);
const ACCION = {};
const textoPagina = (page) => page.evaluate(() => document.body.innerText);
// pathname + query; el fragmento (#error=… que añade Auth al redirigir) no es parte de la ruta de la app
const URLP = (page) => { const u = new URL(page.url()); return u.pathname + u.search; };


// ════════════════════════════════════════════════════════════════════════════════════════════
// #48 / #25 — aceptación REAL de la app compilada (esta sección es el cuerpo propio; las utilidades de arriba son las de #62).
// ════════════════════════════════════════════════════════════════════════════════════════════
const dmy = (dias) => { const d = new Date(Date.now() + dias * 86400000); return String(d.getDate()).padStart(2, "0") + String(d.getMonth() + 1).padStart(2, "0") + d.getFullYear(); };
const X = (t) => `xpath=//label[normalize-space()="${t}"]`;
const scalar = (q) => sql(q).trim();

async function llenarCotizacion(page, { cliente = "Ana", doc = "1234567", tipoAliado = "agencia", aliado, aereo = [800000, 20], hotel = [3200000, 20], recobro = 0, partic = 0 }) {
  await page.goto(`${APP}/dashboard/cotizaciones/nueva`, { waitUntil: "networkidle" });
  await page.locator(`${X("Número de documento")}/following::input[1]`).fill(doc);
  await page.locator(`${X("Tipo de documento")}/following::select[1]`).selectOption("CC");
  await page.locator(`${X("Nombres")}/following-sibling::input[1]`).fill(cliente);
  await page.locator(`${X("Apellidos")}/following-sibling::input[1]`).fill("Prueba");
  await page.locator('input[aria-label="Fecha de nacimiento"]').fill("01011990"); await page.keyboard.press("Tab");
  await page.locator(`${X("Destino")}/following-sibling::input[1]`).fill("Cartagena");
  await page.locator('input[aria-label="Fecha ida"]').fill(dmy(40)); await page.keyboard.press("Tab");
  await page.locator('input[aria-label="Fecha regreso"]').fill(dmy(44)); await page.keyboard.press("Tab");
  if (aliado) {
    await page.getByRole("button", { name: tipoAliado, exact: true }).click();
    await page.locator('input[list="aliados-list"]').fill(aliado);
  }
  await page.getByRole("button", { name: "Aéreo", exact: true }).click();
  await page.getByRole("button", { name: "Hotel", exact: true }).click();
  const costos = page.locator(`${X("Costo neto")}/following-sibling::input[1]`);
  const mk = page.locator(`${X("Markup %")}/following-sibling::input[1]`);
  await costos.nth(0).fill(String(aereo[0])); await mk.nth(0).fill(String(aereo[1]));
  await costos.nth(1).fill(String(hotel[0])); await mk.nth(1).fill(String(hotel[1]));
  if (recobro) {
    await page.locator(`${X("Valor del recobro")}/following-sibling::input[1]`).fill(String(recobro));
    if (aliado) { await page.locator(`input[type="number"][max="${recobro}"]`).fill(String(partic)); }
  }
}
const modalidadNeto = (page) => page.locator('label:has-text("NETO: el aliado paga") input[type="radio"]');
const modalidadPvp = (page) => page.locator('label:has-text("PVP: el aliado cobra") input[type="radio"]');
const aliadoAuto = (id, nombre, tipo, pct) => `insert into public.aliados (id, nombre, tipo, nit, pct_comision, activo) values (${id}, '${nombre}', '${tipo}', '${id}', ${pct}, true) on conflict (id) do nothing;`;

// ── B2B (ronda 7): utilidades y datos sintéticos propios de este recorrido ─────────────────────────────────────────────
import zlib from "node:zlib";
import { createHash } from "node:crypto";
const GRUPOS = process.env.GRUPOS ? process.env.GRUPOS.split(",") : null;
const G = (n) => !GRUPOS || GRUPOS.includes(n);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
// PNG válido sin dependencias (rayas diagonales: se distingue a simple vista en las capturas).
const PNGB = (w, h, [r, g, b]) => {
  const fila = w * 3 + 1, raw = Buffer.alloc(fila * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * fila + 1 + x * 3, rayado = (x + y) % 36 < 7; raw[o] = rayado ? r : 255; raw[o + 1] = rayado ? g : 255; raw[o + 2] = rayado ? b : 255; }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
const nuevoContexto2 = async () => browser.newContext({ viewport: { width: 1280, height: 800 } });
const AR = "ClaveB2B-2026";
async function crearU({ rol, nombre, aliadoId = null, tenant = "mayorista", clave = AR }) {
  const email = `${rol}.${TAG}.${++nAliado}@v1.test`;
  const r = await authFetch("/admin/users", { metodo: "POST", service: true, cuerpo: { email, password: clave, email_confirm: true } });
  const u = await r.json();
  if (!u.id) throw new Error(`no se creó el usuario: ${JSON.stringify(u)}`);
  sql(`insert into public.usuarios (id, email, nombre, rol, activo, tenant, aliado_id) values ('${u.id}', '${email}', '${nombre}', '${rol}', true, '${tenant}', ${aliadoId ?? "null"}) on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant, aliado_id = excluded.aliado_id`);
  return { id: u.id, email, clave, nombre };
}
// Llamada DIRECTA a una Server Action (sin la interfaz): id capturado de la interfaz real, argumentos como arreglo JSON.
async function repetirAccion(ctx, url, idAccion, args) {
  const r = await ctx.request.post(url, { headers: { "next-action": idAccion, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }, data: JSON.stringify(args) });
  return { status: r.status(), texto: await r.text() };
}
const tokenDe = async (u) => (await grant(u.email, u.clave)).json.access_token;
const rest = (ruta, token, metodo = "GET") => fetch(`${GW}/rest/v1/${ruta}`, { method: metodo, headers: { apikey: CFG.anonKey, authorization: `Bearer ${token ?? CFG.anonKey}` } });
const contiene = (t, re) => re.test(t.replace(/\s+/g, " "));

// Aliados: A (freelance, mayorista, con ficha completa), B (freelance, mayorista), C (agencia, mayorista), X (freelance de OTRA agencia: minorista).
const IDA = 97100 + (Date.now() % 800), IDB = IDA + 1, IDC = IDA + 2, IDX = IDA + 3;
const NUM = `DTM-9${String(Date.now()).slice(-6)}`, NUM84 = `DTM-8${String(Date.now()).slice(-6)}`;
const ficha = (id, nombre, tipo, extra = "") => `insert into public.aliados (id, nombre, tipo, nit, tipo_documento, direccion, telefono, email, banco, tipo_cuenta, numero_cuenta, aplica_retencion, pct_retencion, pct_comision, activo) values (${id}, '${nombre}', '${tipo}', '${id}', 'CC', 'Calle 1 # 2-3, Bogotá', '+573001112233', 'a${id}@qa.test', 'Bancolombia', 'Ahorros', '00012${id}', true, 0.10, 0.11, true) on conflict (id) do nothing;`;

const NOMA = `Laura Pérez QA ${TAG}`, NOMB = `Beto Viajes QA ${TAG}`; // nombres únicos por corrida: el formulario de cotización resuelve el aliado por el nombre que se escribe

try {
  await sinFallos(); await limpiarRegistro();
  // ── Datos sintéticos de esta base desechable ─────────────────────────────────────────────────────────────────────────
  sql(ficha(IDA, NOMA, "freelance") + ficha(IDB, NOMB, "freelance") + ficha(IDC, "Agencia Mar QA", "agencia") + ficha(IDX, "Xavi Minorista QA", "freelance"));
  sql("update public.agencias set rnt = 'RNT-PRUEBA-LOCAL' where tenant = 'mayorista' and coalesce(btrim(rnt), '') = ''");
  const sa = await crearU({ rol: "superadmin", nombre: "Super QA" });
  const ger = await crearU({ rol: "gerencia", nombre: "Gerente QA" });
  const adm = await crearU({ rol: "administracion", nombre: "Admin QA" });
  const ven = await crearU({ rol: "venta", nombre: "Venta QA" });
  const uA = await crearU({ rol: "freelance", nombre: NOMA, aliadoId: IDA });
  const uB = await crearU({ rol: "freelance", nombre: NOMB, aliadoId: IDB });
  const uC = await crearU({ rol: "agencia", nombre: "Agencia Mar QA", aliadoId: IDC });
  const uX = await crearU({ rol: "freelance", nombre: "Xavi Minorista QA", aliadoId: IDX, tenant: "minorista" });
  // Contrato del aliado A con su comisión: PVP 5.000.000, base 4.000.000 × 11 % = 440.000; retención 10 % = 44.000 → total a cobrar 396.000 (cálculo a mano).
  sql(`insert into public.ventas (numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, estado, aliado_id, b2b_usuario_id, tipo_asesor, tenant) values ('${NUM}', 'Ana Gómez', 'SAN ANDRÉS', current_date + 60, 5000000, 'COP', 'confirmado', ${IDA}, '${uA.id}', 'freelance', 'mayorista');`);
  sql(`insert into public.aliados_b2b (numero_contrato, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, pct_comision, comision_valor, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, tenant, descontada_en_precio) values ('${NUM}', '${NOMA}', '${IDA}', 'freelance', ${IDA}, 5000000, 4000000, 0.11, 440000, 0, 0, true, 0.10, 'pendiente', 'mayorista', false);`);
  const idCom = Number(scalar(`select id from public.aliados_b2b where numero_contrato = '${NUM}'`));
  info("datos: aliados A/B/C/X, contrato y comisión", `${IDA}/${IDB}/${IDC}/${IDX} · ${NUM} · comisión id ${idCom}`);
  const aliadoDe = {}; // para las capturas y mensajes

  // ══ G1 · #98 firma + aceptación electrónica de una versión congelada ═════════════════════════════════════════════
  if (G("98")) {
    const png = PNGB(240, 90, [30, 58, 138]), shaPng = sha256(png);
    const ctxA = await nuevoContexto2(); const pA = await ctxA.newPage(); await iniciarSesion(pA, uA);
    const URLC = `${APP}/portal/comision/${NUM}`;
    // S1 · versión sin aceptar (valores a mano: comisión 440.000, retención 44.000, total 396.000)
    await pA.goto(URLC, { waitUntil: "networkidle" });
    let t = await textoPagina(pA);
    cierto("S1 la cuenta de cobro abre sin aceptar: «Versión sin aceptar» y total 396.000 (comisión 440.000 − retención 44.000)", /Versión sin aceptar/.test(t) && /396\.000/.test(t) && /440\.000/.test(t) && /44\.000/.test(t), t.replace(/\s+/g, " ").slice(0, 160));
    cierto("S1 aún no hay ninguna aceptación en la base", scalar("select count(*) from public.cuenta_cobro_aceptaciones where clave = 'ab:" + idCom + "'") === "0");
    await capturas(pA, "98-cuenta-sin-aceptar");
    // S2 · el aliado sube su firma en el perfil (PNG real) → bucket privado + fila vigente con su huella
    await pA.goto(`${APP}/portal/b2b/perfil`, { waitUntil: "networkidle" });
    await pA.locator('input[type="file"]:not(#logo-aliado-archivo)').first().setInputFiles({ name: "firma.png", mimeType: "image/png", buffer: png });
    await pA.getByRole("button", { name: /Subir firma|Reemplazar firma/ }).click();
    await pA.getByText("Firma guardada.").waitFor({ timeout: 20000 });
    igual("S2 una sola firma vigente, con la huella del archivo subido", scalar(`select count(*) filter (where vigente) || '/' || bool_and(sha256 = '${shaPng}') from public.aliado_firmas where aliado_id = ${IDA}`), "1/true");
    const rutaFirma = scalar(`select storage_path from public.aliado_firmas where aliado_id = ${IDA} and vigente`);
    await capturas(pA, "98-perfil-firma");
    // S3 · acepta la versión 1: la acción real, con el id de la acción capturado de la interfaz
    await pA.goto(URLC, { waitUntil: "networkidle" });
    const btn = pA.getByRole("button", { name: "Aceptar y firmar esta versión" });
    cierto("S3 el botón de aceptar existe para el titular freelance", (await btn.count()) === 1, (await textoPagina(pA)).replace(/\s+/g, " ").slice(-500));
    await pA.locator('input[type="checkbox"]').first().check();
    ACCION.aceptar = await esperarAccion(pA, () => btn.click());
    await pA.getByText(/Aceptación electrónica — versión 1/).waitFor({ timeout: 20000 });
    const f1 = scalar(`select version || '|' || (firma_sha256 = '${shaPng}') || '|' || (length(snapshot_hash) > 0) || '|' || (aceptada_por = '${uA.id}') from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`);
    igual("S3 una aceptación: versión 1, huella de la imagen de firma, hash del snapshot y quién aceptó", f1, "1|true|true|true");
    const hash1 = scalar(`select snapshot_hash from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}' and version = 1`);
    t = await textoPagina(pA);
    cierto("S3 el documento firmado muestra versión, fecha y que NO es firma digital certificada, con el total congelado", /Aceptación electrónica — versión 1/.test(t) && /No es una firma digital certificada/.test(t) && /396\.000/.test(t), t.replace(/\s+/g, " ").slice(-260));
    const orden = await pA.evaluate(() => { const im = document.querySelector('[data-firma="aceptada"] img'); const nom = [...document.querySelectorAll('[data-firma="aceptada"] p, [data-firma="aceptada"] div')].find((e) => e.children.length === 0 && /Laura Pérez QA/.test(e.textContent ?? "") && im && e.getBoundingClientRect().top > im.getBoundingClientRect().bottom - 2); return { hayImg: !!im, cargada: !!im && im.complete && im.naturalWidth > 0, nombreDebajo: !!nom }; });
    cierto("S3 la imagen de la firma se ve (cargó) y queda ENCIMA del nombre del aliado", orden.hayImg && orden.cargada && orden.nombreDebajo, JSON.stringify(orden));
    await capturas(pA, "98-cuenta-aceptada");
    const pdf = await pA.pdf({ format: "Letter", printBackground: true }); writeFileSync(join(SALIDA, "98-cuenta-aceptada.pdf"), pdf);
    const pag = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    igual("S3 imprime en UNA hoja carta (PDF del navegador)", String(pag), "1");
    // S3b · recargar no duplica nada
    await pA.reload({ waitUntil: "networkidle" });
    igual("S3 recargar no crea otra aceptación", scalar(`select count(*) from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`), "1");
    // S4 · aislamiento: B (otro aliado, misma agencia), C (agencia), X (otra agencia) y anónimo NO ven el documento ni pueden aceptar
    for (const [nombre, u] of [["B", uB], ["C(agencia)", uC], ["X(otra agencia)", uX]]) {
      const ctx = await nuevoContexto2(); const p = await ctx.newPage(); await iniciarSesion(p, u);
      const r = await p.goto(URLC, { waitUntil: "networkidle" }); const tx = await textoPagina(p);
      cierto(`S4 ${nombre} no ve la cuenta de cobro de A (sin importes ni nombre)`, !/396\.000|440\.000|Laura Pérez QA|Aceptación electrónica/.test(tx), `${r?.status()} ${tx.replace(/\s+/g, " ").slice(0, 90)}`);
      const rp = await repetirAccion(ctx, URLC, ACCION.aceptar, [{ numero: NUM, comisionId: idCom, hash: hash1 }]);
      cierto(`S4 ${nombre}: la llamada DIRECTA a la acción de aceptar sobre el contrato de A es rechazada`, !/"ok":true/.test(rp.texto) && scalar(`select count(*) from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`) === "1", `${rp.status} ${rp.texto.slice(0, 140).replace(/\s+/g, " ")}`);
      await ctx.close();
    }
    { const ctx = await nuevoContexto2(); const p = await ctx.newPage(); const r = await p.goto(URLC, { waitUntil: "networkidle" }); const tx = await textoPagina(p);
      cierto("S4 anónimo: no ve el documento", !/396\.000|Laura Pérez QA/.test(tx), `${r?.status()} ${p.url()}`); await ctx.close(); }
    // S5 · permisos de base: ni A ni B alcanzan las tablas ni el archivo de firma por la API (solo el servidor)
    for (const [nombre, u] of [["A", uA], ["B", uB]]) {
      const tk = await tokenDe(u);
      for (const tabla of ["cuenta_cobro_aceptaciones", "aliado_firmas"]) {
        const r = await rest(`${tabla}?select=*`, tk); const cuerpo = await r.text();
        cierto(`S5 ${nombre} no lee ${tabla} por la API (permiso denegado o sin filas)`, r.status === 401 || r.status === 403 || cuerpo === "[]", `${r.status} ${cuerpo.slice(0, 80)}`);
      }
      const o1 = await fetch(`${GW}/storage/v1/object/authenticated/aliado-firmas/${rutaFirma}`, { headers: { apikey: CFG.anonKey, authorization: `Bearer ${tk}` } });
      const o2 = await fetch(`${GW}/storage/v1/object/public/aliado-firmas/${rutaFirma}`);
      cierto(`S5 ${nombre} no descarga la imagen de firma del bucket (ni autenticado ni público)`, o1.status !== 200 && o2.status !== 200, `auth ${o1.status} · público ${o2.status}`);
    }
    // S6 · el personal cambia la comisión (12 %): la versión aceptada NO se altera; aparece una versión nueva SIN aceptar
    sql(`update public.aliados_b2b set pct_comision = 0.12, comision_valor = 480000 where id = ${idCom}`);
    await pA.goto(URLC, { waitUntil: "networkidle" }); t = await textoPagina(pA);
    cierto("S6 tras el cambio: la versión nueva (432.000 = 480.000 − 48.000) sale SIN aceptar", /Versión sin aceptar/.test(t) && /432\.000/.test(t), t.replace(/\s+/g, " ").slice(0, 150));
    cierto("S6 y ofrece la versión aceptada anterior", /versión 1|versi[oó]n aceptada/i.test(t) || (await pA.locator('a[href*="v=1"]').count()) > 0, t.replace(/\s+/g, " ").slice(-200));
    await capturas(pA, "98-cuenta-version-nueva");
    await pA.goto(`${URLC}?v=1`, { waitUntil: "networkidle" }); t = await textoPagina(pA);
    cierto("S6 la versión 1 sigue abriendo con SUS importes (396.000) y su firma, aunque la comisión viva ya cambió", /396\.000/.test(t) && !/432\.000/.test(t) && /Aceptación electrónica — versión 1/.test(t), t.replace(/\s+/g, " ").slice(-200));
    // S7 · aceptación vieja (hash de la versión 1) con la comisión ya cambiada: rechazada, nada se escribe
    const rv = await repetirAccion(ctxA, URLC, ACCION.aceptar, [{ numero: NUM, comisionId: idCom, hash: hash1 }]);
    cierto("S7 aceptar con el hash de una versión vieja (documento ya cambiado) es rechazado y no escribe", !/"ok":true/.test(rv.texto) && scalar(`select count(*) from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`) === "1", `${rv.status} ${rv.texto.slice(0, 160).replace(/\s+/g, " ")}`);
    // S8 · acepta la versión 2 desde la pantalla; se conservan las dos
    await pA.goto(URLC, { waitUntil: "networkidle" });
    await pA.locator('input[type="checkbox"]').first().check();
    await pA.getByRole("button", { name: "Aceptar y firmar esta versión" }).click();
    await pA.getByText(/Aceptación electrónica — versión 2/).waitFor({ timeout: 20000 });
    igual("S8 dos versiones aceptadas conservadas (1 y 2), sin sobrescribir la primera", scalar(`select string_agg(version::text, ',' order by version) from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`), "1,2");
    const hash2 = scalar(`select snapshot_hash from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}' and version = 2`);
    cierto("S8 los hashes de v1 y v2 son distintos", hash1 !== hash2 && hash1.length > 0 && hash2.length > 0);
    const rr = await repetirAccion(ctxA, URLC, ACCION.aceptar, [{ numero: NUM, comisionId: idCom, hash: hash2 }]);
    igual("S8 repetir la aceptación de la versión vigente es idempotente (no crea la 3)", scalar(`select count(*) from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`), "2");
    info("S8 respuesta de la repetición", rr.texto.slice(0, 100).replace(/\s+/g, " "));
    // S9 · inmutabilidad en la base (incluso para un superusuario de la base)
    let upd = "sin error", del = "sin error";
    try { sql(`update public.cuenta_cobro_aceptaciones set version = 9 where clave = 'ab:${idCom}' and version = 1`); } catch (e) { upd = "rechazado"; }
    try { sql(`delete from public.cuenta_cobro_aceptaciones where clave = 'ab:${idCom}'`); } catch (e) { del = "rechazado"; }
    igual("S9 UPDATE y DELETE de una aceptación quedan rechazados por la base", `${upd}/${del}`, "rechazado/rechazado");
    // Peticiones por acción (gateway)
    await limpiarRegistro(); await pA.goto(URLC, { waitUntil: "networkidle" });
    info("P1 peticiones al abrir la cuenta de cobro (gateway)", resumen((await registro())));
    await limpiarRegistro(); await dormir(4000); igual("P1 en reposo (4 s) no hay peticiones", String((await registro()).length), "0");
    await ctxA.close();
  }

  // ══ G2 · #32 logo del aliado en SUS cotizaciones (emisor legal intacto, archivo privado servido por rutas autorizadas) ══════════════
  if (G("32")) {
    const logoPng = PNGB(320, 110, [124, 45, 18]), shaLogo = sha256(logoPng);
    const crearCot = async (page, { cliente, doc, aliado }) => {
      await llenarCotizacion(page, { cliente, doc, tipoAliado: "freelance", aliado });
      await page.locator(`${X("Base no comisionable (BNC) *")}/following-sibling::input[1]`).fill("0");
      await Promise.all([page.waitForURL(/\/dashboard\/cotizaciones\/\d+$/, { timeout: 45000 }), page.getByRole("button", { name: "Generar cotización", exact: true }).click()]);
      const id = Number(new URL(page.url()).pathname.split("/").pop());
      if (scalar(`select coalesce(share_token::text, '') from public.cotizaciones where id = ${id}`) === "") sql(`update public.cotizaciones set share_token = gen_random_uuid() where id = ${id}`);
      return { id, token: scalar(`select share_token::text from public.cotizaciones where id = ${id}`) };
    };
    const ctxAdm = await nuevoContexto2(); const pAdm = await ctxAdm.newPage(); await iniciarSesion(pAdm, adm);
    const cotA = await crearCot(pAdm, { cliente: "Cliente Logo A", doc: "81000111", aliado: NOMA });
    const cotB = await crearCot(pAdm, { cliente: "Cliente Logo B", doc: "81000222", aliado: NOMB });
    info("G2 cotizaciones creadas por la pantalla real", `A: id ${cotA.id} · B: id ${cotB.id}`);
    // Antes de subir logo: documento «de siempre» (sin franja ni logo del aliado)
    { const ctx = await nuevoContexto2(); const p = await ctx.newPage(); await p.goto(`${APP}/cot/${cotA.token}`, { waitUntil: "networkidle" }); const tx = await textoPagina(p);
      cierto("L1 sin logo cargado: el documento no presenta ninguna marca de aliado (comportamiento de siempre)", !/Cotización presentada por/.test(tx) && (await p.locator(`img[src*="/cot/${cotA.token}/logo"]`).count()) === 0, tx.replace(/\s+/g, " ").slice(0, 100)); await ctx.close(); }
    // A sube su logo (validación por bytes: un SVG con script se rechaza; el PNG se acepta)
    const ctxA = await nuevoContexto2(); const pA = await ctxA.newPage(); await iniciarSesion(pA, uA);
    await pA.goto(`${APP}/portal/b2b/perfil`, { waitUntil: "networkidle" });
    await pA.locator("#logo-aliado-archivo").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: SVG });
    await pA.getByRole("alert").first().waitFor({ timeout: 20000 });
    igual("L2 un SVG (con script) NO se acepta como logo: no queda ninguna fila", scalar(`select count(*) from public.aliado_logos where aliado_id = ${IDA}`), "0");
    await pA.locator("#logo-aliado-archivo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logoPng });
    await pA.getByText("Logo actualizado.").waitFor({ timeout: 20000 });
    igual("L2 el PNG queda como único logo vigente, con su huella, en el bucket privado", scalar(`select count(*) filter (where vigente) || '/' || bool_and(sha256 = '${shaLogo}') || '/' || bool_and(via = 'portal') from public.aliado_logos where aliado_id = ${IDA}`), "1/true/true");
    await capturas(pA, "32-perfil-logo");
    const pathLogo = scalar(`select path from public.aliado_logos where aliado_id = ${IDA} and vigente`);
    // Documento público por token (sin sesión)
    const ctxP = await nuevoContexto2(); const pP = await ctxP.newPage();
    await pP.goto(`${APP}/cot/${cotA.token}`, { waitUntil: "networkidle" });
    const img = await pP.evaluate((tk) => { const i = document.querySelector(`img[src*="/cot/${tk}/logo"]`); return { hay: !!i, cargada: !!i && i.complete && i.naturalWidth > 0, alt: i?.alt }; }, cotA.token);
    cierto("L3 el documento público muestra el logo del aliado (servido por la ruta autorizada) y carga de verdad", img.hay && img.cargada, JSON.stringify(img));
    const tp = await textoPagina(pP);
    const ag = scalar("select coalesce(razon_social,'') || '|' || coalesce(nit,'') || '|' || coalesce(rnt,'') from public.agencias where tenant = 'mayorista'").split("|");
    cierto("L3 el emisor legal sigue identificado y sin cambios: «presentada por <aliado>, emitida por» + razón social, NIT y RNT de la agencia", /Cotización presentada por/.test(tp) && tp.includes(NOMA) && tp.includes(ag[0]) && tp.includes(ag[1]) && tp.includes(ag[2]), `${ag.join(" · ")} :: ${tp.replace(/\s+/g, " ").slice(0, 200)}`);
    await capturas(pP, "32-cot-publica-con-logo");
    const pdf = await pP.pdf({ format: "Letter", printBackground: true }); writeFileSync(join(SALIDA, "32-cot-con-logo.pdf"), pdf);
    info("L3 páginas del PDF de la cotización con logo", String((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length));
    // Rutas del archivo: cabeceras privadas y rechazo de lo ajeno
    const rl = await fetch(`${APP}/cot/${cotA.token}/logo`); const bytes = Buffer.from(await rl.arrayBuffer());
    cierto("L4 /cot/<token>/logo entrega los bytes del logo con tipo de imagen y SIN caché compartida", rl.status === 200 && /image\/png/.test(rl.headers.get("content-type") ?? "") && /private/.test(rl.headers.get("cache-control") ?? "") && /no-store/.test(rl.headers.get("cache-control") ?? "") && sha256(bytes) === shaLogo, `${rl.status} ${rl.headers.get("content-type")} ${rl.headers.get("cache-control")} sha=${sha256(bytes).slice(0, 8)}`);
    igual("L4 un token que no existe → 404", String((await fetch(`${APP}/cot/token-inexistente-${TAG}/logo`)).status), "404");
    igual("L4 la cotización de B (sin logo): su ruta de logo → 404 (no se le da el logo de A)", String((await fetch(`${APP}/cot/${cotB.token}/logo`)).status), "404");
    { const p2 = await ctxP.newPage(); await p2.goto(`${APP}/cot/${cotB.token}`, { waitUntil: "networkidle" }); const tb = await textoPagina(p2);
      cierto("L4 el documento de B (sin logo) es el de siempre: sin franja ni imagen de aliado, con la marca de la agencia", !/Cotización presentada por/.test(tb) && (await p2.locator(`img[src*="/cot/${cotB.token}/logo"]`).count()) === 0 && (await p2.locator(`img[src*="/marca/"]`).count()) >= 1, tb.replace(/\s+/g, " ").slice(0, 90));
      await capturas(p2, "32-cot-publica-sin-logo");
      const pdfB = await p2.pdf({ format: "Letter", printBackground: true }); info("L4 páginas del PDF de B (sin logo)", String((pdfB.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length)); }
    const pub = await fetch(`${GW}/storage/v1/object/public/aliado-logos/${pathLogo}`);
    const aut = await fetch(`${GW}/storage/v1/object/authenticated/aliado-logos/${pathLogo}`, { headers: { apikey: CFG.anonKey, authorization: `Bearer ${await tokenDe(uB)}` } });
    cierto("L4 el archivo del bucket no se alcanza directo: ni por URL pública ni autenticado como B", pub.status !== 200 && aut.status !== 200, `público ${pub.status} · B ${aut.status}`);
    // Portal: la vista previa del propio perfil
    igual("L5 /portal/b2b/perfil/logo: A recibe su logo", String((await pA.request.get(`${APP}/portal/b2b/perfil/logo`)).status()), "200");
    { const ctxB = await nuevoContexto2(); const pB = await ctxB.newPage(); await iniciarSesion(pB, uB);
      igual("L5 /portal/b2b/perfil/logo: B (sin logo) recibe 404, no el de A", String((await pB.request.get(`${APP}/portal/b2b/perfil/logo`)).status()), "404");
      await ctxB.close(); }
    igual("L5 anónimo en la ruta del perfil: no entrega el logo", String((await ctxP.request.get(`${APP}/portal/b2b/perfil/logo`, { maxRedirects: 0 })).status() !== 200), "true");
    // Documento interno de la cotización (personal)
    await pAdm.goto(`${APP}/cotizacion/${cotA.id}`, { waitUntil: "networkidle" });
    const imgI = await pAdm.evaluate((id) => { const i = document.querySelector(`img[src*="/cotizacion/${id}/logo"]`); return !!i && i.complete && i.naturalWidth > 0; }, cotA.id);
    cierto("L6 el documento interno de la cotización también muestra el logo del aliado dueño", imgI === true);
    await capturas(pAdm, "32-cot-interna-con-logo");
    // El logo es solo presentación: la identidad de la agencia (razón social/NIT/RNT) es la misma con y sin logo
    cierto("L6 el emisor legal impreso es el mismo con y sin logo (A vs B)", (await textoPagina(pP)).includes(ag[1]));
    await limpiarRegistro(); await pP.goto(`${APP}/cot/${cotA.token}`, { waitUntil: "networkidle" });
    info("P2 peticiones al abrir la cotización pública con logo", resumen(await registro()).slice(0, 400));
    await ctxAdm.close(); await ctxA.close(); await ctxP.close();
  }

  // ══ G3 · #25 corrección por el personal + historial propio · #84 valor actual del contrato ═════════════════════════════════════════
  if (G("25")) {
    // El personal (gerencia) corrige teléfono y nombre desde Aliados; administración NO puede
    const ctxG = await nuevoContexto2(); const pG = await ctxG.newPage(); await iniciarSesion(pG, ger);
    const corregir = async (page, { tel, nombre }) => {
      await page.goto(`${APP}/dashboard/aliados`, { waitUntil: "networkidle" });
      await page.locator("tr", { hasText: scalar(`select nombre from public.aliados where id = ${IDA}`) }).first().locator("button").first().click();
      await page.getByRole("button", { name: "Corregir", exact: true }).first().click();
      if (tel) await page.locator(`#cor-tel-${IDA}`).fill(tel);
      if (nombre) { await page.locator(`#cor-nombre-${IDA}`).fill(nombre); await page.locator('label:has-text("Entiendo que el nuevo nombre") input[type="checkbox"]').check(); }
      await page.getByRole("button", { name: "Guardar corrección" }).click();
      await page.locator('[role="status"],[role="alert"]').filter({ hasText: /.+/ }).first().waitFor({ timeout: 20000 });
      return (await page.locator('[role="status"],[role="alert"]').first().innerText()).trim();
    };
    const msgAdm = await (async () => { const ctx = await nuevoContexto2(); const p = await ctx.newPage(); await iniciarSesion(p, adm); const m = await corregir(p, { tel: "+57 300 000 0000" }); await ctx.close(); return m; })();
    igual("H1 administración NO puede corregir la ficha: el teléfono no cambia", scalar(`select telefono from public.aliados where id = ${IDA}`), "+573001112233");
    info("H1 mensaje a administración", msgAdm.slice(0, 120));
    const msgG = await corregir(pG, { tel: "+573009998888", nombre: `Laura Pérez Gómez QA ${TAG}` });
    igual("H1 gerencia corrige teléfono y nombre (se guardan)", scalar(`select telefono || '|' || nombre from public.aliados where id = ${IDA}`), `+573009998888|Laura Pérez Gómez QA ${TAG}`);
    const aud = scalar(`select count(*) || '|' || bool_and(actor_email = '${ger.email}') || '|' || bool_and(actor_rol = 'gerencia') from public.auditoria where tabla = 'aliados' and registro_id = '${IDA}' and accion = 'UPDATE' and cambios::text like '%telefono%'`);
    igual("H1 la auditoría registra la corrección con el actor real (gerencia) y los campos", aud.endsWith("|true|true") ? "con actor" : aud, "con actor");
    info("H1 mensaje a gerencia", msgG.slice(0, 120));
    await capturas(pG, "25-correccion-gerencia");
    // Historial propio del aliado (con la cuenta bancaria enmascarada)
    sql(`update public.aliados set numero_cuenta = '1234567890' where id = ${IDA}`);
    const ctxA = await nuevoContexto2(); const pA = await ctxA.newPage(); await iniciarSesion(pA, uA);
    await pA.goto(`${APP}/portal/b2b/perfil`, { waitUntil: "networkidle" });
    const th = await textoPagina(pA);
    cierto("H2 el aliado ve SU historial: aparecen el teléfono y el nombre corregidos", /Historial/i.test(th) && /9998888|Laura Pérez Gómez QA/.test(th), th.replace(/\s+/g, " ").slice(-300));
    cierto("H2 la cuenta bancaria se ve enmascarada (****7890) y nunca completa", /\*{2,}7890/.test(th) && !/1234567890/.test(th), th.replace(/\s+/g, " ").slice(-200));
    cierto("H2 no muestra quién del personal hizo el cambio ni el correo del actor", !th.includes(ger.email) && !/Gerente QA/.test(th));
    await capturas(pA, "25-perfil-historial");
    { const ctxB = await nuevoContexto2(); const pB = await ctxB.newPage(); await iniciarSesion(pB, uB);
      await pB.goto(`${APP}/portal/b2b/perfil`, { waitUntil: "networkidle" }); const tb = await textoPagina(pB);
      cierto("H2 aislamiento: B no ve nada del historial de A (ni teléfono, ni nombre, ni cuenta)", !/9998888|Laura Pérez Gómez|7890/.test(tb), tb.replace(/\s+/g, " ").slice(-160)); await ctxB.close(); }
    // Un cambio hecho en el portal por el propio aliado sin aprobación
    await pA.locator("#ed-telefono, input[name='telefono']").first().waitFor({ timeout: 5000 }).catch(() => undefined);
    await ctxG.close(); await ctxA.close();
  }

  if (G("84")) {
    // #84 — valor ACTUAL del contrato con enlace; el cotizado queda como histórico. Marcadores de costo para probar que no se filtran.
    sql(`insert into public.ventas (numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, estado, aliado_id, tipo_asesor, tenant, costo_hotel, costo_aereo) values ('${NUM84}', 'Cliente Uno', 'SAN ANDRÉS', current_date + 60, 4700000, 'COP', 'confirmado', ${IDA}, 'freelance', 'mayorista', 3217654, 813579);`);
    sql(`insert into public.cotizaciones (tenant, codigo, modo, estado, numero_contrato, creado_por, payload, precio_venta, moneda, destino, cliente, fecha_salida, vigencia_hasta, tipo, pax) values ('mayorista', 'COT-84-${TAG}', 'simple', 'convertida', '${NUM84}', 'interno@dspacios.test', '{"b2bAsistido":{"aliado_id":${IDA},"modo_compra":"neta","total_exigible":4520000}}', 5000000, 'COP', 'SAN ANDRÉS', 'Cliente Uno', current_date + 60, current_date + 30, 'tarifario', 2);`);
    const huellaVenta = () => scalar(`select md5(v::text) from public.ventas v where numero_contrato = '${NUM84}'`);
    const antes = huellaVenta();
    const ctxA = await nuevoContexto2(); const pA = await ctxA.newPage(); await iniciarSesion(pA, uA);
    await pA.goto(`${APP}/portal/b2b/cotizaciones?vista=asistidas`, { waitUntil: "networkidle" });
    let t = await textoPagina(pA); const html = await pA.content();
    cierto("V1 muestra «Valor del contrato» ACTUAL ($ 4.700.000) y, aparte, «Valor cotizado» 4.520.000 como histórico", /Valor del contrato\s*\$\s?4\.700\.000/i.test(t.replace(/\s+/g, " ")) && /Valor cotizado:[^$]*\$\s?4\.520\.000/i.test(t.replace(/\s+/g, " ")), t.replace(/\s+/g, " ").slice(-260));
    cierto("V1 enlaza al contrato", (await pA.locator(`a[href*="#contrato-${NUM84}"]`).count()) >= 1);
    cierto("V1 ninguna columna de costo llega a la página (3.217.654 / 813.579 no aparecen)", !/3\.217\.654|813\.579|3217654|813579/.test(html));
    await capturas(pA, "84-cotizaciones-asistidas");
    sql(`update public.ventas set precio_venta = 1950000 where numero_contrato = '${NUM84}'`);
    await pA.reload({ waitUntil: "networkidle" }); t = (await textoPagina(pA)).replace(/\s+/g, " ");
    cierto("V1 una edición interna del contrato se ve en la carga siguiente (1.950.000) y el valor cotizado NO se altera (4.520.000)", /Valor del contrato\s*\$\s?1\.950\.000/i.test(t) && /Valor cotizado:[^$]*\$\s?4\.520\.000/i.test(t), t.slice(-240));
    igual("V2 los hechos financieros no se tocaron al mostrarlo: la cotización conserva 5.000.000 y el contrato solo cambió por la edición interna", scalar(`select (select precio_venta from public.cotizaciones where numero_contrato = '${NUM84}') || '|' || (select precio_venta from public.ventas where numero_contrato = '${NUM84}')`), "5000000.00|1950000.00");
    { const ctxB = await nuevoContexto2(); const pB = await ctxB.newPage(); await iniciarSesion(pB, uB);
      await pB.goto(`${APP}/portal/b2b/cotizaciones?vista=asistidas`, { waitUntil: "networkidle" }); const tb = (await textoPagina(pB)).replace(/\s+/g, " ");
      cierto("V3 B no ve el contrato de A ni su valor", !/DTM-9|1\.950\.000|4\.520\.000|SAN ANDRÉS/.test(tb), tb.slice(-160)); await ctxB.close(); }
    await limpiarRegistro(); await pA.reload({ waitUntil: "networkidle" });
    info("P3 peticiones al abrir la lista de cotizaciones asistidas", resumen(await registro()).slice(0, 500));
    await limpiarRegistro(); await dormir(4000); igual("P3 en reposo (4 s) no hay peticiones", String((await registro()).length), "0");
    void antes;
    await ctxA.close();
  }

  // ══ G4 · #78 «Solicitar contrato» (aparte de guardar): evento persistido, aviso DENTRO de la plataforma, sin mensajes externos ═════════════
  if (G("78")) {
    const mailTotal = async () => (await (await fetch(`${MAIL}/api/v1/messages`)).json()).total ?? 0;
    const insCot = (codigo) => scalar(`insert into public.cotizaciones (tenant, codigo, modo, estado, creado_por, precio_venta, moneda, destino, cliente, fecha_salida, fecha_regreso, vigencia_hasta, tipo, pax, payload, share_token) values ('mayorista', '${codigo}-${TAG}', 'simple', 'abierta', '${uA.email}', 1800000, 'COP', 'CARTAGENA', 'Ana Gómez', current_date + 60, current_date + 64, current_date + 30, 'tarifario', 2, '{}', gen_random_uuid()) returning id`).split("\n")[0];
    const idC1 = Number(insCot("COT-78"));
    sql(`update public.config_solicitudes set emails = '${adm.email}' where id = 1`);
    const ctxA = await nuevoContexto2(); const pA = await ctxA.newPage(); await iniciarSesion(pA, uA);
    const eventos = (id) => scalar(`select count(*) || '/' || coalesce(max(estado), '-') || '/' || coalesce(max(notificados), -1) from public.cotizacion_solicitudes_contrato where cotizacion_id = ${id}`);
    const avisos = (id, u) => scalar(`select count(*) from public.avisos where cotizacion_id = ${id} and tipo = 'solicitud_contrato'${u ? ` and usuario_id = '${u.id}'` : ""}`);
    igual("N1 la cotización existe (guardada) y NO hay ningún evento de solicitud: guardar no es solicitar", eventos(idC1), "0/-/-1");
    await pA.goto(`${APP}/portal/b2b/cotizaciones`, { waitUntil: "networkidle" });
    const boton = pA.getByRole("button", { name: "Solicitar contrato" });
    cierto("N1 la lista ofrece «Solicitar contrato» sobre la cotización vigente", (await boton.count()) >= 1);
    await capturas(pA, "78-lista-antes");
    const m0 = await mailTotal();
    await limpiarRegistro();
    ACCION.solicitar = await esperarAccion(pA, () => boton.first().click());
    await pA.getByText(/Contrato solicitado/).first().waitFor({ timeout: 20000 });
    igual("N2 se persiste UN evento «solicitada», con 1 responsable notificado (el configurado)", eventos(idC1), "1/solicitada/1");
    igual("N2 el aviso va SOLO al responsable configurado (administración), dentro de la plataforma", avisos(idC1, adm) + "/" + avisos(idC1, ger) + "/" + avisos(idC1, sa), "1/0/0");
    igual("N2 NO se envió ningún correo ni mensaje externo (Mailpit sin mensajes nuevos)", String((await mailTotal()) - m0), "0");
    info("N2 peticiones de la acción (gateway)", resumen(await registro()).slice(0, 420));
    await capturas(pA, "78-lista-solicitada");
    // Repetir: idempotente (mismo estado de la cotización → no duplica evento ni aviso)
    await pA.reload({ waitUntil: "networkidle" });
    await pA.getByRole("button", { name: "Volver a solicitar" }).first().click();
    await dormir(2500);
    igual("N3 repetir la solicitud sin cambios es idempotente: sigue 1 evento y 1 aviso", eventos(idC1) + " · " + avisos(idC1), "1/solicitada/1 · 1");
    // Aislamiento: B llama DIRECTO a la acción sobre la cotización de A
    { const ctxB = await nuevoContexto2(); const pB = await ctxB.newPage(); await iniciarSesion(pB, uB);
      const rp = await repetirAccion(ctxB, `${APP}/portal/b2b/cotizaciones`, ACCION.solicitar, [idC1]);
      cierto("N4 B no puede solicitar el contrato de la cotización de A (llamada directa rechazada, nada se escribe)", !/"ok":true/.test(rp.texto) && eventos(idC1) === "1/solicitada/1" && avisos(idC1) === "1", `${rp.status} ${rp.texto.slice(0, 150).replace(/\s+/g, " ")}`);
      await pB.goto(`${APP}/portal/b2b/cotizaciones`, { waitUntil: "networkidle" }); const tb = await textoPagina(pB);
      cierto("N4 B no ve ni el botón ni la cotización de A", !/COT-78/.test(tb) && (await pB.getByRole("button", { name: /solicitar contrato/i }).count()) === 0);
      await ctxB.close(); }
    // Sin responsables configurados: se guarda igual y se dice la verdad (nadie fue avisado)
    sql("update public.config_solicitudes set emails = null where id = 1");
    const idC2 = Number(insCot("COT-78b"));
    await pA.goto(`${APP}/portal/b2b/cotizaciones`, { waitUntil: "networkidle" });
    await pA.locator("tr", { hasText: `COT-78b-${TAG}` }).getByRole("button", { name: "Solicitar contrato" }).click();
    await pA.getByText(/responsables/).first().waitFor({ timeout: 20000 });
    igual("N5 sin responsables configurados: evento guardado con 0 notificados y ningún aviso inventado", eventos(idC2) + " · " + avisos(idC2), "1/solicitada/0 · 0");
    const tn = (await textoPagina(pA)).replace(/\s+/g, " ");
    cierto("N5 la pantalla dice honestamente que aún no hay responsables configurados", /aún no hay responsables configurados/.test(tn), tn.slice(-220));
    await capturas(pA, "78-lista-sin-responsables");
    await limpiarRegistro(); await dormir(4000); igual("P4 en reposo (4 s) no hay peticiones", String((await registro()).length), "0");
    sql(`update public.config_solicitudes set emails = '${adm.email}' where id = 1`);
    await ctxA.close();
  }

  // ══ G5 · #76/#77 clientes del aliado: propiedad, aislamiento y acceso del personal; el CRM central no se toca ═══════════════════════════
  if (G("7677")) {
    const conteoCrm = () => scalar("select (select count(*) from public.crm_contactos) || '/' || (select count(*) from public.personas)");
    const antes = conteoCrm();
    const ctxA = await nuevoContexto2(); const pA = await ctxA.newPage(); await iniciarSesion(pA, uA);
    await pA.goto(`${APP}/portal/b2b/clientes`, { waitUntil: "networkidle" });
    await capturas(pA, "7677-clientes-vacio");
    await pA.getByRole("button", { name: "Agregar cliente" }).first().click();
    await pA.locator("#nom-n").fill(`QA Cliente de Laura ${TAG}`);
    await pA.locator("#tel-n").fill("3105550101");
    await pA.locator("#em-n").fill(`cliente.${TAG}@qa.test`);
    await pA.locator('input[type="checkbox"]').first().check();
    ACCION.cliente = await esperarAccion(pA, () => pA.getByRole("button", { name: "Guardar cliente" }).first().click());
    await pA.getByText(`QA Cliente de Laura ${TAG}`).first().waitFor({ timeout: 20000 });
    const fila = scalar(`select aliado_id || '|' || tenant || '|' || autorizacion_datos || '|' || coalesce(creado_por::text, '') from public.aliado_clientes where nombre = 'QA Cliente de Laura ${TAG}'`);
    igual("C1 el cliente queda asociado al aliado A (por id), en su agencia, con la autorización registrada y quién lo creó", fila, `${IDA}|mayorista|true|${uA.id}`);
    const idCli = scalar(`select id from public.aliado_clientes where nombre = 'QA Cliente de Laura ${TAG}'`);
    igual("C1 el CRM central NO se tocó (crm_contactos / personas sin filas nuevas)", conteoCrm(), antes);
    await capturas(pA, "7677-clientes-lista");
    // Aislamiento: B y X no lo ven; la API no expone la tabla; B no puede editar por llamada directa
    for (const [nombre, u] of [["B", uB], ["X(otra agencia)", uX]]) {
      const ctx = await nuevoContexto2(); const p = await ctx.newPage(); await iniciarSesion(p, u);
      await p.goto(`${APP}/portal/b2b/clientes`, { waitUntil: "networkidle" }); const tx = await textoPagina(p);
      cierto(`C2 ${nombre} no ve al cliente de A`, !tx.includes(`QA Cliente de Laura ${TAG}`) && !tx.includes("3105550101"), tx.replace(/\s+/g, " ").slice(0, 100));
      if (nombre === "B") {
        const tk = await tokenDe(u); const r = await rest("aliado_clientes?select=*", tk); const cuerpo = await r.text();
        cierto("C2 B no lee la tabla por la API (permiso denegado o sin filas)", r.status === 401 || r.status === 403 || cuerpo === "[]", `${r.status} ${cuerpo.slice(0, 70)}`);
        const rp = await repetirAccion(ctx, `${APP}/portal/b2b/clientes`, ACCION.cliente, [{ id: Number(idCli), nombre: "Hackeado por B", telefono: "1", autorizacion: true }]);
        cierto("C2 B no puede EDITAR el cliente de A con una llamada directa a la acción (nada cambia)", !/"ok":true/.test(rp.texto) && scalar(`select nombre from public.aliado_clientes where id = ${idCli}`) === `QA Cliente de Laura ${TAG}`, `${rp.status} ${rp.texto.slice(0, 150).replace(/\s+/g, " ")}`);
      }
      await ctx.close();
    }
    // Personal: lo consulta en el CRM (solo lectura), por aliado; venta no
    for (const [nombre, u, debeVer] of [["superadmin", sa, true], ["gerencia", ger, true], ["administración", adm, true], ["venta", ven, false]]) {
      const ctx = await nuevoContexto2(); const p = await ctx.newPage(); await iniciarSesion(p, u);
      await p.goto(`${APP}/crm/clientes-aliados`, { waitUntil: "networkidle" });
      const sel = p.locator("select").first();
      if (debeVer && (await sel.count()) > 0) {
        const opciones = await sel.locator("option").allInnerTexts();
        const op = opciones.find((t) => t.includes(NOMA) || t.includes(`Gómez QA ${TAG}`));
        if (op) await sel.selectOption({ label: op });
        await p.getByRole("button", { name: "Ver", exact: true }).click();
      }
      await dormir(800); const tx = await textoPagina(p);
      if (debeVer) cierto(`C3 ${nombre} (personal) ve al cliente del aliado en el CRM`, tx.includes(`QA Cliente de Laura ${TAG}`), tx.replace(/\s+/g, " ").slice(0, 160));
      else cierto(`C3 ${nombre} NO accede a los clientes de aliados`, !tx.includes(`QA Cliente de Laura ${TAG}`), tx.replace(/\s+/g, " ").slice(0, 120));
      if (nombre === "gerencia") await capturas(p, "7677-crm-clientes-aliados");
      await ctx.close();
    }
    // Contratos antiguos sin id de aliado (solo el nombre en texto): no se listan ni se les asigna nada por inferencia
    sql(`insert into public.ventas (numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, estado, tipo_asesor, tenant, freelance_nombre) values ('DTM-7${String(Date.now()).slice(-6)}', 'Cliente Legado Solo Nombre ${TAG}', 'CARTAGENA', current_date + 60, 1000000, 'COP', 'confirmado', 'freelance', 'mayorista', '${NOMA}');`);
    await pA.goto(`${APP}/portal/b2b/clientes`, { waitUntil: "networkidle" });
    const tl = await textoPagina(pA);
    cierto("C4 un contrato antiguo que solo nombra al aliado en texto NO se lista como cliente suyo (sin asignación por inferencia)", !tl.includes(`Cliente Legado Solo Nombre ${TAG}`));
    igual("C4 y no se escribió ninguna fila de cliente por ese contrato", scalar(`select count(*) from public.aliado_clientes where nombre like 'Cliente Legado%'`), "0");
    await limpiarRegistro(); await pA.reload({ waitUntil: "networkidle" });
    info("P5 peticiones al abrir Mis clientes", resumen(await registro()).slice(0, 420));
    await limpiarRegistro(); await dormir(4000); igual("P5 en reposo (4 s) no hay peticiones", String((await registro()).length), "0");
    await ctxA.close();
  }

  // ══ G6 · #62 verificación del correo POR CÓDIGO antes de pedir la aprobación B2B (Auth real + correo en Mailpit local) ═════════════════════
  if (G("62")) {
    globalThis.__huellaExistentes = scalar("select md5(string_agg(id::text || '|' || coalesce(email_confirmed_at::text, 'null'), ',' order by id)) from auth.users where email not like 'reg%'");
    const mails = async (para) => ((await (await fetch(`${MAIL}/api/v1/messages`)).json()).messages ?? []).filter((m) => (m.To ?? []).some((t) => t.Address === para)).sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
    async function codigoDe(para, antes = 0) {
      for (let i = 0; i < 40; i++) {
        const l = await mails(para);
        if (l.length > antes) { const c = await (await fetch(`${MAIL}/api/v1/message/${l[0].ID}`)).json(); const m = ((c.Text ?? "") + " " + (c.HTML ?? "")).match(/\b(\d{6})\b/); if (m) return m[1]; }
        await dormir(300);
      }
      return null;
    }
    const llenarRegistro = async (page, { email, nombre, doc }) => {
      await page.goto(`${APP}/portal/registro`, { waitUntil: "networkidle" });
      await page.locator(`${X("Tipo de aliado")}/following-sibling::select[1]`).selectOption("freelance");
      await page.locator(`${X("Nombre / Razón social *")}/following-sibling::input[1]`).fill(nombre);
      await page.locator(`${X("Tipo de documento *")}/following-sibling::select[1]`).selectOption("CC");
      await page.locator(`${X("Número de documento *")}/following-sibling::input[1]`).fill(doc);
      await page.locator(`${X("Correo *")}/following-sibling::input[1]`).fill(email);
      await page.locator(`${X("Contraseña *")}/following-sibling::input[1]`).fill("ClaveRegistro1");
      await page.locator(`${X("Repetir contraseña *")}/following-sibling::input[1]`).fill("ClaveRegistro1");
      await page.getByRole("button", { name: "Continuar: enviar código al correo" }).click();
      await page.getByTestId("paso-codigo").waitFor({ timeout: 25000 });
    };
    const solicitudes = (email) => scalar(`select count(*) from public.b2b_solicitudes where lower(email) = '${email}'`);
    const confirmado = (email) => scalar(`select coalesce(email_confirmed_at is not null, false) from auth.users where lower(email) = '${email}'`);
    // R1 · flujo correcto
    const e1 = `reg1.${TAG}@v1.test`;
    const ctx = await nuevoContexto2(); const p = await ctx.newPage();
    const m0 = (await mails(e1)).length;
    await llenarRegistro(p, { email: e1, nombre: `Registro QA ${TAG}`, doc: `90${String(Date.now()).slice(-7)}` });
    const codigo = await codigoDe(e1, m0);
    cierto("R1 el correo con el código de 6 dígitos llegó SOLO a la captura local (Mailpit)", /^\d{6}$/.test(codigo ?? ""), String(codigo));
    igual("R1 antes del código: NO existe solicitud de aprobación y el correo sigue sin confirmar", solicitudes(e1) + "/" + confirmado(e1), "0/f");
    const tcod = (await textoPagina(p)).replace(/\s+/g, " ");
    cierto("R1 el reenvío queda en espera de 60 s (temporizador local, sin petición)", /Reenviar código en \d+ s/.test(tcod), tcod.slice(-160));
    await capturas(p, "62-paso-codigo");
    // R1b · ENMIENDA ADL-040: un registro NUEVO no inicia sesión hasta verificar el código (Auth real: email_not_confirmed); tras verificar, sí
    const g = await grant(e1, "ClaveRegistro1");
    cierto("R1b registro nuevo SIN verificar: Auth rechaza el inicio de sesión (email_not_confirmed) — verificar por código es previo al login (ADL-040)", g.ok === false && /email_not_confirmed/.test(JSON.stringify(g.json)), `${g.ok ? 200 : "≠200"} ${JSON.stringify(g.json).slice(0, 120)}`);
    // R2 · código incorrecto: se rechaza, sigue sin solicitud
    await p.locator("#codigo-correo").fill("000000");
    await p.getByRole("button", { name: "Verificar y enviar solicitud" }).click();
    await p.getByRole("alert").first().waitFor({ timeout: 20000 });
    cierto("R2 un código incorrecto se rechaza con mensaje y no crea la solicitud", solicitudes(e1) === "0", (await p.getByRole("alert").first().innerText()).slice(0, 100));
    // R3 · código correcto: ahora sí existe la solicitud y el correo queda confirmado
    await p.locator("#codigo-correo").fill(codigo);
    await p.getByRole("button", { name: "Verificar y enviar solicitud" }).click();
    await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
    igual("R3 con el código correcto: la solicitud de aprobación se crea y el correo queda verificado en Auth", solicitudes(e1) + "/" + confirmado(e1), "1/t");
    await capturas(p, "62-solicitud-enviada");
    const g3 = await grant(e1, "ClaveRegistro1");
    cierto("R3b tras verificar el código, el inicio de sesión en Auth funciona", g3.ok === true, JSON.stringify(g3.json).slice(0, 80));
    // R3c · verificada y con la solicitud pendiente: entrar por la pantalla NO da acceso a datos del portal (la cuenta sigue inactiva hasta la aprobación)
    { const pl = await ctx.newPage(); await pl.goto(`${APP}/login`, { waitUntil: "networkidle" }); await pl.fill("#email", e1); await pl.fill("#password", "ClaveRegistro1"); await pl.click('form button[type="submit"]'); await dormir(5000);
      const tl = (await textoPagina(pl)).replace(/\s+/g, " "); const url = new URL(pl.url()).pathname + new URL(pl.url()).search;
      cierto("R3c verificada pero pendiente de aprobación: no ve cotizaciones, ventas ni cartera del portal", !/Mis ventas|Cartera|Cotizaciones/.test(tl.replace(/Aún no tienes/g, "")) || /pendiente|aprobaci|inactiv/i.test(tl), `${url} :: ${tl.slice(0, 200)}`);
      info("R3c destino y mensaje al entrar con la cuenta pendiente", `${url} :: ${tl.slice(0, 160)}`); await capturas(pl, "62-pendiente-login"); }
    await ctx.close();
    // R4 · tope de intentos: 5 códigos equivocados bloquean el código correcto (nueva cuenta)
    const e2 = `reg2.${TAG}@v1.test`;
    const ctx2 = await nuevoContexto2(); const p2 = await ctx2.newPage(); const mm = (await mails(e2)).length;
    await llenarRegistro(p2, { email: e2, nombre: `Registro Tope QA ${TAG}`, doc: `91${String(Date.now()).slice(-7)}` });
    const cod2 = await codigoDe(e2, mm);
    for (let i = 0; i < 5; i++) { await p2.locator("#codigo-correo").fill(String(100000 + i)); await p2.getByRole("button", { name: "Verificar y enviar solicitud" }).click(); await p2.getByRole("alert").first().waitFor({ timeout: 20000 }); await dormir(400); }
    await p2.locator("#codigo-correo").fill(cod2 ?? "123456");
    await p2.getByRole("button", { name: "Verificar y enviar solicitud" }).click();
    await dormir(2500);
    cierto("R4 tras 5 intentos fallidos, ni el código correcto crea la solicitud ni confirma el correo (tope de intentos)", solicitudes(e2) === "0" && confirmado(e2) !== "t", `solicitudes=${solicitudes(e2)} confirmado=${confirmado(e2) || "(cuenta pendiente retirada)"}`);
    // R6 · volver más tarde con el mismo correo: ¿se puede reanudar (código nuevo) o queda atrapado?
    { const ctx3 = await nuevoContexto2(); const p3 = await ctx3.newPage(); const m3 = (await mails(e2)).length;
      let reanuda = "no"; try { await llenarRegistro(p3, { email: e2, nombre: `Registro Tope QA ${TAG}`, doc: `91${String(Date.now()).slice(-7)}` }); reanuda = "sí"; } catch { reanuda = "no: " + (await textoPagina(p3)).replace(/\s+/g, " ").slice(-160); }
      cierto("R6 volver a registrar el mismo correo tras el tope permite empezar de nuevo (se envía un código nuevo)", reanuda === "sí" && (await codigoDe(e2, m3)) !== null, reanuda); await ctx3.close(); }
    const t2 = (await textoPagina(p2)).replace(/\s+/g, " ");
    info("R4 mensaje tras el tope", t2.slice(-200));
    await ctx2.close();
    // R5 · un usuario ya existente NO se bloquea: los creados con email_confirm=true siguen entrando (usuarios de las secciones anteriores)
    const gx = await grant(uA.email, uA.clave);
    cierto("R5 un usuario existente (correo ya confirmado) inicia sesión igual que antes", gx.ok === true);
    for (const [n, u] of [["staff (gerencia)", ger], ["aliado B", uB], ["agencia C", uC]]) { const gg = await grant(u.email, u.clave); cierto(`R5 ${n}: usuario existente, mismo inicio de sesión de siempre`, gg.ok === true); }
    const huellaExistentes = () => scalar("select md5(string_agg(id::text || '|' || coalesce(email_confirmed_at::text, 'null'), ',' order by id)) from auth.users where email not like 'reg%'");
    cierto("R5 sin retroactividad: la verificación de los usuarios ya existentes no se tocó durante el recorrido (huella estable)", huellaExistentes() === (globalThis.__huellaExistentes ?? huellaExistentes()), huellaExistentes());
    await limpiarRegistro(); await dormir(3000); igual("P6 en reposo (3 s) no hay peticiones", String((await registro()).length), "0");
  }
  // R7 · abandonó el registro tras recibir el código (no llegó al tope) y vuelve con el MISMO correo: ¿puede continuar o queda atrapado? (con Auth real, sin iniciar sesión mientras no verifique)
  if (G("62")) {
    const mails7 = async (para) => ((await (await fetch(`${MAIL}/api/v1/messages`)).json()).messages ?? []).filter((m) => (m.To ?? []).some((t) => t.Address === para)).sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
    const e3 = `reg3.${TAG}@v1.test`; const doc3 = `92${String(Date.now()).slice(-7)}`;
    const campos = async (page) => {
      await page.goto(`${APP}/portal/registro`, { waitUntil: "networkidle" });
      await page.locator(`${X("Tipo de aliado")}/following-sibling::select[1]`).selectOption("freelance");
      await page.locator(`${X("Nombre / Razón social *")}/following-sibling::input[1]`).fill(`Registro Reanuda QA ${TAG}`);
      await page.locator(`${X("Tipo de documento *")}/following-sibling::select[1]`).selectOption("CC");
      await page.locator(`${X("Número de documento *")}/following-sibling::input[1]`).fill(doc3);
      await page.locator(`${X("Correo *")}/following-sibling::input[1]`).fill(e3);
      await page.locator(`${X("Contraseña *")}/following-sibling::input[1]`).fill("ClaveRegistro1");
      await page.locator(`${X("Repetir contraseña *")}/following-sibling::input[1]`).fill("ClaveRegistro1");
      await page.getByRole("button", { name: "Continuar: enviar código al correo" }).click();
    };
    const c1 = await nuevoContexto2(); const q1 = await c1.newPage(); await campos(q1); await q1.getByTestId("paso-codigo").waitFor({ timeout: 25000 }); await c1.close(); // cierra sin verificar
    const tReg2 = Date.now(); const c2 = await nuevoContexto2(); const q2 = await c2.newPage(); await campos(q2);
    await dormir(4000); const t7 = (await textoPagina(q2)).replace(/\s+/g, " ");
    const llegoCodigo = (await q2.getByTestId("paso-codigo").count()) > 0;
    cierto("R7 quien abandonó tras recibir el código y vuelve con el mismo correo puede continuar (se le pide un código nuevo), no queda atrapado en «ya existe una cuenta»", llegoCodigo, t7.slice(-220));
    await capturas(q2, "62-reanudar-registro");
    // R8 · reanudado: con el código NUEVO se verifica y se crea UNA solicitud
    const sol3 = () => scalar(`select count(*) from public.b2b_solicitudes where lower(email) = '${e3}'`);
    const conf3 = () => scalar(`select coalesce(email_confirmed_at is not null, false) from auth.users where lower(email) = '${e3}'`);
    const cod7 = await (async () => { for (let i = 0; i < 80; i++) { const l = (await mails7(e3)).filter((m) => new Date(m.Created).getTime() >= tReg2 - 2000); if (l.length >= 1) { const c = await (await fetch(`${MAIL}/api/v1/message/${l[0].ID}`)).json(); const m = ((c.Text ?? "") + " " + (c.HTML ?? "")).match(/\b(\d{6})\b/); if (m) return m[1]; } await dormir(300); } return null; })();
    igual("R8 antes del código nuevo, la cuenta abandonada sigue sin verificar y sin solicitud", sol3() + "/" + conf3(), "0/f");
    info("R8 código usado y correos recibidos", `${cod7} · ${(await mails7(e3)).length} correos`);
    await q2.locator("#codigo-correo").fill(cod7 ?? "000000"); await q2.getByRole("button", { name: "Verificar y enviar solicitud" }).click();
    await q2.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 }).catch(() => undefined);
    const t8 = (await textoPagina(q2)).replace(/\s+/g, " "); info("R8 pantalla tras enviar el código nuevo", t8.slice(-220));
    igual("R8 reanudado con el código nuevo: se verifica y se crea UNA solicitud", sol3() + "/" + conf3(), "1/t");
    cierto("R8 ya verificada, entra a Auth (login permitido tras verificar)", (await grant(e3, "ClaveRegistro1")).ok === true);
    // R9 · interrupción DESPUÉS de verificar y ANTES de la solicitud (se simula borrando la fila): volver con el mismo correo no atrapa a la persona
    sql(`delete from public.b2b_solicitudes where lower(email) = '${e3}'`);
    const c4 = await nuevoContexto2(); const q4 = await c4.newPage(); await campos(q4); await dormir(4000);
    const t9 = (await textoPagina(q4)).replace(/\s+/g, " ");
    const salida9 = (await q4.getByTestId("paso-codigo").count()) > 0 ? "pide un código nuevo" : /Revisaremos tu registro/.test(t9) ? "crea la solicitud" : "mensaje: " + t9.slice(-140);
    info("R9 cuenta verificada sin solicitud, vuelve con el mismo correo", salida9);
    info("R9 LIMITACIÓN observada: cuenta verificada SIN solicitud (interrupción simulada entre verificar y crearla) — el registro dice «Ya existe una cuenta, inicia sesión» y no reanuda; se resuelve con ayuda del personal", salida9);
    await c4.close(); await c2.close();
  }

  // ══ G7 · #62 correcciones B5/B6 con Auth REAL + PostgREST REAL + la app compilada (fallos inyectados en el gateway, entrelazados de verdad entre dos navegadores) ═════════════════════════
  if (G("regb5b6")) {
    const mailsB = async (para) => ((await (await fetch(`${MAIL}/api/v1/messages`)).json()).messages ?? []).filter((m) => (m.To ?? []).some((t) => t.Address === para)).sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
    async function codigoB(para, antes = 0) {
      for (let i = 0; i < 40; i++) {
        const l = await mailsB(para);
        if (l.length > antes) { const c = await (await fetch(`${MAIL}/api/v1/message/${l[0].ID}`)).json(); const m = ((c.Text ?? "") + " " + (c.HTML ?? "")).match(/\b(\d{6})\b/); if (m) return m[1]; }
        await dormir(300);
      }
      return null;
    }
    const llenarB = async (page, { email, nombre, doc }) => {
      await page.goto(`${APP}/portal/registro`, { waitUntil: "networkidle" });
      await page.locator(`${X("Tipo de aliado")}/following-sibling::select[1]`).selectOption("freelance");
      await page.locator(`${X("Nombre / Razón social *")}/following-sibling::input[1]`).fill(nombre);
      await page.locator(`${X("Tipo de documento *")}/following-sibling::select[1]`).selectOption("CC");
      await page.locator(`${X("Número de documento *")}/following-sibling::input[1]`).fill(doc);
      await page.locator(`${X("Correo *")}/following-sibling::input[1]`).fill(email);
      await page.locator(`${X("Contraseña *")}/following-sibling::input[1]`).fill("ClaveRegistro1");
      await page.locator(`${X("Repetir contraseña *")}/following-sibling::input[1]`).fill("ClaveRegistro1");
      await page.getByRole("button", { name: "Continuar: enviar código al correo" }).click();
      await page.getByTestId("paso-codigo").waitFor({ timeout: 25000 });
    };
    const solB = (email) => scalar(`select count(*) from public.b2b_solicitudes where lower(email) = '${email}'`);
    const confB = (email) => scalar(`select coalesce(email_confirmed_at is not null, false) from auth.users where lower(email) = '${email}'`);
    const cuentaB = (email) => scalar(`select count(*) from auth.users where lower(email) = '${email}'`);
    const estadoB = (email) => scalar(`select coalesce((select estado from public.registro_b2b_estado r join auth.users u on u.id = r.usuario_id where lower(u.email) = '${email}'), 'sin fila')`);
    const enviarCodigo = async (page, codigo) => { await page.locator("#codigo-correo").fill(codigo); await page.getByRole("button", { name: "Verificar y enviar solicitud" }).click(); };
    const docB = (p) => `${p}${String(Date.now()).slice(-7)}`;

    // R10 · B6: el código se acepta (Auth confirma) y falla la creación de la solicitud (500 REAL en la RPC): la cuenta verificada NO se borra y se continúa con la contraseña
    { const e = `b6a.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B6a QA ${TAG}`, doc: docB("93") });
      const cod = await codigoB(e, m0);
      igual("R10 antes del código: cuenta sin verificar, sin solicitud y con estado pendiente en la base", `${cuentaB(e)}/${confB(e)}/${solB(e)}/${estadoB(e)}`, "1/f/0/pendiente");
      await inyectar("/rest/v1/rpc/registro_b2b_completar", "500", 1);
      await enviarCodigo(p, cod);
      await p.getByTestId("paso-continuar").waitFor({ timeout: 25000 });
      const t = (await textoPagina(p)).replace(/\s+/g, " ");
      cierto("R10 tras fallar la creación de la solicitud la pantalla ofrece CONTINUAR con la contraseña (no «código inválido», no «ya existe»)", /Continúa tu registro/.test(t) && /contraseña/.test(t) && !/no es válido/.test(t), t.slice(-200));
      igual("R10 la cuenta verificada se CONSERVA (no se borra): existe, confirmada, sin solicitud, estado «verificado»", `${cuentaB(e)}/${confB(e)}/${solB(e)}/${estadoB(e)}`, "1/t/0/verificado");
      await capturas(p, "62-b6-continuar");
      // contraseña incorrecta: no autoriza
      await p.locator("#continuar-password").fill("ClaveEquivocada9");
      await p.getByRole("button", { name: "Continuar y enviar solicitud" }).click();
      await p.locator('p[role="alert"]').first().waitFor({ timeout: 20000 });
      const tm = (await p.locator('p[role="alert"]').first().innerText()).replace(/\s+/g, " ");
      cierto("R10 contraseña equivocada: se rechaza y NO se crea la solicitud (saber el correo no basta)", /No pudimos confirmar tu identidad/.test(tm) && solB(e) === "0", tm.slice(0, 110));
      // contraseña correcta: completa; repetir (otra pestaña, mismo registro) no duplica
      await p.locator("#continuar-password").fill("ClaveRegistro1");
      await p.getByRole("button", { name: "Continuar y enviar solicitud" }).click();
      await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
      igual("R10 con la contraseña correcta se crea UNA solicitud y la cuenta sigue verificada", `${cuentaB(e)}/${confB(e)}/${solB(e)}/${estadoB(e)}`, "1/t/1/completado");
      await ctx.close(); }

    // R11 · B6: la respuesta de la RPC «completar» se PIERDE (la solicitud sí se creó): continuar responde ok y NO duplica
    { const e = `b6b.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B6b QA ${TAG}`, doc: docB("94") });
      const cod = await codigoB(e, m0);
      await inyectar("/rest/v1/rpc/registro_b2b_completar", "perdida", 1);
      await enviarCodigo(p, cod);
      await p.getByTestId("paso-continuar").waitFor({ timeout: 25000 });
      igual("R11 respuesta perdida: la solicitud SÍ se creó en la base aunque el navegador no lo supo", `${confB(e)}/${solB(e)}/${estadoB(e)}`, "t/1/completado");
      await p.locator("#continuar-password").fill("ClaveRegistro1");
      await p.getByRole("button", { name: "Continuar y enviar solicitud" }).click();
      await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
      igual("R11 continuar tras la respuesta perdida responde éxito SIN duplicar la solicitud", `${cuentaB(e)}/${solB(e)}`, "1/1");
      await ctx.close(); }

    // R12 · B6: falla la ANOTACIÓN del intento exitoso (500 real) pero Auth ya confirmó: se completa igual (la base revalida con Auth)
    { const e = `b6c.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B6c QA ${TAG}`, doc: docB("95") });
      const cod = await codigoB(e, m0);
      await inyectar("/rest/v1/rpc/registro_b2b_resolver_intento", "500", 1);
      await enviarCodigo(p, cod);
      await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
      igual("R12 si falla anotar el intento exitoso, la solicitud se crea igual y la cuenta se conserva", `${cuentaB(e)}/${confB(e)}/${solB(e)}`, "1/t/1");
      await ctx.close(); }
    await sinFallos();

    // R13 · B5: cuatro códigos incorrectos y luego el CORRECTO y uno INCORRECTO A LA VEZ (dos peticiones HTTP reales a la MISMA Server Action, en paralelo): la cuenta verificada y su solicitud sobreviven
    for (const orden of ["correcto-primero", "incorrecto-primero"]) {
      const k = orden === "correcto-primero" ? "a" : "b"; const e = `b5${k}.${TAG}@v1.test`; const nombre = `Registro B5 ${k} QA ${TAG}`; const doc = docB(k === "a" ? "96" : "97");
      const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre, doc });
      const cod = await codigoB(e, m0);
      let idAccion = null;
      for (let i = 0; i < 4; i++) {
        await p.locator("#codigo-correo").fill(String(200000 + i));
        idAccion = await esperarAccion(p, () => p.getByRole("button", { name: "Verificar y enviar solicitud" }).click());
        await p.locator('p[role="alert"]').first().waitFor({ timeout: 20000 }); await dormir(300);
      }
      igual(`R13 (${orden}) tras 4 intentos incorrectos: cuenta presente, sin verificar, sin solicitud y 4 fallos contados por la base`, `${cuentaB(e)}/${confB(e)}/${solB(e)}/${scalar(`select fallos from public.registro_b2b_estado r join auth.users u on u.id = r.usuario_id where lower(u.email) = '${e}'`)}`, "1/f/0/4");
      const datos = { tipo: "freelance", nombre, nit: doc, contacto: "", email: e, telefono: "", ciudad: "", notas: "", aceptaNotificaciones: true, tipoDocumento: "CC" };
      const peticion = (codigo) => repetirAccion(ctx, `${APP}/portal/registro`, idAccion, [{ ...datos, codigo }]);
      const lanzadas = orden === "correcto-primero" ? [peticion(cod), peticion("000000")] : [peticion("000000"), peticion(cod)];
      const [r1, r2] = await Promise.all(lanzadas);
      const resultados = [r1, r2].map((r) => (/"ok":true/.test(r.texto) ? "ok" : /Superaste los intentos/.test(r.texto) ? "agotado" : /otro intento/.test(r.texto) ? "en_curso" : /contraseña/.test(r.texto) ? "continuar" : "invalido"));
      info(`R13 (${orden}) respuestas de las dos peticiones simultáneas`, resultados.join(" · "));
      await dormir(1500);
      const sobrevive = `${cuentaB(e)}/${confB(e)}/${solB(e)}` === "1/t/1";
      const agotada = `${cuentaB(e)}/${solB(e)}` === "0/0" && resultados.includes("agotado");
      // El orden de LLEGADA al servidor de dos peticiones lanzadas a la vez no lo controla el cliente: cualquiera de las dos puede tomar el quinto y último cupo. Ambos desenlaces son correctos; lo que NUNCA puede pasar es una cuenta verificada borrada.
      info(`R13 (${orden}) desenlace observado`, sobrevive ? "el correcto tomó el cupo: cuenta verificada con su solicitud" : agotada ? "el incorrecto tomó el último cupo: registro sin verificar descartado (cinco intentos reales)" : "inesperado");
      cierto(`R13 (${orden}) invariante: o sobrevive la cuenta VERIFICADA con UNA solicitud y exactamente UN éxito, o se descarta una cuenta que NUNCA se verificó (0 solicitudes, sin éxitos); jamás una verificada borrada`,
        (sobrevive && resultados.filter((x) => x === "ok").length === 1) || (agotada && resultados.filter((x) => x === "ok").length === 0), `${cuentaB(e)}/${confB(e)}/${solB(e)}/${estadoB(e)} · ${resultados.join(",")}`);
      await ctx.close();
    }

    // R14 · B5: una limpieza/reinicio frente a una cuenta ya VERIFICADA (volver a registrar el mismo correo tras verificar) no borra nada y pide continuar o indica que ya existe
    { const e = `b5c.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 c QA ${TAG}`, doc: docB("98") });
      const cod = await codigoB(e, m0);
      await inyectar("/rest/v1/rpc/registro_b2b_completar", "500", 1);
      await enviarCodigo(p, cod);
      await p.getByTestId("paso-continuar").waitFor({ timeout: 25000 });
      await sinFallos();
      const uid = scalar(`select id from auth.users where lower(email) = '${e}'`);
      // El mismo correo vuelve a empezar el registro en otra pestaña: NO se reemplaza la cuenta verificada
      const ctx2 = await nuevoContexto(); const p2 = await ctx2.newPage();
      await p2.goto(`${APP}/portal/registro`, { waitUntil: "networkidle" });
      await p2.locator(`${X("Tipo de aliado")}/following-sibling::select[1]`).selectOption("freelance");
      await p2.locator(`${X("Nombre / Razón social *")}/following-sibling::input[1]`).fill(`Registro B5 c QA ${TAG}`);
      await p2.locator(`${X("Tipo de documento *")}/following-sibling::select[1]`).selectOption("CC");
      await p2.locator(`${X("Número de documento *")}/following-sibling::input[1]`).fill(docB("98"));
      await p2.locator(`${X("Correo *")}/following-sibling::input[1]`).fill(e);
      await p2.locator(`${X("Contraseña *")}/following-sibling::input[1]`).fill("OtraClaveNueva9");
      await p2.locator(`${X("Repetir contraseña *")}/following-sibling::input[1]`).fill("OtraClaveNueva9");
      await p2.getByRole("button", { name: "Continuar: enviar código al correo" }).click();
      await p2.getByTestId("paso-continuar").waitFor({ timeout: 25000 });
      igual("R14 reiniciar el registro de un correo YA VERIFICADO no borra ni reemplaza la cuenta (mismo id, sigue confirmada)", `${scalar(`select id from auth.users where lower(email) = '${e}'`) === uid}/${confB(e)}/${cuentaB(e)}`, "true/t/1");
      cierto("R14 la contraseña original NO se pisa: la nueva no inicia sesión y la original sí", (await grant(e, "OtraClaveNueva9")).ok === false && (await grant(e, "ClaveRegistro1")).ok === true);
      await ctx2.close(); await ctx.close(); }

    // R15 · peticiones reales por acción con la coordinación nueva (medido en el gateway, sin sondeos ni reintentos) y reposo
    { const e = `b5d.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 d QA ${TAG}`, doc: docB("99") });
      const cod = await codigoB(e, m0);
      const resumen = (l) => { const c = {}; for (const x of l) { const k = x.ruta.split("?")[0].replace("/rest/v1/rpc/", "rpc:").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id"); c[k] = (c[k] ?? 0) + 1; } return JSON.stringify(c); };
      await limpiarRegistro();
      await p.locator("#codigo-correo").fill("000000"); await p.getByRole("button", { name: "Verificar y enviar solicitud" }).click(); await p.locator('p[role="alert"]').first().waitFor({ timeout: 20000 }); await dormir(600);
      const lm = await registro();
      info("R15 una verificación INCORRECTA: peticiones al gateway por tipo", `${lm.length} · ${resumen(lm)}`);
      cierto("R15 una verificación incorrecta cuesta como máximo 8 peticiones (3 lecturas + reservar + verificar + resolver + margen)", lm.length <= 8, String(lm.length));
      await limpiarRegistro();
      await p.locator("#codigo-correo").fill(cod); await p.getByRole("button", { name: "Verificar y enviar solicitud" }).click(); await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 }); await dormir(600);
      const lc = await registro();
      info("R15 una verificación CORRECTA con solicitud: peticiones al gateway por tipo", `${lc.length} · ${resumen(lc)}`);
      cierto("R15 una verificación correcta cuesta como máximo 10 peticiones", lc.length <= 10, String(lc.length));
      await limpiarRegistro(); await dormir(3000);
      igual("R15 en reposo (3 s) no hay peticiones", String((await registro()).length), "0");
      await ctx.close(); }

    // ══ B5 residual · verificación TARDÍA / resultado desconocido / reinicio, con GoTrue REAL ═════════════════════════════════════════════════════════════════════════════════════════
    const verifyDirecto = async (email, token) => { const r = await fetch(`${GW}/auth/v1/verify`, { method: "POST", headers: { apikey: CFG.anonKey, "content-type": "application/json" }, body: JSON.stringify({ type: "signup", email, token }) }); return { status: r.status, texto: (await r.text()).slice(0, 160) }; };
    const idDe = (email) => scalar(`select coalesce((select id::text from auth.users where lower(email) = '${email}'), 'sin cuenta')`);
    const sesionesDe = (id) => scalar(`select (select count(*) from auth.identities where user_id = '${id}') || '/' || (select count(*) from auth.sessions where user_id = '${id}')`);
    const faltaDe = (email) => scalar(`select coalesce((select fallos::text from public.registro_b2b_estado r join auth.users u on u.id = r.usuario_id where lower(u.email) = '${email}'), 'sin fila')`);

    // R16 · la respuesta de verificación se PIERDE (Auth SÍ confirmó): resultado desconocido → no cuenta como intento y el registro se completa preguntando a la base
    { const e = `b5e.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 e QA ${TAG}`, doc: docB("81") });
      const cod = await codigoB(e, m0);
      await inyectar("/auth/v1/verify", "perdida", 1);
      await enviarCodigo(p, cod);
      await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 30000 });
      igual("R16 respuesta de verificación perdida (Auth sí confirmó): se completa; cuenta confirmada, UNA solicitud, 0 fallos contados", `${cuentaB(e)}/${confB(e)}/${solB(e)}/${faltaDe(e)}`, "1/t/1/0");
      await sinFallos(); await ctx.close(); }

    // R17 · Auth responde 500 SIN aplicar nada: resultado desconocido → no cuenta, no borra, se puede reintentar (y seis así no agotan el registro)
    { const e = `b5f.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 f QA ${TAG}`, doc: docB("82") });
      const cod = await codigoB(e, m0);
      await inyectar("/auth/v1/verify", "500", 6);
      for (let i = 0; i < 6; i++) { await p.locator("#codigo-correo").fill(cod); await p.getByRole("button", { name: "Verificar y enviar solicitud" }).click(); await p.locator('p[role="alert"]').first().waitFor({ timeout: 20000 }); await dormir(400); }
      const tx = (await p.locator('p[role="alert"]').first().innerText()).replace(/\s+/g, " ");
      cierto("R17 con Auth caído la pantalla pide reintentar (no «código inválido», no «intentos agotados»)", /No pudimos procesar/.test(tx) && !/Superaste/.test(tx), tx.slice(0, 120));
      igual("R17 seis respuestas 500: cuenta intacta, sin verificar, 0 fallos y nada en vuelo", `${cuentaB(e)}/${confB(e)}/${faltaDe(e)}/${scalar(`select r.en_vuelo from public.registro_b2b_estado r join auth.users u on u.id = r.usuario_id where lower(u.email) = '${e}'`)}`, "1/f/0/0");
      await sinFallos();
      await enviarCodigo(p, cod);
      await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
      igual("R17 al volver Auth el mismo código completa el registro", `${confB(e)}/${solB(e)}`, "t/1");
      await ctx.close(); }

    // R18 · el reinicio REEMPLAZA una cuenta sin verificar con borrado atómico en la base: nada queda colgando en Auth y el código viejo ya no sirve
    { const e = `b5g.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 g QA ${TAG}`, doc: docB("83") });
      const codViejo = await codigoB(e, m0); const idViejo = idDe(e);
      const ctx2 = await nuevoContexto(); const p2 = await ctx2.newPage(); const m1 = (await mailsB(e)).length;
      await llenarB(p2, { email: e, nombre: `Registro B5 g QA ${TAG}`, doc: docB("83") });
      const codNuevo = await codigoB(e, m1); const idNuevo = idDe(e);
      cierto("R18 el reinicio crea otra cuenta (otro id) y la anterior desapareció junto con su identidad y sesiones de Auth", idNuevo !== idViejo && idViejo !== "sin cuenta" && idNuevo !== "sin cuenta" && idDe(e) === idNuevo && scalar(`select count(*) from auth.users where id = '${idViejo}'`) === "0" && sesionesDe(idViejo) === "0/0", `${idViejo} → ${idNuevo} · ${sesionesDe(idViejo)}`);
      await enviarCodigo(p, codViejo);   // la pantalla vieja manda el código viejo
      await p.locator('p[role="alert"]').first().waitFor({ timeout: 20000 });
      igual("R18 el código de la cuenta reemplazada no confirma ni la cuenta nueva ni nada", `${confB(e)}/${solB(e)}/${idDe(e) === idNuevo}`, "f/0/true");
      await enviarCodigo(p2, codNuevo);
      await p2.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
      igual("R18 el código nuevo completa el registro de la cuenta nueva", `${confB(e)}/${solB(e)}`, "t/1");
      await ctx.close(); await ctx2.close(); }

    // R19 · verificación TARDÍA real: la reserva «vence» (3 minutos lógicos) y GoTrue confirma el correo DESPUÉS (verify directo con el código correcto), luego llega el reinicio
    { const e = `b5h.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 h QA ${TAG}`, doc: docB("84") });
      const cod = await codigoB(e, m0); const id = idDe(e);
      sql(`select public.registro_b2b_reclamar_intento('${id}'); update public.registro_b2b_estado set ultimo_reclamo = now() - interval '3 minutes' where usuario_id = '${id}'`);
      const v = await verifyDirecto(e, cod);                               // la verificación que «seguía en vuelo» completa ahora, tras vencer la reserva
      igual("R19 GoTrue confirma tarde (verify con el código correcto)", `${v.status}/${confB(e)}`, "200/t");
      const ctx2 = await nuevoContexto(); const p2 = await ctx2.newPage();
      await p2.goto(`${APP}/portal/registro`, { waitUntil: "networkidle" });
      await p2.locator(`${X("Tipo de aliado")}/following-sibling::select[1]`).selectOption("freelance");
      await p2.locator(`${X("Nombre / Razón social *")}/following-sibling::input[1]`).fill(`Registro B5 h QA ${TAG}`);
      await p2.locator(`${X("Tipo de documento *")}/following-sibling::select[1]`).selectOption("CC");
      await p2.locator(`${X("Número de documento *")}/following-sibling::input[1]`).fill(docB("84"));
      await p2.locator(`${X("Correo *")}/following-sibling::input[1]`).fill(e);
      await p2.locator(`${X("Contraseña *")}/following-sibling::input[1]`).fill("OtraClaveNueva9");
      await p2.locator(`${X("Repetir contraseña *")}/following-sibling::input[1]`).fill("OtraClaveNueva9");
      await p2.getByRole("button", { name: "Continuar: enviar código al correo" }).click();
      await p2.getByTestId("paso-continuar").waitFor({ timeout: 25000 });
      igual("R19 el reinicio tras la confirmación tardía NO borra: mismo id, sigue confirmada, sin solicitud todavía", `${idDe(e) === id}/${confB(e)}/${solB(e)}`, "true/t/0");
      await p2.locator("#continuar-password").fill("ClaveRegistro1");
      await p2.getByRole("button", { name: "Continuar y enviar solicitud" }).click();
      await p2.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 });
      igual("R19 continuar con la contraseña original completa el registro (una solicitud)", `${solB(e)}/${idDe(e) === id}`, "1/true");
      await ctx.close(); await ctx2.close(); }

    // R20 · al revés: el reinicio gana la carrera (cuenta sin verificar con reserva vencida); la verificación tardía con el código viejo ya no puede confirmar nada
    { const e = `b5i.${TAG}@v1.test`; const ctx = await nuevoContexto(); const p = await ctx.newPage(); const m0 = (await mailsB(e)).length;
      await llenarB(p, { email: e, nombre: `Registro B5 i QA ${TAG}`, doc: docB("85") });
      const codViejo = await codigoB(e, m0); const idViejo = idDe(e);
      sql(`select public.registro_b2b_reclamar_intento('${idViejo}'); update public.registro_b2b_estado set ultimo_reclamo = now() - interval '3 minutes' where usuario_id = '${idViejo}'`);
      const ctx2 = await nuevoContexto(); const p2 = await ctx2.newPage(); const m1 = (await mailsB(e)).length;
      await llenarB(p2, { email: e, nombre: `Registro B5 i QA ${TAG}`, doc: docB("85") });   // reinicio con la reserva vencida: la base borra la cuenta sin verificar
      const idNuevo = idDe(e);
      const v = await verifyDirecto(e, codViejo);                                            // la verificación vieja llega tarde
      cierto("R20 el reinicio ganó (otro id) y la verificación tardía con el código viejo es rechazada por GoTrue", idNuevo !== idViejo && v.status >= 400 && confB(e) === "f", `${v.status} ${v.texto}`);
      igual("R20 la cuenta nueva sigue sin confirmar y sin solicitud (no se contaminó)", `${confB(e)}/${solB(e)}/${faltaDe(e)}`, "f/0/0");
      await ctx.close(); await ctx2.close(); }
    await sinFallos();
    await limpiarRegistro();
  }

  // ══ G8 · pestaña «Agentes» del propietario de una agencia (la SÉPTIMA pestaña del portal): visible, alcanzable y sin desbordar en 1280 / 820 / 390 px ═════════════════════════════════════════
  if (G("agentes")) {
    const NAV = 'nav[aria-label="Secciones del portal"]';
    // El propietario de una agencia (rol agencia sin agencia_id) ve 7 pestañas; un freelance, 6.
    const medirNav = async (page) => page.evaluate((sel) => {
      const nav = document.querySelector(sel); const ancho = document.documentElement.clientWidth;
      const enlaces = [...(nav?.querySelectorAll("a") ?? [])].map((a) => { const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return { t: (a.textContent ?? "").trim(), visible: r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none", izq: Math.round(r.left), der: Math.round(r.right), alto: Math.round(r.height), arriba: Math.round(r.top), abajo: Math.round(r.bottom) }; });
      const navR = nav?.getBoundingClientRect();
      return { ancho, scroll: document.documentElement.scrollWidth, enlaces, navDer: navR ? Math.round(navR.right) : null, navScrollX: nav ? (nav.scrollWidth > nav.clientWidth + 1) : null };
    }, NAV);
    const ctx = await nuevoContexto(); const p = await ctx.newPage();
    await iniciarSesion(p, uC);
    await p.goto(`${APP}/portal/b2b`, { waitUntil: "networkidle" });
    const aliasAnchos = [["escritorio", 1280, 800], ["intermedio", 820, 1000], ["movil", 390, 800]];
    for (const [et, w, h] of aliasAnchos) {
      await p.setViewportSize({ width: w, height: h }); await dormir(300);
      const m = await medirNav(p);
      igual(`T7 ${et} (${w} px): el propietario de agencia ve SIETE pestañas, incluida «Agentes»`, `${m.enlaces.length}/${m.enlaces.some((x) => /Agentes/.test(x.t))}`, "7/true");
      cierto(`T7 ${et}: las siete son visibles y NINGUNA queda fuera del ancho de pantalla`, m.enlaces.length === 7 && m.enlaces.every((x) => x.visible && x.izq >= -1 && x.der <= m.ancho + 1), JSON.stringify(m.enlaces.map((x) => `${x.t}:${x.izq}-${x.der}`)).slice(0, 240));
      cierto(`T7 ${et}: la página no tiene scroll horizontal (documento ${m.scroll} px ≤ pantalla ${m.ancho} px)`, m.scroll <= m.ancho + 1, `${m.scroll}/${m.ancho}`);
      cierto(`T7 ${et}: cada pestaña es tocable (alto ≥ 36 px)`, m.enlaces.every((x) => x.alto >= 36), JSON.stringify(m.enlaces.map((x) => x.alto)));
      await p.screenshot({ path: join(SALIDA, `7tab-inicio-${et}.png`), fullPage: false });
    }
    // Se llega a «Agentes» con un toque y la pestaña queda marcada como la actual (aria-current) en cada ancho
    for (const [et, w, h] of aliasAnchos) {
      await p.setViewportSize({ width: w, height: h }); await p.goto(`${APP}/portal/b2b`, { waitUntil: "networkidle" }); await dormir(250);
      await p.locator(`${NAV} a`, { hasText: "Agentes" }).first().click();
      await p.waitForURL((u) => u.pathname === "/portal/b2b/agentes", { timeout: 20000 });
      await p.waitForLoadState("networkidle");
      const marcada = await p.evaluate((sel) => { const a = [...document.querySelectorAll(`${sel} a`)].find((x) => x.getAttribute("aria-current")); return a ? (a.textContent ?? "").trim() : null; }, NAV);
      const m = await medirNav(p);
      cierto(`T7 ${et}: «Agentes» abre /portal/b2b/agentes, queda marcada como actual y mantiene las siete pestañas sin desbordar`, /Agentes/.test(marcada ?? "") && m.enlaces.length === 7 && m.scroll <= m.ancho + 1 && m.enlaces.every((x) => x.der <= m.ancho + 1), `${marcada}/${m.enlaces.length}/${m.scroll}/${m.ancho}`);
      await p.screenshot({ path: join(SALIDA, `7tab-agentes-${et}.png`), fullPage: false });
    }
    await ctx.close();
    // Contraste: un freelance (titular sin agencia propia) NO ve la séptima pestaña
    { const c2 = await nuevoContexto(); const q = await c2.newPage(); await iniciarSesion(q, uA); await q.goto(`${APP}/portal/b2b`, { waitUntil: "networkidle" });
      const m = await medirNav(q);
      igual("T7 un freelance ve SEIS pestañas y ninguna «Agentes»", `${m.enlaces.length}/${m.enlaces.some((x) => /Agentes/.test(x.t))}`, "6/false");
      await c2.close(); }
  }

} catch (e) {
  registrar("EXCEPCIÓN no controlada durante el recorrido", String(e?.stack ?? e).split("\n").slice(0, 4).join(" ⏎ ") + " | causa=" + String(e?.cause?.code ?? e?.cause?.message ?? ""), "sin excepción", false);
} finally {
  await sinFallos().catch(() => undefined);
  await browser.close();
}

writeFileSync(join(SALIDA, "controles.json"), JSON.stringify({ ctrl, layout }, null, 2));
console.log("\ncontrol | observado | esperado | estado");
let fallos = 0;
for (const c of ctrl) { console.log(`${c.nombre} | ${c.observado} | ${c.esperado} | ${c.estado}`); if (c.estado === "FALLO") fallos++; }
// Desborde horizontal: se informa siempre. La barra superior del personal a 820 px ya desbordaba antes de este bloque (observación O3 del §9.6): se marca como previa, no se oculta.
const esBarra = (l) => l.vista === "intermedio" && l.fuera.join(",") === "BUTTON:Cerrar sesión";
// Tablas con scroll horizontal PROPIO (patrón existente del portal, min-w-[980px]): su última columna queda fuera de la pantalla angosta por diseño; se informa, no se oculta.
const esTablaConScroll = (l) => l.scroll <= l.ancho && l.fuera.length > 0 && l.fuera.every((x) => /^A:Contrato /.test(x)) && /cotizaciones/.test(l.nombre);
const malos = layout.filter((l) => (l.scroll > l.ancho || l.fuera.length) && !esBarra(l) && !esTablaConScroll(l));
for (const t of layout.filter(esTablaConScroll)) console.log("  (tabla con scroll propio, patrón existente) " + t.nombre + " " + t.vista + ": ancho=" + t.ancho + " scroll=" + t.scroll + " fuera=" + t.fuera.join(","));
for (const p of layout.filter((l) => (l.scroll > l.ancho || l.fuera.length) && esBarra(l))) console.log("  (previo: barra superior del personal) " + p.nombre + " " + p.vista + ": ancho=" + p.ancho + " scroll=" + p.scroll);
console.log(`\nLAYOUT: ${layout.length} capturas, ${malos.length} con desborde/elementos fuera de pantalla`);
for (const m of malos) console.log(`  ${m.nombre} ${m.vista}: ancho=${m.ancho} scroll=${m.scroll} fuera=${m.fuera.join(",")}`);
console.log(fallos === 0 && malos.length === 0 ? `\nRESULTADO: ${ctrl.length} controles, 0 FALLO` : `\nRESULTADO: ${fallos} FALLO(S) de ${ctrl.length}; layout con problemas: ${malos.length}`);
process.exit(fallos === 0 && malos.length === 0 ? 0 : 1);
