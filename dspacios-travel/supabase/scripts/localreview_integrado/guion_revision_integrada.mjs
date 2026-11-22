// Ejecuta, con los ROLES REALES y los ejemplos sembrados, los pasos de la guía de revisión consolidada (docs/tecnico/integration-126-127-b2b-owner-walkthrough-2026-11-20.md).
// Es la prueba de que la guía es ejecutable tal como está escrita: cada «Esperado» de la guía es una verificación de este archivo. Solo local, contra la pila de revisión.
// Uso (desde dspacios-travel/, con la pila arriba sobre una base rev_verif_*): REV_APP=http://localhost:3070 REV_CFG_DIR=<carpeta config> node supabase/scripts/localreview_integrado/guion_revision_integrada.mjs <carpeta_capturas> [secciones: A,B,C,D,E,F]
// OJO: las secciones C (firma, historial, solicitud, clientes) y D (continuación de registro) CAMBIAN datos de la base; ejecútalas sobre una COPIA (la guía lo indica), no sobre la base del dueño.
import { pathToFileURL } from "node:url";
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const WT = new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const C = await import(pathToFileURL(`${WT}/supabase/scripts/localreview/revision_comun.mjs`).href);
const OUT = process.argv[2] ?? "guion-capturas"; mkdirSync(OUT, { recursive: true });
const SEC = (process.argv[3] ?? "A,G,B,C,D,F,E").split(",");
const BASE = process.env.REV_DB ?? "rev_verif_int_ejec", CT = process.env.REV_PG ?? "pgb2b";
const DIR = process.env.REV_CFG_DIR;
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", BASE, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const MAIL = `http://127.0.0.1:${JSON.parse(readFileSync(`${DIR}/config.json`, "utf8")).puertos.correo}`;
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
let fallos = 0, aciertos = 0;
const ok = (c, m, extra = "") => { console.log(`${c ? "OK   " : "FALLO"} ${m}${!c && extra ? "\n       → " + String(extra).slice(0, 500) : ""}`); if (c) aciertos++; else fallos++; };
const browser = await C.lanzar();
const sesion = async (email, vista = "escritorio") => C.abrirConLogin(browser, email, vista);
const ir = async (page, ruta) => { await page.goto(C.APP + ruta, { waitUntil: "networkidle" }); return norm(await C.texto(page)); };
const hoyBogota = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const pagina = (t) => t.replace(/^.*?(Cerrar sesión )/, "");

// ═══ A · #126 ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
if (SEC.includes("A")) {
  console.log("\n══ A · #126 (superadmin@revision.test) ══");
  const { page } = await sesion("superadmin@revision.test");
  // A1 · DTM-12601: dos pagos en USD, cada uno con su TRM
  let t = await ir(page, "/dashboard/contratos/DTM-12601");
  ok(/DTM-12601/.test(t) && /USD/.test(t), "A1 /dashboard/contratos/DTM-12601 abre (contrato en USD, pendiente, sin pagos)", t);
  ok(sql("select count(*) from public.abonos where numero_contrato = 'DTM-12601'") === "0", "A1 el contrato empieza SIN pagos (el dueño los registra)");
  await page.getByRole("button", { name: /^Cartera/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  const form = page.locator("form", { has: page.getByRole("button", { name: "Registrar abono" }) }).first();
  ok(await form.count() === 1, "A1 pestaña Cartera: formulario «Registrar abono»");
  const trm = form.locator('input[placeholder="COP por 1 USD"]'), valor = form.locator('input[type="number"]').first();
  t = norm(await form.innerText());
  ok(/TRM de este pago/.test(t) && /Pesos \(COP\)/.test(t) && /Dólares \(USD\)/.test(t), "A1 pide la TRM de ESTE pago y ofrece Pesos (COP) o Dólares (USD)");
  await valor.fill("1230000"); await trm.fill("4.100");
  t = norm(await form.innerText());
  ok(/Acredita\s+USD\s?\$?\s?300/.test(t) && /saldo después del pago:\s*USD\s?\$?\s?700/.test(t), "A1 pago 1: COP 1.230.000 con TRM 4.100 → «Acredita USD 300» y saldo USD 700");
  await form.getByRole("button", { name: "Registrar abono" }).click();
  await page.waitForSelector('[data-testid="resumen-cop-usd"]', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1200);
  t = norm(await C.texto(page));
  ok(/Cobrado en pesos \(real\)/i.test(t) && /1\.230\.000/.test(t) && /Equivalente del saldo \(provisional\)/i.test(t) && /≈\s?\$\s?2\.870\.000/.test(t), "A1 panel: «Cobrado en pesos (real) 1.230.000» y «Equivalente del saldo (provisional) ≈ $ 2.870.000» (700 × 4.100)", t.slice(-600));
  await valor.fill("2940000"); await trm.fill("4200");
  t = norm(await form.innerText());
  ok(/Acredita\s+USD\s?\$?\s?700/.test(t) && /saldo después del pago:\s*USD\s?\$?\s?0/.test(t), "A1 pago 2: COP 2.940.000 con TRM 4.200 → «Acredita USD 700» y saldo USD 0");
  await form.getByRole("button", { name: "Registrar abono" }).click(); await page.waitForTimeout(2500);
  t = norm(await C.texto(page));
  ok(/Total cobrado en pesos/i.test(t) && /4\.170\.000/.test(t) && !/Equivalente del saldo \(provisional\)/i.test(t), "A1 saldo 0: «Total cobrado en pesos» 4.170.000 (1.230.000 + 2.940.000), definitivo, sin aviso provisional", t.slice(-500));
  await page.screenshot({ path: join(OUT, "A1-contrato-2-pagos.png"), fullPage: true });
  const href = await page.locator('a[href^="/recibo/"]').first().getAttribute("href").catch(() => null);
  if (href) { const tr = await ir(page, href); ok(/USD/.test(tr), `A1 el recibo ${href} se emite en USD`, tr); }
  // A2 · Gestión de contratos: «Viaje más reciente»
  const ver = async (qs) => { await page.goto(`${C.APP}/dashboard/gestion-contratos?${qs}`, { waitUntil: "networkidle" }); return { html: await page.content(), t: norm(await C.texto(page)) }; };
  const tiene = (html, n) => html.includes(`aria-label="Contrato ${n}"`);
  let { html, t: tg } = await ver("orden=salida_asc&numero=DTM-1261");
  const fechas = Object.fromEntries(sql("select numero_contrato || '=' || coalesce(fecha_salida::text, '-') from public.ventas where numero_contrato like 'DTM-1261_' order by 1").split("\n").map((l) => l.split("=")));
  console.log("   fechas de salida en la base:", JSON.stringify(fechas), "· hoy Bogotá:", hoyBogota);
  const esperados = ["DTM-12611", "DTM-12612", "DTM-12613", "DTM-12614", "DTM-12616"].filter((n) => fechas[n] !== "-" && fechas[n] >= hoyBogota).sort((a, b) => fechas[a].localeCompare(fechas[b]));
  ok(esperados.length >= 3 && esperados.every((n) => tiene(html, n)), `A2 /dashboard/gestion-contratos?orden=salida_asc&numero=DTM-1261 muestra solo salidas de hoy (${hoyBogota}) en adelante: ${esperados.join(", ")}`, tg.slice(0, 400));
  ok(!tiene(html, "DTM-12615") && ["DTM-12611", "DTM-12616"].every((n) => esperados.includes(n) || !tiene(html, n)), "A2 NO aparecen el contrato sin fecha (DTM-12615), ni los pasados (ayer DTM-12611, muy antiguo DTM-12616)");
  const pos = esperados.map((n) => html.indexOf(`aria-label="Contrato ${n}"`));
  ok(pos.every((p, i) => p > 0 && (i === 0 || p > pos[i - 1])), "A2 la salida más próxima va primero");
  ({ html } = await ver("numero=DTM-1261"));
  ok([11, 12, 13, 14, 15, 16].every((n) => tiene(html, `DTM-126${n}`)), "A2 con el orden normal (sin salida_asc) aparecen los 6, incluidos el sin fecha y los pasados");
  ({ html } = await ver(`orden=salida_asc&numero=DTM-1261&salida_desde=${sql("select (public.fecha_negocio() - 500)::text")}`));
  ok(tiene(html, "DTM-12616") && tiene(html, "DTM-12611") && !tiene(html, "DTM-12615"), "A2 con «Viaje desde» explícito (hace 500 días) reaparecen los pasados; el sin fecha sigue fuera");
  await page.context().close();
}

// ═══ G · #126-B/C/D: buscador de hoteles, menores en unidad y grupo solo-infante (administracion@) ════════════════════════════════════════════
if (SEC.includes("G")) {
  console.log("\n══ G · #126-B/C/D (administracion@revision.test) ══");
  const { page } = await sesion("administracion@revision.test");
  const campo = (etiqueta) => page.locator(`label:text-is("${etiqueta}")`).locator("xpath=..").locator("input").first();
  const abrirTabla = async () => { await page.goto(`${C.APP}/tarifario`, { waitUntil: "networkidle" }); await page.getByRole("button", { name: "Vista tabla" }).click(); await page.getByRole("button", { name: /Porción terrestre/ }).first().click().catch(() => {}); await page.waitForTimeout(700); };
  const buscarH = async ({ destino, ida, regreso, adultos = "2", habitaciones = "1", menores = [] }) => {
    await page.locator('button[role="combobox"]').first().click(); await page.getByRole("option", { name: destino }).click();
    await page.getByRole("textbox", { name: "Ida", exact: true }).first().fill(ida); await page.getByRole("textbox", { name: "Ida", exact: true }).first().blur();
    await page.getByRole("textbox", { name: "Regreso", exact: true }).first().fill(regreso); await page.getByRole("textbox", { name: "Regreso", exact: true }).first().blur();
    await campo("Adultos").fill(adultos); await campo("Habitaciones").fill(habitaciones);
    await page.getByLabel(/Menores \(0–17 años\)/).fill(String(menores.length));
    for (let i = 0; i < menores.length; i++) await campo(`Edad menor ${i + 1}`).fill(String(menores[i]));
    await page.getByRole("button", { name: /Buscar hoteles/ }).click(); await page.waitForSelector('button:has-text("Buscar hoteles")', { timeout: 40000 }); await page.waitForTimeout(1500);
  };
  const etiquetas = async () => (await page.locator('[data-testid="etiqueta-promocion-hotel"]').allInnerTexts()).map(norm);
  await abrirTabla(); await buscarH({ destino: "DEMO 125", ida: "04/12/2026", regreso: "09/12/2026" });
  let e = await etiquetas(); ok(e.some((x) => /^Promoción PRE BF$/.test(x)), `G1 /tarifario → «Vista tabla» → destino DEMO 125 · ida 04/12/2026 · regreso 09/12/2026 · 2 adultos · 1 habitación → etiqueta «Promoción PRE BF» (${e.join(" | ") || "ninguna"})`);
  await abrirTabla(); await buscarH({ destino: "DEMO 125", ida: "02/12/2026", regreso: "07/12/2026" });
  e = await etiquetas(); ok(e.some((x) => /solo en algunas noches/.test(x)), `G1 misma búsqueda del 02/12/2026 al 07/12/2026 → la etiqueta dice «solo en algunas noches» (${e.join(" | ") || "ninguna"})`);
  await abrirTabla(); await buscarH({ destino: "DEMO 125", ida: "09/12/2026", regreso: "12/12/2026" });
  e = await etiquetas(); ok(e.length === 0, `G1 del 09/12/2026 al 12/12/2026 (fuera de la promoción) → SIN etiqueta (${e.length})`);
  await abrirTabla(); await buscarH({ destino: "CARTAGENA U1", ida: "10/06/2030", regreso: "13/06/2030", menores: [8, 2] });
  const lista = await page.locator('[data-testid="menor-unidad"]').allInnerTexts();
  ok(lista.length >= 1 && lista.every((x) => /incluido|cargo propio|paga como adulto/.test(x)), `G2 destino CARTAGENA U1 · 10/06/2030 → 13/06/2030 · 2 adultos · 1 hab · menores de 8 y 2 años → cada menor dice «incluido», «cargo propio» o «paga como adulto» (${lista.map(norm).join(" || ")})`);
  await page.screenshot({ path: join(OUT, "G2-unidad-menores.png"), fullPage: true });
  await page.goto(`${C.APP}/dashboard/paquetes/912512`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /Tarifario resultado/ }).click().catch(() => {}); await page.waitForTimeout(500);
  const cab = page.locator("button[aria-expanded]", { hasText: /Hotel Dubai 2 bases 125 ACTIVO/ }).first(); if (await cab.count()) { await cab.click(); await page.waitForTimeout(400); }
  const tg = norm(await C.texto(page));
  ok(/Solo tarifa de infante/.test(tg) && /Solo tarifa de infante · adultos en «Promoción · PRE BF DUBAI»/.test(tg) && !/BASE A · [A-Z ]+Sin tarifa doble/.test(tg), "G3 /dashboard/paquetes/912512 → «Tarifario resultado» → «Hotel Dubai 2 bases 125 ACTIVO»: «Solo tarifa de infante · adultos en «Promoción · PRE BF DUBAI»» y nunca «Sin tarifa doble»", tg.slice(-500));
  await page.context().close();
}

// ═══ B · #127 ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
if (SEC.includes("B")) {
  console.log("\n══ B · #127 (admin127@revision.test) ══");
  const { page } = await sesion("admin127@revision.test");
  const SAL = { A: "30/12/26–02/01/27", B: "26/12/26–29/12/26", D: "10/01/27–13/01/27" }, CERRADO = "GRAND SIRENIS CARTAGENA 127", OTRO = "HOTEL OTRO CARTAGENA 127";
  const buscar = async (etiqueta) => {
    await page.goto(`${C.APP}/tarifario`, { waitUntil: "networkidle" });
    const sel = page.locator("select");
    await sel.nth(3).selectOption({ label: "BOGOTÁ" }); await sel.nth(4).selectOption({ label: "CARTAGENA 127" });
    const ops = await sel.nth(5).locator("option").allTextContents();
    await sel.nth(5).selectOption({ label: ops.find((o) => o.includes(etiqueta)) }); await page.waitForTimeout(2500);
    return norm(await C.texto(page));
  };
  const visible = (t, n) => t.includes(n);
  // B0 · publicar el tarifario del paquete 12701 (botón real) — la semilla deja el paquete armado pero sin tarifario generado
  await page.goto(`${C.APP}/dashboard/paquetes/12701`, { waitUntil: "networkidle" });
  await page.getByText("Tarifario resultado", { exact: true }).first().click();
  await page.getByRole("button", { name: /Generar tarifario/ }).first().click();
  await page.waitForFunction(() => !/Generando…/.test(document.body.innerText), null, { timeout: 120000 });
  ok(Number(sql("select count(*) from public.tarifario_resultado_publicable where paquete_id = 12701 and hotel_id = 12701")) > 0, "B0 /dashboard/paquetes/12701 → «Tarifario resultado» → «Generar tarifario»: queda publicado el hotel 12701");
  let t = await buscar(SAL.A);
  ok(visible(t, CERRADO) && visible(t, OTRO), `B1 /tarifario (BOGOTÁ → CARTAGENA 127 → salida ${SAL.A}): se ofrecen ${CERRADO} y ${OTRO}`, t.slice(0, 500));
  await page.screenshot({ path: join(OUT, "B1-antes-del-cierre.png"), fullPage: true });
  // B2 · cierre general desde la pantalla real
  await page.goto(`${C.APP}/dashboard/producto/hoteles/12701`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Black out general/ }).click();
  const fechas = page.locator('input[placeholder="dd/mm/aaaa"]');
  await fechas.nth(0).fill("29/12/2026"); await fechas.nth(0).press("Tab"); await fechas.nth(1).fill("09/01/2027"); await fechas.nth(1).press("Tab");
  await page.getByRole("button", { name: "Agregar cierre" }).click();
  await page.waitForFunction(() => !/…/.test([...document.querySelectorAll("button")].map((b) => b.textContent).join("")), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1000);
  ok(sql("select count(*) from public.hotel_blackouts where hotel_id = 12701 and fecha_inicio = '2026-12-29' and fecha_fin = '2027-01-09' and total") === "1", "B2 «Black out general» 29/12/2026 → 09/01/2027 → «Agregar cierre»: cierre total guardado");
  ok(sql("select count(*) from public.tarifario_resultado_publicable where paquete_id = 12701 and hotel_id = 12701 and bloqueo_id = 12701") === "0", "B2 la estadía cerrada deja de estar publicada al guardar (sin volver a generar)");
  t = await buscar(SAL.A);
  ok(!visible(t, CERRADO) && visible(t, OTRO), `B3 salida ${SAL.A}: ${CERRADO} YA NO se ofrece; ${OTRO} sigue`, t.slice(0, 500));
  t = await buscar(SAL.B); ok(visible(t, CERRADO), `B3 salida ${SAL.B} (check-out el primer día cerrado, 29/12): ${CERRADO} sigue ofrecido`);
  t = await buscar(SAL.D); ok(visible(t, CERRADO), `B3 salida ${SAL.D} (primera noche posterior al cierre): ${CERRADO} sigue ofrecido`);
  await page.screenshot({ path: join(OUT, "B3-despues-del-cierre.png"), fullPage: true });
  await page.context().close();
}

// ═══ C · freelance (Camila Ríos Demo) ══════════════════════════════════════════════════════════════════════════════════════════════════════
if (SEC.includes("C")) {
  console.log("\n══ C · Portal B2B · freelance@revision.test (Camila Ríos Demo) ══");
  const f = await sesion("freelance@revision.test");
  let t = await ir(f.page, "/portal/b2b");
  const pestanas = await f.page.locator("nav a").allInnerTexts().catch(() => []);
  ok(/DTM-96701/.test(t) && /Panel del aliado/.test(t), "C0 /portal/b2b: Camila ve su contrato DTM-96701 y el panel del aliado", t);
  ok(/396\.000/.test(t), "C0 el panel muestra «Comisión por cobrar $ 396.000»", t);
  ok(!/Agentes/.test(t.slice(0, 300)), "C0 un freelance NO ve la pestaña «Agentes»");
  // C1 · cuenta de cobro sin aceptar (valores a mano)
  t = await ir(f.page, "/portal/comision/DTM-96701");
  ok(/CUENTA DE COBRO/.test(t) && /Versión sin aceptar/.test(t), "C1 /portal/comision/DTM-96701: CUENTA DE COBRO «Versión sin aceptar»", t);
  ok(["5.000.000", "4.000.000", "11.00%", "440.000", "44.000", "396.000"].every((x) => t.includes(x)), "C1 PVP 5.000.000 · base 4.000.000 · 11 % · comisión 440.000 · retención 44.000 · total a cobrar 396.000");
  ok(/Trescientos noventa y seis mil pesos/.test(t), "C1 el total sale también en letras");
  ok(/Bancolombia/.test(t) && /00096701234/.test(t), "C1 datos de pago de Camila (Bancolombia · Ahorros · 00096701234)");
  ok(await f.page.getByRole("button", { name: "Aceptar y firmar esta versión" }).count() === 0, "C1 sin firma subida aún no se puede aceptar (no hay botón)");
  await f.page.screenshot({ path: join(OUT, "C1-cuenta-sin-aceptar.png"), fullPage: true });
  // C2 · Mi perfil: firma y logo (archivos de muestra)
  const muestras = `${process.env.LOCALAPPDATA}/dspacios-local-revision-int/muestras`;
  await ir(f.page, "/portal/b2b/perfil");
  await f.page.locator('input[type="file"]:not(#logo-aliado-archivo)').first().setInputFiles(`${muestras}/firma-camila.png`);
  await f.page.getByRole("button", { name: /Subir firma|Reemplazar firma/ }).click();
  ok(await f.page.getByText("Firma guardada.").waitFor({ timeout: 20000 }).then(() => true).catch(() => false), "C2 /portal/b2b/perfil → «Subir firma» (firma-camila.png) → «Firma guardada.»");
  await f.page.locator("#logo-aliado-archivo").setInputFiles(`${muestras}/logo-camila.png`);
  ok(await f.page.getByText("Logo actualizado.").waitFor({ timeout: 20000 }).then(() => true).catch(() => false), "C2 «Subir logo» (logo-camila.png) → «Logo actualizado.»");
  await f.page.screenshot({ path: join(OUT, "C2-perfil-firma-logo.png"), fullPage: true });
  // C3 · aceptar y firmar
  await ir(f.page, "/portal/comision/DTM-96701");
  await f.page.locator('input[type="checkbox"]').first().check();
  await f.page.getByRole("button", { name: "Aceptar y firmar esta versión" }).click();
  ok(await f.page.getByText(/Aceptación electrónica — versión 1/).waitFor({ timeout: 20000 }).then(() => true).catch(() => false), "C3 «Aceptar y firmar esta versión» → «Aceptación electrónica — versión 1»");
  t = norm(await C.texto(f.page));
  ok(/No es una firma digital certificada/.test(t) && /396\.000/.test(t), "C3 el documento aclara que NO es firma digital certificada y congela 396.000");
  ok(await f.page.locator('[data-firma="aceptada"] img').count() === 1, "C3 la imagen de la firma se ve en el documento");
  ok(sql("select count(*) from public.cuenta_cobro_aceptaciones") === "1", "C3 una sola aceptación registrada (recargar no duplica)");
  await f.page.reload({ waitUntil: "networkidle" });
  ok(sql("select count(*) from public.cuenta_cobro_aceptaciones") === "1", "C3 tras recargar sigue habiendo UNA aceptación");
  await f.page.screenshot({ path: join(OUT, "C3-cuenta-aceptada.png"), fullPage: true });
  // C4 · aislamiento entre freelances y agencia
  const f2 = await sesion("freelance2@revision.test");
  t = await ir(f2.page, "/portal/comision/DTM-96701");
  ok(!/CUENTA DE COBRO/.test(t) || /no tienes acceso|No encontramos|no existe/i.test(t), "C4 freelance2@ (Beto) NO puede abrir la cuenta de cobro de Camila", t.slice(0, 300));
  t = await ir(f2.page, "/portal/b2b");
  ok(!/DTM-96701/.test(t) && /DTM-96702/.test(t), "C4 Beto ve DTM-96702 y no DTM-96701");
  t = await ir(f.page, "/portal/comision/DTM-96702");
  ok(!/CUENTA DE COBRO/.test(t) || /no tienes acceso|No encontramos|no existe/i.test(t), "C4 Camila NO puede abrir la cuenta de cobro de Beto", t.slice(0, 300));
  // C5 · historial: gerencia corrige el teléfono y Camila lo ve en «Historial de tus datos»
  const g = await sesion("gerencia@revision.test");
  await ir(g.page, "/dashboard/aliados");
  const fila = g.page.locator("tr", { hasText: "Camila Ríos Demo" });
  ok(await fila.count() >= 1, "C5 gerencia@: /dashboard/aliados lista «Camila Ríos Demo»");
  await fila.first().locator("button").first().click();                                   // despliega «Datos de pago» de la fila
  await g.page.getByRole("button", { name: "Corregir", exact: true }).first().click();
  await g.page.locator("#cor-tel-96701").fill("+573009990000");
  await g.page.getByRole("button", { name: "Guardar corrección" }).click(); await g.page.waitForTimeout(2500);
  ok(sql("select telefono from public.aliados where id = 96701") === "+573009990000", "C5 gerencia corrige el teléfono de la ficha a +573009990000");
  t = await ir(f.page, "/portal/b2b/perfil");
  ok(/Historial de tus datos/.test(t) && /\+573001234567/.test(t) && /\+573009990000/.test(t), "C5 Camila ve en «Historial de tus datos»: Teléfono +573001234567 → +573009990000", t.slice(-600));
  ok(!/00096701234/.test(t.slice(t.indexOf("Historial"))), "C5 el historial nunca muestra el número de cuenta completo");
  const a = await sesion("administracion@revision.test");
  await ir(a.page, "/dashboard/aliados");
  await a.page.locator("tr", { hasText: "Camila Ríos Demo" }).first().locator("button").first().click(); await a.page.waitForTimeout(500);
  await a.page.getByRole("button", { name: "Corregir", exact: true }).first().click();
  await a.page.locator("#cor-tel-96701").fill("+57 300 000 0000");
  await a.page.getByRole("button", { name: "Guardar corrección" }).click();
  const aviso = await a.page.locator('[role="status"],[role="alert"]').filter({ hasText: /.+/ }).first().innerText({ timeout: 20000 }).catch(() => "(sin mensaje)");
  ok(sql("select telefono from public.aliados where id = 96701") === "+573009990000", `C5 administracion@ intenta corregir la ficha y la base la rechaza (el teléfono no cambia). Mensaje: «${norm(aviso).slice(0, 110)}»`);
  // C6 · #78 solicitar contrato → aviso a administración
  t = await ir(f.page, "/portal/b2b/cotizaciones");
  ok(/C-REV78/.test(t) && /1\.800\.000/.test(t), "C6 /portal/b2b/cotizaciones (Directas): C-REV78 por $ 1.800.000", t);
  await f.page.screenshot({ path: join(OUT, "C6-cotizaciones-antes.png"), fullPage: true });
  await f.page.locator("tr", { hasText: "C-REV78" }).getByRole("button", { name: "Solicitar contrato" }).click();
  ok(await f.page.getByText(/Contrato solicitado/).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false), "C6 «Solicitar contrato» → «Contrato solicitado»");
  ok(sql("select count(*) || '/' || max(estado) from public.cotizacion_solicitudes_contrato where cotizacion_id = (select id from public.cotizaciones where codigo = 'C-REV78')") === "1/solicitada", "C6 un evento «solicitada»");
  ok(sql("select count(*) from public.avisos where tipo = 'solicitud_contrato' and usuario_id = (select id from public.usuarios where email = 'administracion@revision.test')") === "1", "C6 el aviso llegó SOLO a administracion@ (el responsable configurado)");
  ok(sql("select count(*) from public.avisos where tipo = 'solicitud_contrato' and usuario_id <> (select id from public.usuarios where email = 'administracion@revision.test')") === "0", "C6 nadie más recibió el aviso");
  await ir(a.page, "/dashboard");
  const campana = a.page.getByRole("button", { name: /aviso|notificaci/i }).first();
  const cnt = await campana.count();
  ok(cnt >= 1, "C6 administracion@: la campana de avisos existe en el panel");
  if (cnt) { await campana.click(); await a.page.waitForTimeout(800); t = norm(await C.texto(a.page)); ok(/Solicitud de contrato de un aliado: cotización C-REV78/.test(t), "C6 la campana dice «Solicitud de contrato de un aliado: cotización C-REV78»", t.slice(0, 600)); await a.page.screenshot({ path: join(OUT, "C6-campana.png") }); }
  const idc = sql("select id from public.cotizaciones where codigo = 'C-REV78'");
  t = await ir(a.page, `/dashboard/cotizaciones/${idc}`);
  ok(/C-REV78/.test(t), `C6 el aviso enlaza a /dashboard/cotizaciones/${idc}`, t);
  const b2 = await sesion("freelance2@revision.test");
  t = await ir(b2.page, "/portal/b2b/cotizaciones");
  ok(!/C-REV78/.test(t), "C6 Beto no ve la cotización de Camila");
  // C7 · logo en la cotización pública de Camila
  const tok = sql("select share_token from public.cotizaciones where codigo = 'C-0006'");
  const pub = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const pp = await pub.newPage();
  await pp.goto(`${C.APP}/cot/${tok}`, { waitUntil: "networkidle" }); t = norm(await C.texto(pp));
  ok(/Cotización presentada por/.test(t) && /Camila Ríos Demo/.test(t), `C7 /cot/${tok}: «Cotización presentada por Camila Ríos Demo» con el logo`, t.slice(0, 500));
  ok(await pp.locator(`img[src*="/cot/${tok}/logo"]`).count() >= 1, "C7 el logo de Camila aparece en la cotización pública");
  ok(/902076052/.test(t) || /RNT/.test(t), "C7 el emisor legal (agencia) sigue identificado con NIT/RNT");
  await pp.screenshot({ path: join(OUT, "C7-cotizacion-publica-logo.png"), fullPage: true });
  // C8 · clientes (#76/#77)
  t = await ir(f.page, "/portal/b2b/clientes");
  ok(/Ana Gómez/.test(t) && /1 contrato/.test(t), "C8 /portal/b2b/clientes: «Ana Gómez · 1 contrato» (de DTM-96701)", t);
  await f.page.getByRole("button", { name: "Agregar cliente" }).first().click();
  await f.page.waitForTimeout(500);
  await f.page.locator("#nom-n").fill("Cliente Demo de Camila");
  await f.page.locator("#tel-n").fill("3105550101");
  await f.page.locator("#em-n").fill("cliente.demo@revision.test");
  await f.page.locator('input[type="checkbox"]').first().check();   // autorización del cliente para guardar sus datos
  await f.page.getByRole("button", { name: "Guardar cliente" }).first().click();
  ok(await f.page.getByText("Cliente Demo de Camila").first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false), "C8 «Guardar cliente» → «Cliente Demo de Camila» aparece en su lista");
  t = await ir(f2.page, "/portal/b2b/clientes");
  ok(!/Cliente Demo de Camila|Ana Gómez/.test(t), "C8 Beto no ve los clientes de Camila");
  const s = await sesion("superadmin@revision.test");
  t = await ir(s.page, "/crm/clientes-aliados");
  ok(/Cliente Demo de Camila|Camila Ríos Demo/.test(t), "C8 superadmin@: /crm/clientes-aliados muestra los clientes del aliado", t.slice(0, 500));
  await f.page.context().close();
}

// ═══ D · agencia (aliado@) ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
if (SEC.includes("D")) {
  console.log("\n══ D · Agencia · aliado@revision.test (Rev Aliado Uno) ══");
  const ag = await sesion("aliado@revision.test");
  let t = await ir(ag.page, "/portal/b2b");
  ok(/DTM-96703/.test(t), "D1 /portal/b2b: la agencia ve DTM-96703", t);
  ok(await ag.page.locator("nav a", { hasText: "Agentes" }).count() >= 1 || /Agentes/.test(t), "D1 el titular de agencia ve la pestaña «Agentes»");
  t = await ir(ag.page, "/portal/comision/DTM-96703");
  ok(/agencia \(persona jurídica\)/.test(t) && /factura electrónica/.test(t), "D2 /portal/comision/DTM-96703: «Las agencias deben enviar su factura electrónica… no una cuenta de cobro»", t);
  ok(!/Aceptar y firmar/.test(t), "D2 la agencia NO puede aceptar/firmar");
  t = await ir(ag.page, "/portal/b2b/perfil");
  ok(!/Mi firma/.test(t), "D3 el perfil de la agencia NO tiene la sección «Mi firma»", t.slice(0, 500));
  // D4 · cruce #126 ↔ B2B: los pagos USD de DTM-12601 (registrados en A1) se ven en USD en el portal de la agencia, sin equivalentes en pesos
  if (SEC.includes("A")) {
    t = await ir(ag.page, "/portal/b2b/cartera?vista=pagos");
    ok(t.includes("DTM-12601") && t.includes("USD $700") && t.includes("USD $300") && t.includes("USD $0"), "D4 /portal/b2b/cartera?vista=pagos: DTM-12601 con «USD $700» y «USD $300», saldo «USD $0»", t.slice(0, 700));
    ok(!/1\.230\.000|2\.940\.000|4\.170\.000/.test(t), "D4 el portal no mezcla los equivalentes en pesos (1.230.000 / 2.940.000 / 4.170.000)");
    const rec = await ag.page.locator("a").evaluateAll((as) => as.filter((a) => { let n = a; for (let i = 0; i < 6 && n; i++, n = n.parentElement) { const x = n.textContent || ""; if (/DTM-\d+/.test(x)) return x.match(/DTM-\d+/g).every((y) => y === "DTM-12601"); } return false; }).map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/recibo/")));
    ok(rec.length === 2, `D4 dos recibos de DTM-12601 (${rec.join(", ")})`);
    for (const h of rec.slice(0, 2)) { const tr = await ir(ag.page, h); ok(/USD/.test(tr) && !/4\.170\.000/.test(tr), `D4 el recibo ${h} se emite en USD`, tr.slice(0, 300)); }
  }
  await ag.page.context().close();
}

// ═══ F · responsive de las pantallas de la guía (1280 / 820 / 390): sin desborde horizontal ═══════════════════════════════════════════════
if (SEC.includes("F")) {
  console.log("\n══ F · Responsive ══");
  const tok = sql("select share_token from public.cotizaciones where codigo = 'C-0006'");
  const casos = [
    ["freelance@revision.test", ["/portal/b2b", "/portal/b2b/perfil", "/portal/comision/DTM-96701", "/portal/b2b/cotizaciones", "/portal/b2b/clientes", "/portal/b2b/cartera?vista=pagos", `/cot/${tok}`]],
    ["aliado@revision.test", ["/portal/b2b", "/portal/comision/DTM-96703"]],
    ["superadmin@revision.test", ["/dashboard/gestion-contratos?orden=salida_asc&numero=DTM-1261", "/dashboard/contratos/DTM-12601", "/dashboard/usuarios/b2b"]],
    ["admin127@revision.test", ["/dashboard/producto/hoteles/12701"]],
  ];
  for (const [vw, vista] of [[1280, "escritorio"], [820, "intermedio"], [390, "movil"]]) {
    for (const [email, rutas] of casos) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: vw === 390 ? 844 : 900 }, isMobile: vw === 390, hasTouch: vw === 390, locale: "es-CO" });
      const p = await ctx.newPage(); await C.iniciarSesionUI(p, email);
      for (const r of rutas) { await p.goto(C.APP + r, { waitUntil: "networkidle" }); ok(await C.sinDesborde(p), `F ${vw}px ${email} ${r.slice(0, 60)}: sin desborde horizontal`); }
      await ctx.close();
    }
  }
}

// ═══ E · registro de aliados nuevos (#62 / B5–B6) ══════════════════════════════════════════════════════════════════════════════════════════
if (SEC.includes("E")) {
  console.log("\n══ E · Registro B2B (visitante sin sesión) ══");
  const X = (t) => `xpath=//label[normalize-space()="${t}"]`;
  const mails = async (para) => ((await (await fetch(`${MAIL}/api/v1/messages`)).json()).messages ?? []).filter((m) => (m.To ?? []).some((x) => x.Address === para)).sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
  const codigo = async (para, antes) => { for (let i = 0; i < 40; i++) { const l = await mails(para); if (l.length > antes) { const c = await (await fetch(`${MAIL}/api/v1/message/${l[0].ID}`)).json(); const m = ((c.Text ?? "") + " " + (c.HTML ?? "")).match(/\b(\d{6})\b/); if (m) return m[1]; } await new Promise((r) => setTimeout(r, 300)); } return null; };
  const llenar = async (page, { nombre, doc, email, clave }) => {
    await page.locator(`${X("Tipo de aliado")}/following-sibling::select[1]`).selectOption("freelance");
    await page.locator(`${X("Nombre / Razón social *")}/following-sibling::input[1]`).fill(nombre);
    await page.locator(`${X("Tipo de documento *")}/following-sibling::select[1]`).selectOption("CC");
    await page.locator(`${X("Número de documento *")}/following-sibling::input[1]`).fill(doc);
    await page.locator(`${X("Correo *")}/following-sibling::input[1]`).fill(email);
    await page.locator(`${X("Contraseña *")}/following-sibling::input[1]`).fill(clave);
    await page.locator(`${X("Repetir contraseña *")}/following-sibling::input[1]`).fill(clave);
    await page.getByRole("button", { name: "Continuar: enviar código al correo" }).click();
  };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
  // E1 · la entrada real: el enlace del login
  await p.goto(`${C.APP}/login`, { waitUntil: "networkidle" });
  await p.getByRole("link", { name: "Solicitar acceso B2B" }).click(); await p.waitForURL(/\/portal\/registro/, { timeout: 20000 });
  ok(/\/portal\/registro$/.test(p.url()), "E1 /login → enlace «Solicitar acceso B2B» → /portal/registro");
  // E2 · continuar un registro ya verificado (continuar@revision.test: verificado, sin solicitud)
  ok(sql("select count(*) from public.b2b_solicitudes where lower(email) = 'continuar@revision.test'") === "0", "E2 continuar@revision.test está verificado y SIN solicitud");
  await llenar(p, { nombre: "Aliado Continuar Demo", doc: "1010101010", email: "continuar@revision.test", clave: "ClaveContinuar-2026" });
  ok(await p.getByTestId("paso-continuar").waitFor({ timeout: 25000 }).then(() => true).catch(() => false), "E2 al reenviar el formulario con ese correo aparece «Continúa tu registro»");
  const tc = norm(await C.texto(p));
  ok(/Continúa tu registro/.test(tc) && /ya está verificado/.test(tc) && /continuar@revision\.test/.test(tc), "E2 el texto dice que el correo ya está verificado y pide la contraseña del registro", tc.slice(-400));
  await p.locator("#continuar-password").fill("ClaveEquivocada9");
  await p.getByRole("button", { name: "Continuar y enviar solicitud" }).click(); await p.waitForTimeout(1800);
  ok(/No pudimos confirmar tu identidad/.test(norm(await C.texto(p))) && sql("select count(*) from public.b2b_solicitudes where lower(email) = 'continuar@revision.test'") === "0", "E2 contraseña equivocada → «No pudimos confirmar tu identidad…» y NO se crea solicitud (saber el correo no basta)");
  await p.locator("#continuar-password").fill("ClaveContinuar-2026");
  await p.getByRole("button", { name: "Continuar y enviar solicitud" }).click();
  ok(await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 }).then(() => true).catch(() => false), "E2 contraseña correcta («ClaveContinuar-2026») → «¡Solicitud enviada! Revisaremos tu registro…»");
  ok(sql("select count(*) from public.b2b_solicitudes where lower(email) = 'continuar@revision.test'") === "1", "E2 queda UNA solicitud y la cuenta sigue verificada");
  await p.screenshot({ path: join(OUT, "E2-continuacion.png") });
  // E3 · registro nuevo con código escrito a mano: se espera 30 s (más que los 20 s del entorno automatizado) antes de teclearlo
  const mailsAntes = (await mails("nuevo.aliado@revision.test")).length;
  await p.goto(`${C.APP}/portal/registro`, { waitUntil: "networkidle" });
  await llenar(p, { nombre: "Aliado Nuevo Demo", doc: "1020202020", email: "nuevo.aliado@revision.test", clave: "ClaveNueva-2026" });
  ok(await p.getByTestId("paso-codigo").waitFor({ timeout: 25000 }).then(() => true).catch(() => false), "E3 paso del código: «Verificar y enviar solicitud»");
  const cod = await codigo("nuevo.aliado@revision.test", mailsAntes);
  ok(!!cod && /^\d{6}$/.test(cod), `E3 el código de 6 dígitos llegó al correo de pruebas (${MAIL}): ${cod}`);
  await p.waitForTimeout(30000);
  await p.locator("#codigo-correo").fill("000000"); await p.getByRole("button", { name: "Verificar y enviar solicitud" }).click(); await p.waitForTimeout(1800);
  ok(/no es válido|incorrect|inválid/i.test(norm(await C.texto(p))) || (await p.locator('p[role="alert"]').count()) >= 1, "E3 un código equivocado se rechaza con mensaje");
  await p.locator("#codigo-correo").fill(cod); await p.getByRole("button", { name: "Verificar y enviar solicitud" }).click();
  ok(await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 }).then(() => true).catch(() => false), "E3 el código correcto escrito 30 s después (vigencia 600 s) se acepta → «Revisaremos tu registro»");
  ok(sql("select count(*) from public.b2b_solicitudes where lower(email) = 'nuevo.aliado@revision.test'") === "1", "E3 una solicitud pendiente para nuevo.aliado@revision.test");
  // E4 · aprobación del personal: «Aprobaciones B2B»
  const adm = await sesion("administracion@revision.test");
  const ta = await ir(adm.page, "/dashboard/usuarios/b2b");
  ok(/Aprobaciones B2B/.test(ta) && /Aliado Continuar Demo/.test(ta) && /Aliado Nuevo Demo/.test(ta), "E4 administracion@: /dashboard/usuarios/b2b lista «Aliado Continuar Demo» y «Aliado Nuevo Demo» pendientes", ta.slice(0, 600));
  await adm.page.screenshot({ path: join(OUT, "E4-aprobaciones.png"), fullPage: true });
  await ctx.close();
}

await browser.close();
console.log(`\n=== guion: ${aciertos} OK, ${fallos} FALLO`);
process.exit(fallos ? 1 : 0);
