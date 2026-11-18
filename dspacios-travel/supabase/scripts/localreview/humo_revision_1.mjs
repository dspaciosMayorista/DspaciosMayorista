// #1 sobre la fuente INTEGRADA, Edge real (Playwright): el visitante pide cotización de un hotel «bajo solicitud», el personal la ve en el CRM antes de cualquier contrato
// (escritorio y 390 px), la valora desde su ficha, y se comprueban acceso, aislamiento (aliados y agencia) y una sola llamada del navegador por envío.
// ESCRIBE datos de prueba (solicitudes 7710001/7710002): corre `localreview.ps1 restaurar` antes de la revisión del dueño si lo ejecutas tú.
// Uso (desde dspacios-travel/): node supabase/scripts/localreview/humo_revision_1.mjs <carpeta_capturas>
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { lanzar, abrir, abrirConLogin, APP, texto, sinDesborde, crearInforme, reiniciar, mkdirSync } from "./revision_comun.mjs";

const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const { ok, cerrar } = crearInforme("#1");
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", "pg304", "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", (process.env.REV_DB_VERIF ?? "rev_revision"), "-X", "-q", "-t", "-A"], { input: q, encoding: "utf8" }).trim();
const DOC = { visitante: "7710001", aliado: "7710002" };
const b = await lanzar();

async function solicitar(page, cuenta, doc, nombres) {
  await page.goto(`${APP}/tarifario`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Vista Booking/ }).click(); await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Porción terrestre$/ }).click(); await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Solicitar cotización/ }).first().click();
  const dlg = page.locator("[role=dialog]"); await dlg.waitFor();
  const fechas = dlg.locator('input[placeholder="dd/mm/aaaa"]');
  await fechas.nth(0).fill("10/05/2030"); await fechas.nth(0).blur();
  await fechas.nth(1).fill("13/05/2030"); await fechas.nth(1).blur();
  await dlg.locator('input[name="viajan-menores"][value="no"]').check();
  await dlg.locator("label:has-text('Nombres') input").fill(nombres);
  await dlg.locator("label:has-text('Apellidos') input").fill("Humo");
  await dlg.locator("label:has-text('Número de documento') input").fill(doc);
  await dlg.locator("label:has-text('WhatsApp') input").fill("3115550000");
  await page.waitForTimeout(500);
  reiniciar(cuenta);
  await dlg.getByRole("button", { name: "Enviar solicitud" }).click();
  await page.waitForFunction(() => /Solicitud\s+C-\d+\s+registrada|ya la tenemos/i.test(document.body.innerText), null, { timeout: 40000 });
  await page.waitForTimeout(800);
  return cuenta.acciones;
}
async function buscar(page, t) {
  await page.locator("#buscar-personas-cotizacion").waitFor();
  await page.locator("#buscar-personas-cotizacion").fill(t);
  await page.waitForTimeout(3000);
  return texto(page);
}

// 0) Sin sesión
{ const { ctx, page } = await abrir(b); await page.goto(`${APP}/crm/personas-cotizacion`, { waitUntil: "load" }); ok(/\/login/.test(page.url()), "sin sesión el CRM redirige al ingreso"); await ctx.close(); }

// 1) Visitante
let id1;
{
  const { ctx, page, cuenta } = await abrir(b);
  const posts = await solicitar(page, cuenta, DOC.visitante, "Visitante");
  const fila = sql(`select id || '|' || estado || '|' || coalesce(creado_por_id::text,'') from public.cotizaciones where cliente_documento='${DOC.visitante}'`).split("|");
  id1 = Number(fila[0]);
  ok(fila[1] === "pendiente_tarifa" && fila[2] === "", `el visitante genera UNA cotización pendiente de tarifa, sin autor (${fila.join("|")})`);
  ok(sql(`select count(*) from public.cotizacion_participantes where cotizacion_id=${id1} and rol='titular' and activo`) === "1", "el titular queda registrado como puesto desde que pide (sin contrato)");
  ok(posts === 1, `el envío del navegador es UNA solicitud POST (${posts})`);
  await page.screenshot({ path: join(OUT, "1-visitante-enviada.png"), fullPage: true });
  await ctx.close();
}
// 2) Personal en el CRM: escritorio y móvil
for (const vista of ["escritorio", "movil"]) {
  const { ctx, page } = await abrirConLogin(b, "administracion@revision.test", vista);
  await page.goto(`${APP}/crm/personas-cotizacion`, { waitUntil: "load" });
  const t = await buscar(page, DOC.visitante);
  ok(t.includes(DOC.visitante) && /Pendiente de tarifa/.test(t) && !/pendiente_tarifa/.test(t), `${vista}: el CRM lista al visitante «Pendiente de tarifa» (sin código crudo)`);
  ok(t.includes("1 persona(s)") && /rovisional/i.test(t), `${vista}: una persona, ficha provisional`);
  ok(await sinDesborde(page), `${vista}: sin desborde horizontal`);
  await page.screenshot({ path: join(OUT, `1-crm-${vista}.png`), fullPage: true });
  await ctx.close();
}
// 3) Valorar desde la ficha
{
  const { ctx, page } = await abrirConLogin(b, "administracion@revision.test");
  await page.goto(`${APP}/dashboard/cotizaciones/${id1}`, { waitUntil: "networkidle" });
  ok(!/quedaron pendientes de registrar/.test(await texto(page)), "la ficha pendiente no muestra aviso de personas pendientes");
  await page.locator("#neta-hotel").fill("1200000");
  await page.getByRole("button", { name: "Cargar neta y valorar" }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Calculando"), null, { timeout: 40000 });
  await page.waitForTimeout(2500);
  ok(sql(`select estado from public.cotizaciones where id=${id1}`) === "abierta", "valorar la solicitud la abre (sin crear contrato)");
  ok(sql(`select count(*) from public.cotizacion_participantes where cotizacion_id=${id1} and rol='titular' and activo`) === "1", "valorar NO duplica ni pierde el puesto del titular");
  await page.screenshot({ path: join(OUT, "1-ficha-valorada.png"), fullPage: true });
  await ctx.close();
}
// 4) Aliado B2B: su solicitud queda a su nombre; ve solo lo suyo
{
  const { ctx, page, cuenta } = await abrirConLogin(b, "aliado@revision.test");
  const posts = await solicitar(page, cuenta, DOC.aliado, "Aliado");
  const fila = sql(`select id || '|' || coalesce(creado_por_id::text,'') from public.cotizaciones where cliente_documento='${DOC.aliado}'`).split("|");
  const uid = sql("select id from public.usuarios where email='aliado@revision.test'");
  ok(fila[1] === uid, "la solicitud del aliado queda sellada a su nombre");
  ok(posts === 1, `el envío del aliado es UNA solicitud POST (${posts})`);
  await page.goto(`${APP}/crm/personas-cotizacion`, { waitUntil: "load" });
  ok((await buscar(page, DOC.aliado)).includes(DOC.aliado), "el aliado ve en el CRM la persona de SU solicitud");
  ok(!(await buscar(page, DOC.visitante)).includes(DOC.visitante), "el aliado NO ve a la persona del visitante");
  await ctx.close();
}
{ const { ctx, page } = await abrirConLogin(b, "aliado2@revision.test"); await page.goto(`${APP}/crm/personas-cotizacion`, { waitUntil: "load" });
  ok(!(await buscar(page, DOC.aliado)).includes(DOC.aliado), "otro aliado NO ve la persona de la primera agencia"); await ctx.close(); }
{ const { ctx, page } = await abrirConLogin(b, "administracion@revision.test"); await page.goto(`${APP}/crm/personas-cotizacion`, { waitUntil: "load" });
  ok((await buscar(page, DOC.aliado)).includes(DOC.aliado), "el personal autorizado ve la solicitud del aliado"); await ctx.close(); }
// 5) Aislamiento por agencia
{ const { ctx, page } = await abrirConLogin(b, "minorista@revision.test"); await page.goto(`${APP}/crm/personas-cotizacion`, { waitUntil: "load" });
  const t1 = await buscar(page, DOC.visitante), t2 = await buscar(page, DOC.aliado);
  ok(!t1.includes(DOC.visitante) && !t2.includes(DOC.aliado), "minorista NO ve a los visitantes ni a los aliados de mayorista"); await ctx.close(); }
await b.close();
process.exit(cerrar());
