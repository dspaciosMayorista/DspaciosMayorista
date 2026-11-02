// Revisión en navegador REAL (Chrome local vía Playwright) del hotel bajo solicitud (#120): tarjeta, formulario público con el AVISO de acomodación, y la pantalla del operador con
// la valoración (adultos / distribuir). App local + PostgREST local. Solo pruebas locales.
// Uso: node supabase/scripts/revision_navegador_270.mjs <url_app> <carpeta_capturas> <archivo_env> <contenedor_pg> <base>
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const [base, salida, archivoEnv, ct, db] = process.argv.slice(2);
fs.mkdirSync(salida, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(archivoEnv, "utf8").split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", ct, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-X", "-q", "-t", "-A"], { input: q, encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
const ver = (m) => console.log(m);
const ok = (cond, m) => { ver(`${cond ? "OK   " : "FALLA"} ${m}`); if (!cond) process.exitCode = 1; };
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const consola = [];
async function sesion(ancho, alto, tag, cookie) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto } });
  if (cookie) await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !/medicion-error/.test(m.text())) consola.push(`[${tag}] ${m.type()}: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => consola.push(`[${tag}] pageerror: ${String(e).slice(0, 200)}`));
  page.on("response", (r) => { if (r.status() >= 400 && !/_next\/static|favicon|\/auth\/v1/.test(r.url())) consola.push(`[${tag}] HTTP ${r.status()} ${r.url().slice(0, 140)}`); });
  return { ctx, page };
}
const llenarCliente = async (d, nombre, doc) => {
  await d.getByLabel("Nombres").fill(nombre); await d.getByLabel("Apellidos").fill("Navegador"); await d.getByLabel("Número de documento").fill(doc); await d.getByLabel("WhatsApp / teléfono").fill("3001112233");
};

// ── A. Público: tarjeta, aviso de acomodación y envío ────────────────────────────────────────────────
const { ctx: pub, page } = await sesion(1366, 900, "publico");
await page.goto(`${base}/tarifario`, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(1500);
const tarjetas = page.locator('[data-testid^="solicitud-hotel-"]');
ok((await tarjetas.count()) >= 1 && (await page.locator('[data-testid="hoteles-bajo-solicitud"]').first().innerText()).includes("Tarifa y disponibilidad bajo solicitud"), `tarjeta a solicitud visible con el texto exacto (${await tarjetas.count()} tarjeta(s) en Paquetes)`);

// A1. hotel CON acomodaciones configuradas: el aviso verde con los conteos
await page.getByRole("button", { name: "Solicitar cotización" }).first().click();
let d = page.getByRole("dialog"); await d.waitFor();
await d.getByPlaceholder("3, 7").fill("7, 1");
await page.locator('[data-testid="aviso-ocupacion"]').waitFor({ timeout: 15000 });
const verde = await page.locator('[data-testid="aviso-ocupacion"]').innerText();
ok(/2 adulto\(s\), 1 niño\(s\) y 1 infante\(s\)/.test(verde), `aviso verde antes de enviar: «${verde}»`);
await page.screenshot({ path: `${salida}/11_aviso_acomodacion_ok.png` });
// A2. más niños de los que caben en una doble: aviso rojo y envío bloqueado
await d.getByPlaceholder("3, 7").fill("5, 6, 7");
await page.waitForFunction(() => document.querySelector('[data-testid="aviso-ocupacion"]')?.getAttribute("role") === "alert", null, { timeout: 15000 });
const rojo = await page.locator('[data-testid="aviso-ocupacion"]').innerText();
ok(/admite máximo/.test(rojo) && (await d.getByRole("button", { name: "Enviar solicitud" }).isDisabled()), `aviso rojo y «Enviar solicitud» deshabilitado: «${rojo.slice(0, 110)}…»`);
await page.screenshot({ path: `${salida}/12_aviso_acomodacion_error.png` });
// A3. enviar la válida (niño de 7 + infante de 1)
await d.getByPlaceholder("3, 7").fill("7, 1");
await page.waitForFunction(() => document.querySelector('[data-testid="aviso-ocupacion"]')?.getAttribute("role") === "status", null, { timeout: 15000 });
await d.locator("select").first().selectOption({ index: 1 });
await llenarCliente(d, "Laura", "987654");
await d.getByRole("button", { name: "Enviar solicitud" }).click();
await page.locator('[data-testid="solicitud-enviada"]').waitFor({ timeout: 60000 });
ok(true, `solicitud con niño e infante enviada: «${(await page.locator('[data-testid="solicitud-enviada"]').innerText()).split("\n")[0]}»`);
await page.keyboard.press("Escape");

// A4. porción terrestre: hotel marcado SIN hotel_acomodaciones (defaults del motor): con un niño NO se puede enviar; sin menores sí
await page.getByRole("button", { name: "Porción terrestre" }).first().click();
await page.waitForTimeout(800);
ok((await tarjetas.count()) === 2, `Porción terrestre: ${await tarjetas.count()} tarjetas a solicitud (el hotel con acomodaciones y el que no las tiene; el tarifado no aparece aquí: sin tarifario publicado en esta base)`);
const cardSin = page.locator('[data-testid="solicitud-hotel-7205"]');
await cardSin.getByRole("button", { name: "Solicitar cotización" }).click();
d = page.getByRole("dialog"); await d.waitFor();
await d.getByPlaceholder("3, 7").fill("7");
await page.waitForFunction(() => document.querySelector('[data-testid="aviso-ocupacion"]')?.getAttribute("role") === "alert", null, { timeout: 15000 });
ok(/admite máximo 0 niño/.test(await page.locator('[data-testid="aviso-ocupacion"]').innerText()), "hotel sin hotel_acomodaciones: una doble no admite el niño (regla por defecto del motor), dicho antes de enviar");
await page.screenshot({ path: `${salida}/13_sin_acomodaciones.png` });
await d.getByPlaceholder("3, 7").fill("");
await page.waitForTimeout(1200);
ok(await d.getByRole("button", { name: "Enviar solicitud" }).isEnabled(), "sin menores el mismo hotel sí se puede solicitar");
await page.keyboard.press("Escape");

// A5. porción terrestre del hotel con acomodaciones, SIN niños (fechas a mano)
const cardPorcion = page.locator('[data-testid="solicitud-hotel-7203"]');
await cardPorcion.getByRole("button", { name: "Solicitar cotización" }).click();
d = page.getByRole("dialog"); await d.waitFor();
await d.getByRole("textbox", { name: "Ida" }).fill("10/05/2030"); await d.getByRole("textbox", { name: "Ida" }).blur();
await d.getByRole("textbox", { name: "Regreso" }).fill("13/05/2030"); await d.getByRole("textbox", { name: "Regreso" }).blur();
await llenarCliente(d, "Pedro", "555111");
await d.getByRole("button", { name: "Enviar solicitud" }).click();
await page.locator('[data-testid="solicitud-enviada"]').waitFor({ timeout: 60000 });
ok(true, `solicitud sin niños (porción) enviada: «${(await page.locator('[data-testid="solicitud-enviada"]').innerText()).split("\n")[0]}»`);
await pub.close();

// ── B. Operador: valoración ──────────────────────────────────────────────────────────────────────────
const idNinos = Number(sql("select id from public.cotizaciones where cliente_documento = '987654' order by id desc limit 1"));
const idSin = Number(sql("select id from public.cotizaciones where cliente_documento = '555111' order by id desc limit 1"));
const sesionJson = { access_token: env.NAV_USER_JWT, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "00000000-0000-0000-0000-000000270001", aud: "authenticated", role: "authenticated", email: "super270@x.test" } };
const cookie = { name: "sb-127-auth-token", value: "base64-" + Buffer.from(JSON.stringify(sesionJson)).toString("base64url"), url: base };
const { ctx: op, page: p } = await sesion(1366, 1000, "operador", cookie);
await p.goto(`${base}/dashboard/cotizaciones/${idNinos}`, { waitUntil: "networkidle", timeout: 120000 });
await p.waitForTimeout(1500);
const cuerpo = await p.locator("body").innerText();
ok(cuerpo.includes("Tarifa y disponibilidad bajo solicitud") && cuerpo.includes("Neta TOTAL del hotel"), "pantalla del operador: solicitud pendiente con el formulario de valoración");
ok(/2\s*adulto\(s\)\s*·\s*1\s*niño\(s\)\s*·\s*1\s*infante\(s\)/.test(await p.locator('[data-testid="neta-conteos"]').innerText()), "los conteos salen de la solicitud guardada: 2 adultos · 1 niño · 1 infante");
ok(await p.getByText("Cargar hotel a los adultos").isVisible() && await p.getByText("Distribuir", { exact: false }).first().isVisible(), "con niños: se ofrecen «Cargar hotel a los adultos» y «Distribuir»");
await p.screenshot({ path: `${salida}/14_operador_conniños.png` });
await p.locator("#neta-hotel").fill("1200000");
await p.getByLabel(/Distribuir/).check();
await p.locator("#neta-adulto").fill("450000");
await p.locator("#neta-nino").fill("250000");
const mal = await p.locator('[data-testid="neta-cuadre"]').innerText();
ok(/faltan 50[.,]000/.test(mal) && await p.getByRole("button", { name: "Cargar neta y valorar" }).isDisabled(), `suma que no cuadra: «${mal}» y el botón queda deshabilitado`);
await p.screenshot({ path: `${salida}/15_operador_no_cuadra.png` });
await p.locator("#neta-nino").fill("300000");
const bien = await p.locator('[data-testid="neta-cuadre"]').innerText();
ok(/cuadra/.test(bien) && !/faltan|sobran/.test(bien) && await p.getByRole("button", { name: "Cargar neta y valorar" }).isEnabled(), `distribución que cuadra: «${bien}»`);
await p.screenshot({ path: `${salida}/16_operador_cuadra.png` });
await p.getByRole("button", { name: "Cargar neta y valorar" }).click();
await p.waitForFunction(() => !document.querySelector('[data-testid="neta-solicitud-form"]'), null, { timeout: 90000 });
const v = JSON.parse(sql(`select json_build_object('estado', c.estado, 'precio', c.precio_venta, 'modo', t.modo, 'na', t.neta_adulto, 'nn', t.neta_nino, 'ni', t.neta_infante) from public.cotizaciones c join public.cotizacion_tarifa_solicitud t on t.cotizacion_id = c.id where c.id = ${idNinos}`));
ok(v.estado === "abierta" && v.modo === "distribuir" && Number(v.na) === 450000 && Number(v.nn) === 300000 && Number(v.ni) === 0 && Number(v.precio) > 0, `valorada desde el navegador: ${JSON.stringify(v)}`);
await p.screenshot({ path: `${salida}/17_operador_valorada.png` });

await p.goto(`${base}/dashboard/cotizaciones/${idSin}`, { waitUntil: "networkidle", timeout: 120000 });
await p.waitForTimeout(1500);
ok(await p.locator('[data-testid="neta-sin-ninos"]').isVisible() && (await p.locator('[data-testid="neta-reparto"]').count()) === 0, "sin niños: «el hotel se carga a los adultos», sin elección");
await p.screenshot({ path: `${salida}/18_operador_sinninos.png` });
await op.close();

// ── C. Móvil: el aviso y el formulario ──────────────────────────────────────────────────────────────
const { ctx: mv, page: pm } = await sesion(390, 844, "movil");
await pm.goto(`${base}/tarifario`, { waitUntil: "networkidle", timeout: 120000 });
await pm.waitForTimeout(1500);
ok(!(await pm.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)), "móvil 390px: sin desborde horizontal");
await pm.getByRole("button", { name: "Solicitar cotización" }).first().click();
const dm = pm.getByRole("dialog"); await dm.waitFor();
await dm.getByPlaceholder("3, 7").fill("5, 6, 7");
await pm.waitForFunction(() => document.querySelector('[data-testid="aviso-ocupacion"]')?.getAttribute("role") === "alert", null, { timeout: 15000 });
await pm.screenshot({ path: `${salida}/19_movil_aviso.png` });
await mv.close();
await browser.close();
fs.writeFileSync(`${salida}/consola.txt`, consola.join("\n"));
ver(`consola/red (sin medicion-error ni /auth): ${consola.length} mensaje(s)${consola.length ? "\n  " + [...new Set(consola)].slice(0, 8).join("\n  ") : ""}`);
