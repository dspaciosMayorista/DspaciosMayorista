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

try {
  await sinFallos(); await limpiarRegistro();
  sql(aliadoAuto(94801, "Agencia NETO48", "agencia", 0.12) + aliadoAuto(94802, "Agencia Cero48", "agencia", 0) + aliadoAuto(94803, "Freelance NETO48", "freelance", "null"));
  // Fixture sintético de ESTA base desechable: la plantilla no trae el RNT de Mayorista (dato del dueño en «Datos de la agencia», que no se inventa ni se versiona); sin él el documento se niega a imprimirse (guarda correcta).
  sql("update public.agencias set rnt = 'RNT-PRUEBA-LOCAL' where tenant = 'mayorista' and coalesce(btrim(rnt), '') = ''");
  const R = { A: "ClaveOriginal1" };
  const admin = await crearUsuario("administracion", R.A);
  const gerencia = await crearUsuario("gerencia", R.A);
  const venta = await crearUsuario("venta", R.A);
  const superU = await crearUsuario("superadmin", R.A);

  // ══ 1. Administración crea una cotización B2B en NETO desde la pantalla real ══════════════════
  {
    const ctx = await nuevoContexto(); const page = await ctx.newPage();
    await iniciarSesion(page, admin);
    await llenarCotizacion(page, { aliado: "Agencia NETO48" });
    cierto("1: administración ve la opción NETO", (await modalidadNeto(page).count()) === 1);
    cierto("1: PVP seleccionado por defecto y con BNC", (await modalidadPvp(page).isChecked()) && (await page.locator(`${X("Base no comisionable (BNC) *")}`).count()) === 1);
    await modalidadNeto(page).check();
    const t = await page.locator('[data-testid="neto-manual"]').innerText();
    cierto("1: la vista previa muestra el NETO a mano (4.520.000) y la comisión (480.000)", /NETO que paga el aliado\s*\$\s?4\.520\.000/.test(t) && /Descuento total al aliado\s*\$\s?480\.000/.test(t), t.replace(/\s+/g, " ").slice(-260));
    cierto("1: en NETO no hay campo BNC", (await page.locator(`${X("Base no comisionable (BNC) *")}`).count()) === 0);
    await capturas(page, "48-form-neto");
    await limpiarRegistro();
    await Promise.all([page.waitForURL(/\/dashboard\/cotizaciones\/\d+$/, { timeout: 45000 }), page.getByRole("button", { name: "Generar cotización", exact: true }).click()]);
    const idCot = Number(new URL(page.url()).pathname.split("/").pop());
    await page.waitForLoadState("networkidle");
    const sello = sql(`select modalidad, neto_total, descuento_total, costo_total, aliado_id, autorizado_por is null, moneda from public.cotizacion_neto where cotizacion_id = ${idCot}`).trim();
    igual("1: sello NETO persistido por la acción real (NETO 4.520.000, descuento 480.000, costo 4.000.000, aliado 94801)", sello, "neto|4520000.00|480000.00|4000000.00|94801|t|COP");
    igual("1: la cotización queda a PVP 5.000.000 con el aliado por id", scalar(`select precio_venta || '|' || aliado_id || '|' || estado from public.cotizaciones where id = ${idCot}`), "5000000.00|94801|abierta");
    igual("1: sin plan de comisión #97 (NETO no crea segunda comisión)", scalar(`select count(*) from public.comision_plan where cotizacion_id = ${idCot}`), "0");
    const texto = await textoPagina(page);
    cierto("1: la ficha explica por qué no se edita", /precio NETO fijado/.test(texto), texto.slice(0, 80));
    cierto("1: no se ofrecen los editores de servicios ni de recobro", (await page.getByRole("button", { name: /Editar servicios|Guardar cambios/ }).count()) === 0);
    cierto("1: la ficha muestra el precio NETO exigible", /4\.520\.000/.test(texto));
    cierto("1: el PVP del cliente (5.000.000) sigue visible en la ficha", /5\.000\.000/.test(texto));
    await capturas(page, "48-ficha-neto");
    // Control de LAYOUT PREVIO: una página interna que este cambio NO toca, a los mismos anchos (la barra superior del personal ya desbordaba a 820 px antes de #48).
    await page.goto(`${APP}/dashboard/cotizaciones`, { waitUntil: "networkidle" });
    await capturas(page, "48-previo-lista-sin-cambios");
    info("1: peticiones del guardado (gateway)", resumen((await registro()).filter((e) => e.ruta.startsWith("/rest/")).slice(0, 12)));
    // Documento público/imprimible de la cotización: debe mostrar el PVP (nunca el NETO ni los costos).
    const pagDoc = await ctx.newPage();
    await pagDoc.goto(`${APP}/cotizacion/${idCot}`, { waitUntil: "networkidle" });
    const doc = await textoPagina(pagDoc);
    cierto("1: el documento al cliente muestra el PVP 5.000.000", /5\.000\.000/.test(doc));
    cierto("1: el documento al cliente NO muestra el NETO ni el descuento", !/4\.520\.000|480\.000/.test(doc), doc.slice(0, 100));
    await capturas(pagDoc, "48-documento-cliente");
    // Nueva cotización del mismo cliente aliado en PVP con BNC: regresión visual del flujo de siempre.
    await llenarCotizacion(page, { aliado: "Agencia NETO48", doc: "7654321", cliente: "Bea" });
    await page.locator(`${X("Base no comisionable (BNC) *")}/following-sibling::input[1]`).fill("0");
    await Promise.all([page.waitForURL(/\/dashboard\/cotizaciones\/\d+$/, { timeout: 45000 }), page.getByRole("button", { name: "Generar cotización", exact: true }).click()]);
    const idPvp = Number(new URL(page.url()).pathname.split("/").pop());
    igual("1: la PVP con acuerdo sigue creando plan #97 y ningún sello", scalar(`select (select count(*) from public.comision_plan where cotizacion_id = ${idPvp}) || '/' || (select count(*) from public.cotizacion_neto where cotizacion_id = ${idPvp})`), "1/0");
    await ctx.close();
    globalThis.__idNeto = idCot;
  }

  // ══ 2. Pago y conversión (acciones reales de la ficha) ═══════════════════════════════════════
  {
    const idCot = globalThis.__idNeto;
    const ctx = await nuevoContexto(); const page = await ctx.newPage();
    await iniciarSesion(page, admin);
    await page.goto(`${APP}/dashboard/cotizaciones/${idCot}`, { waitUntil: "networkidle" });
    const texto = await textoPagina(page);
    // Pago completo al NETO (4.520.000; el exigido a mano 2.056.000 queda cubierto) y conversión por los botones reales.
    await page.locator("form label:has-text('Valor a abonar') input").fill("4520000");
    await page.locator("form label:has-text('Forma de pago') input").fill("Transferencia");
    await page.locator("form label:has-text('Referencia') input").fill("REF-NETO48");
    // Antes de pagar, convertir se rechaza con un mensaje accionable (el primer pago congela el NETO).
    await page.getByRole("button", { name: /Generar contrato/ }).click(); await dormir(2500);
    cierto("2: convertir sin pago previo muestra qué hacer (registrar primero el pago) y no crea contrato", /registra primero el pago previo/.test(await textoPagina(page)) && scalar(`select count(*) from public.ventas where cotizacion_id = ${idCot}`) === "0");
    await page.getByRole("button", { name: "Registrar pago previo" }).click();
    await dormir(2500);
    await page.screenshot({ path: join(SALIDA, "debug-pago.png"), fullPage: false });
    { const tp = await textoPagina(page); const i = tp.indexOf("Pagos previos"); info("2: panel tras registrar", tp.slice(i, i + 700).replace(/s+/g, " ")); }
    igual("2: el pago previo congeló el NETO (total congelado 4.520.000, abonado 4.520.000)", scalar(`select precio_total_congelado || '|' || (select sum(monto_cop) from public.cotizacion_pagos_previos where cotizacion_id = ${idCot} and estado = 'activo') from public.cotizaciones where id = ${idCot}`), "4520000.00|4520000.00");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Generar contrato/ }).click();
    await dormir(5000);
    const numero = scalar(`select numero_contrato from public.ventas where cotizacion_id = ${idCot}`);
    cierto("2: la conversión creó el contrato", numero.length > 0, numero);
    igual("2: contrato en forma NETO (precio 4.520.000, comisión descontada 480.000, modo neta, aliado 94801, COP)", scalar(`select precio_venta || '|' || comision_b2b || '|' || comision_estado || '|' || modo_compra || '|' || aliado_id || '|' || moneda from public.ventas where cotizacion_id = ${idCot}`), "4520000.00|480000.00|descontada|neta|94801|COP");
    igual("2: UNA sola fila de comisión, la descontada y pagada (sin segunda comisión)", scalar(`select count(*) || '|' || bool_and(descontada_en_precio) || '|' || bool_and(estado = 'pagada') from public.aliados_b2b where numero_contrato = '${numero}'`), "1|true|true");
    igual("2: ningún plan de comisión #97 para este contrato", scalar(`select count(*) from public.comision_plan where cotizacion_id = ${idCot} or numero_contrato = '${numero}'`), "0");
    igual("2: el pago previo quedó como abono del contrato (4.520.000) y el contrato está confirmado", scalar(`select coalesce((select sum(valor_abono) from public.abonos where numero_contrato = '${numero}'), 0) || '|' || (select estado from public.ventas where numero_contrato = '${numero}')`), "4520000.00|confirmado");
    await page.goto(`${APP}/dashboard/contratos/${numero}`, { waitUntil: "networkidle" });
    await capturas(page, "48-contrato-neto-tras-conversion");
    await ctx.close();
  }

  // ══ 3. Rol venta: sin NETO; gerencia: margen bajo bloquea; administración autoriza ═════════════
  {
    let ctx = await nuevoContexto(); let page = await ctx.newPage();
    await iniciarSesion(page, venta);
    await llenarCotizacion(page, { aliado: "Agencia NETO48" });
    igual("3: venta no ve la opción NETO", await modalidadNeto(page).count(), 0);
    cierto("3: venta conserva la BNC del flujo PVP", (await page.locator(`${X("Base no comisionable (BNC) *")}`).count()) === 1);
    await capturas(page, "48-form-venta");
    await ctx.close();

    ctx = await nuevoContexto(); page = await ctx.newPage();
    await iniciarSesion(page, gerencia);
    await llenarCotizacion(page, { aliado: "Agencia NETO48", aereo: [900000, 10], hotel: [3400000, 15] });
    await modalidadNeto(page).check();
    let t = await page.locator('[data-testid="neto-manual"]').innerText();
    cierto("3: gerencia con margen 4,87 %: se muestra el bloqueo", /no cubre el mínimo del 6 %/.test(t), t.replace(/\s+/g, " ").slice(-200));
    await page.locator('label:has-text("Autorizo guardar") input').check();
    t = await page.locator('[data-testid="neto-manual"]').innerText();
    cierto("3: gerencia no destraba el margen marcando la casilla", /lo autoriza superadmin o administración/.test(t));
    await capturas(page, "48-form-gerencia-bloqueo");
    const antes = scalar("select count(*) from public.cotizaciones");
    await page.getByRole("button", { name: "Generar cotización", exact: true }).click(); await dormir(800);
    igual("3: gerencia no crea ninguna cotización", scalar("select count(*) from public.cotizaciones"), antes);
    await ctx.close();

    ctx = await nuevoContexto(); page = await ctx.newPage();
    await iniciarSesion(page, admin);
    await llenarCotizacion(page, { aliado: "Agencia NETO48", aereo: [900000, 10], hotel: [3400000, 15], cliente: "Carla", doc: "555111" });
    await modalidadNeto(page).check();
    await page.locator('label:has-text("Autorizo guardar") input').check();
    cierto("3: administración con la casilla desbloquea el guardado", (await page.locator('[data-testid="neto-manual"] [role="alert"]').count()) === 0);
    await Promise.all([page.waitForURL(/\/dashboard\/cotizaciones\/\d+$/, { timeout: 45000 }), page.getByRole("button", { name: "Generar cotización", exact: true }).click()]);
    const id = Number(new URL(page.url()).pathname.split("/").pop());
    igual("3: sello con autorización registrada (rol administracion) y margen < 6 %", scalar(`select autorizado_rol || '|' || (margen < 0.06) from public.cotizacion_neto where cotizacion_id = ${id}`), "administracion|true");
    await ctx.close();
  }

  // ══ 4. Comisión 0 %, B2C y la base como autoridad (acción directa contra el servidor) ═════════
  {
    const ctx = await nuevoContexto(); const page = await ctx.newPage();
    await iniciarSesion(page, admin);
    await llenarCotizacion(page, { aliado: "Agencia Cero48", cliente: "Dora", doc: "999222" });
    await modalidadNeto(page).check();
    const t = await page.locator('[data-testid="neto-manual"]').innerText();
    cierto("4: aliado con 0 % → «descuento 0 no hay NETO»", /Con descuento 0 no hay precio NETO/.test(t));
    await ctx.close();
  }

  // ══ 5. #25 Historial de cambios de la ficha en Aliados ══════════════════════════════════════
  {
    const aliadoPortal = await crearUsuario("agencia", R.A); // ficha propia vinculada (la edición del portal usa la RPC guardar_perfil_portal, la misma de la acción)
    sql(`select public.guardar_perfil_portal('${aliadoPortal.id}', '${aliadoPortal.email}', 'ficha', '{"telefono":"3009998888"}'::jsonb, '{"telefono":null}'::jsonb)`);
    const idFicha = scalar(`select aliado_id from public.usuarios where id = '${aliadoPortal.id}'`);
    sql(`update public.aliados set pct_comision = 0.1 where id = ${idFicha}`);
    for (const [etiqueta, usuario, esperaLista] of [["superadmin", superU, true], ["administración", admin, false]]) {
      const ctx = await nuevoContexto(); const page = await ctx.newPage();
      await iniciarSesion(page, usuario);
      await page.goto(`${APP}/dashboard/aliados`, { waitUntil: "networkidle" });
      const nombreFicha = scalar(`select nombre from public.aliados where id = ${idFicha}`);
      const fila = page.locator("tr", { hasText: nombreFicha }).first();
      await fila.locator("button").first().click();
      cierto(`5: ${etiqueta}: abrir la fila no pide el historial`, (await page.locator('ol[aria-label="Historial de cambios"]').count()) === 0);
      await limpiarRegistro();
      await page.getByRole("button", { name: "Ver historial" }).first().click();
      await dormir(1200);
      if (esperaLista) {
        const lista = await page.locator('ol[aria-label="Historial de cambios"]').innerText();
        cierto("5: superadmin ve el cambio del portal (una sola línea, no gemelas) con el teléfono", (lista.match(/Teléfono/g) ?? []).length === 1 && /Desde el portal del aliado/.test(lista), lista.replace(/\s+/g, " "));
        cierto("5: y el cambio interno del % de comisión", /% de comisión: .* → 10 %/.test(lista), lista.replace(/\s+/g, " "));
        await capturas(page, "25-historial-aliado");
        info("5: peticiones al pedir el historial", resumen((await registro()).filter((e) => e.ruta.startsWith("/rest/"))));
        const antesN = (await registro()).length; await dormir(3000);
        igual("5: en reposo no hay más peticiones", (await registro()).length, antesN);
      } else {
        cierto("5: administración recibe el mensaje de rol sin acceso (la auditoría es de superadmin y gerencia)", /Solo superadmin y gerencia/.test(await page.locator('[role="alert"]').first().innerText()));
      }
      await ctx.close();
    }
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
// Un desborde de la barra superior a 820 px que existe también SIN el enlace nuevo es previo a este cambio: se informa, no se oculta.
// Desborde de la barra superior del personal a 820 px: previo si la lista de cotizaciones (que #48 no toca) lo muestra igual.
const previoBarra = layout.some((l) => l.nombre === "48-previo-lista-sin-cambios" && l.vista === "intermedio" && l.fuera.join(",") === "BUTTON:Cerrar sesión");
const esBarra = (l) => previoBarra && l.vista === "intermedio" && l.fuera.join(",") === "BUTTON:Cerrar sesión";
const malos = layout.filter((l) => (l.scroll > l.ancho || l.fuera.length) && !esBarra(l));
const previos = layout.filter((l) => (l.scroll > l.ancho || l.fuera.length) && esBarra(l));
for (const p of previos) console.log("  (previo, no causado por el enlace nuevo) " + p.nombre + " " + p.vista + ": ancho=" + p.ancho + " scroll=" + p.scroll + " fuera=" + p.fuera.join(","));
console.log(`\nLAYOUT: ${layout.length} capturas, ${malos.length} con desborde/elementos fuera de pantalla`);
for (const m of malos) console.log(`  ${m.nombre} ${m.vista}: ancho=${m.ancho} scroll=${m.scroll} fuera=${m.fuera.join(",")}`);
console.log(fallos === 0 && malos.length === 0 ? `\nRESULTADO: ${ctrl.length} controles, 0 FALLO` : `\nRESULTADO: ${fallos} FALLO(S) de ${ctrl.length}; layout con problemas: ${malos.length}`);
process.exit(fallos === 0 && malos.length === 0 ? 0 : 1);
