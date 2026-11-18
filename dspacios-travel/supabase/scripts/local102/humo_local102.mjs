// HUMO de la revisión local de #102 en NAVEGADOR REAL (Edge vía Playwright) contra la app local (build de producción) y la base sintética.
// Inicia sesión de verdad en el GoTrue local, arma la cookie como @supabase/ssr y recorre la Vista tabla y la Vista Booking con las acciones REALES.
// Cuenta las solicitudes de red que dispara cada clic y guarda capturas (escritorio y móvil) en la carpeta indicada. Solo lectura sobre los datos.
// Uso (desde dspacios-travel/): node supabase/scripts/local102/humo_local102.mjs <config.json> <carpeta_capturas> [url_app=http://127.0.0.1:3103]
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const OUT = process.argv[3]; mkdirSync(OUT, { recursive: true });
const APP = process.argv[4]?.startsWith("http") ? process.argv[4] : "http://127.0.0.1:3103";
const SUPA = "http://127.0.0.1:54102";
const REF = new URL(SUPA).hostname.split(".")[0];
let fallos = 0;
const ok = (c, m) => { console.log(`${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };
const dinero = (n) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);

async function cookieSesion(email) {
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: cfg.anonKey, "content-type": "application/json" }, body: JSON.stringify({ email, password: "Local102!" }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${email}: ${JSON.stringify(j)}`);
  const valor = "base64-" + Buffer.from(JSON.stringify(j)).toString("base64url");
  const trozos = valor.match(/.{1,3180}/g);
  return trozos.map((t, i) => ({ name: trozos.length === 1 ? `sb-${REF}-auth-token` : `sb-${REF}-auth-token.${i}`, value: t, domain: "127.0.0.1", path: "/" }));
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies(await cookieSesion("administracion@local102.test"));
const page = await ctx.newPage();
const posts = [];
page.on("request", (rq) => { if (rq.method() === "POST" && rq.url().startsWith(APP)) posts.push(rq.url()); });

// Los <label> del buscador no están asociados a su <input>: se busca el input junto a la etiqueta.
const campo = (etiqueta) => page.locator(`label:text-is("${etiqueta}")`).locator("xpath=..").locator("input").first();
async function elegirDestino(nombre) {
  await page.locator('button[role="combobox"]').first().click();
  await page.getByRole("option", { name: nombre }).click();
}
async function buscar({ adultos = "2", habitaciones = "1", menores = [], ida = "10/06/2030", regreso = "13/06/2030" }) {
  await page.getByRole("textbox", { name: "Ida", exact: true }).fill(ida); await page.getByRole("textbox", { name: "Ida", exact: true }).blur();
  await page.getByRole("textbox", { name: "Regreso", exact: true }).fill(regreso); await page.getByRole("textbox", { name: "Regreso", exact: true }).blur();
  await campo("Adultos").fill(adultos);
  await campo("Habitaciones").fill(habitaciones);
  await page.getByLabel(/Menores \(0–17 años\)/).fill(String(menores.length));
  for (let i = 0; i < menores.length; i++) await campo(`Edad menor ${i + 1}`).fill(String(menores[i]));
  posts.length = 0;
  await page.getByRole("button", { name: /Buscar hoteles/ }).click();
  await page.waitForSelector('button:has-text("Buscar hoteles")', { timeout: 30000 });
  await page.waitForTimeout(1200);
}
const textoPagina = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const fila = async (hotel, seccion) => {
  const sec = page.locator(`section[aria-labelledby="${seccion}"]`);
  return (await sec.locator("tbody tr", { hasText: hotel }).first().innerText()).replace(/\s+/g, " ");
};

await page.goto(`${APP}/tarifario`, { waitUntil: "networkidle" });
ok(await page.getByRole("button", { name: "Vista tabla" }).count() === 1, "usuario interno ve «Vista tabla»");
await page.getByRole("button", { name: "Vista tabla" }).click();
await page.screenshot({ path: join(OUT, "01-tabla-inicio-1280.png"), fullPage: true });
let t = await textoPagina();
ok(/Paquete de 3 noches/.test(t) && /Una noche adicional/.test(t) && /Elige las fechas de la estadía/.test(t), "sin búsqueda: «Paquete de 3 noches» y aviso de que la noche adicional depende de la fecha");
ok(!/Habitación 1\b/.test(t) && (await page.locator("select").count()) <= 3, "ya no hay un selector de tipo por habitación en el buscador");
await elegirDestino("CARTAGENA 102");

// 1) 2 adultos, 1 habitación
await buscar({});
ok(posts.length === 1, `un clic en Buscar = 1 llamada al servidor en la Vista tabla (${posts.length})`);
let f = await fila("Hotel A", "sec-estadia");
ok(f.includes("1 Doble") && f.includes(dinero(750000)), `Hotel A: 1 Doble, total $${dinero(750000)}`);
f = await fila("Hotel A", "sec-noche");
ok(f.includes(dinero(250000)), `Hotel A: una noche adicional $${dinero(250000)} (= total 4 noches − total 3 noches)`);
await page.screenshot({ path: join(OUT, "02-tabla-2adultos-1280.png"), fullPage: true });

// 2) 2 adultos + 15 años, 1 habitación: A cobra adulto (Triple), B cobra Niño 1 (Doble)
await buscar({ menores: [15] });
f = await fila("Hotel A", "sec-estadia");
ok(f.includes("1 Triple") && f.includes(dinero(1080000)) && /15 años: tarifa de adulto/.test(f), `Hotel A: 15 años = tarifa de adulto, 1 Triple, total $${dinero(1080000)}`);
f = await fila("Hotel B", "sec-estadia");
ok(f.includes("1 Doble") && f.includes(dinero(900000)) && /Niño 1 · 15 años/.test(f) && f.includes(dinero(150000)), `Hotel B: 1 Doble + Niño 1 (15 años $${dinero(150000)}), total $${dinero(900000)}`);
t = await textoPagina();
ok(!/Hotel D \(solo adultos\)/.test(t), "Hotel D (solo adultos) no aparece con un menor");
await page.screenshot({ path: join(OUT, "03-tabla-15anos-1280.png"), fullPage: true });
await page.setViewportSize({ width: 390, height: 900 });
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, "04-tabla-15anos-390.png"), fullPage: true });
const desborda = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
ok(!desborda, "móvil (390 px): sin desbordamiento horizontal de la página");
await page.setViewportSize({ width: 1280, height: 900 });

// 3) 3 adultos, 4 adultos, 5 adultos (sin reparto) y más habitaciones que viajeros
await buscar({ adultos: "3" });
f = await fila("Hotel A", "sec-estadia"); ok(f.includes("1 Triple") && f.includes(dinero(1080000)), "3 adultos → Triple");
await buscar({ adultos: "4" });
f = await fila("Hotel A", "sec-estadia"); ok(f.includes("1 Múltiple") && f.includes(dinero(1200000)), "4 adultos → Múltiple");
t = await textoPagina(); ok(!/Hotel C \(sin múltiple\)/.test(t), "Hotel C (sin Múltiple) no ofrece 4 adultos en 1 habitación");
await buscar({ adultos: "5" });
t = await textoPagina(); ok(/no se pueden repartir en 1 habitación/.test(t), "5 adultos en 1 habitación: se explica el motivo real");
await buscar({ adultos: "2", habitaciones: "3" });
t = await textoPagina(); ok(/cada habitación necesita al menos una persona/.test(t) && posts.length === 0, `3 habitaciones para 2 viajeros: se explica ANTES de buscar y sin llamadas (${posts.length})`);
await buscar({ adultos: "3", habitaciones: "2" });
f = await fila("Hotel A", "sec-estadia"); ok(f.includes("1 Doble + 1 Sencilla") && f.includes(dinero(1350000)), "3 adultos en 2 habitaciones → Doble + Sencilla");

// 4) Noche adicional en otra temporada y con promoción de un día
await buscar({ adultos: "2", habitaciones: "1", ida: "28/06/2030", regreso: "01/07/2030" });
f = await fila("Hotel A", "sec-noche"); ok(f.includes(dinero(150000)), `noche del 1/7 (temporada BAJA): $${dinero(150000)}, no el valor de las noches del paquete`);
await buscar({ ida: "02/07/2030", regreso: "05/07/2030" });
f = await fila("Hotel A", "sec-noche"); ok(f.includes(dinero(120000)), `noche del 5/7 con promoción de un día: $${dinero(120000)}`);
await page.screenshot({ path: join(OUT, "05-tabla-noche-promo-1280.png"), fullPage: true });

// 5) Vista Booking: misma búsqueda, tarjetas con el desglose compacto
await page.getByRole("button", { name: "Vista Booking" }).click();
await page.getByRole("button", { name: /Porción terrestre/ }).first().click();
await elegirDestino("CARTAGENA 102");
await buscar({ menores: [15], ida: "10/06/2030", regreso: "13/06/2030" });
t = await textoPagina();
ok(/Tarifa por persona · estadía de 3 noches/i.test(t) && /Total de la reserva/i.test(t), "Vista Booking: tarjetas con desglose adulto/menores/total");
ok(/Habitaciones evaluadas: 1 Triple/.test(t) && /cobra como adulto a quien tiene 15 años/.test(t), "Vista Booking: Hotel A muestra la habitación evaluada y la edad cobrada como adulto");
ok(posts.length <= 2, `Vista Booking: un clic en Buscar = persona + unidad (${posts.length} llamadas)`);
await page.screenshot({ path: join(OUT, "06-booking-15anos-1280.png"), fullPage: true });
await page.setViewportSize({ width: 390, height: 900 });
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, "07-booking-15anos-390.png"), fullPage: true });

// 6) Reposo: sin llamadas
posts.length = 0; await page.waitForTimeout(3000);
ok(posts.length === 0, `en reposo (3 s) no hay llamadas al servidor (${posts.length})`);

await browser.close();
console.log(`=== ${fallos} fallo(s)`);
process.exit(fallos ? 1 : 0);
