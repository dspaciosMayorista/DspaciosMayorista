// #62 (V1) — aceptación REAL de la app compilada: navegador (Edge vía @playwright/test) → app `next start` → Server Actions → GoTrue/PostgREST/Postgres reales → Mailpit.
// Nada se simula: las credenciales y sesiones resultantes se comprueban DIRECTO en Auth (password grant, refresh token, GET /user) y el correo se lee de Mailpit.
// El gateway local (gateway.mjs) cuenta las peticiones por acción y permite inyectar un fallo REAL en el cierre de sesión (500 o corte de conexión).
// SOLO=b4 → solo la sección 8 (B4: consumo de la recuperación en estado del servidor). Uso (desde dspacios-travel/, con la pila arriba —pila.sh subir— y `next start -p 3047` corriendo):  node supabase/scripts/real_62/escenarios.mjs <carpeta_config> <carpeta_capturas>
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

try {
  await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" });
  await sinFallos(); await limpiarRegistro();
  const R = { A: "ClaveOriginal1", N: "ClaveNueva22" };
  const staff1 = await crearUsuario("superadmin", R.A);   // cambio de contraseña + revocación fallida + cabecera
  const aliado1 = await crearUsuario("agencia", R.A);     // cabecera del portal B2B + cambio
  const aliado2 = await crearUsuario("agencia", R.A);     // recuperación genuina, repetido, otro navegador
  const aliado3 = await crearUsuario("agencia", R.A);     // enlace vencido
  const staff2 = await crearUsuario("superadmin", R.A);   // sesión ordinaria: denegación en página y en la Server Action; next manipulado
  const aliado4 = await crearUsuario("agencia", R.A);     // recuperación con fallo real del cierre de sesiones

  // ══ 1. Enlaces de cabecera (personal y aliado), contraseña con cambio real ══════════════════════
  if (SOLO !== "b4") {
    const ctx = await nuevoContexto(); const page = await ctx.newPage();
    const sesionB = (await grant(staff1.email, R.A)).json; // «otro dispositivo»
    await iniciarSesion(page, staff1);
    cierto("personal: tras el login real queda en /dashboard", URLP(page).startsWith("/dashboard"), URLP(page));
    const visibles = {};
    for (const [et, w, h] of ANCHOS) { await page.setViewportSize({ width: w, height: h }); await dormir(300); visibles[et] = await page.locator('a[href="/cuenta/contrasena"]:visible').count(); }
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const [et] of ANCHOS) cierto(`personal: el enlace «Contraseña» es visible en cabecera (${et})`, visibles[et] >= 1, `visibles=${visibles[et]}`);
    await capturas(page, "personal-cabecera");
    // ¿El desborde horizontal de la barra a 820 px lo causa el enlace nuevo? Se mide con y sin él.
    await page.setViewportSize({ width: 820, height: 1000 }); await dormir(300);
    const conEnlace = await page.evaluate(() => document.documentElement.scrollWidth);
    const sinEnlace = await page.evaluate(() => { document.querySelectorAll('a[href="/cuenta/contrasena"]').forEach((e) => e.remove()); return document.documentElement.scrollWidth; });
    info("desborde horizontal a 820 px: scrollWidth CON el enlace nuevo / SIN él (ancho de ventana 820)", conEnlace + " / " + sinEnlace);
    igual("el enlace nuevo NO añade desborde a 820 px (con enlace == sin enlace)", conEnlace, sinEnlace);
    layoutPrevio = sinEnlace > 820;
    await page.setViewportSize({ width: 1280, height: 800 }); await page.reload({ waitUntil: "networkidle" });
    await page.locator('a[href="/cuenta/contrasena"]:visible').first().click();
    await page.waitForURL(/\/cuenta\/contrasena/); await page.waitForLoadState("networkidle");
    igual("personal: el enlace lleva a /cuenta/contrasena", URLP(page), "/cuenta/contrasena");
    await capturas(page, "personal-cambiar");

    await llenar(page, { actual: "equivocada1", nueva: R.N, confirmacion: R.N });
    ACCION.cambiar = await esperarAccion(page, () => page.click('button[type="submit"]'));
    await page.waitForSelector('p[role="alert"]');
    cierto("personal: contraseña actual incorrecta → mensaje claro", (await textoPagina(page)).includes("La contraseña actual no es correcta."));
    igual("personal: …y la contraseña NO cambió (la vieja sigue sirviendo)", (await grant(staff1.email, R.A)).ok, true);
    await capturas(page, "personal-cambiar-actual-incorrecta");

    // Éxito real, con conteo de peticiones.
    await llenar(page, { actual: R.A, nueva: R.N, confirmacion: R.N });
    await limpiarRegistro();
    await page.click('button[type="submit"]'); await page.waitForSelector('p[role="status"]'); await dormir(500);
    const log1 = await registro();
    info("PETICIONES por «Cambiar contraseña» (éxito) — gateway", resumen(log1));
    igual("personal: UNA sola actualización de contraseña (PUT /user)", cuenta(log1, "PUT", "/auth/v1/user"), 1);
    igual("personal: UN solo cierre de sesiones, alcance others", log1.filter((e) => e.ruta.startsWith("/auth/v1/logout?scope=others")).length, 1);
    cierto("personal: mensaje de éxito con la salvedad del acceso vigente", /hasta que venza su acceso actual/.test(await textoPagina(page)));
    await capturas(page, "personal-cambiar-exito");
    igual("personal: la contraseña NUEVA funciona", (await grant(staff1.email, R.N)).ok, true);
    igual("personal: la VIEJA ya no funciona", (await grant(staff1.email, R.A)).ok, false);
    igual("personal: la sesión del otro dispositivo ya NO puede renovarse (refresh revocado)", await refrescar(sesionB.refresh_token), false);
    const estadoAcceso = await usuarioConToken(sesionB.access_token);
    info("access token del otro dispositivo tras el cierre (GET /user) — Supabase documenta que sigue válido hasta expirar", `HTTP ${estadoAcceso}`);
    await page.reload({ waitUntil: "networkidle" });
    cierto("personal: la sesión de ESTE navegador sigue viva tras el cambio", !URLP(page).startsWith("/login"), URLP(page));

    // Cierre fallido REAL (500) → resultado PARCIAL, nunca éxito completo
    const sesionC = (await grant(staff1.email, R.N)).json;
    const N2 = "ClaveTercera33";
    await page.goto(`${APP}/cuenta/contrasena`, { waitUntil: "networkidle" });
    await inyectar("/auth/v1/logout", "500", 1);
    await llenar(page, { actual: R.N, nueva: N2, confirmacion: N2 });
    await limpiarRegistro();
    await page.click('button[type="submit"]'); await page.waitForSelector('[data-testid="resultado-parcial"]'); await dormir(300);
    const logP = await registro();
    info("PETICIONES con cierre fallido (500 real) — gateway", resumen(logP));
    igual("parcial: la contraseña se actualizó UNA sola vez", cuenta(logP, "PUT", "/auth/v1/user"), 1);
    const tp = await textoPagina(page);
    cierto("parcial: dice que la contraseña SÍ se actualizó y que reintente el cierre", /SÍ se actualizó/.test(tp) && /Reintentar el cierre/.test(tp));
    cierto("parcial: NO muestra éxito completo", !/se cerraron tus otras sesiones\./.test(tp));
    cierto("parcial: no ofrece repetir el cambio (formulario de contraseña ausente)", (await page.locator('input[name="nueva"]').count()) === 0);
    await capturas(page, "personal-cambiar-parcial");
    igual("parcial: la contraseña NUEVA ya funciona en Auth", (await grant(staff1.email, N2)).ok, true);
    igual("parcial: la vieja ya NO funciona", (await grant(staff1.email, R.N)).ok, false);
    // GoTrue v2.197 ya revoca por sí mismo los refresh tokens de las demás sesiones al cambiar la contraseña (sonda directa): se anota, no se asume.
    info("parcial: ¿la otra sesión puede renovarse tras el cierre FALLIDO? (Auth revoca por su cuenta al cambiar la contraseña en esta versión)", await refrescar(sesionC.refresh_token));
    await limpiarRegistro();
    await page.click('button:has-text("Reintentar el cierre")'); await page.waitForSelector('p[role="status"]:has-text("se cerraron")', { timeout: 15000 });
    const logR = await registro();
    info("PETICIONES del reintento del cierre — gateway", resumen(logR));
    igual("reintento: NO vuelve a actualizar la contraseña (0 PUT /user)", cuenta(logR, "PUT", "/auth/v1/user"), 0);
    igual("reintento: un cierre de sesiones (others)", logR.filter((e) => e.ruta.startsWith("/auth/v1/logout?scope=others")).length, 1);
    const sesionD = (await grant(staff1.email, N2)).json;
    igual("reintento: la sesión del otro dispositivo (anterior al reintento) está revocada", await refrescar(sesionC.refresh_token), false);
    void sesionD;
    await ctx.close();
  }

  // ══ 2. Portal B2B: enlace de cabecera y cambio ═══════════════════════════════════════════════
  if (SOLO !== "b4") {
    const ctx = await nuevoContexto(); const page = await ctx.newPage();
    await iniciarSesion(page, aliado1);
    cierto("aliado B2B: tras el login real queda en el portal", URLP(page).startsWith("/portal/b2b"), URLP(page));
    for (const [et, w, h] of ANCHOS) {
      await page.setViewportSize({ width: w, height: h }); await dormir(300);
      cierto(`aliado B2B: «Contraseña» visible en la cabecera del portal (${et})`, (await page.locator('a[href="/cuenta/contrasena"]:visible').count()) >= 1);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await capturas(page, "aliado-cabecera");
    await page.locator('a[href="/cuenta/contrasena"]:visible').first().click();
    await page.waitForURL(/\/cuenta\/contrasena/); await page.waitForLoadState("networkidle");
    cierto("aliado B2B: «Volver» regresa al portal B2B", (await page.getAttribute('a:has-text("Volver")', "href")) === "/portal/b2b");
    await capturas(page, "aliado-cambiar");
    await llenar(page, { actual: R.A, nueva: R.N, confirmacion: R.N });
    await page.click('button[type="submit"]'); await page.waitForSelector('p[role="status"]');
    igual("aliado B2B: contraseña nueva funciona", (await grant(aliado1.email, R.N)).ok, true);
    igual("aliado B2B: la vieja ya no", (await grant(aliado1.email, R.A)).ok, false);
    await ctx.close();
  }

  // ══ 3. Recuperación GENUINA (aliado2): login → «¿Olvidaste?» → correo → enlace → restablecer ══
  let enlaceUsado = null;
  if (SOLO !== "b4") {
    const sesionPrevia = (await grant(aliado2.email, R.A)).json; // otra sesión abierta de la misma cuenta
    const ctx = await nuevoContexto(); const page = await ctx.newPage();
    await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
    await capturas(page, "login-enlace-olvide");
    await page.click('[data-testid="olvide-contrasena"]'); await page.waitForURL(/\/recuperar/);
    await page.fill("#correo-recuperar", aliado2.email);
    await limpiarRegistro();
    await page.click('button[type="submit"]'); await page.waitForSelector('p[role="status"]');
    const logRec = await registro();
    info("PETICIONES al pedir el enlace — gateway", resumen(logRec));
    igual("recuperar: UNA sola petición a /recover", cuenta(logRec, "POST", "/auth/v1/recover"), 1);
    await capturas(page, "recuperar-enviado");
    const enlace = await enlaceDeCorreo(aliado2.email);
    cierto("recuperar: llega el correo a Mailpit con el enlace /verify de recuperación", !!enlace && /type=recovery/.test(enlace), enlace ?? "sin correo");
    enlaceUsado = enlace;
    // Enlace abierto en el MISMO navegador: callback real → /restablecer
    await page.goto(enlace, { waitUntil: "networkidle" });
    igual("recuperar: el callback real termina en /restablecer", URLP(page), "/restablecer");
    const ses = await sesionDeCookies(ctx);
    const cl = ses ? reclamos(ses.access_token) : null;
    cierto("recuperar: el token de la sesión trae amr «recovery» (la base de la autorización)", !!cl && Array.isArray(cl.amr) && cl.amr.some((a) => a.method === "recovery"), JSON.stringify(cl?.amr));
    await capturas(page, "restablecer");
    // No coincide
    await llenar(page, { nueva: R.N, confirmacion: "otraDistinta9" });
    ACCION.restablecer = await esperarAccion(page, () => page.click('button[type="submit"]'));
    await page.waitForSelector('p[role="alert"]');
    cierto("restablecer: confirmación distinta → error y NO cambia nada", (await textoPagina(page)).includes("no coincide") && (await grant(aliado2.email, R.A)).ok);
    await capturas(page, "restablecer-no-coincide");
    // Válido
    await llenar(page, { nueva: R.N, confirmacion: R.N });
    await limpiarRegistro();
    await page.click('button[type="submit"]'); await page.waitForURL(/\/login\?clave=1/, { timeout: 20000 });
    const logReset = await registro();
    info("PETICIONES del restablecimiento (incluye las del proxy en cada navegación) — gateway", resumen(logReset));
    igual("restablecer: UNA sola actualización de contraseña", cuenta(logReset, "PUT", "/auth/v1/user"), 1);
    igual("restablecer: UN solo cierre global de sesiones", logReset.filter((e) => e.ruta.startsWith("/auth/v1/logout?scope=global")).length, 1);
    cierto("restablecer: /login?clave=1 muestra el aviso de contraseña actualizada", (await textoPagina(page)).includes("Tu contraseña se actualizó"));
    await capturas(page, "login-clave-actualizada");
    igual("restablecer: la contraseña NUEVA funciona en Auth", (await grant(aliado2.email, R.N)).ok, true);
    igual("restablecer: la VIEJA ya no", (await grant(aliado2.email, R.A)).ok, false);
    igual("restablecer: la sesión previa de otro dispositivo ya NO puede renovarse", await refrescar(sesionPrevia.refresh_token), false);
    igual("restablecer: la propia sesión de recuperación ya NO puede renovarse", await refrescar(ses.refresh_token), false);
    info("access token de la sesión de recuperación tras el cierre (GET /user)", `HTTP ${await usuarioConToken(ses.access_token)}`);
    // Con la sesión de recuperación ya consumida, el navegador no conserva sesión útil
    await page.goto(`${APP}/restablecer`, { waitUntil: "networkidle" });
    cierto("restablecer: tras consumirse, /restablecer ya no se muestra (va a login o a pedir enlace)", !URLP(page).startsWith("/restablecer"), URLP(page));
    // REPETIDO: el mismo enlace otra vez en el mismo navegador
    await page.goto(enlaceUsado, { waitUntil: "networkidle" });
    igual("enlace REPETIDO: termina en /recuperar?error=enlace", URLP(page), "/recuperar?error=enlace");
    cierto("enlace REPETIDO: la pantalla avisa que venció o ya se usó", (await textoPagina(page)).includes("El enlace venció o ya se usó"));
    await capturas(page, "recuperar-enlace-repetido");
    await ctx.close();
  }

  // ══ 4. Correo inexistente: respuesta neutra y sin correo ═════════════════════════════════════
  if (SOLO !== "b4") {
    const ctx = await nuevoContexto(); const page = await ctx.newPage();
    await page.goto(`${APP}/recuperar`, { waitUntil: "networkidle" });
    const fantasma = `fantasma.${TAG}@nadie.test`;
    await page.fill("#correo-recuperar", fantasma);
    await page.click('button[type="submit"]'); await page.waitForSelector('p[role="status"]');
    cierto("correo inexistente: mismo mensaje neutro", (await textoPagina(page)).includes("Si el correo está registrado, te enviamos un enlace"));
    await dormir(1200);
    igual("correo inexistente: NO se envía ningún correo", (await mensajes(fantasma)).length, 0);
    await ctx.close();
  }

  // ══ 5. Enlace VENCIDO (aliado3, OTP de 20 s) y abierto en OTRO navegador ═════════════════════
  if (SOLO !== "b4") {
    const ctx = await nuevoContexto(); const page = await ctx.newPage();
    await page.goto(`${APP}/recuperar`, { waitUntil: "networkidle" });
    await page.fill("#correo-recuperar", aliado3.email); await page.click('button[type="submit"]'); await page.waitForSelector('p[role="status"]');
    const enlace = await enlaceDeCorreo(aliado3.email);
    // Otro navegador (sin el verificador PKCE de quien lo pidió)
    const otro = await nuevoContexto(); const pOtro = await otro.newPage();
    await pOtro.goto(enlace, { waitUntil: "networkidle" });
    igual("OTRO navegador: no entra a /restablecer; pide un enlace nuevo", URLP(pOtro), "/recuperar?error=enlace");
    igual("OTRO navegador: no queda ninguna sesión", (await sesionDeCookies(otro)) === null, true);
    await otro.close();
    // Vencimiento: el aliado3 pidió un enlace NUEVO por si el anterior se consumió al abrirlo en otro navegador
    const antes = (await mensajes(aliado3.email)).length;
    await page.goto(`${APP}/recuperar`, { waitUntil: "networkidle" }); // recargar reinicia la espera de 60 s (es un temporizador local de la pantalla)
    await page.fill("#correo-recuperar", aliado3.email);
    await page.click('button[type="submit"]');
    const venc = await enlaceDeCorreo(aliado3.email, antes);
    cierto("enlace VENCIDO: se obtuvo un segundo correo", !!venc);
    await dormir(24_000); // OTP_EXP = 20 s
    await page.goto(venc, { waitUntil: "networkidle" });
    igual("enlace VENCIDO: termina en /recuperar?error=enlace", URLP(page), "/recuperar?error=enlace");
    cierto("enlace VENCIDO: aviso visible y SIN sesión", (await textoPagina(page)).includes("El enlace venció o ya se usó") && (await sesionDeCookies(ctx)) === null);
    igual("enlace VENCIDO: la contraseña no cambió", (await grant(aliado3.email, R.A)).ok, true);
    await ctx.close();
  }

  // ══ 6. Sesión ORDINARIA (staff2): denegada en la página y en la Server Action ═════════════════
  if (SOLO !== "b4") {
    const ctx = await nuevoContexto(); const page = await ctx.newPage();
    await iniciarSesion(page, staff2);
    await page.goto(`${APP}/restablecer`, { waitUntil: "networkidle" });
    igual("sesión ordinaria: /restablecer redirige a «Cambiar contraseña»", URLP(page), "/cuenta/contrasena");
    cierto("el acceso real a la Server Action restablecerContrasena ya fue capturado desde la UI genuina", !!ACCION.restablecer, ACCION.restablecer ?? "sin id");
    for (const nombre of ["restablecer"]) {
      const r = await ctx.request.post(`${APP}/restablecer`, { headers: { "next-action": ACCION[nombre], "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }, data: JSON.stringify(["ClaveAtaque99", "ClaveAtaque99"]) });
      const cuerpo = await r.text();
      cierto("Server Action con SESIÓN ORDINARIA: NO restablece (usarCambio) — llamada directa a la acción", /"ok":false/.test(cuerpo) && /"usarCambio":true/.test(cuerpo), cuerpo.replace(/\s+/g, " ").slice(0, 160));
    }
    igual("…y la contraseña NO cambió (la actual sigue funcionando)", (await grant(staff2.email, R.A)).ok, true);
    igual("…y la que intentó fijar el atacante NO funciona", (await grant(staff2.email, "ClaveAtaque99")).ok, false);
    await capturas(page, "ordinaria-redirigida-a-cambiar");

    // next=/restablecer manipulado con una sesión generada por enlace mágico (amr «otp», no recuperación)
    const almacen = new Map();
    const GoTrueClient = createClient("http://127.0.0.1:1", "x").auth.constructor;
    const nodoAuth = new GoTrueClient({ url: `${GW}/auth/v1`, headers: { apikey: CFG.anonKey, Authorization: `Bearer ${CFG.anonKey}` }, storageKey: `sb-mag-${TAG}`, flowType: "pkce", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      storage: { getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => almacen.set(k, v), removeItem: (k) => almacen.delete(k) } });
    const pedido = await nodoAuth.signInWithOtp({ email: staff2.email, options: { shouldCreateUser: false, emailRedirectTo: `${APP}/auth/callback?next=/restablecer` } });
    igual("enlace mágico solicitado (sesión que NO es de recuperación)", pedido.error === null, true);
    const magico = await enlaceDeCorreo(staff2.email, (await mensajes(staff2.email)).length - 1);
    const verificador = [...almacen.entries()].find(([k]) => k.endsWith("-code-verifier"))?.[1];
    cierto("enlace mágico: hay correo y verificador PKCE", !!magico && !!verificador);
    const ctx2 = await nuevoContexto();
    await ctx2.addCookies([{ name: `${COOKIE}-code-verifier`, value: verificador, url: APP }]);
    const p2 = await ctx2.newPage();
    await p2.goto(magico, { waitUntil: "networkidle" });
    const ses2 = await sesionDeCookies(ctx2);
    const cl2 = ses2 ? reclamos(ses2.access_token) : null;
    cierto("next=/restablecer manipulado: se obtuvo una sesión ordinaria (amr sin «recovery»)", !!cl2 && !cl2.amr.some((a) => a.method === "recovery"), JSON.stringify(cl2?.amr));
    cierto("next=/restablecer manipulado: el callback NO manda a /restablecer", !URLP(p2).startsWith("/restablecer"), URLP(p2));
    await p2.goto(`${APP}/restablecer`, { waitUntil: "networkidle" });
    igual("…y /restablecer con esa sesión redirige a «Cambiar contraseña»", URLP(p2), "/cuenta/contrasena");
    const r2 = await ctx2.request.post(`${APP}/restablecer`, { headers: { "next-action": ACCION.restablecer, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }, data: JSON.stringify(["ClaveAtaque88", "ClaveAtaque88"]) });
    cierto("…y la Server Action con esa sesión NO restablece", /"usarCambio":true/.test(await r2.text()));
    igual("…y la contraseña sigue siendo la actual", (await grant(staff2.email, R.A)).ok, true);
    await ctx2.close(); await ctx.close();
  }

  // ══ 7. Recuperación con fallo REAL del cierre global (aliado4): parcial → reintento ═══════════
  if (SOLO !== "b4") {
    const ctx = await nuevoContexto(); const page = await ctx.newPage();
    const sesionX = (await grant(aliado4.email, R.A)).json;
    await page.goto(`${APP}/recuperar`, { waitUntil: "networkidle" });
    await page.fill("#correo-recuperar", aliado4.email); await page.click('button[type="submit"]'); await page.waitForSelector('p[role="status"]');
    await page.goto(await enlaceDeCorreo(aliado4.email), { waitUntil: "networkidle" });
    igual("fallo de cierre: el enlace llega a /restablecer", URLP(page), "/restablecer");
    await inyectar("/auth/v1/logout", "corte", 1);
    await llenar(page, { nueva: R.N, confirmacion: R.N });
    await limpiarRegistro();
    await page.click('button[type="submit"]'); await page.waitForSelector('[data-testid="resultado-parcial"]', { timeout: 30000 }); await dormir(300);
    const logC = await registro();
    info("PETICIONES con corte de conexión en el cierre — gateway", resumen(logC));
    igual("corte: la contraseña se actualizó UNA sola vez", cuenta(logC, "PUT", "/auth/v1/user"), 1);
    cierto("corte: resultado PARCIAL explícito (no redirige como éxito)", URLP(page) === "/restablecer" && /SÍ se actualizó/.test(await textoPagina(page)), URLP(page));
    await capturas(page, "restablecer-parcial");
    // Recargar la página en el estado parcial (recuperación ya consumida, sesión viva): sigue el panel parcial; no manda a pedir enlace ni muestra el formulario.
    await page.reload({ waitUntil: "networkidle" });
    cierto("parcial + RECARGA: se mantiene el panel parcial (sin formulario y sin ir a /recuperar)", URLP(page) === "/restablecer" && (await page.locator('[data-testid="resultado-parcial"]').count()) === 1 && (await page.locator('input[name="nueva"]').count()) === 0, URLP(page));
    igual("corte: la contraseña NUEVA ya funciona", (await grant(aliado4.email, R.N)).ok, true);
    // La sesión de recuperación SIGUE viva (el cierre falló) y ya cambió la contraseña: repetir la acción con ella debe negarse por CONSUMIDA, no cambiar de nuevo.
    const repetida = await ctx.request.post(`${APP}/restablecer`, { headers: { "next-action": ACCION.restablecer, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }, data: JSON.stringify(["ClaveRepetida77", "ClaveRepetida77"]) });
    const cuerpoRep = await repetida.text();
    cierto("RECUPERACIÓN CONSUMIDA: repetir la Server Action con la sesión de recuperación aún viva se niega (enlaceVencido)", /"ok":false/.test(cuerpoRep) && /"enlaceVencido":true/.test(cuerpoRep), cuerpoRep.replace(/\s+/g, " ").slice(0, 170));
    igual("RECUPERACIÓN CONSUMIDA: la contraseña no volvió a cambiar (la nueva sigue sirviendo)", (await grant(aliado4.email, R.N)).ok, true);
    igual("RECUPERACIÓN CONSUMIDA: la fijada por la repetición NO funciona", (await grant(aliado4.email, "ClaveRepetida77")).ok, false);
    info("corte: ¿la sesión de otro dispositivo puede renovarse tras el cierre FALLIDO? (Auth revoca por su cuenta al cambiar la contraseña en esta versión)", await refrescar(sesionX.refresh_token));
    await limpiarRegistro();
    await page.click('button:has-text("Reintentar el cierre")'); await page.waitForURL(/\/login\?clave=1/, { timeout: 20000 });
    const logR2 = await registro();
    igual("reintento: 0 actualizaciones de contraseña", cuenta(logR2, "PUT", "/auth/v1/user"), 0);
    igual("reintento: la sesión del otro dispositivo está revocada", await refrescar(sesionX.refresh_token), false);
    await ctx.close();
  }

  // ══ 8. B4 · consumo de la recuperación en estado del SERVIDOR: metadatos manipulados, concurrencia, resultado incierto, rechazo 4xx, recuperación nueva ═════
  {
    const filas = (id) => sql(`select count(*) from public.recuperaciones_consumidas where user_id = '${id}'`);
    const estados = (id) => sql(`select coalesce(string_agg(estado, ',' order by reclamada_en), '') from public.recuperaciones_consumidas where user_id = '${id}'`);
    const llegarARestablecer = async (page, u) => {
      const antes = (await mensajes(u.email)).length;
      await page.goto(`${APP}/recuperar`, { waitUntil: "networkidle" });
      await page.fill("#correo-recuperar", u.email); await page.click('button[type="submit"]'); await page.waitForSelector('p[role="status"]');
      await page.goto(await enlaceDeCorreo(u.email, antes), { waitUntil: "networkidle" });
    };
    const postAccion = (ctx, nueva) => ctx.request.post(`${APP}/restablecer`, { headers: { "next-action": ACCION.restablecer, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }, data: JSON.stringify([nueva, nueva]) }).then((r) => r.text());
    const N2 = "ClaveNueva33", N3 = "ClaveNueva44";

    // 8a · el usuario edita o borra su user_metadata con la sesión de recuperación viva: NO reactiva una recuperación consumida
    {
      const u = await crearUsuario("agencia", R.A);
      const ctx = await nuevoContexto(); const page = await ctx.newPage();
      await llegarARestablecer(page, u);
      igual("B4a: el enlace llega a /restablecer", URLP(page), "/restablecer");
      await inyectar("/auth/v1/logout", "corte", 1);
      await llenar(page, { nueva: R.N, confirmacion: R.N });
      ACCION.restablecer = await esperarAccion(page, () => page.click('button[type="submit"]'));
      await page.waitForSelector('[data-testid="resultado-parcial"]', { timeout: 30000 });
      igual("B4a: el reclamo del servidor quedó en «aplicada» (una fila)", await estados(u.id), "aplicada");
      const meta0 = (await (await authFetch(`/admin/users/${u.id}`, { service: true })).json()).user_metadata ?? {};
      cierto("B4a: la app ya NO escribe ninguna marca de consumo en user_metadata", !("recuperacion_consumida" in meta0), JSON.stringify(meta0));
      const tok = (await sesionDeCookies(ctx))?.access_token;
      cierto("B4a: la sesión de recuperación sigue viva (el cierre falló) y su token trae amr recovery", !!tok && reclamos(tok).amr?.some((a) => a.method === "recovery"), tok ? "token presente" : "sin sesión");
      for (const data of [{ recuperacion_consumida: null }, { recuperacion_consumida: 0 }, { recuperacion_consumida: "x", otra: 1 }]) {
        const r = await authFetch("/user", { metodo: "PUT", token: tok, cuerpo: { data } });
        info(`B4a: el usuario edita su user_metadata directo en Auth ${JSON.stringify(data)} → HTTP`, r.status);
      }
      await limpiarRegistro();
      const cuerpo = await postAccion(ctx, "ClaveRepetida66");
      const logB = await registro();
      cierto("B4a: con los metadatos borrados/falsificados, repetir la Server Action sigue DENEGADO (enlaceVencido)", /"ok":false/.test(cuerpo) && /"enlaceVencido":true/.test(cuerpo), cuerpo.replace(/\s+/g, " ").slice(0, 150));
      igual("B4a: ninguna escritura de contraseña en Auth durante el replay (PUT /user)", cuenta(logB, "PUT", "/auth/v1/user"), 0);
      igual("B4a: la contraseña nueva sigue sirviendo", (await grant(u.email, R.N)).ok, true);
      igual("B4a: la fijada por el replay NO sirve", (await grant(u.email, "ClaveRepetida66")).ok, false);
      await page.reload({ waitUntil: "networkidle" });
      cierto("B4a: recargar sigue mostrando el estado parcial (no el formulario)", (await page.locator('[data-testid="resultado-parcial"]').count()) === 1 && (await page.locator('input[name="nueva"]').count()) === 0, URLP(page));
      await ctx.close();
    }

    // 8b · solicitudes concurrentes con contraseñas distintas desde la MISMA recuperación: una sola escritura
    {
      const u = await crearUsuario("agencia", R.A);
      const ctx = await nuevoContexto(); const page = await ctx.newPage();
      await llegarARestablecer(page, u);
      igual("B4b: el enlace llega a /restablecer", URLP(page), "/restablecer");
      const claves = Array.from({ length: 6 }, (_, i) => `Concurrente${i}Clave`);
      await limpiarRegistro();
      const cuerpos = await Promise.all(claves.map((c) => postAccion(ctx, c)));
      const logC = await registro();
      info("B4b: PETICIONES a Auth durante las 6 solicitudes simultáneas — gateway", resumen(logC));
      igual("B4b: exactamente UNA escritura de contraseña en Auth (PUT /user)", cuenta(logC, "PUT", "/auth/v1/user"), 1);
      const ganadoras = cuerpos.filter((t) => /"ok":true|"ok":"parcial"/.test(t)).length;
      const negadas = cuerpos.filter((t) => /"ok":false/.test(t) && /"enlaceVencido":true/.test(t)).length;
      igual("B4b: una solicitud tuvo éxito", ganadoras, 1);
      igual("B4b: las otras 5 se negaron como enlace usado", negadas, 5);
      const sirven = [];
      for (const c of claves) if ((await grant(u.email, c)).ok) sirven.push(c);
      igual("B4b: exactamente UNA de las 6 contraseñas funciona", sirven.length, 1);
      igual("B4b: una sola fila de reclamo para el usuario", await filas(u.id), "1");
      await ctx.close();
    }

    // 8c · resultado INCIERTO: Auth aplica el cambio pero la respuesta se pierde → la app no lo da por hecho ni permite repetirlo; un enlace NUEVO funciona
    {
      const u = await crearUsuario("agencia", R.A);
      const ctx = await nuevoContexto(); const page = await ctx.newPage();
      await llegarARestablecer(page, u);
      await inyectar("/auth/v1/user", "perdida", 1, "PUT");
      await llenar(page, { nueva: R.N, confirmacion: R.N });
      await limpiarRegistro();
      await page.click('button[type="submit"]'); await page.waitForSelector('[data-testid="resultado-incierto"]', { timeout: 30000 });
      const logI = await registro();
      info("B4c: PETICIONES con la respuesta del cambio PERDIDA — gateway", resumen(logI));
      cierto("B4c: la app muestra el estado INCIERTO (sin formulario, sin éxito, sin «parcial»)", (await page.locator('input[name="nueva"]').count()) === 0 && (await page.locator('[data-testid="resultado-parcial"]').count()) === 0 && /No pudimos confirmar si tu contraseña cambió/.test(await textoPagina(page)), URLP(page));
      igual("B4c: el reclamo queda «reclamada» (no «aplicada»)", await estados(u.id), "reclamada");
      igual("B4c: Auth SÍ aplicó la contraseña aunque la app no pudo confirmarlo (por eso no se permite repetir)", (await grant(u.email, R.N)).ok, true);
      igual("B4c: no hubo cierre de sesiones (no se revoca a ciegas)", cuenta(logI, "POST", "/auth/v1/logout"), 0);
      await capturas(page, "restablecer-incierto");
      await limpiarRegistro();
      const rep = await postAccion(ctx, "ClaveRepetida66");
      const logRep = await registro();
      cierto("B4c: repetir la Server Action con esa recuperación se NIEGA", /"ok":false/.test(rep) && /"enlaceVencido":true/.test(rep), rep.replace(/\s+/g, " ").slice(0, 150));
      igual("B4c: ninguna escritura de contraseña en el replay", cuenta(logRep, "PUT", "/auth/v1/user"), 0);
      await page.reload({ waitUntil: "networkidle" });
      cierto("B4c: recargar mantiene el estado incierto (no el formulario)", (await page.locator('[data-testid="resultado-incierto"]').count()) === 1 && (await page.locator('input[name="nueva"]').count()) === 0, URLP(page));
      // camino seguro: un enlace NUEVO (otro evento) funciona después de una recuperación anterior completada/incierta
      await llegarARestablecer(page, u);
      igual("B4c: el enlace NUEVO llega a /restablecer con formulario", URLP(page) + "|" + (await page.locator('input[name="nueva"]').count()), "/restablecer|1");
      await llenar(page, { nueva: N2, confirmacion: N2 });
      await Promise.all([page.waitForURL(/\/login\?clave=1/, { timeout: 30000 }), page.click('button[type="submit"]')]);
      igual("B4c: tras el enlace nuevo, la contraseña nueva funciona", (await grant(u.email, N2)).ok, true);
      igual("B4c: dos eventos reclamados para el usuario (incierto + nuevo aplicado)", await estados(u.id), "reclamada,aplicada");
      await ctx.close();
    }

    // 8d · rechazo DEFINITIVO de Auth (misma contraseña, 4xx): se libera el reclamo y la misma recuperación sirve para corregir
    {
      const u = await crearUsuario("agencia", R.A);
      const ctx = await nuevoContexto(); const page = await ctx.newPage();
      await llegarARestablecer(page, u);
      await llenar(page, { nueva: R.A, confirmacion: R.A });
      await page.click('button[type="submit"]'); await page.waitForSelector('p[role="alert"]', { timeout: 30000 });
      cierto("B4d: Auth rechaza la misma contraseña y la app lo explica; sigue el formulario", /distinta/.test(await textoPagina(page)) && (await page.locator('input[name="nueva"]').count()) === 1, URLP(page));
      igual("B4d: el reclamo se liberó (0 filas)", await filas(u.id), "0");
      await llenar(page, { nueva: N3, confirmacion: N3 });
      await Promise.all([page.waitForURL(/\/login\?clave=1/, { timeout: 30000 }), page.click('button[type="submit"]')]);
      igual("B4d: la MISMA recuperación sirvió para el reintento corregido: contraseña nueva funciona", (await grant(u.email, N3)).ok, true);
      igual("B4d: una fila «aplicada»", await estados(u.id), "aplicada");
      await ctx.close();
    }

    // 8e · cambio con la contraseña actual sigue funcionando y no toca la tabla de recuperaciones
    {
      const u = await crearUsuario("agencia", R.A);
      const ctx = await nuevoContexto(); const page = await ctx.newPage();
      await iniciarSesion(page, u);
      await page.goto(`${APP}/cuenta/contrasena`, { waitUntil: "networkidle" });
      await llenar(page, { actual: R.A, nueva: N2, confirmacion: N2 });
      await page.click('button[type="submit"]'); await page.waitForSelector('p[role="status"], [data-testid="resultado-parcial"]', { timeout: 30000 });
      igual("B4e: cambiar con la contraseña actual: la nueva funciona", (await grant(u.email, N2)).ok, true);
      igual("B4e: no se reclamó ninguna recuperación", await filas(u.id), "0");
      await ctx.close();
    }
  }

} catch (e) {
  registrar("EXCEPCIÓN no controlada durante el recorrido", String(e?.message ?? e).split("\n")[0], "sin excepción", false);
} finally {
  await sinFallos().catch(() => undefined);
  await browser.close();
}

writeFileSync(join(SALIDA, "controles.json"), JSON.stringify({ ctrl, layout }, null, 2));
console.log("\ncontrol | observado | esperado | estado");
let fallos = 0;
for (const c of ctrl) { console.log(`${c.nombre} | ${c.observado} | ${c.esperado} | ${c.estado}`); if (c.estado === "FALLO") fallos++; }
// Un desborde de la barra superior a 820 px que existe también SIN el enlace nuevo es previo a este cambio: se informa, no se oculta.
const malos = layout.filter((l) => (l.scroll > l.ancho || l.fuera.length) && !(layoutPrevio && l.nombre === "personal-cabecera" && l.vista === "intermedio"));
const previos = layout.filter((l) => (l.scroll > l.ancho || l.fuera.length) && layoutPrevio && l.nombre === "personal-cabecera" && l.vista === "intermedio");
for (const p of previos) console.log("  (previo, no causado por el enlace nuevo) " + p.nombre + " " + p.vista + ": ancho=" + p.ancho + " scroll=" + p.scroll + " fuera=" + p.fuera.join(","));
console.log(`\nLAYOUT: ${layout.length} capturas, ${malos.length} con desborde/elementos fuera de pantalla`);
for (const m of malos) console.log(`  ${m.nombre} ${m.vista}: ancho=${m.ancho} scroll=${m.scroll} fuera=${m.fuera.join(",")}`);
console.log(fallos === 0 && malos.length === 0 ? `\nRESULTADO: ${ctrl.length} controles, 0 FALLO` : `\nRESULTADO: ${fallos} FALLO(S) de ${ctrl.length}; layout con problemas: ${malos.length}`);
process.exit(fallos === 0 && malos.length === 0 ? 0 : 1);
