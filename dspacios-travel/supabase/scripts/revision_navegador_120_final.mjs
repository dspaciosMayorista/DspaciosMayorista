// Revisión FINAL en navegador REAL (Chrome local vía Playwright) del cierre de #120: campo «Adultos que viajan» (1 adulto + 1 niño en una doble), formulario de valoración en los dos modos,
// línea «Ajuste de redondeo del reparto del hotel» en la cotización (/cot/[token], /cotizacion/[id], ficha interna) y en el contrato (ficha y documento), a 390 px y a 1280 px, y conteo REAL
// de pasajeros y sillas (base + DOM). App local + PostgREST local. Solo pruebas locales.
// Uso: node supabase/scripts/revision_navegador_120_final.mjs <url_app> <carpeta_capturas> <archivo_env> <contenedor_pg> <base>
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const [base, salida, archivoEnv, ct, db] = process.argv.slice(2);
fs.mkdirSync(salida, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(archivoEnv, "utf8").split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", ct, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", db, "-X", "-q", "-t", "-A"], { input: q, encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
const ok = (cond, m) => { console.log(`${cond ? "OK   " : "FALLA"} ${m}`); if (!cond) process.exitCode = 1; };
const capturas = [];
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const consola = [];
const sesionJson = { access_token: env.NAV_USER_JWT, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "00000000-0000-0000-0000-000000270001", aud: "authenticated", role: "authenticated", email: "super270@x.test" } };
const cookie = { name: "sb-127-auth-token", value: "base64-" + Buffer.from(JSON.stringify(sesionJson)).toString("base64url"), url: base };
async function sesion(ancho, alto, tag, conCookie) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto } });
  if (conCookie) await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !/medicion-error/.test(m.text())) consola.push(`[${tag}] ${m.type()}: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => consola.push(`[${tag}] pageerror: ${String(e).slice(0, 200)}`));
  page.on("response", (r) => { if (r.status() >= 400 && !/_next\/static|favicon|\/auth\/v1/.test(r.url())) consola.push(`[${tag}] HTTP ${r.status()} ${r.url().slice(0, 140)}`); });
  return { ctx, page };
}
let n = 0;
async function shot(page, nombre, muestra, opts = {}) {
  n += 1;
  const ruta = path.resolve(salida, `${String(n).padStart(2, "0")}_${nombre}.png`);
  await page.screenshot({ path: ruta, fullPage: opts.fullPage ?? false });
  capturas.push({ ruta, muestra });
  console.log(`CAPTURA ${ruta} :: ${muestra}`);
}
async function shotTabla(page, nombre, muestra) {
  const t = page.locator("table", { hasText: "Ajuste por redondeo" }).first();
  if (!(await t.count())) return;
  n += 1;
  const ruta = path.resolve(salida, `${String(n).padStart(2, "0")}_${nombre}_tabla_valores.png`);
  await t.scrollIntoViewIfNeeded();
  await t.screenshot({ path: ruta });
  capturas.push({ ruta, muestra });
  console.log(`CAPTURA ${ruta} :: ${muestra}`);
}
const idPorDoc = (doc) => Number(sql(`select id from public.cotizaciones where cliente_documento = '${doc}' order by id desc limit 1`));
const cuentas = (numero) => JSON.parse(sql(`select json_build_object('pasajeros', (select count(*) from public.contrato_pasajeros where numero_contrato = '${numero}'), 'sillas', (select count(*) from public.sillas where numero_contrato = '${numero}'),
  'ajuste_items', (select count(*) from public.contrato_items where numero_contrato = '${numero}' and descripcion like 'Ajuste de redondeo%'), 'cxp', (select count(*) from public.cuentas_por_pagar where numero_contrato = '${numero}'),
  'precio', (select precio_venta from public.ventas where numero_contrato = '${numero}'), 'pax', (select pax from public.ventas where numero_contrato = '${numero}'))`));
const llenarCliente = async (d, nombre, doc) => {
  await d.getByLabel("Nombres").fill(nombre); await d.getByLabel("Apellidos").fill("Navegador"); await d.getByLabel("Número de documento").fill(doc); await d.getByLabel("WhatsApp / teléfono").fill("3001112233");
};

// ── A. Tarjeta pública: «Adultos que viajan» con 1 adulto + 1 niño en una doble (1280 y 390) ───────────────────────────────────────────────────────────────
async function solicitudPublica(ancho, tag, doc, { adultos, edades, capturar, hotelId = 7201 }) {
  const { ctx, page } = await sesion(ancho, ancho >= 1000 ? 900 : 844, tag);
  await page.goto(`${base}/tarifario`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.getByTestId(`solicitud-hotel-${hotelId}`).getByRole("button", { name: "Solicitar cotización" }).click();
  const d = page.getByRole("dialog"); await d.waitFor();
  ok((await d.getByTestId("solicitud-adultos").count()) === 0, `${tag}: sin edades de menores NO se muestra el campo «Adultos que viajan»`);
  await d.getByPlaceholder("3, 7").fill(edades);
  await d.getByTestId("solicitud-adultos").waitFor({ timeout: 15000 });
  await page.locator('[data-testid="aviso-ocupacion"]').waitFor({ timeout: 15000 });
  const sinDeclarar = await page.locator('[data-testid="aviso-ocupacion"]').innerText();
  ok(/2 adulto\(s\), 1 niño\(s\) y 0 infante\(s\)/.test(sinDeclarar), `${tag}: sin declarar adultos el aviso cuenta las plazas de la doble: «${sinDeclarar}»`);
  if (capturar) await shot(page, `${tag}_adultos_antes`, `Tarjeta pública a ${ancho}px: edad del niño (7) escrita, campo «Adultos que viajan» visible y vacío; el aviso cuenta 2 adultos (plazas de la doble) + 1 niño.`);
  if (adultos != null) {
    await d.getByTestId("solicitud-adultos").fill(String(adultos));
    await page.waitForFunction(() => /1 adulto\(s\), 1 niño\(s\) y 0 infante\(s\)/.test(document.querySelector('[data-testid="aviso-ocupacion"]')?.textContent ?? ""), null, { timeout: 15000 });
    const verde = await page.locator('[data-testid="aviso-ocupacion"]').innerText();
    ok(/1 adulto\(s\), 1 niño\(s\) y 0 infante\(s\)/.test(verde) && (await page.locator('[data-testid="aviso-ocupacion"]').getAttribute("role")) === "status", `${tag}: con «Adultos que viajan» = 1 el aviso verde dice «${verde}» (2 personas, no 3)`);
    if (capturar) await shot(page, `${tag}_adultos_1`, `Tarjeta pública a ${ancho}px: «Adultos que viajan» = 1 con 1 niño en una doble; aviso verde «1 adulto(s), 1 niño(s) y 0 infante(s)» (2 viajeros).`);
  }
  await d.locator("select").first().selectOption({ index: 1 });
  await llenarCliente(d, `Cliente${doc}`, doc);
  await d.getByRole("button", { name: "Enviar solicitud" }).click();
  await page.locator('[data-testid="solicitud-enviada"]').waitFor({ timeout: 60000 });
  await ctx.close();
}
await solicitudPublica(1280, "publico1280_S1", "120001", { adultos: 1, edades: "7", capturar: true });   // S1: 1 adulto + 1 niño
await solicitudPublica(1280, "publico1280_S3", "120003", { adultos: null, edades: "7", capturar: false }); // S3: 2 adultos + 1 niño (las plazas de la doble)
await solicitudPublica(390, "publico390_S2", "120002", { adultos: 1, edades: "7", capturar: true });      // S2: 1 adulto + 1 niño
const [S1, S2, S3] = [idPorDoc("120001"), idPorDoc("120002"), idPorDoc("120003")];
const pl = (id) => JSON.parse(sql(`select json_build_object('adultosReales', payload->'adultosReales', 'edades', payload->'edadesMenores', 'estado', estado) from public.cotizaciones where id = ${id}`));
ok(pl(S1).adultosReales === 1 && pl(S2).adultosReales === 1 && pl(S3).adultosReales === null, `payload de la solicitud: S1 y S2 guardan adultosReales = 1; S3 no declara (${JSON.stringify([pl(S1), pl(S2), pl(S3)])})`);

// ── B. Valoración (operador) en los dos modos, a 1280 y a 390 ─────────────────────────────────────────────────────────────────────────────────────────
async function valorar(page, id, { modo, neta, na, nn, tag }) {
  await page.goto(`${base}/dashboard/cotizaciones/${id}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1200);
  const conteos = await page.locator('[data-testid="neta-conteos"]').innerText();
  console.log(`${tag}: conteos del formulario «${conteos}»`);
  await page.locator("#neta-hotel").fill(neta);
  if (modo === "adultos") {
    await shot(page, `${tag}_adultos`, `Formulario de valoración (${tag}) con «Cargar hotel a los adultos» seleccionado; conteos «${conteos}».`, { fullPage: true });
  } else {
    await shot(page, `${tag}_adultos_default`, `Formulario de valoración (${tag}) antes de elegir: «Cargar hotel a los adultos» por defecto; conteos «${conteos}».`, { fullPage: true });
    await page.getByLabel(/Distribuir/).check();
    await page.locator("#neta-adulto").fill(na);
    await page.locator("#neta-nino").fill(nn);
    const cuadre = await page.locator('[data-testid="neta-cuadre"]').innerText();
    ok(/cuadra/.test(cuadre) && !/faltan|sobran/.test(cuadre), `${tag}: la distribución cuadra: «${cuadre}»`);
    ok(await page.locator('[data-testid="neta-total-igual"]').isVisible(), `${tag}: el formulario avisa que el total vendido no cambia al distribuir`);
    await shot(page, `${tag}_distribuir`, `Formulario de valoración (${tag}) en «Distribuir»: neta por adulto y por niño, comprobación de la suma y aviso de que el total no cambia; conteos «${conteos}».`, { fullPage: true });
  }
  await page.getByRole("button", { name: "Cargar neta y valorar" }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="neta-solicitud-form"]'), null, { timeout: 90000 });
  await page.waitForTimeout(800);
  return conteos;
}
{
  const { ctx, page } = await sesion(1280, 1000, "operador1280", true);
  const c1 = await valorar(page, S1, { modo: "adultos", neta: "1200000", tag: "oper1280_S1_1adulto" });
  ok(/1\s*adulto\(s\)\s*·\s*1\s*niño\(s\)\s*·\s*0\s*infante\(s\)/.test(c1), `S1: el formulario de valoración cuenta 1 adulto · 1 niño · 0 infantes («${c1}»)`);
  await shot(page, "oper1280_S1_ficha_valorada", "Ficha interna de la cotización S1 (modo «Cargar hotel a los adultos», 1 adulto + 1 niño): sin línea de ajuste.", { fullPage: true });
  const c3 = await valorar(page, S3, { modo: "distribuir", neta: "1000800", na: "400000", nn: "200800", tag: "oper1280_S3_2adultos" });
  ok(/2\s*adulto\(s\)\s*·\s*1\s*niño\(s\)\s*·\s*0\s*infante\(s\)/.test(c3), `S3: el formulario cuenta 2 adultos · 1 niño · 0 infantes («${c3}»)`);
  await shot(page, "oper1280_S3_ficha_ajuste_positivo", "Ficha interna de la cotización S3 (Distribuir, 2 adultos + 1 niño): línea «Ajuste de redondeo del reparto del hotel» de +$1.000 entre los ítems; el total es el de «adultos».", { fullPage: true });
  await ctx.close();
}
{
  const { ctx, page } = await sesion(390, 844, "operador390", true);
  await valorar(page, S2, { modo: "distribuir", neta: "1200000", na: "701000", nn: "499000", tag: "oper390_S2_1adulto" });
  await shot(page, "oper390_S2_ficha_ajuste_negativo", "Ficha interna de la cotización S2 a 390px (Distribuir, 1 adulto + 1 niño): línea «Ajuste de redondeo del reparto del hotel» de −$1.000.", { fullPage: true });
  await ctx.close();
}
const val = (id) => JSON.parse(sql(`select json_build_object('estado', c.estado, 'precio', c.precio_venta, 'modo', t.modo, 'adultos', t.adultos, 'ninos', t.ninos, 'infantes', t.infantes, 'token', c.share_token,
  'ajuste', (select (i->>'tarifa_adulto')::numeric * (i->>'adultos')::numeric from jsonb_array_elements(c.detalle->'items') i where i->>'descripcion' like 'Ajuste de redondeo%' limit 1)) from public.cotizaciones c join public.cotizacion_tarifa_solicitud t on t.cotizacion_id = c.id where c.id = ${id}`));
const [v1, v2, v3] = [val(S1), val(S2), val(S3)];
console.log("VALORADAS", JSON.stringify({ S1: v1, S2: { ...v2, token: "…" }, S3: { ...v3, token: "…" } }));
ok(v1.estado === "abierta" && v1.modo === "adultos" && v1.adultos === 1 && v1.ninos === 1 && v1.ajuste === null, "S1 valorada: modo adultos, 1 adulto + 1 niño, sin ajuste");
ok(v2.estado === "abierta" && v2.modo === "distribuir" && v2.adultos === 1 && v2.ninos === 1 && Number(v2.ajuste) === -1000, "S2 valorada: distribuir, 1 adulto + 1 niño, ajuste −1.000");
ok(v3.estado === "abierta" && v3.modo === "distribuir" && v3.adultos === 2 && v3.ninos === 1 && Number(v3.ajuste) === 1000, "S3 valorada: distribuir, 2 adultos + 1 niño, ajuste +1.000");

// ── C. Cotización: /cot/[token] (público), /cotizacion/[id] (operador), a 1280 y 390 ────────────────────────────────────────────────────────────────
async function documentoCotizacion(ancho, tag, url, conCookie, esperado) {
  const { ctx, page } = await sesion(ancho, ancho >= 1000 ? 1000 : 844, tag, conCookie);
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1000);
  const texto = await page.locator("body").innerText();
  const lineas = texto.split("\n").filter((l) => /Ajuste por redondeo/.test(l));
  ok(lineas.length === 1, `${tag}: la línea «Ajuste por redondeo» aparece UNA vez: «${lineas[0] ?? ""}»`);
  ok(/^Ajuste por redondeo\s+—\s+—\s+—\s+—\s+-?\$\s?1\.000$/.test((lineas[0] ?? "").trim()), `${tag}: la línea trae «—» en Adultos, Niños y tarifas y el importe solo en «Valor total»: «${(lineas[0] ?? "").trim()}»`);
  ok(!/reparto del hotel/i.test(texto), `${tag}: el documento de cliente no menciona «reparto del hotel»`);
  ok(!/Pasajero\s*3|3\s+pasajeros/i.test(texto) || esperado.pasajeros >= 3, `${tag}: no aparece un tercer pasajero`);
  await shot(page, tag, esperado.muestra, { fullPage: true });
  await shotTabla(page, tag, `Recorte de la tabla de valores del documento (${tag}): ítems, importes y la línea «Ajuste por redondeo».`);
  const tablas = await page.locator("table").evaluateAll((ts) => ts.map((t) => ({ cabecera: (t.querySelector("thead")?.textContent ?? "").replace(/\s+/g, " ").slice(0, 90), filas: t.querySelectorAll("tbody tr").length, texto: t.textContent.replace(/\s+/g, " ").slice(0, 400) })));
  console.log(`${tag}: tablas ${JSON.stringify(tablas.map((t) => [t.cabecera, t.filas]))}`);
  await ctx.close();
  return { texto, tablas };
}
await documentoCotizacion(1280, "cot_token_S3_1280", `${base}/cot/${v3.token}`, false, { pasajeros: 2, muestra: "/cot/[token] (público, sin sesión) a 1280px, cotización S3 (2 adultos + 1 niño, Distribuir): línea de ajuste +$1.000 y total igual al de «adultos»." });
await documentoCotizacion(390, "cot_token_S3_390", `${base}/cot/${v3.token}`, false, { pasajeros: 2, muestra: "/cot/[token] a 390px, cotización S3: línea de ajuste +$1.000." });
await documentoCotizacion(390, "cot_token_S2_390", `${base}/cot/${v2.token}`, false, { pasajeros: 1, muestra: "/cot/[token] a 390px, cotización S2 (1 adulto + 1 niño, Distribuir): línea de ajuste −$1.000 (el único adulto y el niño; 2 viajeros)." });
await documentoCotizacion(1280, "cot_token_S2_1280", `${base}/cot/${v2.token}`, false, { pasajeros: 1, muestra: "/cot/[token] a 1280px, cotización S2: línea de ajuste −$1.000." });
await documentoCotizacion(1280, "cotizacion_id_S3_1280", `${base}/cotizacion/${S3}`, true, { pasajeros: 2, muestra: "/cotizacion/[id] (operador) a 1280px, cotización S3: línea de ajuste +$1.000." });
await documentoCotizacion(390, "cotizacion_id_S2_390", `${base}/cotizacion/${S2}`, true, { pasajeros: 1, muestra: "/cotizacion/[id] (operador) a 390px, cotización S2: línea de ajuste −$1.000." });

// ── D. Conversión a contrato (por la UI): pasajeros y sillas REALES ─────────────────────────────────────────────────────────────────────────────────
const contratos = {};
async function convertir(id, tag, reales, { capturaForm }) {
  const { ctx, page } = await sesion(1280, 1000, tag, true);
  await page.goto(`${base}/dashboard/cotizaciones/${id}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /Confirmar → generar contrato/ }).click();
  const titulo = await page.getByText(/Datos de los pasajeros \(\d+\)/).innerText();
  const nForm = Number(/\((\d+)\)/.exec(titulo)[1]);
  ok(nForm === reales.length, `${tag}: el formulario de pasajeros pide ${nForm} pasajero(s) = personas REALES (${reales.length})`);
  const filas = page.locator("div.flex.flex-wrap.items-end.gap-2").filter({ has: page.getByText("Nombres") });
  ok((await filas.count()) === reales.length, `${tag}: ${await filas.count()} fila(s) de pasajero en el DOM (esperado ${reales.length}; ningún pasajero ficticio)`);
  for (let i = 0; i < reales.length; i++) {
    const r = reales[i]; const fila = filas.nth(i);
    if (i > 0) { await fila.locator("input").nth(0).fill(r.nombres); await fila.locator("input").nth(1).fill("Prueba"); await fila.locator("input").nth(2).fill(r.doc); }
    await fila.locator("select").selectOption(r.tipoDoc);
    const nac = fila.getByRole("textbox", { name: "Nacimiento" }); await nac.fill(r.nac); await nac.blur();
  }
  if (capturaForm) await shot(page, `${tag}_pasajeros`, `Formulario «Datos de los pasajeros (${nForm})» a 1280px para ${tag}: ${nForm} fila(s) = personas reales, sin pasajero adicional.`, { fullPage: true });
  await page.getByRole("button", { name: "Generar contrato", exact: true }).click();
  await page.waitForURL(/\/dashboard\/contratos\//, { timeout: 120000 });
  const numero = decodeURIComponent(page.url().split("/dashboard/contratos/")[1].split(/[?#]/)[0]);
  await page.waitForTimeout(1500);
  contratos[tag] = numero;
  await ctx.close();
  return numero;
}
const real1 = (doc) => [{ doc: "", tipoDoc: "CC", nac: "01/01/1990" }, { nombres: "Nina", doc: `${doc}7`, tipoDoc: "TI", nac: "01/01/2023" }];
const c1 = await convertir(S1, "contrato_S1_1adulto_1nino", real1("9011"), { capturaForm: false });
const c2 = await convertir(S2, "contrato_S2_1adulto_1nino", real1("9012"), { capturaForm: true });
const c3 = await convertir(S3, "contrato_S3_2adultos_1nino", [{ doc: "", tipoDoc: "CC", nac: "01/01/1990" }, { nombres: "Adulto2", doc: "90132", tipoDoc: "CC", nac: "02/02/1991" }, { nombres: "Nina", doc: "90137", tipoDoc: "TI", nac: "01/01/2023" }], { capturaForm: true });
for (const [tag, num, esperado] of [["S1", c1, { pasajeros: 2, sillas: 2, ajuste: 0 }], ["S2", c2, { pasajeros: 2, sillas: 2, ajuste: 1 }], ["S3", c3, { pasajeros: 3, sillas: 3, ajuste: 1 }]]) {
  const c = cuentas(num);
  console.log(`CONTRATO ${tag} ${num} :: ${JSON.stringify(c)}`);
  ok(c.pasajeros === esperado.pasajeros && c.sillas === esperado.sillas && c.pax === esperado.pasajeros, `${tag} ${num}: BD → ${c.pasajeros} pasajeros, ${c.sillas} sillas, pax ${c.pax} (esperado ${esperado.pasajeros}: sin tercer pasajero ni tercera silla)`);
  ok(c.ajuste_items === esperado.ajuste && c.cxp === 2, `${tag} ${num}: BD → ${c.ajuste_items} línea(s) de ajuste (esperado ${esperado.ajuste}) y ${c.cxp} CxP (aéreo + hotel: este fixture no incluye asistencia)`);
}
async function documentoContrato(ancho, tag, numero, esperado) {
  const { ctx, page } = await sesion(ancho, ancho >= 1000 ? 1000 : 844, tag, true);
  await page.goto(`${base}/contrato/${encodeURIComponent(numero)}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1200);
  const texto = await page.locator("body").innerText();
  const lineas = texto.split("\n").filter((l) => /Ajuste por redondeo/.test(l));
  ok(lineas.length === esperado.ajuste, `${tag}: documento del contrato muestra ${lineas.length} línea(s) de ajuste (esperado ${esperado.ajuste}): «${lineas[0] ?? ""}»`);
  if (esperado.ajuste) ok(/^Ajuste por redondeo\s+—\s+—\s+—\s+—\s+-?\$\s?1\.000$/.test((lineas[0] ?? "").trim()), `${tag}: «—» en personas y tarifas, importe solo en «Valor total»`);
  ok(!/reparto del hotel/i.test(texto), `${tag}: el documento del contrato no menciona «reparto del hotel»`);
  const tablas = await page.locator("table").evaluateAll((ts) => ts.map((t) => ({ cabecera: (t.querySelector("thead")?.textContent ?? "").replace(/\s+/g, " ").slice(0, 100), filas: t.querySelectorAll("tbody tr").length })));
  console.log(`${tag}: tablas del documento ${JSON.stringify(tablas.map((t) => [t.cabecera, t.filas]))}`);
  const tablaPas = tablas.find((t) => /nombre|documento/i.test(t.cabecera) && !/habitaci|valor|tarifa/i.test(t.cabecera));
  ok(!!tablaPas && tablaPas.filas === esperado.pasajeros, `${tag}: la tabla de pasajeros del documento tiene ${tablaPas?.filas ?? "?"} fila(s) (esperado ${esperado.pasajeros}; cabecera «${tablaPas?.cabecera ?? "no hallada"}»)`);
  await shot(page, tag, esperado.muestra, { fullPage: true });
  await shotTabla(page, tag, `Recorte de la tabla de valores del documento del contrato (${tag}): ítems, importes y la línea de ajuste.`);
  await ctx.close();
}
await documentoContrato(1280, "documento_contrato_S3_1280", c3, { pasajeros: 3, ajuste: 1, muestra: `Documento del contrato ${c3} a 1280px (S3: 2 adultos + 1 niño, Distribuir): 3 pasajeros y la línea «Ajuste de redondeo del reparto del hotel» de +$1.000 entre los valores.` });
await documentoContrato(390, "documento_contrato_S3_390", c3, { pasajeros: 3, ajuste: 1, muestra: `Documento del contrato ${c3} a 390px (S3).` });
await documentoContrato(1280, "documento_contrato_S2_1280", c2, { pasajeros: 2, ajuste: 1, muestra: `Documento del contrato ${c2} a 1280px (S2: 1 adulto + 1 niño, Distribuir): 2 pasajeros (sin tercero) y la línea de ajuste de −$1.000.` });
await documentoContrato(390, "documento_contrato_S2_390", c2, { pasajeros: 2, ajuste: 1, muestra: `Documento del contrato ${c2} a 390px (S2).` });
await documentoContrato(1280, "documento_contrato_S1_1280", c1, { pasajeros: 2, ajuste: 0, muestra: `Documento del contrato ${c1} a 1280px (S1: 1 adulto + 1 niño, modo «adultos»): 2 pasajeros, sin línea de ajuste.` });
{
  const { ctx, page } = await sesion(1280, 1000, "ficha_contrato_S2", true);
  await page.goto(`${base}/dashboard/contratos/${encodeURIComponent(c2)}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1200);
  await shot(page, "ficha_contrato_S2_1280", `Ficha interna del contrato ${c2} a 1280px (S2): pasajeros y valores del contrato.`, { fullPage: true });
  await ctx.close();
}

// ── E. Cierre #120 · contrato en USD: TRM de costos (campo, rechazo sin TRM, CxP en USD) y lo que muestra /dashboard/pagos ─────────────────────────────────────────────────────────
{
  const { ctx, page } = await sesion(1280, 900, "publico1280_USD");
  await page.goto(`${base}/tarifario`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.getByTestId("solicitud-hotel-7206").getByRole("button", { name: "Solicitar cotización" }).click();
  const d = page.getByRole("dialog"); await d.waitFor();
  await d.locator("select").first().selectOption({ index: 1 });
  await llenarCliente(d, "ClienteUSD", "120010");
  await d.getByRole("button", { name: "Enviar solicitud" }).click();
  await page.locator('[data-testid="solicitud-enviada"]').waitFor({ timeout: 60000 });
  await ctx.close();
}
const SU = idPorDoc("120010");
{
  const { ctx, page } = await sesion(1280, 1000, "operador1280_USD", true);
  await valorar(page, SU, { modo: "adultos", neta: "1000", tag: "oper1280_USD" });
  await ctx.close();
}
const ventasAntes = Number(sql("select count(*) from public.ventas"));
let numeroUsd;
{
  const { ctx, page: pu } = await sesion(1280, 1000, "convertir_USD", true);
  await pu.goto(`${base}/dashboard/cotizaciones/${SU}`, { waitUntil: "networkidle", timeout: 120000 });
  await pu.waitForTimeout(1000);
  ok(await pu.getByTestId("trm-costo").isVisible(), "contrato en USD: la pantalla pide la «TRM de costos (COP por USD)», distinta de la TRM de cobro");
  await pu.getByRole("button", { name: /Confirmar → generar contrato/ }).click();
  const filas = pu.locator("div.flex.flex-wrap.items-end.gap-2").filter({ has: pu.getByText("Nombres") });
  ok((await filas.count()) === 2, `USD: el formulario pide ${await filas.count()} pasajero(s) (2 adultos reales)`);
  for (let i = 0; i < 2; i++) {
    const fila = filas.nth(i);
    if (i > 0) { await fila.locator("input").nth(0).fill("Adulto2"); await fila.locator("input").nth(1).fill("Prueba"); await fila.locator("input").nth(2).fill("120011"); }
    const nac = fila.getByRole("textbox", { name: "Nacimiento" }); await nac.fill(i === 0 ? "01/01/1990" : "02/02/1991"); await nac.blur();
  }
  await shot(pu, "usd_conversion_campo_trm_costos_vacio", "Conversión de la cotización en USD (1280px): campo «TRM de costos (COP por USD)» vacío junto a los 2 pasajeros, antes de generar el contrato.", { fullPage: true });
  await pu.getByRole("button", { name: "Generar contrato", exact: true }).click();
  await pu.waitForTimeout(1200);
  const cuerpo = await pu.locator("body").innerText();
  ok(/ingresa la TRM de costos/i.test(cuerpo), "sin TRM de costos la pantalla se detiene con el mensaje en español («…ingresa la TRM de costos…»)");
  ok(Number(sql("select count(*) from public.ventas")) === ventasAntes, "sin TRM de costos NO se creó ningún contrato");
  await shot(pu, "usd_conversion_sin_trm_rechazada", "Misma pantalla tras pulsar «Generar contrato» sin TRM de costos: mensaje de error y ningún contrato creado.", { fullPage: true });
  await pu.locator("#trm-costo-input").fill("4000.5");
  await pu.getByRole("button", { name: "Generar contrato", exact: true }).click();
  await pu.waitForURL(/\/dashboard\/contratos\//, { timeout: 120000 });
  numeroUsd = decodeURIComponent(pu.url().split("/dashboard/contratos/")[1].split(/[?#]/)[0]);
  await ctx.close();
}
{
  const filasCxp = JSON.parse(sql(`select coalesce(json_agg(json_build_object('tipo', tipo_proveedor, 'valor', valor_total, 'moneda', moneda, 'trm', trm_costo, 'cop', valor_cop_costo) order by id), '[]'::json) from public.cuentas_por_pagar where numero_contrato = '${numeroUsd}'`));
  console.log(`CXP_USD ${numeroUsd} :: ${JSON.stringify(filasCxp)}`);
  ok(filasCxp.length === 3 && filasCxp.every((f) => f.moneda === "USD" && Number(f.trm) === 4000.5 && Math.abs(Number(f.cop) - Math.round(Number(f.valor) * 4000.5 * 100) / 100) <= 0.01), `contrato ${numeroUsd}: 3 CxP, todas en USD, TRM de costos 4000,5 y equivalente en COP = valor × TRM`);
  ok(sql(`select moneda from public.ventas where numero_contrato = '${numeroUsd}'`) === "USD", `contrato ${numeroUsd} en USD`);
  const cop = JSON.parse(sql(`select coalesce(json_agg(json_build_object('n', numero_contrato, 'moneda', moneda, 'trm', trm_costo, 'cop', valor_cop_costo)), '[]'::json) from public.cuentas_por_pagar where numero_contrato in ('${c1}', '${c2}', '${c3}')`));
  ok(cop.length > 0 && cop.every((f) => f.moneda === "COP" && f.trm == null && f.cop == null), `contratos COP ${c1}, ${c2}, ${c3}: ${cop.length} CxP en COP, sin TRM de costos ni equivalente (sin cambios)`);
}
async function paginaPagos(ancho, tag) {
  const { ctx, page } = await sesion(ancho, ancho >= 1000 ? 1000 : 844, tag, true);
  await page.goto(`${base}/dashboard/pagos`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1500);
  const texto = await page.locator("body").innerText();
  ok(/USD/.test(texto) && /COP/.test(texto), `${tag}: el resumen de /dashboard/pagos separa las obligaciones por moneda (USD y COP)`);
  const filasUsd = page.locator("tr", { hasText: numeroUsd });
  const nUsd = await filasUsd.count();
  const textosUsd = [];
  for (let i = 0; i < nUsd; i++) textosUsd.push((await filasUsd.nth(i).innerText()).replace(/\s+/g, " ").trim());
  console.log(`${tag}: filas de ${numeroUsd}: ${JSON.stringify(textosUsd)}`);
  ok(nUsd >= 3 && textosUsd.every((t) => /USD/.test(t)), `${tag}: las ${nUsd} filas del contrato USD muestran el importe y el saldo en USD («${textosUsd[0] ?? ""}»)`);
  const filasCop = page.locator("tr", { hasText: c1 });
  const textosCop = [];
  for (let i = 0; i < await filasCop.count(); i++) textosCop.push((await filasCop.nth(i).innerText()).replace(/\s+/g, " ").trim());
  ok(textosCop.length >= 2 && textosCop.every((t) => !/USD/.test(t)), `${tag}: las filas del contrato COP ${c1} siguen en pesos («${textosCop[0] ?? ""}»)`);
  await shot(page, `${tag}_resumen`, `/dashboard/pagos a ${ancho}px: resumen por moneda (COP y USD) y filas de ${numeroUsd} (USD) y ${c1} (COP).`, { fullPage: true });
  return { ctx, page, nUsd };
}
{
  const { ctx, page, nUsd } = await paginaPagos(1280, "pagos1280");
  const equivalentes = [];
  for (let i = 0; i < nUsd; i++) {
    await page.locator("tr", { hasText: numeroUsd }).nth(i).click();
    await page.waitForTimeout(500);
    const eq = page.getByTestId("equivalente-costo");
    for (let j = 0; j < await eq.count(); j++) equivalentes.push((await eq.nth(j).innerText()).replace(/\s+/g, " ").trim());
  }
  const unicos = [...new Set(equivalentes)];
  console.log(`pagos1280: equivalentes mostrados ${JSON.stringify(unicos)}`);
  ok(unicos.some((t) => /4\.000\.500/.test(t)), "el detalle de la obligación del hotel (1.000 USD) muestra su equivalente en pesos: 4.000.500 a la TRM de costos 4.000,5");
  await shot(page, "pagos1280_detalle_equivalente", "/dashboard/pagos a 1280px con el detalle de las obligaciones USD abiertas: «Valor de la obligación» en USD, «Equivalente en pesos (TRM de costos …)» en COP y saldo por pagar en USD.", { fullPage: true });
  await ctx.close();
}
{
  const { ctx } = await paginaPagos(390, "pagos390");
  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.resolve(salida, "consola.txt"), consola.join("\n"));
fs.writeFileSync(path.resolve(salida, "capturas.json"), JSON.stringify(capturas, null, 2));
console.log(`consola/red (sin medicion-error ni /auth): ${consola.length} mensaje(s)${consola.length ? "\n  " + [...new Set(consola)].slice(0, 10).join("\n  ") : ""}`);
