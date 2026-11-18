// Utilidades comunes de los recorridos en NAVEGADOR REAL (Edge vía Playwright) de la revisión consolidada. Inician sesión de verdad en el GoTrue local,
// arman la cookie como @supabase/ssr y registran qué solicitudes de red dispara cada acción. Solo local.
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

export const CFG = JSON.parse(readFileSync(`${process.env.LOCALAPPDATA}/dspacios-local-revision/config.json`, "utf8"));
export const SUPA = "http://127.0.0.1:54370";
export const APP = process.env.REV_APP ?? "http://127.0.0.1:3070";
export const CLAVE = "Revision2026!";
const REF = new URL(SUPA).hostname.split(".")[0];
export const dinero = (n) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);

export function crearInforme(nombre) {
  const estado = { fallos: 0, ok: 0 };
  const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (c) estado.ok++; else estado.fallos++; };
  const cerrar = () => { console.log(`=== ${nombre}: ${estado.ok} OK, ${estado.fallos} fallo(s)`); return estado.fallos ? 1 : 0; };
  return { ok, cerrar, estado };
}
export async function cookieSesion(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: CFG.anonKey, "content-type": "application/json" }, body: JSON.stringify({ email, password: CLAVE }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${email}: ${JSON.stringify(j)}`);
  const valor = "base64-" + Buffer.from(JSON.stringify(j)).toString("base64url");
  const trozos = valor.match(/.{1,3180}/g);
  return trozos.map((t, i) => ({ name: trozos.length === 1 ? `sb-${REF}-auth-token` : `sb-${REF}-auth-token.${i}`, value: t, domain: "127.0.0.1", path: "/" }));
}
export const VISTAS = { escritorio: { width: 1366, height: 900 }, movil: { width: 390, height: 844 } };
export async function lanzar() { return chromium.launch({ channel: "msedge", headless: true }); }
/** Contexto (opcionalmente con sesión) + página + contador de solicitudes POST de Server Actions y de peticiones a /rest/v1. */
export async function abrir(browser, { email = null, vista = "escritorio" } = {}) {
  const ctx = await browser.newContext({ viewport: VISTAS[vista], isMobile: vista === "movil", hasTouch: vista === "movil", locale: "es-CO", acceptDownloads: true });
  if (email) await ctx.addCookies(await cookieSesion(email));
  const page = await ctx.newPage();
  const cuenta = { acciones: 0, rest: 0, urls: [] };
  page.on("request", (rq) => {
    if (rq.method() === "POST" && rq.url().startsWith(APP) && rq.headers()["next-action"]) { cuenta.acciones++; cuenta.urls.push(rq.url().replace(APP, "")); }
    if (rq.url().startsWith(`${SUPA}/rest/v1`)) cuenta.rest++;
  });
  page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e).slice(0, 160)}`));
  return { ctx, page, cuenta };
}
export const reiniciar = (c) => { c.acciones = 0; c.rest = 0; c.urls.length = 0; };
export const texto = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
export const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
export { mkdirSync };

/** Inicio de sesión por el FORMULARIO REAL (crea también el contexto de agencia de la sesión, como en el uso normal). */
export async function iniciarSesionUI(page, email) {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(CLAVE);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  await page.waitForLoadState("networkidle");
}
/** Como `abrir`, pero iniciando sesión por el formulario real. */
export async function abrirConLogin(browser, email, vista = "escritorio") {
  const o = await abrir(browser, { vista });
  await iniciarSesionUI(o.page, email);
  return o;
}
