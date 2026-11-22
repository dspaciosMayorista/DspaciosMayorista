// Recorrido REAL (Edge + Playwright, build de producción local, base DESECHABLE) de O-3 y O-2 tras la revisión de Codex del 2026-11-21:
//   P  comprobante ANTES de la confirmación: el aliado adjunta evidencia a su cotización y el personal autorizado la ve antes de registrar un pago; subir NO crea ni aprueba un pago.
//   Q  pasajeros adicionales opcionales del aliado: se guardan en la solicitud y llegan a la conversión sin retipear.
//   R  administración (rol REAL del aviso, no superadmin) completa la conversión: el selector de asesor obligatorio trae una lista estrecha; otra agencia y otros roles, denegados.
//   S  documento: la misma regla al capturar (checkout) y al convertir.
//   T  modal de cotización por unidad (O-2) en la app compilada: ejemplo del dueño, menor incluido, menor que paga como adulto; el total cotizado = el guardado.
//   U  consumo (acciones y lecturas por paso, reposo) y presentación en escritorio, ancho intermedio y móvil.
// Uso (desde dspacios-travel/, pila arriba sobre la COPIA): REV_APP=http://localhost:3070 REV_CFG_DIR=<carpeta config> REV_DB=<base copia> REV_PG=pgb2b node supabase/scripts/localreview_integrado/guion_o3_completo.mjs <capturas> [P,Q,R,S,T,U]
// ESCRIBE datos: correr SOLO sobre una copia desechable de la base de revisión (nunca sobre rev_verif_int_revision).
import { pathToFileURL } from "node:url";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const WT = new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const C = await import(pathToFileURL(`${WT}/supabase/scripts/localreview/revision_comun.mjs`).href);
const OUT = process.argv[2] ?? "o3-capturas"; mkdirSync(OUT, { recursive: true });
const SEC = (process.argv[3] ?? "P,Q,R,S,T,V,W,X,Y,Z,ZR,U").split(",");
const BASE = process.env.REV_DB, CT = process.env.REV_PG ?? "pgb2b", DIR = process.env.REV_CFG_DIR;
if (!BASE || /^rev_verif_int_revision(_pristina)?$/.test(BASE)) throw new Error("REV_DB debe ser una COPIA desechable (nunca rev_verif_int_revision).");
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", "PGPASSWORD=postgres", CT, "psql", "-h", "127.0.0.1", "-U", "supabase_admin", "-d", BASE, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8" }).trim();
const MUESTRAS = `${DIR.replace(/\\/g, "/")}/muestras`;
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const sha = (ruta) => createHash("sha256").update(readFileSync(ruta)).digest("hex");
let fallos = 0, aciertos = 0;
const ok = (c, m, extra = "") => { console.log(`${c ? "OK   " : "FALLO"} ${m}${!c && extra ? "\n       → " + String(extra).slice(0, 600) : ""}`); if (c) aciertos++; else fallos++; };
const browser = await C.lanzar();
// La revisión es SOLO local: toda petición a un host que no sea localhost/127.0.0.1 (p. ej. Google Fonts) se aborta, para que ni la carga de página ni los tiempos dependan de internet.
const soloLocal = async (o) => { await o.ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (r) => (/fonts\.googleapis\.com/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: "text/css", body: "" }) : r.abort())); /* la hoja de fuentes se responde VACÍA: si se abortara, React la trata como error de recurso y rompe la hidratación */ return o; };
const sesion = async (email, vista = "escritorio") => { const o = await soloLocal(await C.abrir(browser, { vista })); await C.iniciarSesionUI(o.page, email); return o; };
const anonimo = async (vista = "escritorio") => soloLocal(await C.abrir(browser, { vista }));
const ir = async (page, ruta) => { await page.goto(C.APP + ruta, { waitUntil: "networkidle" }); return norm(await C.texto(page)); };
const campo = (page, etiqueta) => page.locator(`label:text-is("${etiqueta}")`).locator("xpath=..").locator("input").first();
const dinero = (n) => Number(String(n).replace(/[^\d]/g, ""));
const ANCHOS = [["escritorio", 1366, 900], ["intermedio", 820, 900], ["movil", 390, 844]];

async function buscar(page, { destino, vistaTabla = false, ida = "10/06/2030", regreso = "13/06/2030", adultos = "2", habitaciones = "1", menores = [] }) {
  await page.goto(`${C.APP}/tarifario`, { waitUntil: "networkidle" });
  if (vistaTabla) { const t = page.getByRole("button", { name: "Vista tabla" }); if (!(await t.count())) return false; await t.click(); }
  await page.getByRole("button", { name: /Porción terrestre/ }).first().click(); await page.waitForTimeout(800);
  await page.locator('button[role="combobox"]').first().click();
  await page.getByRole("option", { name: destino }).click();
  const f = (n) => page.locator(`input[aria-label="${n}"]:visible`).first();
  await f("Ida").fill(ida); await f("Ida").blur(); await f("Regreso").fill(regreso); await f("Regreso").blur();
  await campo(page, "Adultos").fill(adultos); await campo(page, "Habitaciones").fill(habitaciones);
  await page.getByLabel(/Menores \(0–17 años\)/).fill(String(menores.length));
  for (let i = 0; i < menores.length; i++) await campo(page, `Edad menor ${i + 1}`).fill(String(menores[i]));
  await page.getByRole("button", { name: /Buscar hoteles/ }).click();
  await page.waitForSelector('button:has-text("Buscar hoteles")', { timeout: 30000 });
  await page.waitForTimeout(2500);
  return true;
}
// Rectángulos de los controles visibles de una región: ¿se pisan entre sí? ¿se salen del ancho de la ventana?
async function geometria(page, selector) {
  return page.evaluate((sel) => {
    const raiz = document.querySelector(sel); if (!raiz) return { existe: false };
    const els = [...raiz.querySelectorAll("input, select, button, textarea")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; });
    const r = els.map((e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, t: (e.getAttribute("aria-label") || e.textContent || e.name || e.tagName).trim().slice(0, 30) }; });
    const pisan = [];
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j]; const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 2 && iy > 2) pisan.push(`${a.t} × ${b.t}`);
    }
    return { existe: true, n: r.length, pisan, fuera: r.filter((a) => a.x < -1 || a.x + a.w > window.innerWidth + 1).map((a) => a.t), desborde: document.documentElement.scrollWidth > window.innerWidth + 2 };
  }, selector);
}
async function presentacion(page, nombre, selector, archivo) {
  for (const [etq, w, h] of ANCHOS) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(500);
    const g = await geometria(page, selector);
    ok(g.existe && !g.desborde && g.pisan.length === 0 && g.fuera.length === 0, `U ${nombre} · ${etq} (${w}px): ${g.n ?? 0} controles, sin desborde horizontal, sin controles superpuestos ni fuera de la ventana`, JSON.stringify(g));
    if (archivo) await page.screenshot({ path: join(OUT, `${archivo}-${etq}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1366, height: 900 });
}
const peticiones = (page) => { const c = { acciones: 0, rest: 0, otras: 0, lista: [] }; page.on("request", (rq) => {
  const u = rq.url(); if (!u.startsWith(C.APP) && !u.startsWith(C.SUPA)) return;
  if (rq.method() === "POST" && rq.headers()["next-action"]) { c.acciones++; c.lista.push("accion"); } else if (u.startsWith(`${C.SUPA}/rest/v1`)) { c.rest++; c.lista.push("rest"); } else if (!/\/_next\/|\.(png|jpg|svg|ico|css|js|woff2?)(\?|$)/.test(u)) { c.otras++; c.lista.push(u.replace(C.APP, "").slice(0, 60)); } }); return c; };
const jwtDe = async (email) => (await (await fetch(`${C.SUPA}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: C.CFG.anonKey, "content-type": "application/json" }, body: JSON.stringify({ email, password: C.CLAVE }) })).json()).access_token;
const rest = async (token, ruta, init = {}) => { const r = await fetch(`${C.SUPA}/rest/v1/${ruta}`, { ...init, headers: { apikey: C.CFG.anonKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...(init.headers ?? {}) } }); let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ } return { status: r.status, json: j }; };

// Estado compartido entre secciones (P→Q→R→S se encadenan: una cotización, un recorrido).
let cot = { id: null, codigo: null }, numero = null;
const SHA_A = sha(`${MUESTRAS}/firma-camila.png`), SHA_B = sha(`${MUESTRAS}/logo-camila.png`);
const conteos = () => sql(`select (select count(*) from public.abonos) || '|' || (select count(*) from public.cotizacion_pagos_previos) || '|' || (select count(*) from public.ventas) || '|' || (select count(*) from public.contrato_soportes_pago)`);
const fakePng = join(OUT, "texto-disfrazado.png"); writeFileSync(fakePng, "esto no es una imagen, solo se llama .png");
const noImg = join(OUT, "no-es-imagen.txt"); writeFileSync(noImg, "esto no es un comprobante");
const objetos = () => Number(sql(`select count(*) from storage.objects where bucket_id = 'evidencias-cotizacion'`));
const consumo = []; // [paso, acciones, rest, otras]

let camila = null, adm = null;
if (SEC.some((s) => ["P", "Q", "R", "S"].includes(s))) {
  console.log("\n══ S.1 · entrada: el documento del titular se valida con la regla de la conversión (checkout real de la freelance) ══");
  camila = await sesion("freelance@revision.test");
  const cn = peticiones(camila.page);
  const antes = Number(sql(`select count(*) from public.cotizaciones where creado_por = 'freelance@revision.test' and tipo = 'carrito'`));
  await buscar(camila.page, { destino: "CARTAGENA O3" });
  await camila.page.getByRole("button", { name: /Agregar al carrito/ }).first().click(); await camila.page.waitForTimeout(1500);
  await camila.page.goto(`${C.APP}/tarifario/checkout`, { waitUntil: "networkidle" }); await camila.page.waitForTimeout(2500);
  const lab = (t) => camila.page.locator(`label:text-is("${t}")`).locator("xpath=..");
  const generar = camila.page.getByRole("button", { name: /Generar cotización y enviar solicitud/ });
  await lab("Nombres *").locator("input").fill("Laura"); await lab("Apellidos *").locator("input").fill("Vega Demo");
  await lab("Teléfono / WhatsApp *").locator("input").fill("3105550199"); await lab("Correo").locator("input").fill("laura.demo@revision.test");
  // (a) CE con letras: rechazado al escribir, sin crear nada.
  await lab("Tipo").locator("select").selectOption("CE"); await lab("Documento *").locator("input").fill("E1234567");
  await generar.click(); await camila.page.waitForTimeout(1200);
  let t = norm(await C.texto(camila.page));
  ok(/debe ser solo números \(excepto Pasaporte y PPT\)/.test(t), "S.1 CE «E1234567»: el checkout lo rechaza al capturar y dice por qué", t.slice(-300));
  ok(Number(sql(`select count(*) from public.cotizaciones where creado_por = 'freelance@revision.test' and tipo = 'carrito'`)) === antes, "S.1 el rechazo no creó ninguna cotización");
  // (b) letras SIN tipo: se pide el tipo (no se adivina «CC»).
  await lab("Tipo").locator("select").selectOption({ value: "" }); await generar.click(); await camila.page.waitForTimeout(1200);
  t = norm(await C.texto(camila.page));
  ok(/Elige el tipo de documento/.test(t), "S.1 letras sin tipo elegido: se pide elegir el tipo", t.slice(-300));
  // (c) Pasaporte con letras: válido (misma regla de la conversión).
  // (d) CE solo dígitos: se genera.
  await lab("Tipo").locator("select").selectOption("CE"); await lab("Documento *").locator("input").fill("1234567");
  consumo.push(["checkout hasta aquí", cn.acciones, cn.rest, cn.otras]);
  await generar.click();
  await camila.page.waitForSelector('text=/Ver la cotizaci|Cotización C-|C-0\\d+/', { timeout: 60000 }).catch(() => {}); await camila.page.waitForTimeout(2500);
  const f = sql(`select id || '|' || codigo || '|' || coalesce(payload->'cliente'->>'tipoDoc','') || '|' || coalesce(payload->'cliente'->>'numeroDoc','') || '|' || coalesce(pax,0) from public.cotizaciones where creado_por = 'freelance@revision.test' and tipo = 'carrito' order by id desc limit 1`).split("|");
  cot = { id: Number(f[0]), codigo: f[1] };
  ok(!!cot.id && /^C-/.test(cot.codigo ?? "") && f[2] === "CE" && f[3] === "1234567", `S.1 con CE «1234567» se generó ${cot.codigo} (id ${cot.id}, ${f[4]} viajeros) con el titular tal cual`, f.join("|"));
}

// ═══ Q + P · el aliado prepara su solicitud: pasajeros adicionales y comprobantes ════════════════════════════════════════════════════════════════
if (SEC.includes("Q") || SEC.includes("P")) {
  console.log("\n══ Q/P · portal del aliado: pasajeros adicionales opcionales y comprobantes (ANTES de cualquier contrato) ══");
  const cn = peticiones(camila.page);
  const cont0 = conteos();
  await ir(camila.page, "/portal/b2b/cotizaciones?vista=directas");
  const fila = camila.page.locator("tr", { hasText: cot.codigo });
  const panel = fila.locator("xpath=following-sibling::tr[1]").locator('[data-testid="preparacion-contrato"]');
  ok((await panel.count()) === 1, `Q/P ${cot.codigo} muestra su panel «Preparar la solicitud (opcional)» y NO obliga a usarlo`);
  await panel.locator("summary").click(); await camila.page.waitForTimeout(400);
  const resumen = () => panel.locator('[data-testid="preparacion-resumen"]').innerText();
  ok(/0 comprobante\(s\) · 0 pasajero\(s\) adicional/.test(norm(await resumen())), "Q/P el resumen parte en 0 comprobantes y 0 pasajeros adicionales (nada inventado)");
  // — Q: pasajero adicional —
  await panel.getByTestId("agregar-pasajero").click();
  const fs1 = panel.locator('[data-testid="pasajero-aliado"]').first();
  await fs1.locator("label", { hasText: /^Nombres$/ }).locator("xpath=..").locator("input").fill("Marco");
  await fs1.locator("label", { hasText: /^Apellidos$/ }).locator("xpath=..").locator("input").fill("Vega Demo");
  await fs1.locator("label", { hasText: /^Tipo doc$/ }).locator("xpath=..").locator("select").selectOption("CE");
  await fs1.locator("label", { hasText: /^N° doc$/ }).locator("xpath=..").locator("input").fill("E7654321");
  await panel.getByTestId("guardar-pasajeros").click(); await camila.page.waitForTimeout(1500);
  ok(/solo números/.test(norm(await panel.innerText())) && sql(`select count(*) from public.cotizacion_pasajeros_aliado where cotizacion_id = ${cot.id}`) === "0", "Q un CE con letras se rechaza al guardar (misma regla que la conversión) y no se guarda nada", norm(await panel.innerText()).slice(-200));
  await fs1.locator("label", { hasText: /^N° doc$/ }).locator("xpath=..").locator("input").fill("7654321");
  await panel.locator('input[aria-label="Nacimiento pasajero 2"]').fill("02/02/1987"); await camila.page.keyboard.press("Tab");
  await panel.getByTestId("guardar-pasajeros").click(); await camila.page.waitForTimeout(2000);
  const guardado = sql(`select pasajeros::text from public.cotizacion_pasajeros_aliado where cotizacion_id = ${cot.id}`);
  const pj = guardado ? JSON.parse(guardado) : [];
  ok(pj.length === 1 && pj[0].nombres === "Marco" && pj[0].apellidos === "Vega Demo" && pj[0].tipoDoc === "CE" && pj[0].numeroDoc === "7654321" && pj[0].fechaNacimiento === "1987-02-02", `Q el pasajero adicional quedó guardado tal como se escribió (${guardado})`);
  ok((await panel.getByTestId("agregar-pasajero").count()) === 0, "Q con 2 viajeros cotizados el universo está completo (titular + 1): «Agregar pasajero» ya NO se ofrece");
  ok(/1 pasajero\(s\) adicional/.test(norm(await resumen())), "Q tras guardar, el resumen dice 1 pasajero adicional (el servidor releyó lo guardado)");
  // recarga: lo guardado sigue ahí
  await ir(camila.page, "/portal/b2b/cotizaciones?vista=directas");
  const panel2 = camila.page.locator("tr", { hasText: cot.codigo }).locator("xpath=following-sibling::tr[1]").locator('[data-testid="preparacion-contrato"]');
  await panel2.locator("summary").click();
  ok((await panel2.locator('[data-testid="pasajero-aliado-resumen"]').count()) === 1 && (await panel2.locator('[data-testid="pasajero-aliado"]').count()) === 0, "Q al recargar, el pasajero guardado llega COMPACTO (resumen), no como formulario expandido");
  await panel2.getByTestId("editar-pasajero").click();
  ok((await panel2.locator('[data-testid="pasajero-aliado"] input').first().inputValue()) === "Marco", "Q al recargar, el pasajero adicional sigue precargado en el portal");
  // — P: comprobantes —
  const adj = (p) => panel2.locator('input[type="file"]').setInputFiles(p).then(() => panel2.getByTestId("adjuntar-evidencia").click()).then(() => camila.page.waitForTimeout(3500));
  const o0 = objetos();
  await adj(`${MUESTRAS}/firma-camila.png`);
  const r1 = sql(`select count(*) || '|' || coalesce(max(sha256),'') || '|' || coalesce(max(size_bytes)::text,'') from public.cotizacion_evidencias where cotizacion_id = ${cot.id} and vigente`).split("|");
  ok(r1[0] === "1" && r1[1] === SHA_A, `P el comprobante quedó vigente en la cotización y su huella coincide con la del archivo (${r1[1]?.slice(0, 12)}…)`, r1.join("|"));
  ok(objetos() === o0 + 1, "P el archivo se guardó en el bucket privado (un objeto más)");
  ok(conteos() === cont0, "P adjuntar NO crea ni aprueba un pago: abonos, pagos previos, contratos y soportes de contrato idénticos", `${cont0} → ${conteos()}`);
  for (const [p, que] of [[noImg, "un .txt"], [fakePng, "un texto disfrazado de .png"]]) {
    await adj(p);
    const t2 = norm(await panel2.innerText());
    ok(/Solo se admiten archivos PDF, JPG o PNG/.test(t2) && sql(`select count(*) from public.cotizacion_evidencias where cotizacion_id = ${cot.id}`) === "1" && objetos() === o0 + 1, `P ${que} se rechaza por su contenido real: sin fila nueva ni objeto nuevo`, t2.slice(-200));
  }
  await adj(`${MUESTRAS}/firma-camila.png`);
  ok(sql(`select count(*) from public.cotizacion_evidencias where cotizacion_id = ${cot.id}`) === "1" && objetos() === o0 + 1, "P reintento con el MISMO archivo: sin fila ni objeto duplicados (idempotente)");
  await adj(`${MUESTRAS}/logo-camila.png`);
  ok(sql(`select count(*) from public.cotizacion_evidencias where cotizacion_id = ${cot.id} and vigente`) === "2", "P un segundo archivo distinto queda vigente (2)");
  await panel2.getByRole("button", { name: /Retirar logo-camila\.png/ }).click(); await camila.page.waitForTimeout(2000);
  ok(sql(`select count(*) filter (where vigente) || '/' || count(*) from public.cotizacion_evidencias where cotizacion_id = ${cot.id}`) === "1/2" && objetos() === o0 + 2, "P retirar conserva la fila (vigente 1 de 2) y el archivo (el objeto no se borra)");
  ok(sql(`select count(*) from public.cotizacion_evidencias where cotizacion_id = ${cot.id} and not vigente and retirado_por is not null and retirado_en is not null`) === "1", "P el retiro deja constancia de quién y cuándo");
  ok(conteos() === cont0, "P tras subir, rechazar, repetir y retirar, el dinero sigue intacto");
  consumo.push(["portal: guardar pasajeros + 7 operaciones de comprobante", cn.acciones, cn.rest, cn.otras]);
  await presentacion(camila.page, "portal del aliado (panel abierto)", '[data-testid="preparacion-contrato"][open]', "U-portal-panel");

  // — Aislamiento entre aliados —
  console.log("\n══ Q/P · otro aliado y otros roles NO alcanzan esta evidencia ni estos pasajeros ══");
  const beto = await sesion("freelance2@revision.test");
  let tb = await ir(beto.page, "/portal/b2b/cotizaciones?vista=directas") + " " + await ir(beto.page, "/portal/b2b/cotizaciones?vista=asistidas");
  ok(!new RegExp(cot.codigo).test(tb) && !/Marco/.test(tb), `P Beto (otro aliado) no ve ${cot.codigo} ni a Marco en su portal (ni en Directas ni en Asistidas)`);
  await beto.ctx.close();
  const TB = await jwtDe("freelance2@revision.test"), TC = await jwtDe("freelance@revision.test");
  for (const [quien, tk] of [["Beto (otro aliado)", TB], ["Camila (la dueña)", TC], ["visitante anónimo", null]]) {
    const a = await rest(tk, "cotizacion_evidencias?select=id"), b = await rest(tk, "cotizacion_pasajeros_aliado?select=cotizacion_id");
    const vacio = (x) => (x.status === 200 && Array.isArray(x.json) && x.json.length === 0) || x.status === 401 || x.status === 403;
    ok(vacio(a) && vacio(b), `P ${quien}: por la API directa (RLS) no lee evidencias ni pasajeros guardados (${a.status}/${b.status})`, JSON.stringify([a.json, b.json]).slice(0, 200));
  }
  const rpcDirecto = await rest(TB, "rpc/evidencia_cotizacion_registrar", { method: "POST", body: JSON.stringify({ p_cotizacion_id: cot.id, p_actor: "00000000-0000-0000-0000-000000000000", p_path: "x", p_nombre: "x", p_mime: "image/png", p_size: 1, p_sha: "a".repeat(64) }) });
  const rpcPas = await rest(TB, "rpc/cotizacion_pasajeros_aliado_guardar", { method: "POST", body: JSON.stringify({ p_cotizacion_id: cot.id, p_actor: "00000000-0000-0000-0000-000000000000", p_pasajeros: [] }) });
  ok([rpcDirecto, rpcPas].every((x) => x.status === 401 || x.status === 403 || x.status === 404), `P un aliado no puede llamar las funciones de escritura desde el navegador (solo el servidor: ${rpcDirecto.status}/${rpcPas.status})`, JSON.stringify([rpcDirecto.json, rpcPas.json]).slice(0, 200));
}

// ═══ solicitud + R · el personal REAL (administración) ve la evidencia ANTES, y completa la conversión ═════════════════════════════════════════════
if (SEC.includes("R") || SEC.includes("P")) {
  console.log("\n══ R · solicitud → aviso → administración@ (rol real del aviso) ve la evidencia ANTES de pagar y convierte ══");
  await camila.page.goto(`${C.APP}/portal/b2b/cotizaciones?vista=directas`, { waitUntil: "networkidle" });
  await camila.page.locator("tr", { hasText: cot.codigo }).getByRole("button", { name: "Solicitar contrato" }).click(); await camila.page.waitForTimeout(2500);
  ok(sql(`select count(*) from public.cotizacion_solicitudes_contrato where cotizacion_id = ${cot.id} and estado = 'solicitada'`) === "1", "R la solicitud de contrato queda registrada (un evento)");
  ok(sql(`select count(*) from public.cotizacion_evidencias where cotizacion_id = ${cot.id} and vigente`) === "1" && sql(`select count(*) from public.cotizacion_pasajeros_aliado where cotizacion_id = ${cot.id}`) === "1", "R solicitar no tocó la evidencia ni los pasajeros ya preparados");

  // FIXTURE (solo en la copia desechable): un asesor `venta` de la OTRA agencia y uno INACTIVO; ninguno debe aparecer en el selector de administración (mayorista).
  sql(`update public.usuarios set tenant = 'minorista' where lower(email) = 'venta2@revision.test'; update public.usuarios set activo = false where lower(email) = 'venta127@revision.test'`);
  adm = await sesion("administracion@revision.test");
  const cn = peticiones(adm.page);
  await ir(adm.page, "/dashboard");
  const campana = adm.page.getByRole("button", { name: /avisos|notificaciones|campana/i }).first();
  if (await campana.count()) { await campana.click(); await adm.page.waitForTimeout(900); }
  let t = norm(await C.texto(adm.page));
  ok(new RegExp(`Solicitud de contrato de un aliado: cotización ${cot.codigo}`).test(t), "R la campana de administración@ avisa de la solicitud");
  const c0 = conteos();
  t = await ir(adm.page, `/dashboard/cotizaciones/${cot.id}`);
  ok(/Evidencia previa del aliado \(1 vigente\)/.test(t) && /Es evidencia adjunta por el aliado, no un pago/.test(t), "R administración ve «Evidencia previa del aliado (1 vigente)» y que NO es un pago, ANTES de cualquier pago", t.slice(0, 300));
  const yEv = await adm.page.getByTestId("evidencia-aliado").evaluate((e) => e.getBoundingClientRect().top + scrollY);
  const yConv = await adm.page.getByRole("button", { name: /Confirmar → generar contrato/ }).evaluate((e) => e.getBoundingClientRect().top + scrollY);
  ok(yEv < yConv, "R la evidencia aparece ARRIBA del botón de generar contrato (se ve antes de confirmar)");
  const [popup] = await Promise.all([adm.page.waitForEvent("popup", { timeout: 15000 }).catch(() => null), adm.page.getByRole("button", { name: "Abrir" }).first().click()]);
  if (popup) {
    await popup.waitForURL(/^https?:/, { timeout: 15000 }).catch(() => {});
    const url = popup.url(); await popup.close();
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    ok(createHash("sha256").update(bytes).digest("hex") === SHA_A, "R «Abrir» entrega el archivo exacto que subió la aliada (URL firmada de 2 min; misma huella)");
  } else ok(false, "R «Abrir» no abrió el archivo");
  ok(conteos() === c0, "R mirar y abrir la evidencia no registra nada: dinero idéntico");
  await presentacion(adm.page, "cotización — evidencia previa (personal)", '[data-testid="evidencia-aliado"]', "U-staff-evidencia");

  // — selector de asesor con el rol REAL —
  await adm.page.getByRole("button", { name: /Confirmar → generar contrato/ }).click(); await adm.page.waitForTimeout(800); await reabrirTodas(adm.page);
  const sel = adm.page.locator("select").filter({ has: adm.page.locator("option", { hasText: "Elegir asesor" }) }).first();
  const opciones = (await sel.locator("option").allInnerTexts()).map(norm).filter((x) => !/Elegir asesor/.test(x)).sort();
  const esperadas = sql(`select nombre from public.usuarios where rol = 'venta' and activo and tenant = 'mayorista' order by nombre`).split("\n").map(norm).filter(Boolean).sort();
  ok(opciones.length > 0 && JSON.stringify(opciones) === JSON.stringify(esperadas), `R administración@ ve el selector OBLIGATORIO con ${opciones.length} asesor(es) venta de SU agencia y activos (antes: vacío; el de la otra agencia y el inactivo NO salen): ${opciones.join(", ")}`, `${JSON.stringify(opciones)} vs ${JSON.stringify(esperadas)}`);
  // — filas de pasajeros —
  const v = async (i, etiqueta) => adm.page.locator("label", { hasText: new RegExp(`^${etiqueta}$`) }).nth(i).locator("xpath=..").locator("input,select").first().inputValue();
  const filas = await adm.page.locator("label", { hasText: /^Nombres$/ }).count();
  ok(filas === 2 && (await v(0, "Nombres")) === "Laura" && (await v(0, "Tipo doc")) === "CE" && (await v(0, "N° doc")) === "1234567", `R la fila 1 es la titular (Laura Vega Demo · CE 1234567) — ${filas} filas`);
  ok((await v(1, "Nombres")) === "Marco" && (await v(1, "Apellidos")) === "Vega Demo" && (await v(1, "Tipo doc")) === "CE" && (await v(1, "N° doc")) === "7654321", "Q la fila 2 llega con lo que la aliada escribió (Marco Vega Demo · CE 7654321), SIN retipear");
  ok(/1987/.test(await adm.page.locator('input[aria-label="Nacimiento"]').nth(1).inputValue()) || /02\/02\/1987|1987-02-02/.test(await adm.page.locator('input[aria-label="Nacimiento"]').nth(1).inputValue()), "Q la fecha de nacimiento del pasajero adicional también llegó");
  await adm.page.screenshot({ path: join(OUT, "R-conversion-captura.png"), fullPage: true });
  await adm.page.evaluate(() => { const s = document.querySelector("#moneda-cobro-carrito-select"); if (s) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "COP"); s.dispatchEvent(new Event("change", { bubbles: true })); } });
  // — rechazos —
  const generarC = adm.page.getByRole("button", { name: /Generar contrato\(s\)/ });
  await generarC.click(); await adm.page.waitForTimeout(1200);
  t = norm(await C.texto(adm.page));
  ok(/Elige el asesor interno/.test(t) && sql(`select count(*) from public.ventas where cliente ilike '%Vega Demo%'`) === "0", "R sin asesor la conversión sigue exigiéndolo (administración no es superadmin) y no crea nada");
  await sel.selectOption({ label: opciones[0] });
  const docMarco = adm.page.locator("label", { hasText: /^N° doc$/ }).nth(1).locator("xpath=..").locator("input");
  await docMarco.fill("E7654321"); await generarC.click(); await adm.page.waitForTimeout(1200);
  t = norm(await C.texto(adm.page));
  ok(/Pasajero 2: el documento debe ser solo números/.test(t) && sql(`select count(*) from public.ventas where cliente ilike '%Vega Demo%'`) === "0", "S.2 al convertir, un CE con letras se rechaza ANTES de enviar con la misma regla de la captura");
  await docMarco.fill("7654321");
  // el titular no trae fecha de nacimiento (el checkout no la pide): el personal la completa; es lo único que falta.
  await adm.page.locator('input[aria-label="Nacimiento"]').nth(0).fill("01/01/1985"); await adm.page.keyboard.press("Tab");
  await generarC.click();
  await adm.page.waitForURL(/\/dashboard\/contratos\//, { timeout: 60000 }).catch(() => {}); await adm.page.waitForTimeout(2500);
  numero = decodeURIComponent(adm.page.url().split("/").pop() ?? "");
  ok(/^DTM-\d+$/.test(numero), `R administración@ (no superadmin) generó el contrato ${numero}`, adm.page.url());
  const pas = sql(`select string_agg(nombres || ' ' || apellidos || ':' || tipo_id || ':' || coalesce(identificacion,'') || ':' || coalesce(fecha_nacimiento::text,''), ' | ' order by orden) from public.contrato_pasajeros where numero_contrato = '${numero}'`);
  ok(/Laura Vega Demo:CE:1234567:1985-01-01/.test(pas) && /Marco Vega Demo:CE:7654321:1987-02-02/.test(pas), `Q el contrato conservó a los dos pasajeros tal como los escribieron la aliada y el personal (${pas})`);
  ok(sql(`select asesor from public.ventas where numero_contrato = '${numero}'`) === opciones[0], "R el asesor elegido quedó en el contrato");
  ok(sql(`select count(*) from public.abonos where numero_contrato = '${numero}'`) === "0", "P/R convertir NO crea abonos: el comprobante sigue siendo evidencia, no dinero");
  t = norm(await C.texto(adm.page));
  ok(/Evidencia previa del aliado \(1 vigente\)/.test(t) && /registrar un abono/.test(t), "P en la ficha del CONTRATO la evidencia sigue visible antes de registrar el abono");
  await presentacion(adm.page, "contrato — evidencia previa (personal)", '[data-testid="evidencia-aliado"]', "U-contrato-evidencia");
  consumo.push(["personal: abrir cotización + evidencia + convertir", cn.acciones, cn.rest, cn.otras]);
  // reintento
  t = await ir(adm.page, `/dashboard/cotizaciones/${cot.id}`);
  ok(/Convertida en/.test(t) && !(await adm.page.getByRole("button", { name: /Confirmar → generar contrato/ }).count()) && sql(`select count(*) from public.ventas where cliente ilike '%Vega Demo%'`) === "1", "R reintento: la cotización dice «Convertida en…», sin botón, y hay UN solo contrato");
  ok(/Evidencia previa del aliado/.test(t), "P la cotización convertida conserva visible su evidencia");
  // el pago lo registra el personal DESPUÉS de ver la evidencia
  await adm.page.goto(`${C.APP}/dashboard/contratos/${numero}`, { waitUntil: "networkidle" });
  await adm.page.getByRole("button", { name: /^Cartera/ }).first().click().catch(() => {}); await adm.page.waitForTimeout(600);
  const form = adm.page.locator("form", { has: adm.page.getByRole("button", { name: "Registrar abono" }) }).first();
  await form.locator('input[type="number"]').first().fill("300000");
  await form.locator("select").first().selectOption({ index: 1 }); await form.locator('input[placeholder="Comprobante / nota"]').fill("TRANSF-O3B-001");
  await form.getByRole("button", { name: "Registrar abono" }).click(); await adm.page.waitForTimeout(3000);
  ok(sql(`select count(*) from public.abonos where numero_contrato = '${numero}'`) === "1" && sql(`select count(*) from public.cotizacion_evidencias where cotizacion_id = ${cot.id} and vigente`) === "1", "P el pago existe SOLO porque el personal lo registró; la evidencia sigue igual (vigente, sin vincularse sola)");

  // — Otra agencia y otros roles —
  console.log("\n══ R · aislamiento de agencia y de roles ══");
  const min = await sesion("minorista@revision.test");
  const tm = await ir(min.page, `/dashboard/cotizaciones/${cot.id}`);
  ok(!/Evidencia previa/.test(tm) && !/Laura|Marco/.test(tm), "R el administrador de la OTRA agencia (minorista) no ve la cotización, ni su evidencia, ni sus pasajeros", tm.slice(0, 200));
  await min.ctx.close();
  const roles = { "gerencia@revision.test": [true, true], "operaciones@revision.test": [true, true], "venta@revision.test": [false, true], "minorista@revision.test": [false, false] };
  for (const [email, [veEv, vePas]] of Object.entries(roles)) {
    const tk = await jwtDe(email);
    const e = await rest(tk, `cotizacion_evidencias?cotizacion_id=eq.${cot.id}&select=id`), p = await rest(tk, `cotizacion_pasajeros_aliado?cotizacion_id=eq.${cot.id}&select=cotizacion_id`);
    ok((e.json?.length > 0) === veEv && (p.json?.length > 0) === vePas, `R por la API con ${email}: evidencia ${veEv ? "visible" : "NO visible"}, pasajeros del aliado ${vePas ? "visibles" : "NO visibles"} (obtenido ${e.json?.length ?? "?"}/${p.json?.length ?? "?"})`, JSON.stringify([e, p]).slice(0, 200));
  }
  const tAdm = await jwtDe("administracion@revision.test");
  const lista = await rest(tAdm, "usuarios?select=nombre,rol&rol=eq.venta");
  ok(Array.isArray(lista.json) && lista.json.length === 0, "R la solución NO abrió `usuarios`: por la API administración@ sigue sin poder listar asesores (la lista sale solo en esta pantalla, con nombre y correo)");
}

// ═══ T · el modal de cotización por unidad (O-2) en la app compilada ═══════════════════════════════════════════════════════════════════════════════
if (SEC.includes("T")) {
  console.log("\n══ T · modal «Cotizar» del hotel por unidad (CARTAGENA U1) en la app compilada ══");
  // FIXTURE (solo en la copia desechable): la oferta del hotel por unidad se marca «recomendada» para que la exploración sin búsqueda muestre su tarjeta, que es la que abre el modal.
  sql(`update public.armado_hoteles set prioridad = 1 where paquete_id = 10311 and hotel_id = 10311`);
  const casos = [
    { etiqueta: "ejemplo del dueño: niño de 8 (cargo propio) + infante de 2 (incluido)", menores: [8, 2], total: 750000, base: 600000, cargos: 150000, equiv: 300000, comoAdulto: false },
    { etiqueta: "solo un menor INCLUIDO (infante de 2)", menores: [2], total: 600000, base: 600000, cargos: 0, equiv: 300000, comoAdulto: false },
    { etiqueta: "un menor que PAGA COMO ADULTO (14 años)", menores: [14], total: 900000, base: null, cargos: 0, equiv: null, comoAdulto: true },
  ];
  for (const [etiqueta, abrir] of [["visitante", anonimo], ["administracion@ (personal)", () => sesion("administracion@revision.test")]]) {
    for (const caso of casos) {
      const o = await abrir(); const page = o.page;
      // Exploración (sin búsqueda): la tarjeta «recomendada» del hotel por unidad abre el modal «Cotizar» (HotelBernaloCotizarModal).
      await page.goto(`${C.APP}/tarifario`, { waitUntil: "networkidle" });
      const vb = page.getByRole("button", { name: "Vista Booking" }); if (await vb.count()) await vb.first().click().catch(() => {});
      await page.getByRole("button", { name: /Porción terrestre/ }).first().click(); await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "Ver opciones de U1 · Hotel por unidad con edades" }).click().catch(() => {}); await page.waitForTimeout(2000);
      const dialogo = page.locator(".fixed.inset-0").first();
      ok((await dialogo.count()) > 0, `T ${etiqueta} · ${caso.etiqueta}: se abre el modal «Cotizar» del hotel por unidad`);
      if (!(await dialogo.count())) { await page.screenshot({ path: join(OUT, `T-sin-modal-${etiqueta.split(" ")[0]}.png`), fullPage: true }); await o.ctx.close(); continue; }
      await dialogo.locator("input").nth(1).fill("1"); // 1 habitación Doble = 2 adultos
      await dialogo.locator("select").nth(0).selectOption({ label: "Estandar" }); await dialogo.locator("select").nth(1).selectOption({ label: "PAM" });
      await dialogo.locator('input[aria-label="Entrada"]').fill("10/06/2030"); await page.keyboard.press("Tab");
      await dialogo.locator('input[aria-label="Salida"]').fill("13/06/2030"); await page.keyboard.press("Tab");
      await dialogo.locator('input[id$="-doble-0-cant"]').fill(String(caso.menores.length)); await page.waitForTimeout(600);
      for (let i = 0; i < caso.menores.length; i++) await dialogo.locator(`input[id$="-doble-0-edad-${i}"]`).fill(String(caso.menores[i]));
      const cot0 = dialogo.getByRole("button", { name: /^Cotizar$|^Recotizar$/ });
      if (await cot0.count()) { await cot0.first().click(); await page.waitForTimeout(3500); }
      const d = dialogo.locator('[data-testid="desglose-unidad"]');
      const tot = norm(await dialogo.innerText());
      const mTotal = tot.match(/Total solicitado[^$]*\$\s*([\d.]+)/);
      const total = mTotal ? dinero(mTotal[1]) : null;
      ok(total === caso.total, `T ${etiqueta} · ${caso.etiqueta}: el modal cotiza ${caso.total.toLocaleString("es-CO")} (calculado a mano: ${caso.etiqueta.includes("14") ? "2 adultos 600.000 + menor como adulto 300.000" : "2 adultos × 3 noches × 100.000 + cargos propios"}); obtenido ${total}`, tot.slice(0, 500));
      if ((await d.count()) > 0) {
        const base = dinero(await d.locator('[data-testid="desglose-base"] dd').innerText());
        const cargos = (await d.locator('[data-testid="desglose-cargos"] dd').count()) ? dinero(await d.locator('[data-testid="desglose-cargos"] dd').innerText()) : 0;
        const eq = (await d.locator('[data-testid="desglose-equivalente"]').count()) ? norm(await d.locator('[data-testid="desglose-equivalente"]').innerText()) : "";
        const dt = norm(await d.innerText());
        ok(base + cargos === total, `T ${etiqueta} · ${caso.etiqueta}: base ${base} + cargos propios ${cargos} = total ${total} (nada contado dos veces)`, dt);
        if (caso.base != null) ok(base === caso.base && cargos === caso.cargos, `T ${etiqueta} · ${caso.etiqueta}: base ${caso.base} y cargos ${caso.cargos} como en el cálculo a mano`, dt);
        if (caso.equiv != null) ok(new RegExp(`equivalente informativo ≈ \\$\\s*${String(caso.equiv).replace(/(\d)(?=(\d{3})+$)/g, "$1.")} c/u`).test(eq) && /el precio real es por unidad, no por persona/.test(eq), `T ${etiqueta} · ${caso.etiqueta}: equivalente informativo ≈ ${caso.equiv} c/u, marcado como informativo`, eq);
        if (caso.comoAdulto) ok(eq === "" && /paga como adulto|como adulto/i.test(dt), `T ${etiqueta} · ${caso.etiqueta}: NO se ofrece equivalente por adulto y se dice que paga como adulto`, dt);
        if (etiqueta === "visitante") {
          for (const [etq, w, h] of ANCHOS) {
            await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(400); await d.scrollIntoViewIfNeeded();
            const bb = await d.boundingBox(); const desb = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
            ok(!!bb && bb.x >= -1 && bb.x + bb.width <= w + 1 && !desb, `T modal · ${caso.menores.join("+")} años · ${etq} (${w}px): el desglose cabe en el ancho de la ventana, sin desborde horizontal`, JSON.stringify(bb));
            await page.screenshot({ path: join(OUT, `T-modal-${caso.menores.join("-")}-${etq}.png`), fullPage: false });
          }
          await page.setViewportSize({ width: 1366, height: 900 });
        }
      } else ok(false, `T ${etiqueta} · ${caso.etiqueta}: el modal no muestra el desglose`, tot.slice(0, 400));
      // «Recotizar» no cambia el total (el equivalente nunca altera lo cotizado)
      const rec = dialogo.getByRole("button", { name: /^Recotizar$/ });
      if (await rec.count()) { await rec.click(); await page.waitForTimeout(3000); const t2 = norm(await dialogo.innerText()).match(/Total solicitado[^$]*\$\s*([\d.]+)/); ok(t2 && dinero(t2[1]) === total, `T ${etiqueta} · ${caso.etiqueta}: recotizar devuelve el mismo total`); }
      // visitante, caso del dueño: agregar al carrito → generar la cotización → el total GUARDADO es el cotizado
      if (etiqueta === "visitante" && caso.menores.length === 2) {
        const antes = Number(sql(`select count(*) from public.cotizaciones where tipo = 'carrito' and creado_por is null`));
        const agregar = dialogo.getByRole("button", { name: /Agregar al carrito|Agregar/ }).last();
        await agregar.click().catch(() => {}); await page.waitForTimeout(1500);
        await page.goto(`${C.APP}/tarifario/checkout`, { waitUntil: "networkidle" }); await page.waitForTimeout(2500);
        const lab = (t) => page.locator(`label:text-is("${t}")`).locator("xpath=..");
        await lab("Nombres *").locator("input").fill("Visitante"); await lab("Apellidos *").locator("input").fill("Unidad O2");
        await lab("Tipo").locator("select").selectOption("CC"); await lab("Documento *").locator("input").fill("9876543");
        await lab("Teléfono / WhatsApp *").locator("input").fill("3100000000");
        await page.getByRole("button", { name: /Generar cotización y enviar solicitud/ }).click();
        await page.waitForSelector('text=/Ver la cotizaci|Cotización C-|C-0\\d+/', { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(2500);
        const g = sql(`select precio_venta || '|' || codigo from public.cotizaciones where tipo = 'carrito' and payload->'cliente'->>'numeroDoc' = '9876543' order by id desc limit 1`).split("|");
        ok(Number(g[0]) === 750000, `T el total GUARDADO de la cotización (${g[1]}) es 750.000, el mismo del modal: el equivalente informativo no lo cambió`, g.join("|"));
      }
      await o.ctx.close();
    }
  }
}

// ═══ Helpers de las secciones V/W/X (R325 ronda 2) ═══════════════════════════════════════════════════════════════════════════════════════════
const pngUnico = (n) => { const p = join(OUT, `unico-${n}.png`); writeFileSync(p, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`evidencia sintetica ${n} ${Math.random()}`)])); return p; };
const panelDe = (page, codigo) => page.locator("tr", { hasText: codigo }).locator("xpath=following-sibling::tr[1]").locator('[data-testid="preparacion-contrato"]');
const abrirPanel = async (page, codigo, vista = "directas") => { await ir(page, `/portal/b2b/cotizaciones?vista=${vista}`); const p = panelDe(page, codigo); await p.locator("summary").click(); await page.waitForTimeout(300); return p; };
/** Cotización del carrito de Camila por el checkout REAL (devuelve id y código). */
async function cotizacionCarritoCamila(page, { destino, ida, regreso, menores = [], adultos = "2", habitaciones = "1", modo = "comisionable", nombres, apellidos, tipoDoc = "CE", doc }) {
  const antes = Number(sql(`select coalesce(max(id),0) from public.cotizaciones where creado_por = 'freelance@revision.test' and tipo = 'carrito'`));
  await buscar(page, { destino, ida, regreso, menores, adultos, habitaciones });
  await page.getByRole("button", { name: /Agregar al carrito/ }).first().click(); await page.waitForTimeout(1500);
  await page.goto(`${C.APP}/tarifario/checkout`, { waitUntil: "networkidle" }); await page.waitForTimeout(2500);
  const lab = (t) => page.locator(`label:text-is("${t}")`).locator("xpath=..");
  await page.getByRole("button", { name: modo === "neta" ? "Contrato neto" : "Contrato comisionable", exact: true }).click(); await page.waitForTimeout(800);
  await lab("Nombres *").locator("input").fill(nombres); await lab("Apellidos *").locator("input").fill(apellidos);
  await lab("Tipo").locator("select").selectOption(tipoDoc); await lab("Documento *").locator("input").fill(doc);
  await lab("Teléfono / WhatsApp *").locator("input").fill("3105550199");
  await page.getByRole("button", { name: /Generar cotización y enviar solicitud/ }).click();
  await page.waitForSelector('text=/Ver la cotizaci|Cotización C-|C-0\\d+/', { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(2500);
  const f = sql(`select id || '|' || codigo || '|' || pax from public.cotizaciones where creado_por = 'freelance@revision.test' and tipo = 'carrito' and id > ${antes} order by id desc limit 1`).split("|");
  return { id: Number(f[0]), codigo: f[1], pax: Number(f[2]) };
}
// Rellena y envía el formulario de pasajeros del panel del aliado.
async function escribirPasajeros(panel, lista) {
  for (const [i, p] of lista.entries()) {
    await panel.getByTestId("agregar-pasajero").click();
    const fs1 = panel.locator('[data-testid="pasajero-aliado"]').nth(i);
    await fs1.locator("label", { hasText: /^Nombres$/ }).locator("xpath=..").locator("input").fill(p.nombres);
    await fs1.locator("label", { hasText: /^Apellidos$/ }).locator("xpath=..").locator("input").fill(p.apellidos);
    if (p.tipoDoc) await fs1.locator("label", { hasText: /^Tipo doc$/ }).locator("xpath=..").locator("select").selectOption(p.tipoDoc);
    if (p.numeroDoc) await fs1.locator("label", { hasText: /^N° doc$/ }).locator("xpath=..").locator("input").fill(p.numeroDoc);
    if (p.nacimiento) { await fs1.locator(`input[aria-label="Nacimiento pasajero ${i + 2}"]`).fill(p.nacimiento); await panel.page().keyboard.press("Tab"); }
  }
  await panel.getByTestId("guardar-pasajeros").click(); await panel.page().waitForTimeout(2200);
}
// Corrección 2: las filas completas de la conversión llegan COMPACTAS (resumen + «Editar»); las secciones que leen campos las reabren primero (lo que también prueba que reabrir deja los datos intactos).
async function reabrirTodas(page) { for (let i = 0; i < 20; i++) { const b = page.locator('[data-testid="editar-pasajero"]').first(); if (!(await b.count())) break; await b.click(); await page.waitForTimeout(120); } }
const ddmmyyyy = (iso) => iso.split("-").reverse().join("/");
const filaVal = async (page, i, etiqueta) => page.locator("label", { hasText: new RegExp(`^${etiqueta}$`) }).nth(i).locator("xpath=..").locator("input,select").first().inputValue();
const pasajerosDe = (numero) => sql(`select string_agg(nombres || ' ' || apellidos || ':' || tipo_id || ':' || coalesce(identificacion,'') || ':' || coalesce(fecha_nacimiento::text,'') || ':' || es_infante::text || ':' || coalesce(responsable_id::text,'-'), ' | ' order by orden) from public.contrato_pasajeros where numero_contrato = '${numero}'`);

// ═══ V · carrera real: acción completa + Storage + compensación ══════════════════════════════════════════════════════════════════════════════
if (SEC.includes("V")) {
  console.log("\n══ V · carreras REALES de subida (acción de servidor + Storage + base) sobre UNA cotización ══");
  const base = await sesion("freelance@revision.test");
  const q = await cotizacionCarritoCamila(base.page, { destino: "CARTAGENA O3", ida: "10/06/2030", regreso: "13/06/2030", nombres: "Carrera", apellidos: "Subidas", doc: "7000001" });
  ok(!!q.id, `V cotización de prueba ${q.codigo} (id ${q.id})`);
  const dinero0 = conteos();
  const objetos = () => Number(sql(`select count(*) from storage.objects where bucket_id = 'evidencias-cotizacion' and name like '${q.id}/%'`));
  const filas = () => Number(sql(`select count(*) from public.cotizacion_evidencias where cotizacion_id = ${q.id}`));
  const vigentes = () => Number(sql(`select count(*) from public.cotizacion_evidencias where cotizacion_id = ${q.id} and vigente`));
  // Coherencia total fila ⇄ objeto: cada fila tiene su objeto con el tamaño registrado y no sobra ningún objeto (compensación completa).
  const coherente = () => sql(`select count(*) from public.cotizacion_evidencias e left join storage.objects o on o.bucket_id = 'evidencias-cotizacion' and o.name = e.path where e.cotizacion_id = ${q.id} and (o.id is null or (o.metadata->>'size')::bigint <> e.size_bytes)`) === "0" && objetos() === filas();
  const N = 4; const ctxs = []; for (let i = 0; i < N; i++) ctxs.push(await sesion("freelance@revision.test"));
  const preparar = async () => { const paneles = []; for (const c of ctxs) paneles.push(await abrirPanel(c.page, q.codigo)); return paneles; };
  const lanzar = async (paneles, archivos) => {
    for (const [i, p] of paneles.entries()) await p.locator('input[type="file"]').setInputFiles(archivos[i]);
    await Promise.all(paneles.map((p) => p.getByTestId("adjuntar-evidencia").click()));
    await ctxs[0].page.waitForTimeout(9000);
    return Promise.all(paneles.map(async (p) => norm(await p.innerText())));
  };
  // — Ronda de contenido IDÉNTICO (3 veces, 4 solicitudes simultáneas cada vez): exactamente una fila y un objeto nuevos —
  let compensadas = 0, idempotentes = 0;
  for (let ronda = 1; ronda <= 3; ronda++) {
    const f = pngUnico(`identico-${ronda}`); const f0 = filas(), o0 = objetos();
    const textos = await lanzar(await preparar(), [f, f, f, f]);
    const rechazadas = textos.filter((t) => /Ya adjuntaste ese archivo/.test(t)).length;
    compensadas += rechazadas; idempotentes += 4 - 1 - rechazadas;
    ok(filas() === f0 + 1 && vigentes() === ronda && objetos() === o0 + 1 && coherente() && sql(`select count(*) from public.cotizacion_evidencias where cotizacion_id = ${q.id} and sha256 = '${sha(f)}'`) === "1",
      `V identico #${ronda}: 4 solicitudes simultáneas con el MISMO archivo → exactamente 1 fila y 1 objeto nuevos; ${rechazadas} rechazada(s) por la base con compensación y ${3 - rechazadas} resuelta(s) por idempotencia; fila⇄objeto coherentes`, `filas ${f0}→${filas()}, objetos ${o0}→${objetos()}`);
  }
  ok(conteos() === dinero0, "V tras las carreras de contenido idéntico, abonos/pagos previos/contratos/soportes de contrato siguen idénticos");
  // — Último cupo: 4 vigentes (3 + 1 distinta) y 4 solicitudes simultáneas con archivos DISTINTOS para el 5º —
  { const p0 = await abrirPanel(ctxs[0].page, q.codigo); await p0.locator('input[type="file"]').setInputFiles(pngUnico("cuarto")); await p0.getByTestId("adjuntar-evidencia").click(); await ctxs[0].page.waitForTimeout(3500); }
  ok(vigentes() === 4 && coherente(), "V preparación del último cupo: 4 vigentes (queda 1 libre), fila⇄objeto coherentes");
  const f0 = filas(), o0 = objetos();
  const distintos = [pngUnico("ultimo-a"), pngUnico("ultimo-b"), pngUnico("ultimo-c"), pngUnico("ultimo-d")];
  const textos = await lanzar(await preparar(), distintos);
  const limite = textos.filter((t) => /Ya tienes 5 comprobantes vigentes/.test(t)).length;
  ok(vigentes() === 5 && filas() === f0 + 1 && objetos() === o0 + 1 && coherente(), `V último cupo: 4 archivos DISTINTOS simultáneos → exactamente 1 gana (5 vigentes), ${limite} rechazados por el límite con su objeto COMPENSADO (borrado): objetos ${o0}→${objetos()}, filas ${f0}→${filas()}`, textos.map((t) => t.slice(-120)).join(" ¦ "));
  ok(limite === 3, `V los 3 perdedores recibieron el aviso de límite en pantalla (${limite}/3)`);
  const ganador = sql(`select sha256 from public.cotizacion_evidencias where cotizacion_id = ${q.id} and id = (select max(id) from public.cotizacion_evidencias where cotizacion_id = ${q.id})`);
  ok(distintos.some((d) => sha(d) === ganador), "V el archivo ganador es uno de los 4 enviados y su huella coincide con la guardada");
  ok(conteos() === dinero0, "V el último cupo tampoco tocó dinero: abonos/pagos previos/contratos/soportes de contrato idénticos");
  console.log(`       [carreras] compensaciones por contenido idéntico: ${compensadas}, resueltas por idempotencia: ${idempotentes} (de 9 solicitudes perdedoras en 3 rondas)`);
  for (const c of ctxs) await c.ctx.close(); await base.ctx.close();
}

// ═══ X · aliado con un MENOR y un INFANTE → conversión del carrito (reglas existentes de responsable) ═══════════════════════════════════════════
if (SEC.includes("X")) {
  console.log("\n══ X · pasajeros del aliado con un menor y un infante: conversión del carrito y vínculo con el adulto responsable ══");
  const cam = await sesion("freelance@revision.test");
  const q = await cotizacionCarritoCamila(cam.page, { destino: "DEMO 125", ida: "04/12/2026", regreso: "09/12/2026", menores: [8, 1], nombres: "Nora", apellidos: "Prueba Menores", doc: "5555001" });
  ok(!!q.id && q.pax >= 4, `X cotización ${q.codigo} con 2 adultos + menor de 8 + infante de 1 (${q.pax} viajeros)`, JSON.stringify(q));
  const dinero0 = conteos();
  const panel = await abrirPanel(cam.page, q.codigo, "directas");
  await escribirPasajeros(panel, [
    { nombres: "Marco", apellidos: "Prueba Menores", tipoDoc: "CE", numeroDoc: "7654321", nacimiento: "02/02/1987" },
    { nombres: "Sol", apellidos: "Prueba Menores", tipoDoc: "TI", numeroDoc: "1020304050", nacimiento: ddmmyyyy("2018-06-15") },
    { nombres: "Bebe", apellidos: "Prueba Menores", tipoDoc: "RC", numeroDoc: "1111222233", nacimiento: ddmmyyyy("2025-03-10") },
  ]);
  const guardado = JSON.parse(sql(`select coalesce(pasajeros::text,'[]') from public.cotizacion_pasajeros_aliado where cotizacion_id = ${q.id}`) || "[]");
  ok(guardado.length === 3 && guardado[1].fechaNacimiento === "2018-06-15" && guardado[2].tipoDoc === "RC" && guardado[2].fechaNacimiento === "2025-03-10", "X el aliado guardó 3 pasajeros: adulto, menor (TI) e infante (RC), con sus fechas de nacimiento");
  await cam.page.locator("tr", { hasText: q.codigo }).getByRole("button", { name: "Solicitar contrato" }).click(); await cam.page.waitForTimeout(2200);
  const adm = await sesion("administracion@revision.test");
  await ir(adm.page, `/dashboard/cotizaciones/${q.id}`);
  await adm.page.getByRole("button", { name: /Confirmar → generar contrato/ }).click(); await adm.page.waitForTimeout(800); await reabrirTodas(adm.page);
  const filasN = await adm.page.locator("label", { hasText: /^Nombres$/ }).count();
  ok(filasN === 4 && (await filaVal(adm.page, 0, "Nombres")) === "Nora" && (await filaVal(adm.page, 1, "Nombres")) === "Marco" && (await filaVal(adm.page, 2, "Nombres")) === "Sol" && (await filaVal(adm.page, 3, "Nombres")) === "Bebe", `X las 4 filas llegan precargadas sin retipear (${filasN})`);
  ok((await filaVal(adm.page, 2, "Tipo doc")) === "TI" && (await filaVal(adm.page, 2, "N° doc")) === "1020304050" && (await filaVal(adm.page, 3, "Tipo doc")) === "RC" && (await filaVal(adm.page, 3, "N° doc")) === "1111222233", "X tipo y número de documento del menor (TI) y del infante (RC) llegan tal como los escribió el aliado");
  const t0 = norm(await C.texto(adm.page));
  ok(/Niño · 8a/.test(t0), "X la pantalla clasifica a Sol por su fecha de nacimiento (8 años)");
  ok(/Infante · 1a/.test(t0) && /Adulto responsable \*/.test(t0), "X la pantalla clasifica a Bebé como infante y EXIGE su adulto responsable (regla existente; el aliado no lo inventó)");
  const selResp = adm.page.locator("select").filter({ has: adm.page.locator("option", { hasText: "Sin vincular" }) }).first();
  ok((await selResp.inputValue()) === "", "X el responsable llega SIN elegir: ni el aliado ni el sistema lo deciden");
  await adm.page.screenshot({ path: join(OUT, "X-conversion-menor-infante.png"), fullPage: true });
  await adm.page.evaluate(() => { const s = document.querySelector("#moneda-cobro-carrito-select"); if (s) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "COP"); s.dispatchEvent(new Event("change", { bubbles: true })); } });
  const asesor = adm.page.locator("select").filter({ has: adm.page.locator("option", { hasText: "Elegir asesor" }) }).first(); await asesor.selectOption({ index: 1 });
  await adm.page.locator('input[aria-label="Nacimiento"]').nth(0).fill("01/01/1985"); await adm.page.keyboard.press("Tab");
  // 1) sin responsable: la regla existente rechaza y NO se crea nada
  await adm.page.getByRole("button", { name: /Generar contrato\(s\)/ }).click(); await adm.page.waitForTimeout(2500);
  const t1 = norm(await C.texto(adm.page));
  ok(sql(`select count(*) from public.ventas where cliente ilike '%Prueba Menores%'`) === "0" && /responsable|infante/i.test(t1), "X sin adulto responsable la conversión se rechaza con la regla existente y no crea contrato", t1.slice(-300));
  // 2) con responsable (Marco, adulto): se genera
  await selResp.selectOption({ label: "Marco Prueba Menores" });
  await adm.page.getByRole("button", { name: /Generar contrato\(s\)/ }).click();
  await adm.page.waitForURL(/\/dashboard\/contratos\//, { timeout: 60000 }).catch(() => {}); await adm.page.waitForTimeout(2500);
  const numero = decodeURIComponent(adm.page.url().split("/").pop() ?? "");
  ok(/^DTM-\d+$/.test(numero), `X con el adulto responsable elegido por el personal se generó ${numero}`, adm.page.url());
  const pas = pasajerosDe(numero); const idMarco = sql(`select id from public.contrato_pasajeros where numero_contrato = '${numero}' and nombres = 'Marco'`);
  ok(/Marco Prueba Menores:CE:7654321:1987-02-02:false:-/.test(pas), `X adulto persistido tal como lo escribió la aliada (${pas.split(" | ")[1]})`);
  ok(/Sol Prueba Menores:TI:1020304050:2018-06-15:false:-/.test(pas), "X menor de 8 años persistido con TI, su documento y su fecha, sin ser infante ni llevar responsable");
  ok(new RegExp(`Bebe Prueba Menores:RC:1111222233:2025-03-10:true:${idMarco}`).test(pas), `X infante persistido como infante, con RC y su fecha, vinculado al adulto responsable que eligió el personal (id ${idMarco})`, pas);
  ok(sql(`select count(*) from public.abonos where numero_contrato = '${numero}'`) === "0" && conteos().split("|")[0] === dinero0.split("|")[0], "X convertir no creó abonos");
  await cam.ctx.close(); await adm.ctx.close();
}

// ═══ W · conversión NO carrito (tarifario): la lista del aliado llega a CotizacionAcciones ════════════════════════════════════════════════════
if (SEC.includes("W")) {
  console.log("\n══ W · cotización de tarifario (no carrito) de una aliada: pasajeros guardados → pantalla de conversión → contrato ══");
  // FIXTURE (solo en la copia desechable): clones de C-0005 (tarifario convertible, 4 viajeros, hotel 912503) propiedad de Camila y SIN pasajeros: C-9005 (adultos), C-9007 (con un menor que no cuadra con lo cotizado), C-9006 (con los pasajeros ya capturados por D'spacios), y la dinámica manual de la copia a nombre de Camila.
  sql(`do $$ declare r public.cotizaciones; begin
    select * into r from public.cotizaciones where id = 5;
    for i in 1..3 loop r.id := nextval(pg_get_serial_sequence('public.cotizaciones', 'id')); r.codigo := 'C-900' || (4 + i); r.share_token := md5(random()::text); r.creado_por := 'freelance@revision.test'; r.numero_contrato := null; r.estado := 'abierta'; r.vigencia_hasta := current_date + 30;
      r.payload := case when i = 2 then (select payload from public.cotizaciones where id = 5) else jsonb_set((select payload from public.cotizaciones where id = 5), '{pasajeros}', '[]'::jsonb) end; insert into public.cotizaciones select r.*; end loop;
    update public.cotizaciones set creado_por = 'freelance@revision.test', vigencia_hasta = current_date + 30 where tipo = 'manual' and estado = 'abierta'; end $$;`);
  const cam = await sesion("freelance@revision.test");
  const ids = Object.fromEntries(sql(`select codigo || '=' || id from public.cotizaciones where codigo in ('C-9005','C-9006','C-9007')`).split("\n").map((x) => x.split("=")));
  const manual = sql(`select codigo || '|' || id from public.cotizaciones where tipo = 'manual' and creado_por = 'freelance@revision.test' limit 1`).split("|");
  const dinero0 = conteos();
  // — restricciones EXPLÍCITAS antes de guardar —
  await ir(cam.page, "/portal/b2b/cotizaciones?vista=directas");
  for (const [cod, patron, que] of [[manual[0], /se convierte con el titular/, "una cotización dinámica (manual)"], ["C-9006", /ya trae sus pasajeros/, "una cotización que ya trae pasajeros capturados por D'spacios"]]) {
    const p = panelDe(cam.page, cod); if (!(await p.count())) { ok(false, `W no aparece el panel de ${cod}`); continue; }
    await p.locator("summary").click();
    ok((await p.getByTestId("sin-captura-pasajeros").count()) === 1 && patron.test(norm(await p.getByTestId("sin-captura-pasajeros").innerText())) && (await p.getByTestId("agregar-pasajero").count()) === 0, `W ${que}: el panel DICE que no admite pasajeros adicionales y no ofrece escribirlos (no promete un traspaso que no ocurre)`);
  }
  // — C-9005: 3 adultos escritos por la aliada —
  const p5 = panelDe(cam.page, "C-9005"); await p5.locator("summary").click();
  ok((await p5.getByTestId("sin-captura-pasajeros").count()) === 0 && (await p5.getByTestId("agregar-pasajero").count()) === 1, "W C-9005 (tarifario sin pasajeros) SÍ ofrece escribir pasajeros");
  await escribirPasajeros(p5, [
    { nombres: "Ana", apellidos: "Uno", tipoDoc: "CC", numeroDoc: "1010101010", nacimiento: "04/03/1985" },
    { nombres: "Tomas", apellidos: "Dos", tipoDoc: "TI", numeroDoc: "2020202020", nacimiento: "01/01/2018" },
    { nombres: "Lucia", apellidos: "Tres", tipoDoc: "RC", numeroDoc: "3030303030", nacimiento: "01/01/2021" },
  ]);
  const g5 = JSON.parse(sql(`select coalesce(pasajeros::text,'[]') from public.cotizacion_pasajeros_aliado where cotizacion_id = ${ids["C-9005"]}`) || "[]");
  ok(g5.length === 3 && g5[1].tipoDoc === "TI" && g5[2].tipoDoc === "RC" && g5[2].fechaNacimiento === "2021-01-01", "W la aliada guardó 3 pasajeros de la cotización de 2 adultos + 2 menores: un adulto, un menor de 8 (TI) y un menor de 5 (RC)");
  ok(sql(`select count(*) from public.cotizacion_pasajeros_aliado where cotizacion_id in (${ids["C-9006"]}, ${manual[1]})`) === "0", "W en la dinámica y en la que ya trae pasajeros NO quedó guardado nada");
  // — conversión por CotizacionAcciones —
  const adm = await sesion("administracion@revision.test");
  await ir(adm.page, `/dashboard/cotizaciones/${ids["C-9005"]}`);
  await adm.page.getByRole("button", { name: /Confirmar → generar contrato/ }).click(); await adm.page.waitForTimeout(800); await reabrirTodas(adm.page);
  const nFilas = await adm.page.locator("label", { hasText: /^Nombres$/ }).count();
  ok(nFilas === 4, `W la pantalla de conversión NO-carrito muestra 4 filas (titular + 3)`, String(nFilas));
  ok((await filaVal(adm.page, 1, "Nombres")) === "Ana" && (await filaVal(adm.page, 1, "N° doc")) === "1010101010" && (await filaVal(adm.page, 2, "Tipo doc")) === "TI" && (await filaVal(adm.page, 3, "Tipo doc")) === "RC" && (await filaVal(adm.page, 3, "N° doc")) === "3030303030", "W las filas 2-4 llegan precargadas con lo que escribió la aliada (nombres, tipo y número de documento), sin retipear");
  ok(/1985/.test(await adm.page.locator('input[aria-label="Nacimiento"]').nth(1).inputValue()) && /2018/.test(await adm.page.locator('input[aria-label="Nacimiento"]').nth(2).inputValue()), "W las fechas de nacimiento también llegan");
  await adm.page.screenshot({ path: join(OUT, "W-conversion-no-carrito.png"), fullPage: true });
  const asesor = adm.page.locator("select").filter({ has: adm.page.locator("option", { hasText: "Elegir asesor" }) }).first(); await asesor.selectOption({ index: 1 });
  if (!(await adm.page.locator('input[aria-label="Nacimiento"]').nth(0).inputValue())) { await adm.page.locator('input[aria-label="Nacimiento"]').nth(0).fill("05/05/1975"); await adm.page.keyboard.press("Tab"); }
  const antes = Number(sql(`select count(*) from public.ventas`));
  await adm.page.getByRole("button", { name: /^Generar contrato$/ }).click();
  await adm.page.waitForURL(/\/dashboard\/contratos\//, { timeout: 60000 }).catch(() => {}); await adm.page.waitForTimeout(3000);
  const numero = decodeURIComponent(adm.page.url().split("/").pop() ?? "");
  const t = norm(await C.texto(adm.page));
  ok(/^DTM-\d+$/.test(numero) && Number(sql(`select count(*) from public.ventas`)) === antes + 1, `W administración@ generó el contrato ${numero} desde la cotización NO-carrito`, adm.page.url() + " " + t.slice(-200));
  const pas = /^DTM-/.test(numero) ? pasajerosDe(numero) : "";
  ok(/Ana Uno:CC:1010101010:1985-03-04:false/.test(pas) && /Tomas Dos:TI:2020202020:2018-01-01:false/.test(pas) && /Lucia Tres:RC:3030303030:2021-01-01:false/.test(pas), `W el contrato guarda a los 3 pasajeros de la aliada (adulto y dos menores) exactamente como los escribió (${pas})`);
  ok(sql(`select count(*) from public.abonos where numero_contrato = '${numero}'`) === "0", "W convertir no crea abonos");
  // — variante rechazada: la aliada escribe 3 ADULTOS en una cotización de 2 adultos + 2 menores (regla EXISTENTE pasajeros↔acomodación) —
  const p7 = await abrirPanel(cam.page, "C-9007", "directas");
  await escribirPasajeros(p7, [
    { nombres: "Uno", apellidos: "Adulto", tipoDoc: "CC", numeroDoc: "4040404041", nacimiento: "01/01/1985" },
    { nombres: "Dos", apellidos: "Adulto", tipoDoc: "CC", numeroDoc: "4040404042", nacimiento: "01/01/1986" },
    { nombres: "Tres", apellidos: "Adulto", tipoDoc: "CC", numeroDoc: "4040404043", nacimiento: "01/01/1987" },
  ]);
  await ir(adm.page, `/dashboard/cotizaciones/${ids["C-9007"]}`);
  await adm.page.getByRole("button", { name: /Confirmar → generar contrato/ }).click(); await adm.page.waitForTimeout(800); await reabrirTodas(adm.page);
  ok((await filaVal(adm.page, 1, "Nombres")) === "Uno" && (await filaVal(adm.page, 3, "N° doc")) === "4040404043", "W (composición distinta) las filas llegan precargadas también aquí");
  const a7 = adm.page.locator("select").filter({ has: adm.page.locator("option", { hasText: "Elegir asesor" }) }).first(); await a7.selectOption({ index: 1 });
  await adm.page.locator('input[aria-label="Nacimiento"]').nth(0).fill("05/05/1975"); await adm.page.keyboard.press("Tab");
  const antes7 = Number(sql(`select count(*) from public.ventas`));
  await adm.page.getByRole("button", { name: /^Generar contrato$/ }).click(); await adm.page.waitForTimeout(4000);
  const t7 = norm(await C.texto(adm.page));
  ok(Number(sql(`select count(*) from public.ventas`)) === antes7 && /adulto.s., pero las habitaciones son para/.test(t7), "W (composición distinta) la regla EXISTENTE pasajeros↔acomodación rechaza la conversión con su mensaje y no se crea contrato (el sistema no ajusta ni inventa nada)", t7.slice(-260));
  ok(sql(`select count(*) from public.cotizacion_pasajeros_aliado where cotizacion_id = ${ids["C-9007"]}`) === "1", "W (composición distinta) lo que la aliada guardó se conserva tras el rechazo (la conversión no lo borra ni lo altera)");
  ok(dinero0.split("|")[0] === conteos().split("|")[0] && dinero0.split("|")[3] === conteos().split("|")[3], "W ninguna conversión creó abonos ni soportes");
  await cam.ctx.close(); await adm.ctx.close();
}

// ═══ Y · R325-3: conversión ORDINARIA (no carrito) con un INFANTE escrito por la aliada → responsable elegido por el personal ═══════════════════════════════════════
if (SEC.includes("Y")) {
  console.log("\n══ Y · conversión ordinaria con infante: la aliada guarda → el personal recibe → falta responsable (rechazo sin efectos) → elige adulto elegible → vínculo persistido ══");
  // FIXTURE (solo en la copia desechable): clon de C-0005 (tarifario convertible, hotel 912503, 1 doble) propiedad de Camila, SIN pasajeros y con la composición cotizada 2 adultos + un menor de 8 + un infante de 1.
  sql(`do $$ declare r public.cotizaciones; begin
    select * into r from public.cotizaciones where id = 5;
    r.id := nextval(pg_get_serial_sequence('public.cotizaciones', 'id')); r.codigo := 'C-9008'; r.share_token := md5(random()::text); r.creado_por := 'freelance@revision.test'; r.numero_contrato := null; r.estado := 'abierta'; r.vigencia_hasta := current_date + 30;
    r.payload := jsonb_set(jsonb_set(r.payload, '{pasajeros}', '[]'::jsonb), '{edadesMenores}', '[8,1]'::jsonb);
    insert into public.cotizaciones select r.*; end $$;`);
  const idCot = Number(sql(`select id from public.cotizaciones where codigo = 'C-9008'`));
  // Huella de TODO lo que un contrato (o su intento fallido) tocaría: contrato y sus hijas, cuentas por pagar, dinero, asientos, sillas y las tablas de numeración liberada.
  const huella = () => sql(`select (select count(*) from public.ventas) || '|' || (select count(*) from public.contrato_pasajeros) || '|' || (select count(*) from public.contrato_items) || '|' || (select count(*) from public.contrato_hoteles) || '|' || (select count(*) from public.contrato_servicios) || '|' || (select count(*) from public.cuentas_por_pagar) || '|' || (select count(*) from public.abonos) || '|' || (select count(*) from public.asientos_contables) || '|' || (select count(*) from public.sillas where numero_contrato is not null) || '|' || (select count(*) from public.numeros_dtm_liberados) || '|' || (select count(*) from public.numeros_contrato_liberados) || '|' || coalesce((select last_value::text from pg_sequences where schemaname = 'public' and sequencename = 'contrato_seq_mayorista'), '0')`);
  const cam = await sesion("freelance@revision.test");
  const adm = await sesion("administracion@revision.test");
  const ca = peticiones(adm.page);
  // 1) la aliada guarda un adulto, un menor de 8 y un infante de 1 (a la salida del 04/12/2026)
  const panel = await abrirPanel(cam.page, "C-9008", "directas");
  ok((await panel.getByTestId("sin-captura-pasajeros").count()) === 0, "Y la cotización ordinaria sin pasajeros ofrece la captura");
  await escribirPasajeros(panel, [
    { nombres: "Ana", apellidos: "Uno", tipoDoc: "CC", numeroDoc: "1010101010", nacimiento: "04/03/1985" },
    { nombres: "Tomas", apellidos: "Dos", tipoDoc: "TI", numeroDoc: "2020202020", nacimiento: "01/01/2018" },
    { nombres: "Bebe", apellidos: "Tres", tipoDoc: "RC", numeroDoc: "3030303030", nacimiento: "01/06/2025" },
  ]);
  const g = JSON.parse(sql(`select coalesce(pasajeros::text,'[]') from public.cotizacion_pasajeros_aliado where cotizacion_id = ${idCot}`) || "[]");
  ok(g.length === 3 && g[2].nombres === "Bebe" && g[2].tipoDoc === "RC" && g[2].fechaNacimiento === "2025-06-01", "Y la aliada guardó adulto, menor (TI) e infante (RC) con sus fechas de nacimiento");
  // 2) el personal recibe los datos en la conversión ordinaria y ve el selector del infante
  await ir(adm.page, `/dashboard/cotizaciones/${idCot}`);
  await adm.page.getByRole("button", { name: /Confirmar → generar contrato/ }).click(); await adm.page.waitForTimeout(800); await reabrirTodas(adm.page);
  ok((await adm.page.locator("label", { hasText: /^Nombres$/ }).count()) === 4 && (await filaVal(adm.page, 1, "Nombres")) === "Ana" && (await filaVal(adm.page, 3, "Nombres")) === "Bebe" && (await filaVal(adm.page, 3, "Tipo doc")) === "RC" && (await filaVal(adm.page, 3, "N° doc")) === "3030303030", "Y el personal recibe las 4 filas precargadas (titular + Ana, Tomas, Bebe) sin retipear");
  const edades = (await adm.page.locator('[data-testid="edad-pasajero"]').allInnerTexts()).map(norm);
  ok(edades[1] === "Adulto · 41a" && edades[2] === "Niño · 8a" && edades[3] === "Infante · 1a", `Y la pantalla clasifica por fecha de nacimiento contra la salida: ${edades.join(" / ")}`);
  const sels = adm.page.locator('[data-testid="responsable-infante"] select');
  ok((await sels.count()) === 1 && (await sels.first().inputValue()) === "", "Y solo el infante pide «Adulto responsable *» y llega SIN elegir (nadie lo decide por el personal)");
  const opc = async () => (await sels.first().locator("option").allInnerTexts()).map(norm);
  const antes = await opc();
  ok(antes.length === 2 && /Sin vincular/.test(antes[0]) && antes[1] === "Ana Uno", `Y antes de que el titular tenga fecha, el único adulto elegible es Ana: ${antes.join(" | ")}`);
  await adm.page.locator('input[aria-label="Nacimiento"]').nth(0).fill("05/05/1975"); await adm.page.keyboard.press("Tab"); await adm.page.waitForTimeout(400);
  const despues = await opc();
  ok(despues.length === 3 && despues.slice(1).some((o) => /Ana Uno/.test(o)) && !despues.some((o) => /Tomas|Bebe/.test(o)), `Y con la fecha del titular hay 2 adultos elegibles y nunca el menor de 8 ni el propio infante: ${despues.join(" | ")}`);
  await presentacion(adm.page, "conversión ordinaria con selector de responsable", '[data-testid="captura-pasajeros"]', "Y-conversion-ordinaria");
  await adm.page.screenshot({ path: join(OUT, "Y-conversion-ordinaria-selector.png"), fullPage: true });
  const asesor = adm.page.locator("select").filter({ has: adm.page.locator("option", { hasText: "Elegir asesor" }) }).first(); await asesor.selectOption({ index: 1 });
  // 3) sin responsable: la base rechaza y NO queda ningún efecto
  const h0 = huella(); const a0 = ca.acciones;
  await adm.page.getByRole("button", { name: /^Generar contrato$/ }).click(); await adm.page.waitForTimeout(5000);
  const t1 = norm(await C.texto(adm.page));
  const h1 = huella();
  ok(/responsable/i.test(t1) && /\/dashboard\/cotizaciones\//.test(adm.page.url()), "Y sin responsable la base rechaza y la pantalla lo explica sin navegar", t1.slice(-260));
  const d0 = h0.split("|"), d1 = h1.split("|");
  const etiquetas = ["contratos", "pasajeros", "ítems", "hoteles", "servicios", "cuentas por pagar", "abonos", "asientos", "sillas con contrato", "números DTM liberados", "números liberados (otros)", "consecutivo DTM (último valor de la secuencia)"];
  const difer = etiquetas.map((e, i) => (d0[i] === d1[i] ? null : `${e}: ${d0[i]}→${d1[i]}`)).filter(Boolean);
  console.log(`       huella antes ${h0}\n       huella después ${h1} → diferencias: ${difer.length ? difer.join("; ") : "ninguna"} · acciones de servidor en el intento: ${ca.acciones - a0}`);
  ok(d0.slice(0, 9).join("|") === d1.slice(0, 9).join("|") && d0[11] === d1[11], "Y el intento rechazado no dejó contrato, pasajeros, ítems, hoteles, servicios, cuentas por pagar, abonos, asientos ni sillas, y NO gastó un consecutivo (la secuencia DTM no avanzó)", difer.join("; "));
  ok(sql(`select estado || '|' || coalesce(numero_contrato,'-') from public.cotizaciones where id = ${idCot}`) === "abierta|-", "Y la cotización sigue abierta y sin contrato");
  ok(sql(`select jsonb_array_length(pasajeros) from public.cotizacion_pasajeros_aliado where cotizacion_id = ${idCot}`) === "3", "Y los 3 pasajeros que guardó la aliada se conservan tras el rechazo");
  // 4) el personal elige a UN adulto elegible que viaja en el contrato → se genera y queda el vínculo correcto
  await sels.first().selectOption({ label: "Ana Uno" });
  const a1 = ca.acciones;
  await adm.page.getByRole("button", { name: /^Generar contrato$/ }).click();
  await adm.page.waitForURL(/\/dashboard\/contratos\//, { timeout: 60000 }).catch(() => {}); await adm.page.waitForTimeout(3000);
  const numero = decodeURIComponent(adm.page.url().split("/").pop() ?? "");
  ok(/^DTM-\d+$/.test(numero), `Y con el adulto responsable elegido por el personal se generó ${numero}`, adm.page.url());
  const pas = pasajerosDe(numero); const idAna = sql(`select id from public.contrato_pasajeros where numero_contrato = '${numero}' and nombres = 'Ana'`);
  ok(new RegExp(`Bebe Tres:RC:3030303030:2025-06-01:true:${idAna}\\b`).test(pas), `Y el infante quedó persistido como infante (RC, 2025-06-01) con responsable_id = la fila de Ana (${idAna})`, pas);
  ok(/Ana Uno:CC:1010101010:1985-03-04:false:-/.test(pas) && /Tomas Dos:TI:2020202020:2018-01-01:false:-/.test(pas), "Y el adulto y el menor de 8 se persistieron tal como los escribió la aliada, sin infante ni responsable");
  const d2 = huella().split("|");
  ok(d2[0] === String(Number(d0[0]) + 1) && d2[6] === d0[6], "Y se creó exactamente UN contrato y ningún abono");
  ok(numero === "DTM-" + String(Number(d0[11]) + 1).padStart(4, "0"), `Y el contrato recibió el consecutivo inmediatamente siguiente (${numero} tras la secuencia en ${d0[11]}): sin hueco por el intento rechazado`);
  ok(sql(`select estado from public.cotizaciones where id = ${idCot}`) === "convertida", "Y la cotización quedó convertida");
  console.log(`       acciones de servidor: intento rechazado ${a1 - a0 === 0 ? "?" : a1 - a0}, intento aceptado ${ca.acciones - a1}; número generado ${numero} (último antes: ${d0[11]})`);
  await cam.ctx.close(); await adm.ctx.close();
}

// ═══ Z · correcciones del dueño (2026-11-21): origen directo/asistido, pasajeros compactos, «Agregar pasajero» por universo, tarjeta de tarifa ══════════════
// Z.1  origen REAL con flujos reales: la aliada cotiza en NETO y en comisión (Directas), el personal arma una para ella (Asistidas); pestañas y conteos; otra aliada no ve nada.
// Z.2  panel de pasajeros del aliado con 5 adicionales: compactos, «Agregar pasajero» desaparece al completar el universo y vuelve al quitar una fila (3 anchos).
// Z.3  conversión del personal sobre esa misma cotización: filas compactas, infante con responsable, «Agregar pasajero» oculto, 3 anchos.
// Z.4  tarjeta de tarifa de Vista Booking con un niño con beneficio: importe regular y a pagar dentro del bloque del niño.
async function cotizacionAsistidaB2B(page, { destino, ida, regreso, modo, aliado, nombres, apellidos, doc, adultos = "2", menores = [] }) {
  const antes = Number(sql(`select coalesce(max(id),0) from public.cotizaciones where creado_por = 'administracion@revision.test' and tipo = 'carrito'`));
  await buscar(page, { destino, ida, regreso, adultos, menores });
  await page.getByRole("button", { name: /Agregar al carrito/ }).first().click(); await page.waitForTimeout(1500);
  await page.goto(`${C.APP}/tarifario/checkout`, { waitUntil: "networkidle" }); await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Aliado (B2B)" }).click(); await page.waitForTimeout(500);
  const opciones = await page.locator("#asist-aliados-lista option").evaluateAll((os) => os.map((o) => o.getAttribute("value")));
  const etiqueta = opciones.find((v) => v && v.includes(aliado));
  if (!etiqueta) throw new Error(`el catálogo del checkout no ofrece al aliado «${aliado}»: ${JSON.stringify(opciones)}`);
  await page.locator("#asist-aliado").fill(etiqueta); await page.waitForTimeout(600);
  await page.getByRole("button", { name: modo === "neta" ? "NETO" : "PVP con comisión", exact: true }).click(); await page.waitForTimeout(2500);
  const lab = (t) => page.locator(`label:text-is("${t}")`).locator("xpath=..");
  await lab("Nombres *").locator("input").fill(nombres); await lab("Apellidos *").locator("input").fill(apellidos);
  await lab("Tipo de documento").locator("select").selectOption("CE"); await lab("Número de documento *").locator("input").fill(doc);
  await lab("Teléfono / WhatsApp *").locator("input").fill("3105550188");
  await page.getByRole("button", { name: /Generar cotización y enviar solicitud/ }).click();
  await page.waitForSelector('text=/Ver la cotizaci|Cotización C-|C-0\\d+/', { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(2500);
  const f = sql(`select id || '|' || codigo || '|' || pax from public.cotizaciones where creado_por = 'administracion@revision.test' and tipo = 'carrito' and id > ${antes} order by id desc limit 1`).split("|");
  return { id: Number(f[0]), codigo: f[1], pax: Number(f[2]) };
}
const tabs = async (page) => {
  await page.waitForSelector('nav[aria-label="Tipo de cotización"]');
  const n = async (txt) => Number(norm(await page.locator('nav[aria-label="Tipo de cotización"] a', { hasText: txt }).locator("span").innerText()));
  return { directas: await n("Directas"), asistidas: await n("Asistidas") };
};
const codigosDe = async (page) => (await page.locator("table th[scope=row]").allInnerTexts()).map(norm);
const clasifica = (id) => sql(`select coalesce(payload->'b2bAsistido'->>'origen','-') || '|' || coalesce(payload->'b2bAsistido'->>'modo_compra','-') || '|' || coalesce(payload->'b2bAsistido'->>'total_exigible','-') || '|' || creado_por from public.cotizaciones where id = ${id}`);

const filaValPanel = async (panel, i, etiqueta) => panel.locator('[data-testid="pasajero-aliado"]').nth(i).locator("label", { hasText: new RegExp(`^${etiqueta}$`) }).locator("xpath=..").locator("input,select").first().inputValue();
if (SEC.includes("Z")) {
  console.log("\n══ Z.1 · origen REAL de la cotización: la aliada cotiza sola (NETO y comisión) y el personal arma una para ella ══");
  const cam = await sesion("freelance@revision.test");
  const adm = await sesion("administracion@revision.test");
  const beto = await sesion("freelance2@revision.test");
  const v0 = conteos();
  const qNeta = await cotizacionCarritoCamila(cam.page, { destino: "CARTAGENA O3", ida: "10/06/2030", regreso: "13/06/2030", modo: "neta", nombres: "Zeta", apellidos: "Neta Aliada", doc: "7100001" });
  const qCom = await cotizacionCarritoCamila(cam.page, { destino: "CARTAGENA O3", ida: "10/06/2030", regreso: "13/06/2030", modo: "comisionable", nombres: "Zeta", apellidos: "Comision Aliada", doc: "7100002" });
  const qAsN = await cotizacionAsistidaB2B(adm.page, { destino: "CARTAGENA O3", ida: "10/06/2030", regreso: "13/06/2030", modo: "neta", aliado: "Camila", nombres: "Zeta", apellidos: "Asistida Neta", doc: "7100003" });
  const qAsC = await cotizacionAsistidaB2B(adm.page, { destino: "CARTAGENA O3", ida: "10/06/2030", regreso: "13/06/2030", modo: "comisionable", aliado: "Camila", nombres: "Zeta", apellidos: "Asistida Comision", doc: "7100004" });
  for (const [etq, q] of [["NETO de la aliada", qNeta], ["comisionable de la aliada", qCom], ["asistida NETO", qAsN], ["asistida comisionable", qAsC]]) ok(!!q.id, `Z.1 se creó la cotización ${etq}: ${q.codigo} (id ${q.id})`);
  const sello = (q) => clasifica(q.id).split("|");
  ok(sello(qNeta)[0] === "aliado_directo" && sello(qNeta)[1] === "neta" && sello(qNeta)[3] === "freelance@revision.test", `Z.1 ${qNeta.codigo}: el servidor selló origen=aliado_directo, modo=neta, autor=la aliada`, clasifica(qNeta.id));
  ok(sello(qCom)[0] === "aliado_directo" && sello(qCom)[1] === "comisionable", `Z.1 ${qCom.codigo}: origen=aliado_directo, modo=comisionable`, clasifica(qCom.id));
  ok(sello(qAsN)[0] === "asistida" && sello(qAsN)[1] === "neta" && sello(qAsN)[3] === "administracion@revision.test", `Z.1 ${qAsN.codigo}: origen=asistida, modo=neta, autor=el personal`, clasifica(qAsN.id));
  ok(sello(qAsC)[0] === "asistida" && sello(qAsC)[1] === "comisionable", `Z.1 ${qAsC.codigo}: origen=asistida, modo=comisionable`, clasifica(qAsC.id));
  const totalesSellados = [qNeta, qCom, qAsN, qAsC].map((q) => sello(q)[2]);
  ok(totalesSellados.every((t) => Number(t) > 0), "Z.1 cada cotización conserva congelados sus términos financieros (total exigible > 0)", totalesSellados.join(","));

  const dir = await (async () => { await ir(cam.page, "/portal/b2b/cotizaciones?vista=directas"); return { tabs: await tabs(cam.page), cods: await codigosDe(cam.page) }; })();
  const asi = await (async () => { await ir(cam.page, "/portal/b2b/cotizaciones?vista=asistidas"); return { tabs: await tabs(cam.page), cods: await codigosDe(cam.page) }; })();
  ok(dir.cods.includes(qNeta.codigo) && dir.cods.includes(qCom.codigo), `Z.1 la pestaña DIRECTAS trae la NETO y la comisionable de la aliada (${[qNeta.codigo, qCom.codigo].join(", ")})`, dir.cods.join(","));
  ok(!asi.cods.includes(qNeta.codigo) && !asi.cods.includes(qCom.codigo), "Z.1 ninguna de las dos aparece en ASISTIDAS (la modalidad NETO ya no la manda ahí)", asi.cods.join(","));
  ok(asi.cods.includes(qAsN.codigo) && asi.cods.includes(qAsC.codigo) && !dir.cods.includes(qAsN.codigo) && !dir.cods.includes(qAsC.codigo), `Z.1 las dos que armó el personal para ella siguen en ASISTIDAS y no en Directas (${[qAsN.codigo, qAsC.codigo].join(", ")})`, `asist: ${asi.cods.join(",")} · dir: ${dir.cods.join(",")}`);
  ok(dir.cods.length === dir.tabs.directas && asi.cods.length === asi.tabs.asistidas, `Z.1 los conteos de las pestañas son las filas visibles (Directas ${dir.tabs.directas}=${dir.cods.length}; Asistidas ${asi.tabs.asistidas}=${asi.cods.length})`, JSON.stringify({ dir, asi }));
  ok(!dir.cods.some((c) => asi.cods.includes(c)), "Z.1 una cotización aparece en UNA sola lista (sin duplicados entre pestañas)");
  ok(dir.cods.includes("C-0007"), "Z.1 la cotización NETO ya existente de la aliada (C-0007, convertida, con plan congelado) también pasa a Directas: la corrección alcanza lo ya guardado");
  const tb = norm(await ir(beto.page, "/portal/b2b/cotizaciones?vista=directas")) + " " + norm(await ir(beto.page, "/portal/b2b/cotizaciones?vista=asistidas"));
  ok(![qNeta, qCom, qAsN, qAsC].some((q) => tb.includes(q.codigo)), "Z.1 otra aliada (Beto) no ve ninguna de las cuatro, ni en Directas ni en Asistidas");
  await ir(cam.page, "/portal/b2b");
  ok(conteos() === v0, "Z.1 crear cotizaciones no tocó dinero: abonos, pagos previos, contratos y soportes idénticos");
  await presentacion(cam.page, "pestañas de cotizaciones (directas)", "main", "Z1-directas");

  console.log("\n══ Z.2 · panel de pasajeros del aliado: compacto, sin botón al completar el universo, vuelve al quitar una fila ══");
  const qMulti = await cotizacionCarritoCamila(cam.page, { destino: "DEMO 125", ida: "04/12/2026", regreso: "09/12/2026", menores: [8, 1], adultos: "4", habitaciones: "2", modo: "comisionable", nombres: "Muchos", apellidos: "Viajeros Z", doc: "7200001" });
  ok(!!qMulti.id && qMulti.pax === 6, `Z.2 cotización ${qMulti.codigo} con ${qMulti.pax} viajeros (4 adultos + menor de 8 + infante de 1) ⇒ 5 adicionales además del titular`, JSON.stringify(qMulti));
  let panel = await abrirPanel(cam.page, qMulti.codigo, "directas");
  const lista = [
    { nombres: "Adulto", apellidos: "Dos", tipoDoc: "CE", numeroDoc: "7200002", nacimiento: "01/01/1980" },
    { nombres: "Adulto", apellidos: "Tres", tipoDoc: "CE", numeroDoc: "7200003", nacimiento: "02/02/1981" },
    { nombres: "Adulto", apellidos: "Cuatro", tipoDoc: "CE", numeroDoc: "7200004", nacimiento: "03/03/1982" },
    { nombres: "Sol", apellidos: "Menor", tipoDoc: "TI", numeroDoc: "1020304051", nacimiento: ddmmyyyy("2018-06-15") },
    { nombres: "Bebe", apellidos: "Infante", tipoDoc: "RC", numeroDoc: "1111222234", nacimiento: ddmmyyyy("2025-03-10") },
  ];
  ok((await panel.getByTestId("agregar-pasajero").count()) === 1, "Z.2 sin pasajeros adicionales todavía caben 5: «Agregar pasajero» se ofrece");
  await escribirPasajeros(panel, lista);
  ok(sql(`select jsonb_array_length(pasajeros) from public.cotizacion_pasajeros_aliado where cotizacion_id = ${qMulti.id}`) === "5", "Z.2 el aliado guardó sus 5 pasajeros adicionales (la base los aceptó)");
  const resum = () => panel.locator('[data-testid="pasajero-aliado-resumen"]'), abiertas = () => panel.locator('[data-testid="pasajero-aliado"]');
  ok((await resum().count()) === 5 && (await abiertas().count()) === 0, "Z.2 tras guardar, los 5 pasajeros quedan COMPACTOS (5 resúmenes, ningún formulario expandido)");
  ok((await panel.getByTestId("agregar-pasajero").count()) === 0 && /Ya están todos los viajeros/.test(norm(await panel.innerText())), "Z.2 universo completo (titular + 5 = 6): «Agregar pasajero» NO se ofrece y el panel explica por qué");
  const txtRes = norm(await resum().nth(4).innerText());
  ok(/Pasajero 6/.test(txtRes) && /Bebe Infante/.test(txtRes) && /RC 1111222234/.test(txtRes) && /nac\. 2025-03-10/.test(txtRes), `Z.2 cada resumen es legible: «${txtRes.slice(0, 90)}»`);
  const hCompacto = (await panel.boundingBox()).height;
  for (let i = 0; i < 5; i++) await resum().first().getByTestId("editar-pasajero").click();
  await cam.page.waitForTimeout(200);
  const hExpandido = (await panel.boundingBox()).height;
  ok(hCompacto < hExpandido * 0.6, `Z.2 la vista compacta ocupa ${Math.round(hCompacto)} px frente a ${Math.round(hExpandido)} px con los 5 formularios expandidos (< 60 %)`);
  ok((await filaValPanel(panel, 0, "Nombres")) === "Adulto" && (await filaValPanel(panel, 4, "N° doc")) === "1111222234", "Z.2 «Editar» reabre cada pasajero con sus datos intactos");
  // edición sin guardar sobrevive a compactar/reabrir otra fila
  await abiertas().nth(0).locator("label", { hasText: /^Nombres$/ }).locator("xpath=..").locator("input").fill("Adulto Editado");
  await abiertas().nth(1).getByTestId("compactar-pasajero").click(); await cam.page.waitForTimeout(150);
  ok((await abiertas().count()) === 4 && (await filaValPanel(panel, 0, "Nombres")) === "Adulto Editado", "Z.2 compactar OTRA fila no pierde lo escrito (sin guardar) en la que sigue abierta");
  // fila inválida: queda abierta y el mensaje la nombra; no llama al servidor
  await abiertas().nth(0).locator("label", { hasText: /^N° doc$/ }).locator("xpath=..").locator("input").fill("E72");
  await panel.getByTestId("guardar-pasajeros").click(); await cam.page.waitForTimeout(900);
  ok(/solo números/.test(norm(await panel.innerText())) && (await abiertas().count()) >= 1, "Z.2 un documento inválido se rechaza en pantalla con su mensaje y la fila sigue abierta (lo inválido no se esconde)");
  await abiertas().nth(0).locator("label", { hasText: /^N° doc$/ }).locator("xpath=..").locator("input").fill("7200002");
  await presentacion(cam.page, "panel de pasajeros del aliado (5 adicionales, mixto)", '[data-testid="preparacion-contrato"]', "Z2-panel-mixto");
  await panel.getByTestId("guardar-pasajeros").click(); await cam.page.waitForTimeout(2200);
  ok((await resum().count()) === 5 && (await abiertas().count()) === 0 && /Adulto Editado/.test(norm(await panel.innerText())), "Z.2 al guardar, todo vuelve a compactarse y el cambio quedó guardado");
  await presentacion(cam.page, "panel de pasajeros del aliado (5 compactos)", '[data-testid="preparacion-contrato"]', "Z2-panel-compacto");
  // quitar una fila libera un lugar: el botón reaparece
  await resum().nth(4).locator('button[aria-label="Quitar pasajero 6"]').click(); await cam.page.waitForTimeout(250);
  ok((await resum().count()) === 4 && (await panel.getByTestId("agregar-pasajero").count()) === 1, "Z.2 quitar un pasajero (4 adicionales) libera un lugar: «Agregar pasajero» VUELVE a mostrarse");
  await panel.getByTestId("agregar-pasajero").click(); await cam.page.waitForTimeout(250);
  ok((await panel.getByTestId("agregar-pasajero").count()) === 0 && (await abiertas().count()) === 1, "Z.2 al agregar de nuevo el universo se completa y el botón desaparece otra vez (la fila nueva queda abierta)");
  // el servidor nunca vio la baja ni la fila vacía: la base sigue con las 5 guardadas
  ok(sql(`select jsonb_array_length(pasajeros) from public.cotizacion_pasajeros_aliado where cotizacion_id = ${qMulti.id}`) === "5", "Z.2 las altas/bajas sin guardar no tocaron la base (siguen 5 guardados)");
  await cam.page.reload({ waitUntil: "networkidle" });

  console.log("\n══ Z.3 · conversión del personal sobre esa cotización: filas compactas, infante con responsable, sin botón de agregar ══");
  await cam.page.locator("tr", { hasText: qMulti.codigo }).getByRole("button", { name: "Solicitar contrato" }).click(); await cam.page.waitForTimeout(2200);
  const ad2 = await sesion("administracion@revision.test");
  await ir(ad2.page, `/dashboard/cotizaciones/${qMulti.id}`);
  await ad2.page.getByRole("button", { name: /Confirmar → generar contrato/ }).click(); await ad2.page.waitForTimeout(900);
  const R = ad2.page.locator('[data-testid="pasajero-resumen"]'), F = ad2.page.locator('[data-testid="pasajero-fila"]');
  ok((await R.count()) === 5 && (await F.count()) === 1, `Z.3 6 filas: 5 compactas (titular + 3 adultos + menor) y 1 ABIERTA (el infante, que aún no tiene responsable) — compactas ${await R.count()}, abiertas ${await F.count()}`);
  ok(/Adulto responsable \*/.test(norm(await F.first().innerText())), "Z.3 la fila abierta es la del infante y trae su selector de adulto responsable");
  ok((await ad2.page.getByTestId("agregar-pasajero").count()) === 0 && /Ya están todos los viajeros/.test(norm(await C.texto(ad2.page))), "Z.3 universo declarado completo (6 filas = 6 viajeros): «+ Agregar pasajero» no se ofrece");
  ok(/Faltan: nacimiento/.test(norm(await R.first().innerText())), "Z.3 el titular (sin fecha de nacimiento) se ve compacto pero con «Faltan: nacimiento»");
  const hC = (await ad2.page.locator('p:has-text("Datos de los pasajeros")').first().locator("xpath=..").locator("xpath=..").boundingBox()).height;
  await presentacion(ad2.page, "conversión del personal — 5 compactas + infante abierto", "main", "Z3-conversion-compacta");
  // el responsable lo elige el personal; «Listo» compacta y el resumen lo nombra
  { const selResp = F.first().locator("select").filter({ has: ad2.page.locator("option", { hasText: "Sin vincular" }) }); await selResp.selectOption({ label: "Adulto Dos" }).catch(async () => selResp.selectOption({ index: 1 })); }
  await F.first().getByTestId("compactar-pasajero").click(); await ad2.page.waitForTimeout(250);
  const resInf = norm(await R.nth(5).innerText());
  ok((await R.count()) === 6 && /Bebe Infante/.test(resInf) && /Infante · 1a/.test(resInf) && /responsable: /.test(resInf), `Z.3 el infante se compacta mostrando SU responsable elegido: «${resInf.slice(0, 120)}»`);
  // titular: completar su nacimiento reabriéndolo con «Editar» (los demás siguen compactos)
  await R.first().getByTestId("editar-pasajero").click(); await ad2.page.waitForTimeout(200);
  await ad2.page.locator('input[aria-label="Nacimiento"]').first().fill("01/01/1985"); await ad2.page.keyboard.press("Tab");
  await F.first().getByTestId("compactar-pasajero").click(); await ad2.page.waitForTimeout(200);
  await ad2.page.evaluate(() => { const s = document.querySelector("#moneda-cobro-carrito-select"); if (s) { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "COP"); s.dispatchEvent(new Event("change", { bubbles: true })); } });
  await ad2.page.locator("select").filter({ has: ad2.page.locator("option", { hasText: "Elegir asesor" }) }).first().selectOption({ index: 1 });
  const dZ0 = conteos();
  await ad2.page.getByRole("button", { name: /Generar contrato\(s\)/ }).click();
  await ad2.page.waitForURL(/\/dashboard\/contratos\//, { timeout: 60000 }).catch(() => {}); await ad2.page.waitForTimeout(2500);
  const numZ = decodeURIComponent(ad2.page.url().split("/").pop() ?? "");
  ok(/^DTM-\d+$/.test(numZ), `Z.3 con las filas compactas y el responsable elegido se generó ${numZ}`, ad2.page.url());
  const pasZ = pasajerosDe(numZ); const idAdulto2 = sql(`select id from public.contrato_pasajeros where numero_contrato = '${numZ}' and apellidos = 'Dos'`);
  ok(new RegExp(`Bebe Infante:RC:1111222234:2025-03-10:true:${idAdulto2}\\b`).test(pasZ), `Z.3 el infante quedó persistido como infante con responsable_id = el adulto que eligió el personal (id ${idAdulto2})`, pasZ);
  ok((pasZ.match(/ \| /g) ?? []).length === 5, "Z.3 se persistieron los 6 pasajeros (titular + 5 adicionales) tal como estaban en las filas compactas", pasZ);
  ok(conteos().split("|")[0] === dZ0.split("|")[0], "Z.3 convertir no creó abonos");
  await ad2.ctx.close();

  console.log("\n══ Z.3b · «Agregar pasajero» en la conversión: se oculta al completar el universo y vuelve al quitar una fila ══");
  const qVis = await cotizacionCarritoCamila(cam.page, { destino: "CARTAGENA O3", ida: "10/06/2030", regreso: "13/06/2030", modo: "comisionable", nombres: "Visible", apellidos: "Universo Z", doc: "7300001" });
  const ad3 = await sesion("administracion@revision.test");
  await ir(ad3.page, `/dashboard/cotizaciones/${qVis.id}`);
  await ad3.page.getByRole("button", { name: /Confirmar → generar contrato/ }).click(); await ad3.page.waitForTimeout(800);
  const n3 = () => ad3.page.locator('[data-testid="pasajero-resumen"], [data-testid="pasajero-fila"]').count();
  ok(qVis.pax === 2 && (await n3()) === 2 && (await ad3.page.getByTestId("agregar-pasajero").count()) === 0, `Z.3b ${qVis.codigo}: 2 viajeros = 2 filas ⇒ no hay «+ Agregar pasajero»`, `pax ${qVis.pax}, filas ${await n3()}`);
  await ad3.page.locator('[data-testid="pasajero-fila"] button:text-is("Quitar")').last().click(); await ad3.page.waitForTimeout(250);
  ok((await n3()) === 1 && (await ad3.page.getByTestId("agregar-pasajero").count()) === 1, "Z.3b quitar una fila libera un lugar: el botón VUELVE");
  await ad3.page.getByTestId("agregar-pasajero").click(); await ad3.page.waitForTimeout(250);
  ok((await n3()) === 2 && (await ad3.page.getByTestId("agregar-pasajero").count()) === 0, "Z.3b agregar de nuevo completa el universo y el botón desaparece");
  await ad3.ctx.close();

  console.log("\n══ Z.3c · cotización de carrito con DOS hoteles (universo ambiguo): el botón NO se oculta por el máximo ══");
  sql(`do $$ declare r public.cotizaciones; begin select * into r from public.cotizaciones where id = ${qVis.id}; r.id := nextval(pg_get_serial_sequence('public.cotizaciones', 'id')); r.codigo := 'C-9Z' || r.id; r.share_token := md5(random()::text); r.clave_envio := gen_random_uuid(); r.numero_contrato := null; r.estado := 'abierta';
      r.payload := jsonb_set(r.payload, '{items}', (r.payload->'items') || (r.payload->'items')); insert into public.cotizaciones select r.*; end $$;`);
  const idAmb = Number(sql(`select max(id) from public.cotizaciones where codigo like 'C-9Z%'`));
  const ad4 = await sesion("administracion@revision.test");
  await ir(ad4.page, `/dashboard/cotizaciones/${idAmb}`);
  await ad4.page.getByRole("button", { name: /Confirmar → generar contrato/ }).click(); await ad4.page.waitForTimeout(800);
  const n4 = () => ad4.page.locator('[data-testid="pasajero-resumen"], [data-testid="pasajero-fila"]').count();
  ok((await n4()) === 2 && (await ad4.page.getByTestId("agregar-pasajero").count()) === 1 && /2 servicios independientes/.test(norm(await ad4.page.getByTestId("nota-universo").innerText())), "Z.3c con dos hoteles de 2 viajeros hay 2 filas pero el botón SIGUE: el universo no se calcula como el máximo; la nota explica que el personal confirma el número real");
  for (let i = 0; i < 2; i++) { await ad4.page.getByTestId("agregar-pasajero").click(); await ad4.page.waitForTimeout(200); }
  ok((await n4()) === 4 && (await ad4.page.getByTestId("agregar-pasajero").count()) === 0 && /cota máxima/.test(norm(await ad4.page.getByTestId("nota-universo").innerText())), "Z.3c solo la cota de seguridad (suma de los dos hoteles = 4) detiene el botón");
  await ad4.ctx.close();

  console.log("\n══ Z.4 · tarjeta de tarifa (Vista Booking): importe regular y a pagar dentro del bloque del niño ══");
  const pv = await sesion("freelance@revision.test");
  await buscar(pv.page, { destino: "DEMO 125", ida: "04/12/2026", regreso: "07/12/2026", adultos: "2", menores: [8, 1] });
  const tarjetas = pv.page.locator('[data-testid="desglose-tarifas"]');
  const conBeneficio = pv.page.locator('[data-testid="desglose-tarifas"] [data-con-beneficio]');
  const nT = await tarjetas.count(), nB = await conBeneficio.count();
  console.log(`       tarjetas con desglose: ${nT}; bloques de niño con beneficio: ${nB}`);
  if (nB > 0) {
    const bloque = conBeneficio.first();
    const tarjeta = bloque.locator("xpath=ancestor::*[@data-testid='desglose-tarifas']");
    const nota = bloque.locator("[data-nino-gratis]");
    const t = norm(await nota.innerText());
    ok(/^Niño 1 · 8 años: tarifa regular \$ ?[\d.]+ · a pagar \$ ?[\d.]+ c\/u · /.test(t), `Z.4 la nota nombra al niño y junta tarifa regular y a pagar: «${t.slice(0, 150)}»`);
    ok((await bloque.locator("s[data-tarifa-regular]").count()) === 1 && (await tarjeta.locator("s[data-tarifa-regular]").count()) === 1, "Z.4 una sola tarifa regular tachada y dentro del bloque del niño");
    ok((await tarjeta.locator('[data-clase="infante"] [data-nino-gratis]').count()) === 0 && (await tarjeta.locator('[data-clase="adulto"] [data-nino-gratis]').count()) === 0, "Z.4 el infante y los adultos no llevan nota de beneficio");
    const caja = await bloque.boundingBox(), cajaNota = await nota.boundingBox();
    ok(caja && cajaNota && cajaNota.y >= caja.y && cajaNota.y + cajaNota.height <= caja.y + caja.height + 1, "Z.4 la nota está geométricamente DENTRO del bloque del niño (no suelta debajo de la tarjeta)");
    for (const [etq, w, h] of ANCHOS) { await pv.page.setViewportSize({ width: w, height: h }); await pv.page.waitForTimeout(400); await tarjeta.scrollIntoViewIfNeeded(); await tarjeta.screenshot({ path: join(OUT, `Z4-tarjeta-tarifa-${etq}.png`) }); const g = await geometria(pv.page, '[data-testid="desglose-tarifas"]'); ok(!g.desborde, `Z.4 tarjeta · ${etq} (${w}px): sin desborde horizontal`, JSON.stringify(g)); }
  } else console.log("       (informativo) este dato de revisión no produce un niño con beneficio parcial en esta búsqueda; la estructura queda cubierta por la prueba React del caso del dueño.");
  await pv.ctx.close();
  await cam.ctx.close(); await adm.ctx.close(); await beto.ctx.close();
}

// ═══ ZR · R326-1: capacidad ofrecida = capacidad que se puede guardar (límite técnico de 30), distinta del universo ═══════════════════════════════════════════
// Fixture (SOLO en la copia): clon de una cotización de carrito de la aliada con DOS servicios independientes de 16 viajeros (universo 16..32 ⇒ 31 adicionales como cota; la captura admite 30).
// ZR.1 el panel lo dice antes de escribir y ofrece 30; ZR.2 las 30 se guardan con la acción real y la base (nada se trunca); ZR.3 en el límite no se afirma que estén todos y el botón no se ofrece;
// ZR.4 la 31 se rechaza en la base con el mensaje propio (no el 23514 del CHECK); ZR.5 el personal puede completar el resto en la conversión (cota del universo: 32 filas).
if (SEC.includes("ZR")) {
  console.log("\n══ ZR · R326-1: dos servicios de 16 viajeros — límite técnico de captura (30) frente al universo (hasta 32) ══");
  sql(`do $$ declare r public.cotizaciones; it jsonb; begin
    select * into r from public.cotizaciones where creado_por = 'freelance@revision.test' and tipo = 'carrito' and estado = 'abierta' order by id desc limit 1;
    if r.id is null then raise exception 'sin cotización de carrito abierta de la aliada'; end if;
    it := jsonb_set((r.payload->'items')->0, '{pax}', '16'::jsonb);
    r.id := nextval(pg_get_serial_sequence('public.cotizaciones', 'id')); r.codigo := 'C-9R' || r.id; r.share_token := md5(random()::text); r.clave_envio := gen_random_uuid();
    r.numero_contrato := null; r.estado := 'abierta'; r.vigencia_hasta := current_date + 30; r.pax := 16;
    r.payload := jsonb_set(jsonb_set(r.payload, '{items}', jsonb_build_array(it, it)), '{pasajeros}', '[]'::jsonb);
    insert into public.cotizaciones select r.*; end $$;`);
  const [idZ, codZ] = sql(`select id || '|' || codigo from public.cotizaciones where codigo like 'C-9R%' order by id desc limit 1`).split("|");
  ok(!!idZ, `ZR fixture ${codZ} (id ${idZ}): dos servicios independientes de 16 viajeros, propiedad de la aliada`);
  const cam = await sesion("freelance@revision.test");
  const panel = await abrirPanel(cam.page, codZ, "directas");
  const t0 = norm(await panel.innerText());
  ok(/Hasta 30 además del titular/.test(t0), "ZR.1 el panel ofrece 30 adicionales (no 31) antes de que escriba nada");
  ok(/2 servicios independientes/.test(t0) && /hasta 30 pasajeros adicionales/.test(t0) && /completa el resto al convertir/.test(t0), "ZR.1 y lo explica ANTES de la captura: el universo declarado, el límite de 30 y que el personal completa el resto", t0.slice(0, 500));
  const lista = Array.from({ length: 30 }, (_, i) => ({ nombres: `Viajero${i + 2}`, apellidos: "Limite" }));
  await escribirPasajeros(panel, lista);
  ok(sql(`select jsonb_array_length(pasajeros) from public.cotizacion_pasajeros_aliado where cotizacion_id = ${idZ}`) === "30", "ZR.2 la acción real y la base guardaron los 30 pasajeros (la frontera)");
  ok(sql(`select (pasajeros->29->>'nombres') || '|' || (pasajeros->0->>'nombres') from public.cotizacion_pasajeros_aliado where cotizacion_id = ${idZ}`) === "Viajero31|Viajero2", "ZR.2 ninguno se truncó: están el primero y el último escritos");
  const resum = panel.locator('[data-testid="pasajero-aliado-resumen"]');
  ok((await resum.count()) === 30 && (await panel.locator('[data-testid="pasajero-aliado"]').count()) === 0, "ZR.2 tras guardar, los 30 quedan compactos");
  const t1 = norm(await panel.innerText());
  ok((await panel.getByTestId("agregar-pasajero").count()) === 0, "ZR.3 con 30 adicionales «Agregar pasajero» NO se ofrece (la fila 31 no existe en pantalla)");
  ok(/Llegaste al máximo de 30 pasajeros adicionales/.test(t1) && /NO significa que ya estén todos los viajeros/.test(t1) && !/Ya están todos/.test(t1), "ZR.3 en el límite el panel NO afirma que estén todos: dice que el personal completa el resto");
  await presentacion(cam.page, "panel en el límite técnico (30 compactos)", '[data-testid="preparacion-contrato"]', "ZR-panel-limite");
  await cam.page.reload({ waitUntil: "networkidle" });
  const p2 = panelDe(cam.page, codZ); await p2.locator("summary").click(); await cam.page.waitForTimeout(300);
  ok((await p2.locator('[data-testid="pasajero-aliado-resumen"]').count()) === 30 && (await p2.getByTestId("agregar-pasajero").count()) === 0 && /NO significa que ya estén todos/.test(norm(await p2.innerText())), "ZR.3 tras recargar sigue igual: 30 guardados, sin botón y con el aviso");
  // quitar uno libera un lugar dentro del límite
  await p2.locator('button[aria-label="Quitar pasajero 31"]').click(); await cam.page.waitForTimeout(250);
  ok((await p2.getByTestId("agregar-pasajero").count()) === 1, "ZR.3 al quitar una fila (29) vuelve a ofrecerse exactamente una más");
  // ZR.4 sobre la frontera, en la base real (la pantalla ya no permite escribirla): mensaje propio, no el CHECK; la lista guardada no cambia
  const l31 = `(select jsonb_agg(jsonb_build_object('nombres', 'P' || i, 'apellidos', 'Z')) from generate_series(1, 31) i)`;
  let msg = ""; try { sql(`select public.cotizacion_pasajeros_aliado_guardar(${idZ}, (select id from public.usuarios where lower(email) = 'freelance@revision.test'), ${l31})`); } catch (e) { msg = String(e.stderr ?? e.message); }
  ok(/F4721/.test(msg) && /hasta 30 pasajeros adicionales/.test(msg) && !/23514|cotizacion_pasajeros_aliado_pasajeros_check/.test(msg), `ZR.4 31 pasajeros: la base responde con su mensaje propio (F4721 «hasta 30 … completa el resto»), no con el CHECK`, msg.slice(0, 300));
  ok(sql(`select jsonb_array_length(pasajeros) from public.cotizacion_pasajeros_aliado where cotizacion_id = ${idZ}`) === "30", "ZR.4 el intento rechazado no cambió la lista guardada (siguen 30)");
  // ZR.5 ruta del personal: la conversión (cota del universo 32) recibe los 30 y deja completar el resto
  const adm = await sesion("administracion@revision.test");
  await ir(adm.page, `/dashboard/cotizaciones/${idZ}`);
  await adm.page.getByRole("button", { name: /Confirmar → generar contrato/ }).click(); await adm.page.waitForTimeout(1200);
  const filasN = await adm.page.locator('[data-testid="pasajero-resumen"], [data-testid="pasajero-fila"]').count();
  ok(filasN === 31, `ZR.5 la conversión del personal recibe titular + 30 pasajeros sin retipear (${filasN} filas)`);
  ok((await adm.page.getByTestId("agregar-pasajero").count()) === 1 && /2 servicios independientes/.test(norm(await adm.page.getByTestId("nota-universo").innerText())), "ZR.5 el personal SÍ puede agregar la fila que falta (el límite técnico no aplica a su pantalla; su cota es el universo, 32)");
  await adm.page.getByTestId("agregar-pasajero").click(); await adm.page.waitForTimeout(250);
  ok((await adm.page.locator('[data-testid="pasajero-resumen"], [data-testid="pasajero-fila"]').count()) === 32 && (await adm.page.getByTestId("agregar-pasajero").count()) === 0, "ZR.5 con 32 filas se alcanza la cota del universo y el botón desaparece");
  await presentacion(adm.page, "conversión del personal con 31+1 filas", "main", "ZR-conversion-personal");
  await cam.ctx.close(); await adm.ctx.close();
}


// ═══ U · consumo en reposo ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Referencia: la campana de avisos (#86) sondea UNA vez cada 30 s por pestaña (INTERVALO_SONDEO_MS, con limpieza al desmontar y pausa al ocultar la pestaña). Las pantallas nuevas no
// tienen temporizadores ni efectos de red: en reposo deben costar EXACTAMENTE lo mismo que una pantalla equivalente SIN panel (misma pestaña, mismo sondeo) y cero lecturas del navegador a la base.
if (SEC.includes("U")) {
  console.log("\n══ U · consumo: solicitudes en reposo (30 s) con el panel nuevo frente a pantallas equivalentes sin él ══");
  const cam = camila ?? await sesion("freelance@revision.test"), ad = adm ?? await sesion("administracion@revision.test");
  const cotId = cot.id ?? Number(sql(`select id from public.cotizaciones where tipo = 'carrito' order by id desc limit 1`));
  const medidas = {};
  for (const [nombre, page, ruta] of [
    ["portal SIN panel (inicio del aliado)", cam.page, "/portal/b2b"],
    ["portal CON panel (cotizaciones directas, panel abierto)", cam.page, "/portal/b2b/cotizaciones?vista=directas"],
    ["personal SIN evidencia (panel principal)", ad.page, "/dashboard"],
    ["personal CON evidencia (cotización del aliado)", ad.page, `/dashboard/cotizaciones/${cotId}`],
  ]) {
    await ir(page, ruta); await page.waitForTimeout(1500);
    if (/directas/.test(ruta)) { const s = page.locator('[data-testid="preparacion-contrato"] summary').first(); if (await s.count()) await s.click(); }
    const c = peticiones(page); await page.waitForTimeout(31000);
    medidas[nombre] = { acciones: c.acciones, rest: c.rest, otras: c.otras }; consumo.push([`reposo 31 s · ${nombre}`, c.acciones, c.rest, c.otras]);
    console.log(`       reposo 31 s · ${nombre}: acciones ${c.acciones}, lecturas REST del navegador ${c.rest}, otras ${c.otras}`);
    ok(c.rest === 0 && c.otras === 0, `U ${nombre}: en reposo, cero lecturas del navegador a la base y cero navegaciones/recargas`);
  }
  const m = Object.values(medidas);
  ok(m[1].acciones === m[0].acciones && m[3].acciones === m[2].acciones, `U el panel nuevo no suma solicitudes en reposo: portal ${m[1].acciones} = ${m[0].acciones} sin panel; personal ${m[3].acciones} = ${m[2].acciones} sin evidencia (el sondeo de 30 s de la campana, ya existente)`);
  ok(m.every((x) => x.acciones <= 2), "U el reposo equivale a ≤ 1 sondeo de la campana por 30 s y pestaña (31 s de espera → 1; no crece)");
  console.log("       [consumo por paso] " + JSON.stringify(consumo));
}
await browser.close();
console.log(`\n=== O-3/O-2: ${aciertos} OK, ${fallos} FALLO`);
process.exit(fallos ? 1 : 0);
