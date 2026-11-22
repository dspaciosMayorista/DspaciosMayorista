// #62 — evidencia del PROVEEDOR: recuperación y cambio de contraseña contra GoTrue (Supabase Auth) local + captura de correo local (Mailpit), llamando a Auth directo.
// NO prueba la app (callback, Server Actions, páginas): eso lo hace supabase/scripts/real_62/escenarios.mjs sobre la app compilada.
// Lo lanza test_62_recuperacion_gotrue.sh (contenedores propios y desechables, sin red externa). Usa las MISMAS llamadas de supabase-js que
// `app/(auth)/contrasena-actions.ts` y `RecuperarClient.tsx`; los pasos del navegador (seguir el enlace del correo) se hacen con fetch manual.
// Variables: B2B62_AUTH (http://127.0.0.1:PUERTO de GoTrue), B2B62_MAIL (API de Mailpit), B2B62_SECRET (JWT de GoTrue).
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";

const AUTH = process.env.B2B62_AUTH, MAIL = process.env.B2B62_MAIL, SECRET = process.env.B2B62_SECRET;
if (!AUTH || !MAIL || !SECRET) throw new Error("Faltan B2B62_AUTH, B2B62_MAIL y B2B62_SECRET: usa test_62_recuperacion_gotrue.sh");
const SITE = "http://localhost:3000";
const REDIRECT = `${SITE}/auth/callback?next=/restablecer`;
const ANON = jwt({ role: "anon", iss: "local", exp: 4102444800 });
const SERVICE = jwt({ role: "service_role", iss: "local", exp: 4102444800 });

function jwt(payload) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" }), p = b(payload);
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
// supabase-js antepone /auth/v1 (lo que en producción resuelve el gateway); aquí se habla DIRECTO con GoTrue, así que se usa la misma clase de cliente de Auth
// que supabase-js contiene (GoTrueClient) apuntando a GoTrue sin ese prefijo. Las llamadas (resetPasswordForEmail, exchangeCodeForSession, updateUser…) son las mismas.
const GoTrueClient = createClient("http://127.0.0.1:1", "x").auth.constructor;
let contador = 0;
function auth(opciones) {
  return { auth: new GoTrueClient({ url: AUTH, headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }, storageKey: `sb-b2b62-${++contador}`, autoRefreshToken: false, detectSessionInUrl: false, ...opciones }) };
}
// Cada navegador() es «un navegador» distinto: su propio almacenamiento en memoria (ahí vive el verificador PKCE).
function navegador() {
  const m = new Map();
  return auth({ flowType: "pkce", persistSession: true, storage: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } });
}
const sinSesion = () => auth({ persistSession: false });

const resultados = [];
function paso(nombre, observado, esperado, ok) { resultados.push({ nombre, observado: String(observado), esperado: String(esperado), estado: ok ? "OK" : "FALLO" }); }
function igual(nombre, observado, esperado) { paso(nombre, observado, esperado, observado === esperado); }
function cumple(nombre, condicion, observado = condicion) { paso(nombre, observado, "true", condicion === true); }

async function admin(ruta, metodo, cuerpo) {
  const r = await fetch(`${AUTH}${ruta}`, { method: metodo, headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}`, apikey: SERVICE }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function correos(para) {
  for (let i = 0; i < 20; i++) {
    const lista = await (await fetch(`${MAIL}/api/v1/messages`)).json();
    const mios = (lista.messages ?? []).filter((m) => (m.To ?? []).some((t) => t.Address === para));
    if (mios.length) return mios;
    await dormir(300);
  }
  return [];
}
async function enlaceDelUltimoCorreo(para) {
  const lista = await correos(para);
  if (!lista.length) return null;
  const ultimo = lista.sort((a, b) => new Date(b.Created) - new Date(a.Created))[0];
  const cuerpo = await (await fetch(`${MAIL}/api/v1/message/${ultimo.ID}`)).json();
  const m = (cuerpo.HTML + " " + cuerpo.Text).match(/href="([^"]+\/verify\?[^"]+)"/) ?? (cuerpo.Text ?? "").match(/(https?:\/\/\S+\/verify\?\S+)/);
  if (!m) console.log("DIAGNÓSTICO: correo sin enlace /verify →", JSON.stringify({ asunto: cuerpo.Subject, texto: (cuerpo.Text ?? "").slice(0, 400), html: (cuerpo.HTML ?? "").slice(0, 600) }));
  return m ? m[1].replaceAll("&amp;", "&") : null;
}
// Seguir el enlace del correo SIN seguir redirecciones: lo que haría el navegador hasta llegar a /auth/callback.
async function abrirEnlace(url) {
  const r = await fetch(url, { redirect: "manual" });
  const destino = r.headers.get("location") ?? "";
  const u = new URL(destino, SITE);
  const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
  return { status: r.status, destino, code: u.searchParams.get("code"), error: u.searchParams.get("error") ?? hash.get("error"), errorCode: u.searchParams.get("error_code") ?? hash.get("error_code") };
}

const CORREO = `ana.${Date.now()}@agencia.test`, CLAVE_VIEJA = "ClaveVieja1", CLAVE_NUEVA = "ClaveNueva2";
const FANTASMA = `fantasma.${Date.now()}@nadie.test`;

// ── Preparación: una cuenta existente y confirmada ─────────────────────────────────────────────
const crear = await admin("/admin/users", "POST", { email: CORREO, password: CLAVE_VIEJA, email_confirm: true });
igual("alta de la cuenta de prueba (admin)", crear.status, 200);
const idUsuario = crear.json?.id;

// ── 1. Solicitud de recuperación: correo existente vs inexistente ─────────────────────────────
const nav = navegador();
const pedirExistente = await nav.auth.resetPasswordForEmail(CORREO, { redirectTo: REDIRECT });
const pedirFantasma = await navegador().auth.resetPasswordForEmail(FANTASMA, { redirectTo: REDIRECT });
igual("solicitud con correo REGISTRADO: sin error", pedirExistente.error === null, true);
igual("solicitud con correo INEXISTENTE: sin error (misma respuesta, no se revela la cuenta)", pedirFantasma.error === null, true);
const correoReal = await correos(CORREO);
igual("llega UN correo a la cuenta registrada (capturado en Mailpit local)", correoReal.length, 1);
await dormir(1500);
igual("NO llega ningún correo al correo inexistente", (await correos(FANTASMA)).length, 0);

// ── 2. El enlace del correo: PKCE → /auth/callback?next=/restablecer&code=... ────────────────
const enlace = await enlaceDelUltimoCorreo(CORREO);
cumple("el correo trae un enlace /verify de recuperación", !!enlace && /type=recovery/.test(enlace), enlace ?? "sin enlace");
if (!enlace) { console.log("RESULTADO: FALLO (sin enlace)"); process.exit(1); }
const abierto = await abrirEnlace(enlace);
const dest = new URL(abierto.destino);
cumple("abrir el enlace redirige a /auth/callback del MISMO origen, con next=/restablecer (ya decodificado) y un code PKCE", dest.origin === SITE && dest.pathname === "/auth/callback" && dest.searchParams.get("next") === "/restablecer" && !!abierto.code, abierto.destino.slice(0, 110));

// ── 3. Mismo navegador: intercambio del code → sesión de recuperación → nueva contraseña ─────
const sesion = await nav.auth.exchangeCodeForSession(abierto.code);
igual("el MISMO navegador intercambia el code por una sesión", !!sesion.data?.session && sesion.error === null, true);
igual("la sesión de recuperación es del usuario correcto", sesion.data?.user?.id, idUsuario);
const mismaClave = await nav.auth.updateUser({ password: CLAVE_VIEJA });
igual("fijar la MISMA clave actual es rechazado (same_password)", mismaClave.error?.code, "same_password");
const cambio = await nav.auth.updateUser({ password: CLAVE_NUEVA });
igual("updateUser con la clave nueva: sin error", cambio.error === null, true);
const cerrar = await nav.auth.signOut({ scope: "global" });
igual("signOut global: sin error", cerrar.error === null, true);
igual("la clave VIEJA ya no sirve", (await sinSesion().auth.signInWithPassword({ email: CORREO, password: CLAVE_VIEJA })).error?.code, "invalid_credentials");
igual("la clave NUEVA sí sirve", (await sinSesion().auth.signInWithPassword({ email: CORREO, password: CLAVE_NUEVA })).error === null, true);

// ── 4. El enlace NO se reutiliza ──────────────────────────────────────────────────────────────
const reuso = await abrirEnlace(enlace);
cumple("reabrir el MISMO enlace: sin code y con error de enlace vencido/usado", !reuso.code && (reuso.error != null || /error/.test(reuso.destino)), reuso.destino.slice(0, 120));

// ── 5. Otro dispositivo/navegador: el code no se puede canjear sin el verificador PKCE ───────
const nav2 = navegador();
await nav2.auth.resetPasswordForEmail(CORREO, { redirectTo: REDIRECT });
await dormir(800);
const enlace2 = await enlaceDelUltimoCorreo(CORREO);
const abierto2 = await abrirEnlace(enlace2);
const otroNavegador = await navegador().auth.exchangeCodeForSession(abierto2.code ?? "x");
igual("un navegador DISTINTO al que pidió el enlace no obtiene sesión (el callback mandará a /recuperar?error=enlace)", !!otroNavegador.data?.session, false);
const propio = await nav2.auth.exchangeCodeForSession(abierto2.code);
igual("el navegador que lo pidió sí (el code sigue vigente)", !!propio.data?.session, true);
await nav2.auth.signOut({ scope: "global" });

// ── 6. Cambiar contraseña desde una sesión: verifica la actual, no rota la sesión, cierra las otras ─
const A = navegador(), B = navegador();
await A.auth.signInWithPassword({ email: CORREO, password: CLAVE_NUEVA });
await B.auth.signInWithPassword({ email: CORREO, password: CLAVE_NUEVA });
const tokenA = (await A.auth.getSession()).data.session.refresh_token;
const tokenB = (await B.auth.getSession()).data.session.refresh_token;
igual("la verificación de la clave actual con un cliente SIN sesión: la equivocada falla", (await sinSesion().auth.signInWithPassword({ email: CORREO, password: "equivocada" })).error?.code, "invalid_credentials");
igual("…y la correcta pasa sin tocar las sesiones A y B", (await sinSesion().auth.signInWithPassword({ email: CORREO, password: CLAVE_NUEVA })).error === null, true);
const CLAVE_3 = "ClaveTres3";
igual("A actualiza la contraseña", (await A.auth.updateUser({ password: CLAVE_3 })).error === null, true);
igual("A cierra las OTRAS sesiones", (await A.auth.signOut({ scope: "others" })).error === null, true);
const refrescoB = await sinSesion().auth.refreshSession({ refresh_token: tokenB });
igual("la sesión B (otro dispositivo) ya NO puede refrescarse", !!refrescoB.data?.session, false);
const refrescoA = await sinSesion().auth.refreshSession({ refresh_token: tokenA });
igual("la sesión A (la que cambió la clave) sigue viva", !!refrescoA.data?.session, true);
igual("la clave anterior (nueva #1) ya no sirve; la #3 sí", [
  (await sinSesion().auth.signInWithPassword({ email: CORREO, password: CLAVE_NUEVA })).error?.code,
  (await sinSesion().auth.signInWithPassword({ email: CORREO, password: CLAVE_3 })).error === null,
].join("|"), "invalid_credentials|true");

// ── 7. Limpieza de la cuenta de prueba (la base es desechable de todos modos) ─────────────────
await admin(`/admin/users/${idUsuario}`, "DELETE");

console.log("\ncontrol | observado | esperado | estado");
let fallos = 0;
for (const r of resultados) { console.log(`${r.nombre} | ${r.observado} | ${r.esperado} | ${r.estado}`); if (r.estado !== "OK") fallos++; }
console.log(fallos === 0 ? `\nRESULTADO: ${resultados.length} controles OK` : `\nRESULTADO: ${fallos} FALLO(S) de ${resultados.length}`);
process.exit(fallos === 0 ? 0 : 1);
