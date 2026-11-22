// Verificación con ROLES REALES y el build entregado de las correcciones de la revisión del dueño (docs/tecnico/owner-review-integration-126-127-b2b-2026-11-20.md):
//   O1  el diagnóstico de configuración del hotel (campos de edades, «Producto → Hoteles…») es solo interno: visitante, aliado B2B y personal, en Vista tabla y Vista Booking,
//       en la pantalla y en los payloads de las acciones de servidor; la regla de seguridad (sin menores sin edades del hotel) no cambia.
//   O2  lectura adulto/menores de un alojamiento por unidad (tabla y tarjeta): base de la unidad + cargos propios = total; equivalente por adulto solo cuando es honesto.
//   O3  recorrido real solicitud → aviso → cotización → conversión → contrato (pasajeros, abonos, soportes) con una cotización del carrito generada por una freelance.
//   O4  «Olvidé mi contraseña» desde «Continúa tu registro»: recuperación real (Mailpit) → cambio de contraseña → continuación segura → UNA solicitud.
// Uso (desde dspacios-travel/, con la pila arriba): REV_APP=http://localhost:3070 REV_CFG_DIR=<carpeta config> REV_DB=<base> node supabase/scripts/localreview_integrado/guion_o1_o4.mjs <capturas> [O1,O2,O3,O4]
// O1 y O2 solo LEEN (se pueden correr sobre la base del dueño). O3 y O4 ESCRIBEN: correrlas sobre una COPIA (clon) de la base de revisión.
import { pathToFileURL } from "node:url";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const WT = new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const C = await import(pathToFileURL(`${WT}/supabase/scripts/localreview/revision_comun.mjs`).href);
const OUT = process.argv[2] ?? "o1o4-capturas"; mkdirSync(OUT, { recursive: true });
const SEC = (process.argv[3] ?? "O1,O2,O3,O4").split(",");
const BASE = process.env.REV_DB ?? "rev_verif_int_revision", CT = process.env.REV_PG ?? "pgb2b";
const DIR = process.env.REV_CFG_DIR;
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", BASE, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const MAIL = `http://127.0.0.1:${JSON.parse(readFileSync(`${DIR}/config.json`, "utf8")).puertos.correo}`;
const MUESTRAS = `${DIR.replace(/\\/g, "/")}/muestras`;
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
let fallos = 0, aciertos = 0;
const ok = (c, m, extra = "") => { console.log(`${c ? "OK   " : "FALLO"} ${m}${!c && extra ? "\n       → " + String(extra).slice(0, 500) : ""}`); if (c) aciertos++; else fallos++; };
const browser = await C.lanzar();
const sesion = (email, vista = "escritorio") => C.abrirConLogin(browser, email, vista);
const anonimo = async (vista = "escritorio") => C.abrir(browser, { vista });
const ir = async (page, ruta) => { await page.goto(C.APP + ruta, { waitUntil: "networkidle" }); return norm(await C.texto(page)); };
const campo = (page, etiqueta) => page.locator(`label:text-is("${etiqueta}")`).locator("xpath=..").locator("input").first();
// El cuerpo de la acción puede traer la clave vacía (`"enRevision":[]`, la acción por unidad): solo cuenta una lista CON elementos.
const revisionNoVacia = (p) => /"enRevision":\[\s*\{/.test(p);
const PROHIBIDO = [/Infante hasta/, /Niño hasta/, /Producto →/, /Configuración del hotel/, /edades_hotel_incompletas/];

// Registra los cuerpos de las respuestas de Server Actions (lo que el navegador realmente recibe del servidor).
const vigilar = (page) => { const cargas = []; page.on("response", async (r) => { try { if (r.request().method() === "POST" && r.request().headers()["next-action"]) cargas.push(await r.text()); } catch { /* respuesta descartada por la navegación */ } }); return cargas; };

async function buscar(page, { destino, vistaTabla, ida = "10/06/2030", regreso = "13/06/2030", adultos = "2", menores = [] }) {
  await page.goto(`${C.APP}/tarifario`, { waitUntil: "networkidle" });
  // «Vista tabla» solo existe para quien puede reservar (personal); visitante y aliados B2B buscan en Vista Booking.
  if (vistaTabla) { const t = page.getByRole("button", { name: "Vista tabla" }); if (!(await t.count())) return false; await t.click(); }
  await page.getByRole("button", { name: /Porción terrestre/ }).first().click(); await page.waitForTimeout(800);
  await page.locator('button[role="combobox"]').first().click();
  await page.getByRole("option", { name: destino }).click();
  const f = (n) => page.locator(`input[aria-label="${n}"]:visible`).first();
  await f("Ida").fill(ida); await f("Ida").blur(); await f("Regreso").fill(regreso); await f("Regreso").blur();
  await campo(page, "Adultos").fill(adultos); await campo(page, "Habitaciones").fill("1");
  await page.getByLabel(/Menores \(0–17 años\)/).fill(String(menores.length));
  for (let i = 0; i < menores.length; i++) await campo(page, `Edad menor ${i + 1}`).fill(String(menores[i]));
  await page.getByRole("button", { name: /Buscar hoteles/ }).click();
  await page.waitForSelector('button:has-text("Buscar hoteles")', { timeout: 30000 });
  await page.waitForTimeout(2500);
  return true;
}

// ═══ O1 · diagnóstico de configuración solo interno ══════════════════════════════════════════════════════════════════════════════════════════
if (SEC.includes("O1")) {
  console.log("\n══ O1 · el diagnóstico de edades del hotel es solo interno ══");
  const H = { OK: "O3 · Hotel con edades completas", SIN: ["O3 · Hotel SIN edades configuradas", "O3 · Hotel con edades inválidas", "O3 · Hotel sin edades, con override en la tarifa"] };
  const U = { OK: "U1 · Hotel por unidad con edades", SIN: "U1 · Hotel por unidad SIN edades" };
  const roles = [
    { etiqueta: "visitante (sin sesión)", abrir: anonimo, interno: false },
    { etiqueta: "aliado B2B · freelance Camila", abrir: () => sesion("freelance@revision.test"), interno: false },
    { etiqueta: "aliado B2B · agencia", abrir: () => sesion("aliado@revision.test"), interno: false },
    { etiqueta: "personal · administracion", abrir: () => sesion("administracion@revision.test"), interno: true },
    { etiqueta: "personal · superadmin", abrir: () => sesion("superadmin@revision.test"), interno: true },
  ];
  for (const rol of roles) for (const vistaTabla of [true, false]) {
    const o = await rol.abrir(); const page = o.page; const cargas = vigilar(page);
    const vista = vistaTabla ? "Vista tabla" : "Vista Booking";
    // Por persona: CARTAGENA O3 con un menor de 5 años.
    if ((await buscar(page, { destino: "CARTAGENA O3", vistaTabla, menores: [5] })) === false) { console.log(`       (${rol.etiqueta}: sin «Vista tabla» — solo Vista Booking)`); await o.ctx.close(); continue; }
    let t = norm(await C.texto(page));
    const bloque = await page.locator('[data-testid="hoteles-en-revision"]').count();
    const payload = cargas.join("\n");
    ok(t.includes(H.OK), `O1 ${rol.etiqueta} · ${vista} · persona: «${H.OK}» se cotiza con el menor (la búsqueda normal sigue)`);
    for (const h of H.SIN) ok(!(await page.locator(`section tbody tr, article`, { hasText: h }).count()) || rol.interno, `O1 ${rol.etiqueta} · ${vista} · persona: «${h}» NO se cotiza con menores (regla de seguridad intacta)`);
    if (rol.interno) {
      ok(bloque === 1 && /Producto → Hoteles → Configuración del hotel/.test(t) && /falta: «Infante hasta \(edad\)», «Niño hasta \(edad\)»/.test(t), `O1 ${rol.etiqueta} · ${vista} · persona: el personal SÍ ve el motivo accionable`, t.slice(0, 400));
      ok(/Producto/.test(payload) && /Infante hasta/.test(payload) && revisionNoVacia(payload), `O1 ${rol.etiqueta} · ${vista} · persona: el payload de la acción trae el detalle (es interno)`);
    } else {
      ok(bloque === 0, `O1 ${rol.etiqueta} · ${vista} · persona: NO hay bloque «hoteles en revisión»`);
      ok(!PROHIBIDO.some((re) => re.test(t)), `O1 ${rol.etiqueta} · ${vista} · persona: la pantalla no nombra campos, rutas ni instrucciones de Producto`, t.slice(0, 300));
      ok(!PROHIBIDO.some((re) => re.test(payload)) && !revisionNoVacia(payload), `O1 ${rol.etiqueta} · ${vista} · persona: el payload de la acción NO trae el detalle (${cargas.length} respuestas inspeccionadas)`);
    }
    // Solo adultos: nada cambia para nadie (todos los hoteles se cotizan).
    await buscar(page, { destino: "CARTAGENA O3", vistaTabla, menores: [] });
    t = norm(await C.texto(page));
    ok([H.OK, ...H.SIN].every((h) => t.includes(h)) && (await page.locator('[data-testid="hoteles-en-revision"]').count()) === 0, `O1 ${rol.etiqueta} · ${vista} · solo adultos: los ${1 + H.SIN.length} hoteles se cotizan y no hay avisos`);
    // Por unidad: CARTAGENA U1 con un menor de 5 años.
    cargas.length = 0;
    await buscar(page, { destino: "CARTAGENA U1", vistaTabla, menores: [5] });
    t = norm(await C.texto(page)); const bloqueU = await page.locator('[data-testid="hoteles-en-revision"]').count(); const payloadU = cargas.join("\n");
    ok(t.includes(U.OK), `O1 ${rol.etiqueta} · ${vista} · unidad: «${U.OK}» se cotiza`);
    if (rol.interno) ok(bloqueU === 1 && /Producto → Hoteles → Configuración del hotel/.test(t) && /Infante hasta/.test(payloadU), `O1 ${rol.etiqueta} · ${vista} · unidad: el personal SÍ ve el motivo (pantalla y payload)`, t.slice(0, 300));
    else {
      ok(bloqueU === 0 && !PROHIBIDO.some((re) => re.test(t)), `O1 ${rol.etiqueta} · ${vista} · unidad: sin bloque ni textos internos en pantalla`, t.slice(0, 300));
      ok(!PROHIBIDO.some((re) => re.test(payloadU)) && !revisionNoVacia(payloadU), `O1 ${rol.etiqueta} · ${vista} · unidad: el payload no trae el detalle (${cargas.length} respuestas)`);
      ok(!new RegExp(U.SIN.replace(/[()]/g, "\\$&")).test(t.replace(/\s+/g, " ")) || !(await page.locator("article, tbody tr", { hasText: U.SIN }).count()), `O1 ${rol.etiqueta} · ${vista} · unidad: «${U.SIN}» no se cotiza con menores`);
    }
    if (vistaTabla && rol.etiqueta.startsWith("visitante")) await page.screenshot({ path: join(OUT, "O1-visitante-tabla.png"), fullPage: true });
    if (vistaTabla && rol.etiqueta.startsWith("personal · administracion")) await page.screenshot({ path: join(OUT, "O1-personal-tabla.png"), fullPage: true });
    await o.ctx.close();
  }
  // Adults Only: con menores sigue rechazado y con solo adultos sigue disponible (regla ya existente, sin tocar).
  { const o = await anonimo(); await buscar(o.page, { destino: "CARTAGENA 102", vistaTabla: false, menores: [] }); const t = norm(await C.texto(o.page));
    ok(t.includes("Hotel D (solo adultos)"), "O1 Adults Only · solo adultos: «Hotel D (solo adultos)» sigue disponible"); await o.ctx.close(); }
}

// ═══ O2 · lectura adulto/menores del alojamiento por unidad ═══════════════════════════════════════════════════════════════════════════════
if (SEC.includes("O2")) {
  console.log("\n══ O2 · desglose informativo del alojamiento por unidad ══");
  const num = (s) => Number(String(s).replace(/[^\d]/g, ""));
  for (const [etiqueta, abrir] of [["visitante", anonimo], ["personal · administracion", () => sesion("administracion@revision.test")]]) for (const vistaTabla of [true, false]) {
    const o = await abrir(); const page = o.page; const vista = vistaTabla ? "Vista tabla" : "Vista Booking";
    if ((await buscar(page, { destino: "CARTAGENA U1", vistaTabla, menores: [8, 2] })) === false) { console.log(`       (${etiqueta}: sin «Vista tabla»)`); await o.ctx.close(); continue; }
    const d = page.locator('[data-testid="desglose-unidad"]').first();
    const n = await page.locator('[data-testid="desglose-unidad"]').count();
    ok(n >= 1, `O2 ${etiqueta} · ${vista}: aparece el desglose de la opción por unidad (${n})`);
    if (n >= 1) {
      const base = num(await d.locator('[data-testid="desglose-base"] dd').innerText()), total = num(await d.locator('[data-testid="desglose-total"] dd').innerText());
      const cargos = (await d.locator('[data-testid="desglose-cargos"] dd').count()) ? num(await d.locator('[data-testid="desglose-cargos"] dd').innerText()) : 0;
      const eq = (await d.locator('[data-testid="desglose-equivalente"]').count()) ? norm(await d.locator('[data-testid="desglose-equivalente"]').innerText()) : "";
      console.log(`       base ${base} + cargos ${cargos} = total ${total} · «${eq}»`);
      ok(base + cargos === total && base > 0, `O2 ${etiqueta} · ${vista}: base de la unidad + cargos propios = total (sin contar nada dos veces)`);
      ok(/equivalente informativo/.test(eq) ? /el precio real es por unidad, no por persona/.test(eq) : true, `O2 ${etiqueta} · ${vista}: el equivalente por adulto, si aparece, se marca como informativo y aclara que el precio es por unidad`);
      const t = norm(await C.texto(page));
      ok(/Niño de 8 años|Menor de 8 años/.test(t) && /Infante de 2 años|Menor de 2 años/.test(t), `O2 ${etiqueta} · ${vista}: siguen las líneas por menor (edad y si va incluido o tiene cargo propio)`);
      if (vistaTabla && etiqueta === "visitante") await page.screenshot({ path: join(OUT, "O2-tabla-unidad.png"), fullPage: true });
      if (!vistaTabla && etiqueta === "visitante") await page.screenshot({ path: join(OUT, "O2-tarjeta-unidad.png"), fullPage: true });
    }
    await o.ctx.close();
  }
}

// ═══ O3 · solicitud → contrato, con pasajeros, abonos y soportes ═════════════════════════════════════════════════════════════════════════
if (SEC.includes("O3")) {
  console.log("\n══ O3 · recorrido real: cotización de una freelance → solicitud → aviso → conversión → contrato → soportes (EN UNA COPIA) ══");
  const camila = await sesion("freelance@revision.test");
  const cargas = vigilar(camila.page);
  // 1) La freelance genera su cotización por el carrito/checkout reales, con su titular (tipo CE).
  await buscar(camila.page, { destino: "CARTAGENA O3", vistaTabla: false, ida: "10/06/2030", regreso: "13/06/2030" });
  await camila.page.getByRole("button", { name: /Agregar al carrito/ }).first().click(); await camila.page.waitForTimeout(1500);
  await camila.page.goto(`${C.APP}/tarifario/checkout`, { waitUntil: "networkidle" }); await camila.page.waitForTimeout(2500);
  const lab = (t) => camila.page.locator(`label:text-is("${t}")`).locator("xpath=..");
  await lab("Nombres *").locator("input").fill("Laura"); await lab("Apellidos *").locator("input").fill("Vega Demo");
  await lab("Tipo").locator("select").selectOption("CE"); await lab("Documento *").locator("input").fill("1234567");
  await lab("Teléfono / WhatsApp *").locator("input").fill("3105550199"); await lab("Correo").locator("input").fill("laura.demo@revision.test");
  await camila.page.getByRole("button", { name: /Generar cotización y enviar solicitud/ }).click();
  await camila.page.waitForSelector('text=/Ver la cotizaci|Cotización C-|C-0\\d+/', { timeout: 60000 }).catch(() => {}); await camila.page.waitForTimeout(2500);
  const cot = sql(`select id || '|' || codigo || '|' || coalesce(payload->'cliente'->>'tipoDoc','') || '|' || coalesce(payload->'cliente'->>'numeroDoc','') || '|' || jsonb_array_length(coalesce(payload->'pasajeros','[]')) || '|' || tipo from public.cotizaciones where creado_por = 'freelance@revision.test' and tipo = 'carrito' order by id desc limit 1`).split("|");
  const [cotId, cotCodigo, tipoDoc, numDoc, nPas] = cot;
  ok(!!cotId && /^C-/.test(cotCodigo ?? ""), `O3.1 la freelance generó su cotización del carrito: ${cotCodigo} (id ${cotId})`, cot.join("|"));
  ok(tipoDoc === "CE" && numDoc === "1234567", `O3.1 el checkout guardó el titular con SU tipo de documento (${tipoDoc} ${numDoc})`);
  ok(nPas === "0", `O3.1 HALLAZGO: en el flujo normal la freelance solo escribe al TITULAR; la cotización no lleva lista de pasajeros (payload.pasajeros = ${nPas})`);
  // 2) Solicitar contrato desde el portal.
  // La cotización que un aliado genera por el checkout lleva su ficha congelada en el plan B2B: el portal la clasifica en la pestaña «Asistidas».
  let t = await ir(camila.page, "/portal/b2b/cotizaciones?vista=asistidas");
  ok(new RegExp(cotCodigo).test(t), `O3.2 /portal/b2b/cotizaciones lista ${cotCodigo}`, t.slice(0, 300));
  await camila.page.locator("tr", { hasText: cotCodigo }).getByRole("button", { name: "Solicitar contrato" }).click(); await camila.page.waitForTimeout(2500);
  ok(sql(`select count(*) from public.cotizacion_solicitudes_contrato where cotizacion_id = ${cotId} and estado = 'solicitada'`) === "1", "O3.2 queda UN evento «solicitada» para esa cotización");
  // 3) El personal recibe el aviso y abre la cotización.
  const adm = await sesion("administracion@revision.test");
  await ir(adm.page, "/dashboard");
  const campana = adm.page.getByRole("button", { name: /avisos|notificaciones|campana/i }).first();
  if (await campana.count()) { await campana.click(); await adm.page.waitForTimeout(900); }
  t = norm(await C.texto(adm.page));
  ok(new RegExp(`Solicitud de contrato de un aliado: cotización ${cotCodigo}`).test(t), `O3.3 la campana de administracion dice «Solicitud de contrato de un aliado: cotización ${cotCodigo}»`, t.slice(0, 300));
  t = await ir(adm.page, `/dashboard/cotizaciones/${cotId}`);
  ok(new RegExp(cotCodigo).test(t) && /Laura Vega Demo/.test(t), "O3.3 el aviso enlaza a la cotización y la ficha muestra al titular Laura Vega Demo", t.slice(0, 400));
  ok(!(await adm.page.locator('[data-testid="soportes-cotizacion"]').count()), "O3.3 LÍMITE: no existe etapa de soportes ANTES del contrato (la cotización no tiene soportes)");
  // 4) Conversión. HALLAZGO: administracion/gerencia ven la cotización y reciben el aviso, pero su lista de asesores está VACÍA (la RLS de `usuarios` solo deja ver el propio perfil o todo a superadmin) y el asesor es obligatorio para ellas: convierte superadmin (asesor opcional) o un asesor venta.
  const conv = await sesion("superadmin@revision.test"); await ir(conv.page, `/dashboard/cotizaciones/${cotId}`);
  await adm.page.getByRole("button", { name: /Confirmar → generar contrato/ }).click(); await adm.page.waitForTimeout(600);
  { const sel = adm.page.locator("select").filter({ has: adm.page.locator("option", { hasText: "Elegir asesor" }) }).first(); const n = (await sel.locator("option").count()) - 1; ok(true, `O3.4 HALLAZGO: con administracion@ el selector de asesor (obligatorio) trae ${n} asesores`); }
  // El titular llega como pasajero 1 (con su tipo CE); el resto lo escribe el personal (nadie lo inventa).
  await conv.page.getByRole("button", { name: /Confirmar → generar contrato/ }).click(); await conv.page.waitForTimeout(800);
  const nombres = conv.page.locator("label", { hasText: /^Nombres$/ }); const filas = await nombres.count();
  const v = async (i, etiqueta) => conv.page.locator("label", { hasText: new RegExp(`^${etiqueta}$`) }).nth(i).locator("xpath=..").locator("input,select").first().inputValue();
  ok(filas === 2 && (await v(0, "Nombres")) === "Laura" && (await v(0, "Apellidos")) === "Vega Demo" && (await v(0, "Tipo doc")) === "CE" && (await v(0, "N° doc")) === "1234567", `O3.4 la fila 1 llega con el titular de la freelance, tipo CE (filas: ${filas})`);
  ok((await v(1, "Nombres")) === "" && (await v(1, "N° doc")) === "", "O3.4 la fila 2 llega VACÍA: nadie se inventa a un pasajero");
  await conv.page.screenshot({ path: join(OUT, "O3-conversion-captura.png"), fullPage: true });
  // Pasajero incompleto: se rechaza antes de crear nada.
  await conv.page.evaluate(() => { const s = document.querySelector("#moneda-cobro-carrito-select"); if (s) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "COP"); s.dispatchEvent(new Event("change", { bubbles: true })); } });
  await conv.page.getByRole("button", { name: /Generar contrato\(s\)/ }).click(); await conv.page.waitForTimeout(1500);
  t = norm(await C.texto(conv.page));
  ok(/Completa|Falta|nombre/i.test(t) && sql(`select count(*) from public.ventas where cliente ilike '%Vega Demo%'`) === "0", "O3.4 con el pasajero 2 incompleto NO se crea ningún contrato y se explica qué falta", t.slice(-300));
  // Completa el pasajero 2 y genera.
  await conv.page.locator("label", { hasText: /^Nombres$/ }).nth(1).locator("xpath=..").locator("input").fill("Marco");
  await conv.page.locator("label", { hasText: /^Apellidos$/ }).nth(1).locator("xpath=..").locator("input").fill("Vega Demo");
  await conv.page.locator("label", { hasText: /^N° doc$/ }).nth(1).locator("xpath=..").locator("input").fill("1020304059");
  await conv.page.locator("input[aria-label=\"Nacimiento\"]").nth(0).fill("01/01/1985"); await conv.page.locator("input[aria-label=\"Nacimiento\"]").nth(1).fill("02/02/1987"); await conv.page.keyboard.press("Tab");
  await conv.page.getByRole("button", { name: /Generar contrato\(s\)/ }).click();
  await conv.page.waitForURL(/\/dashboard\/contratos\//, { timeout: 60000 }).catch(() => {}); await conv.page.waitForTimeout(2000);
  const numero = decodeURIComponent(conv.page.url().split("/").pop() ?? "");
  ok(/^DTM-\d+$/.test(numero), `O3.5 se generó el contrato ${numero}`, conv.page.url());
  const pas = sql(`select string_agg(nombres || ' ' || apellidos || ':' || tipo_id || ':' || coalesce(identificacion,''), ' | ' order by orden) from public.contrato_pasajeros where numero_contrato = '${numero}'`);
  ok(/Laura Vega Demo:CE:1234567/.test(pas) && /Marco Vega Demo/.test(pas), `O3.5 el contrato guardó los dos pasajeros, el titular con su tipo CE (${pas})`);
  ok(sql(`select count(*) from public.abonos where numero_contrato = '${numero}'`) === "0", "O3.5 convertir NO crea abonos ni da por pagado nada");
  ok(sql(`select estado from public.cotizaciones where id = ${cotId}`) === "convertida", "O3.5 la cotización queda «convertida»");
  // 5) Reintento idempotente: la cotización ya no ofrece convertir otra vez.
  t = await ir(conv.page, `/dashboard/cotizaciones/${cotId}`);
  ok(/Convertida en/.test(t) && !(await conv.page.getByRole("button", { name: /Confirmar → generar contrato/ }).count()) && sql(`select count(*) from public.ventas where cliente ilike '%Vega Demo%'`) === "1", "O3.6 reintento: la cotización muestra «Convertida en…», sin botón, y sigue habiendo UN contrato");
  // 6) Soportes: el abono lo registra el personal; el aliado adjunta evidencia a SU contrato; el personal la ve; nada se vuelve pago.
  await adm.page.goto(`${C.APP}/dashboard/contratos/${numero}`, { waitUntil: "networkidle" });
  await adm.page.getByRole("button", { name: /^Cartera/ }).first().click().catch(() => {}); await adm.page.waitForTimeout(600);
  const form = adm.page.locator("form", { has: adm.page.getByRole("button", { name: "Registrar abono" }) }).first();
  await form.locator('input[type="number"]').first().fill("300000");
  await form.locator("select").first().selectOption({ index: 1 }); await form.locator('input[placeholder="Comprobante / nota"]').fill("TRANSF-O3-001");
  await form.getByRole("button", { name: "Registrar abono" }).click(); await adm.page.waitForTimeout(3000);
  ok(sql(`select count(*) from public.abonos where numero_contrato = '${numero}'`) === "1", "O3.7 el personal registró el pago (1 abono)");
  const abonosAntes = sql(`select count(*) || '/' || coalesce(sum(valor_abono),0) from public.abonos where numero_contrato = '${numero}'`);
  await camila.page.goto(`${C.APP}/portal/b2b/cartera?vista=soportes`, { waitUntil: "networkidle" });
  const tarjeta = camila.page.locator("article", { hasText: numero });
  t = norm(await tarjeta.innerText());
  ok(/Soportes vigentes:\s*0\s*de\s*1/.test(t), `O3.7 el portal muestra «Soportes vigentes: 0 de 1 pago registrado» para ${numero}`, t);
  const png = `${MUESTRAS}/firma-camila.png`, png2 = `${MUESTRAS}/logo-camila.png`;
  await tarjeta.locator('input[type="file"]').last().setInputFiles(png); await camila.page.waitForTimeout(3500);
  ok(sql(`select count(*) from public.contrato_soportes_pago where numero_contrato = '${numero}' and retirado_en is null`) === "1", "O3.7 el soporte quedó vigente (1)");
  ok(sql(`select count(*) || '/' || coalesce(sum(valor_abono),0) from public.abonos where numero_contrato = '${numero}'`) === abonosAntes, "O3.7 un soporte NO es un pago: los abonos no cambian");
  // límite: un segundo soporte distinto no se admite con 1 pago
  const hayExtra = await camila.page.locator("article", { hasText: numero }).getByRole("button", { name: "Subir soporte" }).isDisabled();
  ok(hayExtra, "O3.7 con un soporte por pago, «Subir soporte» queda deshabilitado (no se acumulan sin pagos)");
  // archivo no admitido (texto): rechazado, nada se registra
  const falso = join(OUT, "no-es-imagen.txt"); (await import("node:fs")).writeFileSync(falso, "esto no es un comprobante");
  await tarjeta.locator("li", { hasText: /\.png/ }).locator('input[type="file"]').setInputFiles(falso).catch(() => {}); await camila.page.waitForTimeout(2500);
  ok(sql(`select count(*) from public.contrato_soportes_pago where numero_contrato = '${numero}' and retirado_en is null`) === "1", "O3.7 un archivo que no es PDF/JPG/PNG se rechaza y no cambia nada");
  // el personal lo ve, con aviso
  t = await ir(adm.page, `/dashboard/contratos/${numero}`);
  ok(/Soportes de pago del aliado/.test(t) && /Un soporte no registra ni aprueba un pago/.test(t), "O3.8 el personal autorizado ve «Soportes de pago del aliado» en la ficha, aclarando que no es un pago", t.slice(0, 200));
  // otro aliado no ve nada
  const beto = await sesion("freelance2@revision.test");
  t = await ir(beto.page, "/portal/b2b/cartera?vista=soportes");
  ok(!new RegExp(numero).test(t), `O3.8 Beto (otro aliado) no ve ${numero} ni sus soportes`);
  // reemplazo: mismo conteo vigente, historial conservado
  await tarjeta.locator("li", { hasText: /\.png/ }).locator('input[type="file"]').setInputFiles(png2); await camila.page.waitForTimeout(3500);
  ok(sql(`select count(*) filter (where retirado_en is null) || '/' || count(*) from public.contrato_soportes_pago where numero_contrato = '${numero}'`) === "1/2", "O3.9 reemplazar mantiene 1 vigente y conserva el anterior en el historial (1/2)");
  // mismo archivo otra vez: sin duplicado
  await tarjeta.locator("li", { hasText: /\.png/ }).locator('input[type="file"]').setInputFiles(png2); await camila.page.waitForTimeout(2500);
  ok(sql(`select count(*) from public.contrato_soportes_pago where numero_contrato = '${numero}'`) === "2", "O3.9 reintento con el mismo archivo: no se crea otra fila");
  ok(sql(`select count(*) || '/' || coalesce(sum(valor_abono),0) from public.abonos where numero_contrato = '${numero}'`) === abonosAntes, "O3.9 tras reemplazar y reintentar, los abonos siguen intactos");
  t = await ir(adm.page, `/dashboard/contratos/${numero}`);
  ok(/Historial conservado \(1\)/.test(t), "O3.9 el personal ve «Historial conservado (1)»");
  await adm.page.screenshot({ path: join(OUT, "O3-contrato-soportes-personal.png"), fullPage: true });
  await camila.ctx.close(); await conv.ctx.close(); await adm.ctx.close(); await beto.ctx.close();
}

// ═══ O4 · «Olvidé mi contraseña» desde «Continúa tu registro» ═════════════════════════════════════════════════════════════════════════════
if (SEC.includes("O4")) {
  console.log("\n══ O4 · recuperación desde «Continúa tu registro» (visitante, EN UNA COPIA) ══");
  const X = (t) => `xpath=//label[normalize-space()="${t}"]`;
  const mails = async (para) => ((await (await fetch(`${MAIL}/api/v1/messages`)).json()).messages ?? []).filter((m) => (m.To ?? []).some((x) => x.Address === para)).sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
  const enlaceRecuperacion = async (para, antes) => { for (let i = 0; i < 40; i++) { const l = await mails(para); if (l.length > antes) { const c = await (await fetch(`${MAIL}/api/v1/message/${l[0].ID}`)).json(); const cuerpo = (c.HTML ?? "") + " " + (c.Text ?? ""); const m = cuerpo.match(/https?:\/\/[^"'\s<>]+(?:verify|callback)[^"'\s<>]*/i); if (m) return m[0].replace(/&amp;/g, "&"); } await new Promise((r) => setTimeout(r, 750)); } return null; };
  const p0 = await anonimo(); const p = p0.page;
  const correo = "continuar2@revision.test", vieja = "ClaveContinuar-2026", nueva = "NuevaClave-2026-O4";
  ok(sql(`select count(*) from public.b2b_solicitudes where lower(email) = '${correo}'`) === "0", `O4.0 ${correo} está verificado y SIN solicitud`);
  const confirmadoAntes = sql(`select email_confirmed_at is not null from auth.users where lower(email) = '${correo}'`);
  await p.goto(`${C.APP}/portal/registro`, { waitUntil: "networkidle" });
  await p.locator(`${X("Tipo de aliado")}/following-sibling::select[1]`).selectOption("freelance");
  await p.locator(`${X("Nombre / Razón social *")}/following-sibling::input[1]`).fill("Aliado Continuar Demo Dos");
  await p.locator(`${X("Tipo de documento *")}/following-sibling::select[1]`).selectOption("CC");
  await p.locator(`${X("Número de documento *")}/following-sibling::input[1]`).fill("1010101011");
  await p.locator(`${X("Correo *")}/following-sibling::input[1]`).fill(correo);
  await p.locator(`${X("Contraseña *")}/following-sibling::input[1]`).fill(vieja); await p.locator(`${X("Repetir contraseña *")}/following-sibling::input[1]`).fill(vieja);
  await p.getByRole("button", { name: "Continuar: enviar código al correo" }).click();
  ok(await p.getByTestId("paso-continuar").waitFor({ timeout: 25000 }).then(() => true).catch(() => false), "O4.1 aparece «Continúa tu registro»");
  const enlace = p.getByTestId("olvide-contrasena");
  ok(await enlace.count() === 1 && /Olvidé mi contraseña/.test(await enlace.innerText()), "O4.1 hay un enlace claro «Olvidé mi contraseña» en ese paso");
  await p.screenshot({ path: join(OUT, "O4-continua-registro.png") });
  const antesMails = (await mails(correo)).length;
  await enlace.click(); await p.waitForURL(/\/recuperar/, { timeout: 20000 }); await p.waitForTimeout(1200); let t;
  ok(/desde=registro/.test(p.url()) && (await p.locator("#correo-recuperar").inputValue()) === correo, "O4.2 /recuperar?desde=registro abre con el correo ya escrito");
  await p.getByRole("button", { name: /Enviar enlace/ }).click(); await p.waitForTimeout(2500);
  t = norm(await C.texto(p));
  ok(/Si el correo está registrado/.test(t) && /volverás a «Continúa tu registro»/.test(t), "O4.2 respuesta genérica («Si el correo está registrado…») y aviso de que se vuelve al registro", t.slice(0, 400));
  // respuesta genérica idéntica para un correo que no existe
  const p1 = await anonimo(); await p1.page.goto(`${C.APP}/recuperar`, { waitUntil: "networkidle" }); await p1.page.locator("#correo-recuperar").fill("no-existe-o4@revision.test");
  await p1.page.getByRole("button", { name: /Enviar enlace/ }).click(); await p1.page.waitForTimeout(2500);
  ok(/Si el correo está registrado/.test(norm(await C.texto(p1.page))), "O4.2 un correo inexistente recibe el MISMO mensaje genérico (no se enumera nada)");
  await p1.ctx.close();
  // El correo de recuperación llega; el enlace lleva al formulario de contraseña nueva
  const url = await enlaceRecuperacion(correo, antesMails);
  ok(!!url, "O4.3 el correo de recuperación llegó al correo de pruebas", String(url));
  if (url) {
    await p.goto(url, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
    ok(/\/restablecer/.test(p.url()), `O4.3 el enlace abre /restablecer (${p.url().replace(C.APP, "")})`);
    await p.locator('input[name="nueva"]').fill(nueva); await p.locator('input[name="confirmacion"]').fill(nueva);
    await p.getByRole("button", { name: "Guardar contraseña" }).click();
    await p.waitForURL(/\/portal\/registro\?retomar=1/, { timeout: 30000 }).catch(() => {});
    ok(/\/portal\/registro\?retomar=1/.test(p.url()), `O4.4 tras cambiar la contraseña se vuelve a /portal/registro?retomar=1 (${p.url().replace(C.APP, "")})`);
    await p.waitForTimeout(1200);
    ok(await p.getByTestId("paso-continuar").count() === 1 && /Contraseña actualizada/.test(norm(await C.texto(p))), "O4.4 vuelve el paso «Continúa tu registro» con el aviso «Contraseña actualizada»");
    ok((await p.locator("#continuar-password").inputValue()) === "", "O4.4 la contraseña NO viene precargada (hay que escribir la nueva)");
    ok(sql(`select count(*) from public.b2b_solicitudes where lower(email) = '${correo}'`) === "0", "O4.4 hasta aquí NO existe ninguna solicitud (cambiar la contraseña no aprueba nada)");
    // la contraseña vieja ya no sirve
    await p.locator("#continuar-password").fill(vieja); await p.getByRole("button", { name: "Continuar y enviar solicitud" }).click(); await p.waitForTimeout(2000);
    ok(/No pudimos confirmar tu identidad/.test(norm(await C.texto(p))) && sql(`select count(*) from public.b2b_solicitudes where lower(email) = '${correo}'`) === "0", "O4.5 la contraseña VIEJA ya no continúa el registro y no crea solicitud");
    await p.locator("#continuar-password").fill(nueva); await p.getByRole("button", { name: "Continuar y enviar solicitud" }).click();
    ok(await p.getByText(/Revisaremos tu registro/).waitFor({ timeout: 25000 }).then(() => true).catch(() => false), "O4.5 la contraseña NUEVA completa: «¡Solicitud enviada! Revisaremos tu registro…»");
    ok(sql(`select count(*) from public.b2b_solicitudes where lower(email) = '${correo}'`) === "1", "O4.5 queda EXACTAMENTE UNA solicitud");
    ok(sql(`select email_confirmed_at is not null from auth.users where lower(email) = '${correo}'`) === confirmadoAntes, "O4.5 la verificación del correo no cambió (no hay verificación retroactiva)");
    ok(sql(`select activo::text from public.usuarios where lower(email) = '${correo}'`) === "false", "O4.5 la cuenta sigue inactiva hasta que el personal apruebe");
    // repetir la continuación no duplica
    await p.goto(`${C.APP}/portal/registro`, { waitUntil: "networkidle" });
    ok(sql(`select count(*) from public.b2b_solicitudes where lower(email) = '${correo}'`) === "1", "O4.5 volver a la pantalla no crea una segunda solicitud");
  }
  // Un registro SIN verificar: pedir recuperación no lo verifica ni crea solicitud
  const mailsAntes2 = (await mails("nuevo.aliado.o4@revision.test")).length;
  await p.goto(`${C.APP}/portal/registro`, { waitUntil: "networkidle" });
  await p.locator(`${X("Tipo de aliado")}/following-sibling::select[1]`).selectOption("freelance");
  await p.locator(`${X("Nombre / Razón social *")}/following-sibling::input[1]`).fill("Aliado Sin Verificar O4");
  await p.locator(`${X("Tipo de documento *")}/following-sibling::select[1]`).selectOption("CC");
  await p.locator(`${X("Número de documento *")}/following-sibling::input[1]`).fill("1030303030");
  await p.locator(`${X("Correo *")}/following-sibling::input[1]`).fill("nuevo.aliado.o4@revision.test");
  await p.locator(`${X("Contraseña *")}/following-sibling::input[1]`).fill("ClaveSinVerificar-1"); await p.locator(`${X("Repetir contraseña *")}/following-sibling::input[1]`).fill("ClaveSinVerificar-1");
  await p.getByRole("button", { name: "Continuar: enviar código al correo" }).click();
  await p.getByTestId("paso-codigo").waitFor({ timeout: 25000 }).catch(() => {});
  const pr = await anonimo(); await pr.page.goto(`${C.APP}/recuperar`, { waitUntil: "networkidle" }); await pr.page.locator("#correo-recuperar").fill("nuevo.aliado.o4@revision.test");
  await pr.page.getByRole("button", { name: /Enviar enlace/ }).click(); await pr.page.waitForTimeout(3000);
  ok(sql(`select email_confirmed_at is null from auth.users where lower(email) = 'nuevo.aliado.o4@revision.test'`) === "t" && sql(`select count(*) from public.b2b_solicitudes where lower(email) = 'nuevo.aliado.o4@revision.test'`) === "0",
    "O4.6 pedir recuperación para un registro SIN verificar no lo verifica ni crea solicitud (la verificación sigue siendo solo por código)");
  await pr.ctx.close(); await p0.ctx.close();
}

await browser.close();
console.log(`\n=== guion O1–O4: ${aciertos} OK, ${fallos} FALLO`);
process.exit(fallos ? 1 : 0);
