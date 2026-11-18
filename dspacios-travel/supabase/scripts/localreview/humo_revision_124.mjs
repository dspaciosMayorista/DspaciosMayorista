// #124 sobre la fuente INTEGRADA (build de producción local, Edge real): renombre propio, renombre con cambios sin guardar, choque real entre dos sesiones y falta de permiso demostrada.
// Derivado de supabase/scripts/local124/verificar_124_navegador.mjs (mismos escenarios A–C) + escenario D. Usa el hotel sintético 12401 y lo restaura antes de cada escenario.
// Uso (desde dspacios-travel/): node supabase/scripts/localreview/humo_revision_124.mjs <carpeta_capturas>
// Counts the server-action requests (POST with a `next-action` header) of each click: no polling, no retries.
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SALIDA = process.argv[2], BASE = process.argv[3] ?? "http://127.0.0.1:3070";
mkdirSync(SALIDA, { recursive: true });
const H = 12401, TEMP = 124011;
const psql = (q) => execSync(`docker exec -i -e PGPASSWORD=postgres pg304 psql -h 127.0.0.1 -U supabase_admin -d ${process.env.REV_DB_VERIF ?? "rev_revision"} -X -q -t -A -c "${q.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
const restaurar = () => {
  psql(`update public.hotel_temporadas set nombre = 'ALTA' where id = ${TEMP}`);
  psql(`update public.tarifa_hotel set temporada = 'ALTA' where hotel_id = ${H} and temporada = 'ALTA 2027'`);
  psql(`update public.hotel_calculadora set params = jsonb_set(jsonb_set(replace(params::text, 'ALTA 2027', 'ALTA')::jsonb, '{modificadores,sencilla_pct}', '50'), '{bases,0,precio}', '100000') where hotel_id = ${H}`);
};
const estadoDb = () => JSON.parse(psql(`select json_build_object('version', version, 'sencilla', params->'modificadores'->>'sencilla_pct', 'bases', (select json_agg(b->>'temporada') from jsonb_array_elements(params->'bases') b)) from public.hotel_calculadora where hotel_id = ${H}`));
let fallos = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK   " : "FALLO"} ${m}`); if (!c) fallos++; };

const navegador = await chromium.launch({ channel: "msedge", headless: true });
const VISTAS = [{ nombre: "desktop", viewport: { width: 1366, height: 900 } }, { nombre: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }];

async function contexto(vista) {
  const ctx = await navegador.newContext({ viewport: vista.viewport, isMobile: vista.isMobile, hasTouch: vista.hasTouch, locale: "es-CO" });
  const page = await ctx.newPage();
  const acciones = { n: 0, urls: [] };
  page.on("request", (r) => { if (r.method() === "POST" && r.headers()["next-action"]) { acciones.n++; acciones.urls.push(r.url().replace(BASE, "")); } });
  return { ctx, page, acciones };
}
async function entrar(page) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", "operaciones@revision.test");
  await page.fill("#password", "Revision2026!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
}
const abrirCalculadora = async (page) => {
  await page.goto(`${BASE}/dashboard/producto/hoteles/${H}?tab=temporadas`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Tarifa por fórmula/ }).click();
  await page.locator('td[data-label="ALTA"] input').first().waitFor({ timeout: 30000 });
};
const sencilla = (page) => page.locator('xpath=//label[normalize-space()="Sencilla"]/parent::*//input').first();
async function renombrarAltaDesdeTemporadas(page, nuevo) {
  await page.locator("li", { has: page.locator("b", { hasText: /^ALTA$/ }) }).getByRole("button", { name: "Editar" }).first().click();
  await page.locator('input[placeholder^="ALTA, BAJA"]').fill(nuevo);
  await page.getByRole("button", { name: "Guardar cambios" }).first().click();
}
const esperarAviso = (page) => page.locator("[data-aviso-calculadora]").first().waitFor({ timeout: 30000 });
const mensajeForm = (page, re) => page.getByText(re).first().waitFor({ timeout: 30000 });

for (const vista of VISTAS) {
  console.log(`\n######## ${vista.nombre} (${vista.viewport.width}×${vista.viewport.height})`);
  const { ctx, page, acciones } = await contexto(vista);
  await entrar(page);

  console.log("\n-- A. Same user renames the vigencia (calculator open, nothing edited), then saves");
  restaurar(); await abrirCalculadora(page);
  const v0 = estadoDb().version;
  await renombrarAltaDesdeTemporadas(page, "ALTA 2027");
  await esperarAviso(page);
  const aviso = (await page.locator("[data-aviso-calculadora]").first().innerText()).replace(/\s+/g, " ");
  console.log(`  banner: ${aviso}`);
  ok(/«ALTA» se renombró a «ALTA 2027»/.test(aviso) && /No tenías cambios sin guardar/.test(aviso) && !/otra persona/i.test(aviso), "banner names the rename, says nothing was lost, names no person");
  const baseNueva = await page.locator('td[data-label="ALTA 2027"] input').first().inputValue();
  ok(baseNueva === "100000", `the base price is shown under the new season name (value: ${baseNueva})`);
  await page.screenshot({ path: join(SALIDA, `${vista.nombre}-A-aviso-renombre.png`), fullPage: false });
  acciones.n = 0; acciones.urls = [];
  await page.getByRole("button", { name: "Guardar calculadora" }).click();
  await mensajeForm(page, /Calculadora guardada/);
  const a = estadoDb();
  ok(a.version === v0 + 2 && JSON.stringify(a.bases) === '["ALTA 2027"]', `saved with the current version (db v${v0} → rename v${v0 + 1} → save v${a.version}); bases ${JSON.stringify(a.bases)}`);
  console.log(`  server-action POSTs for «Guardar calculadora»: ${acciones.n} ${JSON.stringify(acciones.urls)}`);
  ok(acciones.n === 1, "exactly one server action for the save (no extra reads, no retry)");

  console.log("\n-- B. Same user edits first (unsaved), then renames; edits must be kept and carried to the new name");
  restaurar(); await abrirCalculadora(page);
  await sencilla(page).fill("65");
  await page.locator('td[data-label="ALTA"] input').first().fill("120000");
  await renombrarAltaDesdeTemporadas(page, "ALTA 2027");
  await esperarAviso(page);
  const avisoB = (await page.locator("[data-aviso-calculadora]").first().innerText()).replace(/\s+/g, " ");
  console.log(`  banner: ${avisoB}`);
  ok(/Conservamos tus cambios sin guardar/.test(avisoB) && /Todavía NO están guardados/.test(avisoB), "banner says the edits were kept and are NOT saved yet");
  ok((await sencilla(page).inputValue()) === "65" && (await page.locator('td[data-label="ALTA 2027"] input').first().inputValue()) === "120000", "typed values are still on screen (sencilla 65, base 120000 under the new name)");
  ok(estadoDb().sencilla === "50", "nothing was saved automatically");
  await page.screenshot({ path: join(SALIDA, `${vista.nombre}-B-cambios-conservados.png`), fullPage: false });
  await page.getByRole("button", { name: "Guardar calculadora" }).click();
  await mensajeForm(page, /Calculadora guardada/);
  const b = estadoDb();
  ok(b.sencilla === "65" && JSON.stringify(b.bases) === '["ALTA 2027"]', `saved the kept edits: sencilla ${b.sencilla}, bases ${JSON.stringify(b.bases)}`);
  acciones.n = 0; acciones.urls = [];
  await page.getByRole("button", { name: "Generar (agregar/actualizar)" }).click();
  await mensajeForm(page, /Generadas/);
  console.log(`  server-action POSTs for «Generar»: ${acciones.n} ${JSON.stringify(acciones.urls)} (save + generate in one click)`);
  ok(acciones.n === 2, "«Generar» = 1 save + 1 generate");
  ok(estadoDb().version === b.version + 1, "generate after the save used the version the save returned (a single new version)");

  console.log("\n-- C. Genuine concurrent save from another browser session of the same account");
  restaurar(); await abrirCalculadora(page);
  await sencilla(page).fill("65");
  const otra = await contexto(vista); await entrar(otra.page); await abrirCalculadora(otra.page);
  await sencilla(otra.page).fill("70");
  await otra.page.getByRole("button", { name: "Guardar calculadora" }).click();
  await mensajeForm(otra.page, /Calculadora guardada/);
  const vOtra = estadoDb();
  acciones.n = 0; acciones.urls = [];
  await page.getByRole("button", { name: "Guardar calculadora" }).click();
  await esperarAviso(page);
  const avisoC = (await page.locator("[data-aviso-calculadora]").first().innerText()).replace(/\s+/g, " ");
  console.log(`  banner: ${avisoC}`);
  ok(/Tu clic no guardó nada/.test(avisoC) && /siguen en pantalla/.test(avisoC) && /cambió: modificadores/.test(avisoC), "banner explains what changed and that nothing was saved");
  ok(estadoDb().sencilla === "70" && estadoDb().version === vOtra.version, "the other session's save was NOT overwritten");
  ok((await sencilla(page).inputValue()) === "65", "the stale form keeps its unsaved value");
  console.log(`  server-action POSTs for the rejected click: ${acciones.n} ${JSON.stringify(acciones.urls)}`);
  ok(acciones.n === 1, "one request (no automatic retry)");
  await page.screenshot({ path: join(SALIDA, `${vista.nombre}-C-choque-real.png`), fullPage: false });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Cargar la versión guardada/ }).click();
  ok((await sencilla(page).inputValue()) === "70", "«Cargar la versión guardada» is an explicit, confirmed action");
  await otra.ctx.close();
  await ctx.close();
}
// D. Falta de permiso DEMOSTRADA: sesión de superadmin sin contexto de agencia (cookie inyectada, sin pasar por el login real) → la base confirma que no puede editar el catálogo global.
{
  console.log("\n######## D. Permission failure proven by the database (session without active agency)");
  const { cookieSesion } = await import("./revision_comun.mjs");
  restaurar();
  const ctx = await navegador.newContext({ viewport: { width: 1366, height: 900 }, locale: "es-CO" });
  await ctx.addCookies(await cookieSesion("superadmin@revision.test"));
  const page = await ctx.newPage();
  const acciones = { n: 0 };
  page.on("request", (r) => { if (r.method() === "POST" && r.headers()["next-action"]) acciones.n++; });
  await abrirCalculadora(page);
  const v0 = estadoDb();
  await sencilla(page).fill("65");
  console.log("  POSTs antes del clic (carga de la página): " + acciones.n); acciones.n = 0;
  await page.getByRole("button", { name: "Guardar calculadora" }).click();
  await page.getByText(/No se guardó nada/).first().waitFor({ timeout: 30000 });
  const msg = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  ok(/La calculadora NO cambió/.test(msg) && /La base confirma que tu sesión o la agencia activa no puede editar/.test(msg), "message states the permission cause the database confirmed (not a 'someone else changed it' claim)");
  ok(!/otra persona/i.test(msg) && !/cambió: /.test(msg), "no actor is named and no phantom concurrent change is reported");
  ok((await sencilla(page).inputValue()) === "65", "typed value is kept on screen");
  ok(estadoDb().version === v0.version && estadoDb().sencilla === "50", "nothing was saved and the version did not change");
  ok(acciones.n === 1, `one request for the rejected click, no retry (${acciones.n})`);
  await page.screenshot({ path: join(SALIDA, "desktop-D-sin-permiso.png"), fullPage: false });
  await ctx.close();
}
restaurar();
await navegador.close();
console.log(`\n${fallos === 0 ? "ALL BROWSER CHECKS PASSED" : `${fallos} BROWSER CHECK(S) FAILED`}`);
process.exit(fallos === 0 ? 0 : 1);
