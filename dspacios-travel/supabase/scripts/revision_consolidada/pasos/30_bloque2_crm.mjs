// Bloque 2 — CRM: #76 referidos (catálogo, códigos, asignación manual, código en el registro público, elegibilidad) y #78 aviso de cotización pública del visitante («Atendida» = convertida).
// #27/#28 (inventarios de diagnóstico de clientes/contratos) son SCRIPTS SQL de solo lectura sin pantalla: no tienen paso en esta guía.
// NO IMPLEMENTADO (se repite en los textos para no engañar al dueño): registro de pago al referidor, retención/documento de pago, asiento contable o margen de referidos, política de pago en USD.
// Datos: semilla 06 (referidor «Odair Referidor», códigos ODAIR-1 al 1 % y ODAIR-2 al 2 %, aliados 9801/9802, contratos DTM-7001…7006, registros B2B pendientes) y semilla tras_perfiles/12 (DTM-6101 ordinaria y DTM-6102 NETO, ambas con base 2.600.000 al 2 % = 52.000).
import fs from "node:fs";
import path from "node:path";

const CFG = JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA ?? "", "dspacios-local-revision-consolidada", "config.json"), "utf8"));
const MAIL = `http://127.0.0.1:${CFG.puertos.correo}`;
const EMAIL_REG = "registro.referido@consolidada.test", NOMBRE_REG = "Agencia Registro Revision", DOC_VISITANTE = "77100001";

const texto = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
const esperarTexto = (page, re, ms = 30000) => page.waitForFunction((s) => new RegExp(s).test(document.body.innerText), re.source, { timeout: ms });
const filaContrato = (page, n) => page.locator("tr:visible, li:visible").filter({ hasText: n }).first().innerText().then((t) => t.replace(/\s+/g, " "));
const campana = (page) => page.locator('button[aria-label^="Avisos"]:visible').first();
const panelCampana = (page) => page.locator("[role=region][aria-label=Avisos]");
const gerenciaId = (c) => c.sql("select id from public.usuarios where email = 'gerencia@consolidada.test'");
const refContrato = (c, n) => c.sql(`select referidor_id || '|' || pct || '|' || coalesce(comision::text, '') || '|' || estado from public.referidos_contratos('${gerenciaId(c)}', null, null) where numero_contrato = '${n}'`);

// Abre otra sesión (otra cuenta) en un contexto aparte del mismo navegador, para comprobar lo que NO ve otro rol dentro del mismo paso.
async function comoOtro(c, alias, ruta, fn) {
  const ctx = await c.page.context().browser().newContext({ viewport: { width: c.ancho, height: 900 }, locale: "es-CO", timezoneId: "America/Bogota" });
  const page = await ctx.newPage();
  try {
    await page.goto(`${c.APP}/login`, { waitUntil: "domcontentloaded" }); await page.waitForLoadState("networkidle").catch(() => {});
    await page.fill('input[name="email"]', `${alias}${c.cuentas}`); await page.fill('input[name="password"]', c.clave);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => null), page.click('button[type="submit"]')]);
    await page.waitForTimeout(800);
    await page.goto(`${c.APP}${ruta}`, { waitUntil: "domcontentloaded" }); await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1200);
    return await fn(page);
  } finally { await ctx.close(); }
}

// Código de verificación del registro: llega por GoTrue real al correo de pruebas (Mailpit).
async function codigoDeCorreo(email) {
  for (let i = 0; i < 25; i++) {
    const lista = await (await fetch(`${MAIL}/api/v1/messages`)).json();
    const m = (lista.messages ?? []).filter((x) => (x.To ?? []).some((t) => t.Address?.toLowerCase() === email)).sort((a, b) => String(b.Created).localeCompare(String(a.Created)))[0];
    if (m) { const d = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json(); const k = /\b(\d{6,8})\b/.exec(d.Text ?? ""); if (k) return k[1]; }
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}
// RC-4: utilidades para recorrer los formularios REALES (mismos helpers que 50_bloque95).
const aBogota = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const campo = (page, etiqueta, n = 0) => page.locator(`xpath=(//label[normalize-space(.)="${etiqueta}"])[${n + 1}]/parent::*`).locator("input:not([type=hidden]), select, textarea").first();
const fechaIn = async (page, etiqueta, iso, n = 0) => { const el = page.getByLabel(etiqueta, { exact: true }).nth(n); await el.fill(aBogota(iso)); await el.press("Tab"); };
const boton = (page, nombre) => page.getByRole("button", { name: nombre }).first();
// rev2 · B2-11/B2-12a: lee la tarjeta «Titular de la cotización» de la ficha de trabajo (atributos data-testid), SIN abrir «Ver / Imprimir».
const campoFicha = async (page, id) => ((await page.getByTestId(id).count()) ? (await page.getByTestId(id).first().innerText()).replace(/\s+/g, " ").trim() : "");
async function leerFicha(page) {
  await page.getByTestId("ficha-titular-cotizacion").waitFor({ timeout: 30000 });
  const g = (id) => campoFicha(page, id);
  return { nombre: await g("ficha-nombre"), documento: await g("ficha-documento"), nacimiento: await g("ficha-nacimiento"), telefono: await g("ficha-telefono"), email: await g("ficha-email"), origen: await g("ficha-origen"), aliado: await g("ficha-aliado"), composicion: await g("ficha-composicion"), pasajeros: await g("ficha-pasajeros"), registro: await g("ficha-registro") };
}
const tarjetaB2B = (page, nombre) => page.locator("div.rounded-xl").filter({ has: page.locator("span.font-semibold", { hasText: new RegExp(`^${nombre}$`) }) }).last();

export const pasos = [
  {
    id: "B2-01", entrega: "bloque2", rol: "gerencia", titulo: "Referidos: catálogo, asignaciones y contratos con su participación", ruta: "/crm/referidos", solo_lectura: true,
    accion: "Con la cuenta de gerencia (superadmin ve lo mismo) abre CRM → Referidos y recorre la pantalla de arriba abajo. Revisa «Referidores y códigos», «Asignaciones vigentes» y la tabla «Contratos con participación de referido» (en el celular son fichas).",
    esperado: "El referidor «Odair Referidor» con sus códigos «ODAIR-1 · 1 %» y «ODAIR-2 · 2 %»; asignaciones vigentes: «Agencia Humo Uno» al 1 % y «Freelance Humo Dos» al 2 %. En los contratos, cada participación = porcentaje × la base comisionable que el aliado ya tiene guardada: DTM-7001 8.000 (1 % de 800.000, «Pagable»); DTM-7002 60.000 (2 % de 3.000.000, «Pendiente de pago del contrato» porque está pagado a medias); DTM-7003 USD $25 (1 % de USD $2,500, «Pagable»); "
      + "DTM-6101 ordinaria 52.000 y DTM-6102 NETO 52.000 (2 % de la MISMA base de 2.600.000, «Pagable»: en el NETO se usa la base original, no lo que pagó el cliente); DTM-7004 NETO 20.000 (2 % de 1.000.000 original); DTM-7005 «Contrato cancelado» en $ 0; DTM-7006 sin comisión del aliado guardada: «Sin evidencia» y «Falta la base de la comisión del aliado», NUNCA un cero inventado. Los totales salen separados por moneda (COP y USD). "
      + "ELEGIBLE NO ES PAGADO: «Pagable» solo dice que el contrato está 100 % pagado; la pantalla aclara que no se paga automáticamente. NO IMPLEMENTADO: registrar el pago al referidor, retención o documento de pago, asiento contable/margen de referidos y la política de pago en USD; tampoco hay pantalla para los inventarios #27/#28 (son scripts SQL de solo lectura).",
    async verificar(c) {
      await c.ir("/crm/referidos");
      const t = await c.texto();
      c.check("catálogo: referidor y códigos con su porcentaje", /Odair Referidor/.test(t) && /ODAIR-1 · 1 %/.test(t) && /ODAIR-2 · 2 %/.test(t), t.slice(0, 200));
      c.check("asignaciones vigentes: Humo Uno 1 % y Humo Dos 2 %", /Agencia Humo Uno referido por Odair Referidor 1 %/.test(t) && /Freelance Humo Dos referido por Odair Referidor 2 %/.test(t));
      const f = {}; for (const n of ["DTM-7001", "DTM-7002", "DTM-7003", "DTM-7004", "DTM-7005", "DTM-7006", "DTM-6101", "DTM-6102"]) f[n] = await filaContrato(c.page, n);
      c.check("DTM-7001: 1 % de 800.000 = 8.000, Pagable", /1 %/.test(f["DTM-7001"]) && /8\.000/.test(f["DTM-7001"]) && /Pagable/.test(f["DTM-7001"]), f["DTM-7001"]);
      c.check("DTM-7002: 2 % de 3.000.000 = 60.000, pendiente de pago del contrato", /2 %/.test(f["DTM-7002"]) && /60\.000/.test(f["DTM-7002"]) && /Pendiente de pago del contrato/.test(f["DTM-7002"]), f["DTM-7002"]);
      c.check("DTM-7003 (USD): USD $25 Pagable", /USD \$25(?!\d)/.test(f["DTM-7003"]) && /Pagable/.test(f["DTM-7003"]), f["DTM-7003"]);
      c.check("ordinaria DTM-6101: 2 % de 2.600.000 = 52.000, Pagable", /2\.600\.000/.test(f["DTM-6101"]) && /52\.000/.test(f["DTM-6101"]) && /Pagable/.test(f["DTM-6101"]) && !/NETO/.test(f["DTM-6101"]), f["DTM-6101"]);
      c.check("NETO DTM-6102: MISMA base 2.600.000 y MISMA participación 52.000", /NETO · base original/.test(f["DTM-6102"]) && /2\.600\.000/.test(f["DTM-6102"]) && /52\.000/.test(f["DTM-6102"]) && /Pagable/.test(f["DTM-6102"]), f["DTM-6102"]);
      c.check("NETO DTM-7004: 2 % sobre la base original (20.000), no sobre lo cobrado ni sobre la comisión del aliado", /NETO · base original/.test(f["DTM-7004"]) && /20\.000/.test(f["DTM-7004"]) && !/17\.800/.test(f["DTM-7004"]) && !/2\.200/.test(f["DTM-7004"]), f["DTM-7004"]);
      c.check("DTM-7005 cancelado: «Contrato cancelado»", /Contrato cancelado/.test(f["DTM-7005"]), f["DTM-7005"]);
      c.check("DTM-7006 sin evidencia: sin monto calculado y con la explicación", /Sin evidencia/.test(f["DTM-7006"]) && /Falta la base de la comisión del aliado/.test(f["DTM-7006"]) && !/\$ 0\b/.test(f["DTM-7006"]), f["DTM-7006"]);
      const dl = await c.page.locator("dl > div").allInnerTexts();
      c.check("totales separados por moneda (COP y USD)", dl.length === 2 && dl.some((x) => x.trim().startsWith("COP")) && dl.some((x) => x.trim().startsWith("USD")), dl.join(" | "));
      c.check("aclara que la elegibilidad no es un pago", /no se paga automáticamente/.test(t) && /solo es pagable cuando el contrato está 100 % pagado/.test(t));
      c.check("NO hay controles de pago al referidor (no implementado)", (await c.page.getByRole("button", { name: /Pagar|Registrar pago|Liquidar|Retenci/i }).count()) === 0);
      c.check("gerencia ve los formularios de gestión", (await c.page.getByRole("button", { name: /Guardar referidor/ }).count()) === 1 && (await c.page.getByRole("button", { name: "Asignar", exact: true }).count()) === 1);
    },
  },
  {
    id: "B2-02", entrega: "bloque2", rol: "administracion", titulo: "Administración consulta los referidos pero no puede asignar ni cambiar", ruta: "/crm/referidos", solo_lectura: true,
    accion: "Con la cuenta de administración abre CRM → Referidos. Busca formularios, botones de asignar o terminar asignación, y mira la sección «Códigos de registro por confirmar».",
    esperado: "Ve los mismos contratos, asignaciones y códigos (consulta), pero NO hay formularios ni botones «Asignar», «Terminar asignación», «Guardar» ni «Aplicar código». Aparece «Tu rol puede consultar los referidos. Solo superadmin y gerencia pueden asignarlos o cambiarlos.» En «Códigos de registro por confirmar» ve los candidatos con la nota «Administración puede ver esta información, pero no asignar ni cambiar referidores ni porcentajes», sin opciones de decisión ni «Aplicar decisión».",
    async verificar(c) {
      await c.ir("/crm/referidos");
      const t = await c.texto();
      c.check("administración ve el catálogo y los contratos", /Odair Referidor/.test(t) && /DTM-7001/.test(t) && /ODAIR-1 · 1 %/.test(t));
      c.check("mensaje de solo consulta", /Solo superadmin y gerencia pueden asignarlos o cambiarlos/.test(t));
      c.check("sin formularios de gestión", (await c.page.locator("main form:not([role=search])").count()) === 0 && (await c.page.getByRole("button", { name: /Terminar asignación|Guardar|Aplicar código|Asignar$/ }).count()) === 0);
      c.check("ve los códigos por confirmar sin opciones ni «Aplicar decisión»", /Códigos de registro por confirmar/.test(t) && /Administración puede ver esta información, pero no asignar ni cambiar referidores ni porcentajes/.test(t) && (await c.page.locator("input[type=radio]").count()) === 0 && (await c.page.getByRole("button", { name: /Aplicar decisión/ }).count()) === 0);
    },
  },
  {
    id: "B2-03", entrega: "bloque2", rol: "venta", titulo: "Venta, operaciones y aliados no ven los referidos", ruta: "/crm/referidos", solo_lectura: true,
    accion: "Con la cuenta de venta abre la dirección /crm/referidos. Repite con operaciones y con la agencia aliada.",
    esperado: "En los tres casos aparece «Módulo no disponible para tu usuario» (o el sistema te devuelve a tu portal) y no se ve ningún dato: ni «Odair Referidor» ni contratos DTM-70… ni formularios.",
    async verificar(c) {
      await c.ir("/crm/referidos");
      const t = await c.texto();
      c.check("venta: módulo no disponible (o devuelta a su pantalla) y sin datos", (/Módulo no disponible para tu usuario/.test(t) || !c.page.url().includes("/crm/referidos")) && !/Odair|DTM-70|DTM-61/.test(t), t.slice(0, 160));
      for (const alias of ["operaciones", "aliado"]) {
        const r = await comoOtro(c, alias, "/crm/referidos", async (p) => ({ t: await texto(p), url: new URL(p.url()).pathname }));
        c.check(`${alias}: sin acceso ni datos`, (/Módulo no disponible para tu usuario/.test(r.t) || r.url !== "/crm/referidos") && !/Odair|DTM-70|DTM-61|Contratos con participación/.test(r.t), `${r.url} · ${r.t.slice(0, 120)}`);
      }
    },
  },
  {
    id: "B2-04", entrega: "bloque2", rol: "gerencia", titulo: "Asignar y cambiar el referido de un aliado: solo 1 % o 2 %, solo hacia adelante", ruta: "/crm/referidos",
    accion: "En «Asignar un aliado a un referidor» elige «Agencia Humo Tres · agencia», «Odair Referidor · mayorista», porcentaje «2 %» y pulsa «Asignar». Luego cambia a «Agencia Humo Uno» (hoy 1 %) al «2 %» y pulsa «Asignar» otra vez. En «Asignar por código de referido» escribe «odair-1» para «Aliado Codigo Manual» y pulsa «Aplicar código»; repite con el código inexistente «noexiste» para «Agencia Humo Tres». Por último pulsa «Terminar asignación» en la tarjeta de «Agencia Humo Tres».",
    esperado: "«Asignación creada: rige para compras futuras.»; al cambiar Humo Uno: «Asignación cambiada: rige para compras futuras; el historial se conserva.»; el código válido: «Asignación creada por el código.» (1 %, tomado de la regla del código); el inválido: «El código de referido no es válido.» sin cambiar nada; terminar: «Asignación terminada: las compras futuras ya no generan participación.» Los selectores de porcentaje solo ofrecen «1 %» y «2 %» (no hay campo libre). Los contratos anteriores NO cambian (DTM-7001 sigue al 1 % y 8.000). El historial queda en «Historial de asignaciones». (La compra posterior al cambio se prueba en el paso siguiente con un contrato REAL.)",
    async verificar(c) {
      await c.ir("/crm/referidos");
      const ops = await c.page.locator("select[aria-label=Porcentaje]").evaluateAll((s) => s.map((x) => [...x.options].map((o) => o.textContent.trim()).join("|")));
      c.check("el porcentaje solo se elige entre 1 % y 2 %", ops.length >= 2 && ops.every((o) => o === "1 %|2 %") && (await c.page.locator("input[type=number]").count()) === 0, JSON.stringify(ops));
      const asignar = async (aliado, pct) => {
        const f = c.page.locator("form").filter({ has: c.page.getByRole("button", { name: "Asignar", exact: true }) });
        await f.locator("select").nth(0).selectOption({ label: aliado }); await f.locator("select").nth(1).selectOption({ label: "Odair Referidor · mayorista" }); await f.locator("select").nth(2).selectOption(pct);
        await f.getByRole("button", { name: "Asignar", exact: true }).click();
      };
      await asignar("Agencia Humo Tres · agencia", "0.02"); await esperarTexto(c.page, /Asignación creada: rige para compras futuras/);
      c.check("asignación manual creada al 2 %", c.sql("select pct || '|' || origen from public.aliado_referidores where aliado_id = 9803 and vigente_hasta is null") === "0.0200|manual");
      await asignar("Agencia Humo Uno · agencia", "0.02"); await esperarTexto(c.page, /Asignación cambiada: rige para compras futuras; el historial se conserva/);
      c.check("el cambio cierra la asignación anterior y abre la nueva (historial conservado)", c.sql("select count(*) filter (where vigente_hasta is null) || '|' || count(*) filter (where vigente_hasta is not null) from public.aliado_referidores where aliado_id = 9801") === "1|1");
      await c.ir("/crm/referidos");
      const f7001 = await filaContrato(c.page, "DTM-7001");
      c.check("DTM-7001 conserva su atribución anterior (1 % y 8.000) tras cambiar la asignación", /1 %/.test(f7001) && /8\.000/.test(f7001) && !/2 %/.test(f7001), f7001);
      const fc = c.page.locator("form").filter({ has: c.page.getByRole("button", { name: /Aplicar código/ }) });
      await fc.locator("select").first().selectOption({ label: "Aliado Codigo Manual · agencia" }); await fc.locator("input").first().fill("odair-1");
      await fc.getByRole("button", { name: /Aplicar código/ }).click(); await esperarTexto(c.page, /Asignación creada por el código/);
      c.check("el código fija referidor y 1 % desde la regla guardada (origen código)", c.sql("select pct || '|' || origen || '|' || codigo || '|' || referidor_id from public.aliado_referidores where aliado_id = 9805 and vigente_hasta is null") === "0.0100|codigo|ODAIR-1|9901");
      await fc.locator("select").first().selectOption({ label: "Agencia Humo Tres · agencia" }); await fc.locator("input").first().fill("noexiste");
      await fc.getByRole("button", { name: /Aplicar código/ }).click(); await esperarTexto(c.page, /El código de referido no es válido/);
      c.check("un código inválido no cambia nada (Humo Tres sigue al 2 %)", c.sql("select pct from public.aliado_referidores where aliado_id = 9803 and vigente_hasta is null") === "0.0200");
      await c.page.locator("li").filter({ hasText: "Agencia Humo Tres" }).filter({ has: c.page.getByRole("button", { name: /Terminar asignación/ }) }).getByRole("button", { name: /Terminar asignación/ }).click();
      await esperarTexto(c.page, /Asignación terminada/);
      c.check("terminar conserva el historial y deja el aliado sin referidor vigente", c.sql("select count(*) filter (where vigente_hasta is null) || '|' || count(*) filter (where vigente_hasta is not null) from public.aliado_referidores where aliado_id = 9803") === "0|1");
    },
  },
  {
    id: "B2-04b", entrega: "bloque2", rol: "venta", titulo: "Una compra REAL posterior al cambio: el contrato nuevo nace al 2 % y los anteriores no cambian", ruta: "/dashboard/contratos/nuevo",
    accion: "Con la cuenta de venta (la que puede elegir asesor: ella misma) abre «Nuevo contrato (manual)»: Tipo «Dinámico (todo manual)», Asesor «Rev Venta», Tipo de venta «Agencia (B2B)», Agencia «Agencia Humo Uno» (modo PVP), Nombres «Cliente», Apellidos «Referido Real». En el ítem escribe «Paquete referido», 1 adulto y tarifa adulto 1000000, deja el valor de los tiquetes en 0 y pulsa «Generar contrato». Cuando abra la ficha del contrato, anota su número. Luego, con la cuenta de gerencia, abre ese contrato en la pestaña Cartera, registra un abono de 400.000 por «Transferencia» («Registrar abono») y abre /crm/referidos para buscar ese número.",
    esperado: "El contrato se crea con el formulario normal (no con una instrucción de base). En /crm/referidos, ya como gerencia, aparece el contrato nuevo de Agencia Humo Uno con «Odair Referidor», «2 %» y participación «20.000» (2 % de la base comisionable de 1.000.000), mientras DTM-7001 sigue en «1 %» y «8.000». Antes del abono el contrato está pendiente y todavía NO tiene comisión del aliado (en /crm/referidos aparecería «Sin evidencia»); al registrar el abono se confirma, se crea la comisión (base 1.000.000) y el contrato queda «Pendiente de pago del contrato» (pagado solo en parte).",
    async verificar(c) {
      const p = c.page;
      const antes = c.sql("select count(*) from public.ventas");
      await c.ir("/dashboard/contratos/nuevo");
      await campo(p, "Tipo *").selectOption("dinamico");
      await campo(p, "Asesor interno *").selectOption({ label: "Rev Venta" });
      await campo(p, "Tipo de venta *").selectOption({ label: "Agencia (B2B)" });
      await campo(p, "Agencia *").selectOption({ label: "Agencia Humo Uno" });
      await campo(p, "Nombres *").fill("Cliente"); await campo(p, "Apellidos *").fill("Referido Real");
      // REV2 (F6, B95-13): el destino se elige del catálogo (lista con buscador), ya no se escribe: «CARTAGENA HUMO» (semilla del bloque 2).
      const comboDestino = p.locator('[data-testid="campo-destino"] input[role="combobox"]').first();
      await comboDestino.click(); await comboDestino.fill("CARTAG");
      await p.locator('[role="option"]', { hasText: "CARTAGENA HUMO" }).first().click();
      const hoy = c.sql("select public.fecha_negocio()::text");
      const mas = (n) => c.sql(`select (public.fecha_negocio() + ${n})::text`);
      await fechaIn(p, "Fecha de salida (viaje)", mas(60)); await fechaIn(p, "Fecha de regreso", mas(63));
      const item = p.locator("div.bg-gray-50", { has: p.locator("label", { hasText: "Ítem" }) }).last();
      await item.locator("xpath=.//label[normalize-space(.)='Ítem']/parent::*//input").fill("Paquete referido");
      await item.locator("xpath=.//label[normalize-space(.)='Adultos']/parent::*//input").fill("1");
      await item.locator("xpath=.//label[normalize-space(.)='Tarifa adulto']/parent::*//input").fill("1000000");
      const invalidos = await p.evaluate(() => [...document.querySelectorAll("form :invalid")].map((e) => `${e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.name || e.tagName}: ${e.validationMessage}`));
      c.check("el formulario no tiene campos inválidos antes de enviar", invalidos.length === 0, invalidos.join(" || "));
      await boton(p, "Generar contrato").click();
      const llego = await p.waitForURL(/\/dashboard\/contratos\/(?!nuevo)[^/?]+$/, { timeout: 150000 }).then(() => true, () => false);
      const numero = llego ? decodeURIComponent(new URL(p.url()).pathname.split("/").pop()) : "";
      c.check("el servidor creó el contrato y abrió su ficha", llego && /^DTM-/.test(numero), p.url());
      c.check("hay UN contrato más y es de Agencia Humo Uno (aliado 9801), pendiente de pago, sin comisión registrada todavía (nace al confirmarse)",
        Number(c.sql("select count(*) from public.ventas")) === Number(antes) + 1 && c.sql(`select aliado_id || '|' || estado || '|' || (select count(*) from public.aliados_b2b b where b.numero_contrato = v.numero_contrato) from public.ventas v where numero_contrato = '${numero}'`) === "9801|pendiente|0", c.sql(`select aliado_id || '|' || estado from public.ventas where numero_contrato = '${numero}'`));
      c.check("la atribución ya quedó guardada al crear el contrato (Odair Referidor, 2 %), pero sin base de comisión aún", /^9901\|0\.0200\|\|sin_evidencia_base$/.test(refContrato(c, numero)), refContrato(c, numero));
      // Primer abono REAL (gerencia, formulario «Registrar abono» de la pestaña Cartera): confirma el contrato y registra la comisión del aliado, que es la base de la participación.
      await comoOtro(c, "gerencia", `/dashboard/contratos/${numero}?tab=cartera`, async (pg) => {
        const f = pg.locator("form").filter({ has: pg.getByRole("button", { name: "Registrar abono" }) });
        await f.locator("input[type=number]").first().fill("400000"); await f.locator("select").first().selectOption({ label: "Transferencia" });
        await f.getByRole("button", { name: "Registrar abono" }).click();
        for (let i = 0; i < 60 && c.sql(`select count(*) from public.abonos where numero_contrato = '${numero}'`) === "0"; i++) await new Promise((r) => setTimeout(r, 500));
        for (let i = 0; i < 40 && c.sql(`select count(*) from public.aliados_b2b where numero_contrato = '${numero}'`) === "0"; i++) await new Promise((r) => setTimeout(r, 500));
      });
      c.check("el abono real quedó registrado y el contrato se confirmó con la comisión del aliado (base 1.000.000)", c.sql(`select (select count(*) from public.abonos where numero_contrato = '${numero}') || '|' || (select estado from public.ventas where numero_contrato = '${numero}') || '|' || (select base_comision::bigint from public.aliados_b2b where numero_contrato = '${numero}' and aliado_id = 9801 limit 1)`) === "1|confirmado|1000000", c.sql(`select estado from public.ventas where numero_contrato = '${numero}'`));
      const ref = refContrato(c, numero);
      c.check("la foto del referido del contrato nuevo: Odair Referidor, 2 % y 20.000 (base 1.000.000), pendiente de pago", /^9901\|0\.0200\|20000(\.00)?\|pendiente_pago$/.test(ref), ref);
      c.numeroReal = numero;
      await comoOtro(c, "gerencia", "/crm/referidos", async (pg) => {
        const t = await pg.locator("tr:visible, li:visible").filter({ hasText: numero }).first().innerText().then((x) => x.replace(/\s+/g, " "));
        const t7001 = await pg.locator("tr:visible, li:visible").filter({ hasText: "DTM-7001" }).first().innerText().then((x) => x.replace(/\s+/g, " "));
        c.check("en el CRM el contrato real sale al 2 % con 20.000 y «Pendiente de pago del contrato»", /2 %/.test(t) && /20\.000/.test(t) && /Pendiente de pago del contrato/.test(t), t);
        c.check("DTM-7001 sigue al 1 % con 8.000 (no se reescribió)", /1 %/.test(t7001) && /8\.000/.test(t7001) && !/2 %/.test(t7001), t7001);
      });
    },
  },
  {
    id: "B2-05", entrega: "bloque2", rol: null, titulo: "Registro público de una agencia con código de referido (verificación real por correo)", ruta: "/portal/registro",
    accion: `Sin iniciar sesión abre /portal/registro. Llena: Nombre «${NOMBRE_REG}», Número de documento «99100», Correo «${EMAIL_REG}», Contraseña y Repetir contraseña «Registro2026!». En «Código de referido (opcional)» escribe primero «a b» y pulsa «Continuar: enviar código al correo»; corrige a « odair-2 » (con espacios y minúsculas) y pulsa de nuevo. El código de 6 dígitos llega al correo de pruebas (http://127.0.0.1:${CFG.puertos.correo}); escríbelo en «Código de verificación» y pulsa «Verificar y enviar solicitud».`,
    esperado: "Con «a b» aparece «El código de referido usa de 4 a 20 letras, números o guiones» ANTES de crear la cuenta. Con el código bueno se pide el código del correo; tras verificarlo aparece «¡Solicitud enviada!». El campo dice «Lo revisamos al aprobar tu registro; no cambia tu comisión»: el código queda solo como CANDIDATO (queda como «Por confirmar»), no se asigna ningún referidor al aliado todavía.",
    async verificar(c) {
      const p = c.page;
      await c.ir("/portal/registro"); await p.waitForLoadState("networkidle").catch(() => {});
      const t0 = await c.texto();
      c.check("el campo de código es opcional y explica que no cambia la comisión", /Código de referido \(opcional\)/.test(t0) && /Lo revisamos al aprobar tu registro; no cambia tu comisión/.test(t0));
      const campo = (etq) => p.locator("label").filter({ hasText: new RegExp(`^${etq}`) }).first().locator("xpath=following-sibling::*[1]");
      await campo("Nombre / Razón social").fill(NOMBRE_REG); await campo("Número de documento").fill("99100"); await campo("Correo").fill(EMAIL_REG);
      await campo("Contraseña").fill("Registro2026!"); await campo("Repetir contraseña").fill("Registro2026!");
      await p.locator("#reg-codigo-referido").fill("a b");
      await p.getByRole("button", { name: /Continuar: enviar código al correo/ }).click();
      await esperarTexto(p, /El código de referido usa de 4 a 20 letras, números o guiones/);
      c.check("formato inválido avisado antes de crear la cuenta", c.sql(`select count(*) from auth.users where lower(email) = '${EMAIL_REG}'`) === "0");
      await p.locator("#reg-codigo-referido").fill(" odair-2 ");
      await p.getByRole("button", { name: /Continuar: enviar código al correo/ }).click();
      await p.locator("[data-testid=paso-codigo]").waitFor({ timeout: 40000 });
      const codigo = await codigoDeCorreo(EMAIL_REG);
      c.check("el código de verificación llegó al correo de pruebas (GoTrue real)", !!codigo, String(codigo));
      if (!codigo) return;
      await p.locator("#codigo-correo").fill(codigo);
      await p.getByRole("button", { name: /Verificar y enviar solicitud/ }).click();
      await esperarTexto(p, /Solicitud enviada/, 40000);
      c.check("solicitud creada pendiente con el código como CANDIDATO normalizado", c.sql(`select s.estado || '|' || s.referido_estado || '|' || s.codigo_referido from public.b2b_solicitudes s join public.usuarios u on u.id = s.usuario_id where lower(u.email) = '${EMAIL_REG}'`) === "pendiente|candidato|ODAIR-2");
      c.check("no se asignó ningún referidor (la cuenta ni siquiera está activa)", c.sql(`select count(*) from public.aliado_referidores r join public.usuarios u on u.aliado_id = r.aliado_id where lower(u.email) = '${EMAIL_REG}'`) === "0");
    },
  },
  {
    id: "B2-06", entrega: "bloque2", rol: "administracion", titulo: "Administración aprueba un registro pero no confirma el referido", ruta: "/dashboard/usuarios/b2b",
    accion: "En Usuarios → Aprobaciones B2B busca la solicitud «Freelance Aprueba Admin» (código ODAIR-1). Mira qué controles hay en la parte del código de referido, elige «+ Crear ficha nueva en el catálogo con estos datos» y pulsa «Aprobar».",
    esperado: "La tarjeta muestra «Código de referido escrito en el registro: ODAIR-1» con «Por confirmar» y la nota «Solo superadmin o gerencia confirman el referido y el porcentaje», SIN opciones de decisión ni campo para editar el código. El registro queda aprobado, pero el código sigue como candidato y el aliado nuevo NO recibe referidor (lo decide después gerencia o superadmin en CRM → Referidos).",
    async verificar(c) {
      await c.ir("/dashboard/usuarios/b2b");
      const card = tarjetaB2B(c.page, "Freelance Aprueba Admin"); await card.waitFor({ timeout: 30000 });
      const t = (await card.innerText()).replace(/\s+/g, " ");
      c.check("ve el código candidato y la nota de que solo superadmin/gerencia lo confirman", /Código de referido escrito en el registro: ODAIR-1/.test(t) && /Solo superadmin o gerencia confirman el referido y el porcentaje/.test(t), t.slice(0, 300));
      c.check("sin opciones de decisión ni campo de texto del código", (await card.locator("input[type=radio]").count()) === 0 && (await c.page.locator("[id^='cod-ref-']").count()) === 0);
      await card.locator("select").first().selectOption({ label: "+ Crear ficha nueva en el catálogo con estos datos" });
      await card.getByRole("button", { name: "Aprobar", exact: true }).click();
      await c.page.waitForFunction(() => [...document.querySelectorAll("span.font-semibold")].some((s) => s.textContent.trim() === "Freelance Aprueba Admin" && /aprobada/.test(s.closest("div.rounded-xl")?.innerText ?? "")), null, { timeout: 45000 });
      c.check("registro aprobado y código sigue como candidato", c.sql("select s.estado || '|' || s.referido_estado from public.b2b_solicitudes s join public.usuarios u on u.id = s.usuario_id where u.nombre = 'Freelance Aprueba Admin'") === "aprobada|candidato");
      c.check("el aliado nuevo no recibió referidor", c.sql("select count(*) from public.aliado_referidores r join public.usuarios u on u.aliado_id = r.aliado_id where u.nombre = 'Freelance Aprueba Admin'") === "0");
    },
  },
  {
    id: "B2-07", entrega: "bloque2", rol: "gerencia", titulo: "Gerencia aprueba el registro y confirma el referido en un solo paso", ruta: "/dashboard/usuarios/b2b",
    accion: `En Usuarios → Aprobaciones B2B abre la solicitud de «${NOMBRE_REG}» (la del paso de registro público; si no está, usa «Solicitante Humo»). Lee la línea «Corresponde a Odair Referidor al 2 %», deja marcada la opción «Confirmar: Odair Referidor · 2 %», elige «+ Crear ficha nueva en el catálogo con estos datos» y pulsa «Aprobar».`,
    esperado: "Con gerencia la tarjeta ofrece las opciones: «Confirmar: Odair Referidor · 2 %», «Asignar otro referidor o porcentaje», «No asignar (descartar el código)» y «Decidir después». Al aprobar aparece el aviso con «referido asignado para las compras futuras»; la ficha nueva queda con Odair Referidor al 2 % (origen: código ODAIR-2) y el candidato pasa a «confirmado». Solo rige para compras futuras de ese aliado.",
    async verificar(c) {
      await c.ir("/dashboard/usuarios/b2b");
      let nombre = NOMBRE_REG;
      if ((await tarjetaB2B(c.page, nombre).count()) === 0) nombre = "Solicitante Humo";
      const card = tarjetaB2B(c.page, nombre); await card.waitFor({ timeout: 30000 });
      const t = (await card.innerText()).replace(/\s+/g, " ");
      c.check("la tarjeta resuelve el código contra la regla guardada", /Corresponde a Odair Referidor al 2 %/.test(t), t.slice(0, 300));
      c.check("ofrece confirmar, otro, descartar o decidir después", (await card.locator("input[type=radio]").count()) >= 4 && /Confirmar: Odair Referidor · 2 %/.test(t));
      await card.locator("select").first().selectOption({ label: "+ Crear ficha nueva en el catálogo con estos datos" });
      await card.getByRole("button", { name: "Aprobar", exact: true }).click();
      await esperarTexto(c.page, /referido asignado para las compras futuras/, 45000);
      c.check("aprobada y confirmada: ficha nueva con Odair Referidor al 2 % por código ODAIR-2", c.sql(`select s.estado || '|' || s.referido_estado from public.b2b_solicitudes s join public.usuarios u on u.id = s.usuario_id where u.nombre = '${nombre}'`) === "aprobada|confirmado"
        && c.sql(`select r.pct || '|' || r.origen || '|' || r.codigo from public.aliado_referidores r join public.usuarios u on u.aliado_id = r.aliado_id where u.nombre = '${nombre}' and r.vigente_hasta is null`) === "0.0200|codigo|ODAIR-2");
    },
  },
  {
    id: "B2-08", entrega: "bloque2", rol: "gerencia", titulo: "Códigos por confirmar en el CRM: confirmar después de aprobar; los inválidos no inventan nada", ruta: "/crm/referidos",
    accion: "En CRM → Referidos baja a «Códigos de registro por confirmar». Revisa cada candidato. En «Freelance Ya Aprobado» deja marcada la opción «Confirmar: Odair Referidor · 1 %» y pulsa «Aplicar decisión». En «Freelance Aprueba Admin» (aprobado por administración) elige «No asignar (descartar el código)» y pulsa «Aplicar decisión».",
    esperado: "«Freelance Codigo Invalido» (NOEXISTE) dice «Ese código no corresponde hoy a un referidor activo de esta agencia. No se asignó nada.»; los registros aún pendientes dicen «Decide al aprobar el registro (Usuarios → Aprobaciones B2B) o después de aprobarlo». Solo los registros YA aprobados y enlazados a una ficha tienen «Aplicar decisión». Al confirmar «Freelance Ya Aprobado» aparece «Decisión aplicada. Rige solo para las compras futuras del aliado.» y su ficha queda con Odair Referidor al 1 %; el descartado no recibe referidor. Ningún candidato inválido o sin código genera asignación.",
    async verificar(c) {
      await c.ir("/crm/referidos");
      const t = await c.texto();
      c.check("código inexistente: no corresponde a un referidor y no se asignó nada", /Freelance Codigo Invalido[\s\S]{0,200}NOEXISTE[\s\S]{0,200}no corresponde hoy a un referidor activo/.test(t), t.slice(0, 200));
      c.check("registros pendientes: se decide al aprobar", /Decide al aprobar el registro/.test(t));
      const li = (n) => c.page.locator("li").filter({ hasText: n }).filter({ has: c.page.getByRole("button", { name: /Aplicar decisión/ }) });
      c.check("«Aplicar decisión» solo en los aprobados con ficha (Ya Aprobado y Aprueba Admin)", (await li("Freelance Ya Aprobado").count()) === 1 && (await li("Freelance Aprueba Admin").count()) === 1 && (await li("Freelance Codigo Invalido").count()) === 0);
      c.check("la opción por defecto confirma lo que dice la regla guardada", /Confirmar: Odair Referidor · 1 %/.test(await li("Freelance Ya Aprobado").locator("input[type=radio]:checked").locator("xpath=..").innerText()));
      await li("Freelance Ya Aprobado").getByRole("button", { name: /Aplicar decisión/ }).click();
      await esperarTexto(c.page, /Decisión aplicada\. Rige solo para las compras futuras del aliado/);
      c.check("Ya Aprobado: ficha 9804 con Odair Referidor al 1 % por código y candidato confirmado", c.sql("select pct || '|' || origen || '|' || codigo from public.aliado_referidores where aliado_id = 9804 and vigente_hasta is null") === "0.0100|codigo|ODAIR-1"
        && c.sql("select s.referido_estado from public.b2b_solicitudes s join public.usuarios u on u.id = s.usuario_id where u.nombre = 'Freelance Ya Aprobado'") === "confirmado");
      await c.ir("/crm/referidos");
      const adm = li("Freelance Aprueba Admin");
      await adm.getByText("No asignar (descartar el código)").click();
      await adm.getByRole("button", { name: /Aplicar decisión/ }).click();
      await esperarTexto(c.page, /Decisión aplicada/);
      c.check("descartado: el candidato deja de estar por confirmar y no hay asignación", c.sql("select s.referido_estado from public.b2b_solicitudes s join public.usuarios u on u.id = s.usuario_id where u.nombre = 'Freelance Aprueba Admin'") !== "candidato"
        && c.sql("select count(*) from public.aliado_referidores r join public.usuarios u on u.aliado_id = r.aliado_id where u.nombre = 'Freelance Aprueba Admin'") === "0");
      c.check("registros inválidos o sin código no crearon ninguna asignación", c.sql("select count(*) from public.aliado_referidores r join public.usuarios u on u.aliado_id = r.aliado_id where u.nombre in ('Freelance Codigo Invalido', 'Freelance Sin Codigo')") === "0");
    },
  },
  {
    id: "B2-09", entrega: "bloque2", rol: "gerencia", titulo: "Pago parcial, pago total y anulación cambian la elegibilidad, no la atribución", ruta: "/dashboard/contratos/DTM-7002?tab=cartera",
    accion: "Abre el contrato DTM-7002 (pestaña Cartera; está pagado 1.000.000 de 3.000.000). En «Registrar abono» pon 2.000.000, forma «Transferencia» y pulsa «Registrar abono». Abre CRM → Referidos y mira la fila de DTM-7002. Vuelve al contrato, pulsa «Anular» en el abono de 2.000.000, escribe un motivo y confirma con «Anular abono». Mira otra vez la fila en Referidos.",
    esperado: "Antes: DTM-7002 «Pendiente de pago del contrato». Con el contrato 100 % pagado pasa a «Pagable» (60.000 = 2 % de 3.000.000). Al anular el abono vuelve a «Pendiente de pago del contrato». En los tres momentos el referidor (Odair Referidor), el 2 % y los 60.000 son los mismos: la atribución se guardó al crear el contrato. «Pagable» es solo elegibilidad: NO existe todavía registrar el pago al referidor, ni retención, documento, asiento contable o política en USD (no implementado).",
    async verificar(c) {
      const base = c.sql(`select count(*) from public.abonos where numero_contrato = 'DTM-7002'`);
      c.check("punto de partida: DTM-7002 pendiente de pago, referidor 9901 al 2 %", /^9901\|0\.0200\|60000(\.00)?\|pendiente_pago$/.test(refContrato(c, "DTM-7002")), refContrato(c, "DTM-7002"));
      await c.ir("/dashboard/contratos/DTM-7002?tab=cartera");
      const f = c.page.locator("form").filter({ has: c.page.getByRole("button", { name: "Registrar abono" }) });
      await f.locator("input[type=number]").first().fill("2000000"); await f.locator("select").first().selectOption({ label: "Transferencia" });
      await f.getByRole("button", { name: "Registrar abono" }).click();
      for (let i = 0; i < 40 && c.sql(`select count(*) from public.abonos where numero_contrato = 'DTM-7002'`) === base; i++) await c.espera(500);
      c.check("el abono quedó registrado", c.sql(`select count(*) from public.abonos where numero_contrato = 'DTM-7002'`) === String(Number(base) + 1));
      await c.ir("/crm/referidos");
      const pagable = await filaContrato(c.page, "DTM-7002");
      c.check("con el contrato 100 % pagado la fila pasa a «Pagable» (60.000, 2 %)", /Pagable/.test(pagable) && /60\.000/.test(pagable) && /2 %/.test(pagable), pagable);
      const a1 = refContrato(c, "DTM-7002");
      c.check("la atribución (referidor 9901, 2 %, 60.000) no cambió", /^9901\|0\.0200\|60000(\.00)?\|elegible$/.test(a1), a1);
      await c.ir("/dashboard/contratos/DTM-7002?tab=cartera");
      await c.page.locator("tr").filter({ hasText: "2.000.000" }).getByRole("button", { name: /Anular/ }).first().click();
      await c.page.getByLabel("Motivo (obligatorio)").fill("Prueba de reversa de la revisión");
      await c.page.getByRole("button", { name: "Anular abono" }).click();
      for (let i = 0; i < 40 && c.sql(`select count(*) from public.abonos where numero_contrato = 'DTM-7002'`) !== base; i++) await c.espera(500);
      c.check("el abono quedó anulado", c.sql(`select count(*) from public.abonos where numero_contrato = 'DTM-7002'`) === base);
      await c.ir("/crm/referidos");
      const de = await filaContrato(c.page, "DTM-7002");
      c.check("tras anular vuelve a «Pendiente de pago del contrato» con la misma atribución", /Pendiente de pago del contrato/.test(de) && /60\.000/.test(de) && /^9901\|0\.0200\|60000(\.00)?\|pendiente_pago$/.test(refContrato(c, "DTM-7002")), de);
    },
  },
  {
    id: "B2-10", entrega: "bloque2", rol: null, titulo: "Un visitante pide cotización de un hotel «bajo solicitud» en el tarifario público", ruta: "/tarifario",
    accion: "Sin iniciar sesión abre /tarifario → «Vista Booking» → «Porción terrestre». En «HOTELES BAJO SOLICITUD» pulsa «Solicitar cotización» en «Hotel Solicitud Humo». Llena Ida 10/05/2030, Regreso 13/05/2030, 1 habitación Doble, «¿Viajan menores?» No, Nombres «Visitante», Apellidos «Revision», Número de documento «77100001», WhatsApp «3115550000» y pulsa «Enviar solicitud».",
    esperado: "El visitante recibe la confirmación de su solicitud (sin cuenta). Se crea UNA cotización «pendiente de tarifa» sin autor y NO se crea ningún contrato. El sistema avisa dentro de la plataforma (campana) a quienes pueden generar o asistir cotizaciones en la agencia: superadmin, gerencia, administración, operaciones y los asesores de venta. NO recibe aviso control de vuelo, el administrador de la otra agencia (minorista), ni agencia/freelance aliados, ni cuentas desactivadas. No hay correo ni WhatsApp de aviso.",
    async verificar(c) {
      const p = c.page;
      const contratos0 = c.sql("select count(*) from public.ventas");
      await c.ir("/tarifario");
      await p.getByRole("button", { name: /Vista Booking/ }).click(); await c.espera(1200);
      await p.getByRole("button", { name: /^Porción terrestre$/ }).click(); await c.espera(1800);
      const tarjeta = p.getByText("Hotel Solicitud Humo", { exact: true }).first().locator('xpath=ancestor::div[.//button[contains(.,"Solicitar cotización")]][1]');
      await tarjeta.getByRole("button", { name: /Solicitar cotización/ }).first().click();
      const d = p.locator("[role=dialog]"); await d.waitFor({ timeout: 15000 });
      const fechas = d.locator('input[placeholder="dd/mm/aaaa"]'); await fechas.nth(0).fill("10/05/2030"); await fechas.nth(1).fill("13/05/2030");
      await d.locator("input[type=number]").nth(1).fill("1"); await d.locator("input[type=radio][value=no]").check();
      const lab = (t) => d.locator("label", { hasText: new RegExp(`^${t}`) }).locator("input,textarea,select").first();
      await lab("Nombres").fill("Visitante"); await lab("Apellidos").fill("Revision"); await lab("Número de documento").fill(DOC_VISITANTE); await lab("WhatsApp").fill("3115550000");
      await d.getByRole("button", { name: "Enviar solicitud" }).click();
      for (let i = 0; i < 60 && c.sql(`select count(*) from public.cotizaciones where cliente_documento = '${DOC_VISITANTE}'`) === "0"; i++) await c.espera(500);
      const cot = c.sql(`select id || '|' || estado || '|' || coalesce(creado_por, '') || '|' || codigo from public.cotizaciones where cliente_documento = '${DOC_VISITANTE}' order by id desc limit 1`).split("|");
      c.check("una cotización pendiente de tarifa, sin autor", cot[1] === "pendiente_tarifa" && cot[2] === "", cot.join("|"));
      c.check("no se creó ningún contrato", c.sql("select count(*) from public.ventas") === contratos0);
      const dest = c.sql(`select string_agg(u.email, ',' order by u.email) from public.avisos a join public.usuarios u on u.id = a.usuario_id where a.tipo = 'cotizacion_publica' and a.cotizacion_id = ${Number(cot[0])}`);
      const esperado = ["administracion", "gerencia", "operaciones", "superadmin", "venta", "venta2"].map((a) => `${a}@consolidada.test`).sort().join(",");
      c.check("avisan exactamente a quienes pueden generar/asistir cotizaciones (sin aliados, control de vuelo ni minorista)", dest === esperado, dest);
    },
  },
  {
    id: "B2-11", entrega: "bloque2", rol: "gerencia", titulo: "El aviso de la cotización pública en la campana global", ruta: "/dashboard/cotizaciones", solo_lectura: true,
    accion: "Con gerencia abre Cotizaciones (cualquier pantalla del panel o del CRM tiene la campana) y pulsa la campana de arriba a la derecha. En el celular el panel debe caber en la pantalla. Después, SIN abrir «Ver / Imprimir cotización»: en Cotizaciones mira la columna «Cliente» de «Titular Ficha Uno», pulsa «Ver →» en esa fila y lee la tarjeta «Titular de la cotización»; abre «¿Cuándo se guarda este titular en el CRM?»; repite con «Titular Ficha Dos».",
    esperado: "Entre los demás avisos de la campana (compras por vencer, soportes de pago, solicitudes de aliados…) aparece «Nueva cotización de un visitante del tarifario: COT-…» con el código de la cotización del visitante, sin su nombre, documento ni teléfono, y SIN la marca «Atendida» (todavía no se convirtió en contrato). Pulsar el aviso lleva a la ficha de esa cotización. En la lista, bajo «Titular Ficha Uno» hay una línea gris «••••0001 · 3115550001 · ficha.uno@consolidada.test» (documento enmascarado: solo los últimos 4). La ficha, sin abrir el documento imprimible, muestra la tarjeta «Titular de la cotización»: Nombre «Titular Ficha Uno», Documento «CC 88100001», Nacimiento «1988-03-15», Teléfono «3115550001», Correo «ficha.uno@consolidada.test»; «Origen: Cotización dinámica · personal interno · asesor Rev Venta»; «Adultos: 2 · Niños: 1 · Infantes: 1»; «Viajeros con datos guardados (1)»: «Viajero Ficha Uno · CC 88100002 · Nac. 1990-07-20»; una nota sobre «Personas de cotización» (registrado o pendiente de «Reintentar»). El texto «¿Cuándo se guarda este titular en el CRM?» dice que se registra al crear o guardar la cotización, no al verla, aceptarla, descartarla ni convertirla. «Titular Ficha Dos» (carrito de un freelance): «Aliado: Freelance Humo (freelance) · El titular de abajo es el viajero, no el aliado.», Documento «88200001 (tipo no registrado)» (nunca se supone «CC») y Nacimiento, Teléfono y Correo dicen «No registrado».",
    async verificar(c) {
      const cot = c.sql(`select id || '|' || codigo from public.cotizaciones where cliente_documento = '${DOC_VISITANTE}' order by id desc limit 1`).split("|");
      c.check("existe la cotización del visitante (paso anterior)", cot.length === 2 && cot[1] !== "", cot.join("|"));
      await c.ir("/dashboard/cotizaciones"); await c.espera(2500);
      await campana(c.page).click(); await c.espera(900);
      const enlace = panelCampana(c.page).locator("a", { hasText: cot[1] }).first();
      const t = (await enlace.innerText()).replace(/\s+/g, " ");
      c.check("el aviso nombra la cotización pública con su código", /Nueva cotización de un visitante del tarifario/.test(t) && t.includes(cot[1]), t);
      c.check("sin datos personales del visitante y todavía sin «Atendida»", !/Visitante|Revision|77100001|3115550000/.test(t) && !/Atendida/.test(t), t);
      c.check("enlaza a la ficha de la cotización", (await enlace.getAttribute("href")) === `/dashboard/cotizaciones/${cot[0]}`);
      const caja = await panelCampana(c.page).boundingBox();
      c.check("el panel cabe en la pantalla", !!caja && caja.x >= -1 && caja.x + caja.width <= c.ancho + 1, JSON.stringify(caja));
      // rev2 · el titular está a la vista en la lista y en la ficha de trabajo ANTES de decidir, sin abrir «Ver / Imprimir» (semilla semillas/rev2/b2holder.sql).
      c.check("la semilla rev2/b2holder está cargada («Titular Ficha Uno» y «Titular Ficha Dos»)", c.sql("select count(*) from public.cotizaciones where cliente in ('Titular Ficha Uno', 'Titular Ficha Dos')") === "2");
      const [idUno, idDos] = ["Titular Ficha Uno", "Titular Ficha Dos"].map((n) => c.sql(`select id from public.cotizaciones where cliente = '${n}' order by id desc limit 1`));
      const ventas0 = c.sql("select count(*) from public.ventas");
      await c.ir("/dashboard/cotizaciones"); await c.espera(2000);
      const filaUno = c.page.locator("tr", { hasText: "Titular Ficha Uno" }).first();
      const txtFila = (await filaUno.innerText()).replace(/\s+/g, " ");
      c.check("la lista muestra bajo el cliente el documento enmascarado y el contacto, nunca el documento completo", (await filaUno.getByTestId("lista-titular-contacto").innerText()).trim() === "••••0001 · 3115550001 · ficha.uno@consolidada.test" && !txtFila.includes("88100001"), txtFila);
      await filaUno.getByRole("link", { name: /Ver/ }).click();
      await c.page.waitForURL(new RegExp(`/dashboard/cotizaciones/${idUno}$`), { timeout: 30000 });
      const f1 = await leerFicha(c.page);
      c.check("la ficha de trabajo (no el documento imprimible) muestra nombre, documento, nacimiento y contacto del titular", !c.page.url().includes("/cotizacion/") && f1.nombre === "Titular Ficha Uno" && f1.documento === "CC 88100001" && f1.nacimiento === "1988-03-15" && f1.telefono === "3115550001" && f1.email === "ficha.uno@consolidada.test", JSON.stringify(f1));
      c.check("origen y composición: dinámica interna con su asesor · Adultos 2 · Niños 1 · Infantes 1", f1.origen.includes("Cotización dinámica · personal interno · asesor Rev Venta") && f1.composicion === "Adultos: 2 · Niños: 1 · Infantes: 1", `${f1.origen} | ${f1.composicion}`);
      c.check("viajero guardado con su documento y nacimiento", /\(1\)/.test(f1.pasajeros) && f1.pasajeros.includes("Viajero Ficha Uno") && f1.pasajeros.includes("CC 88100002") && f1.pasajeros.includes("Nac. 1990-07-20"), f1.pasajeros);
      c.check("la nota de registro habla de Personas de cotización (registrado o pendiente de «Reintentar»; nunca un dato inventado)", /Personas de cotización/.test(f1.registro), f1.registro);
      const caja1 = await c.page.getByTestId("ficha-titular-cotizacion").boundingBox();
      const botDescartar = c.page.getByRole("button", { name: /Descartar/ }).first();
      c.check("la tarjeta está ARRIBA de las decisiones (descartar / generar contrato) y no se pulsó ninguna", (await botDescartar.count()) > 0 && !!caja1 && caja1.y < (await botDescartar.boundingBox()).y && c.sql(`select estado from public.cotizaciones where id = ${idUno}`) === "abierta" && c.sql("select count(*) from public.ventas") === ventas0);
      const caja1Tam = await c.page.getByTestId("ficha-titular-cotizacion").boundingBox();
      c.check("la tarjeta cabe en la pantalla", !!caja1Tam && caja1Tam.x >= -1 && caja1Tam.x + caja1Tam.width <= c.ancho + 1, JSON.stringify(caja1Tam));
      await c.page.locator("summary", { hasText: "¿Cuándo se guarda este titular en el CRM?" }).click(); await c.espera(300);
      const crmTxt = (await c.page.locator("details", { hasText: "¿Cuándo se guarda este titular en el CRM?" }).innerText()).replace(/\s+/g, " ");
      c.check("la explicación distingue crear/guardar de ver/aceptar/descartar/convertir", /al crear o guardar la cotización: no al verla, aceptarla, descartarla ni convertirla/.test(crmTxt) && /Convertir en contrato no crea personas ni contactos nuevos/.test(crmTxt), crmTxt);
      await c.ir(`/dashboard/cotizaciones/${idDos}`);
      const f2 = await leerFicha(c.page);
      c.check("venta B2B: el aliado se rotula aparte del viajero y el documento no supone «CC»", f2.aliado === "Aliado: Freelance Humo (freelance) · El titular de abajo es el viajero, no el aliado." && f2.nombre === "Titular Ficha Dos" && f2.documento === "88200001 (tipo no registrado)" && f2.origen.includes("Carrito del tarifario"), JSON.stringify(f2));
      c.check("lo no guardado dice «No registrado» (nacimiento, teléfono y correo)", [f2.nacimiento, f2.telefono, f2.email].every((x) => x === "No registrado"), JSON.stringify(f2));
    },
  },
  {
    id: "B2-12a", entrega: "bloque2", rol: "operaciones", titulo: "Valorar la solicitud del visitante: cargar la neta del hotel (REAL)", ruta: "/dashboard/cotizaciones",
    accion: "Con la cuenta de operaciones abre el aviso «Nueva cotización de un visitante del tarifario: COT-…» de la campana (o la cotización del visitante en Cotizaciones). ANTES de escribir la neta, lee la tarjeta «Titular de la cotización» que está encima de «Pendiente de valoración» (quién pide, su documento y contacto, qué pide); no hace falta abrir «Ver / Imprimir». Después, en «Neta TOTAL del hotel (COP)» escribe 900000 y pulsa «Cargar neta y valorar». (Solo producto u operaciones pueden cargar la neta: venta ve «Esta solicitud espera la neta del hotel».)",
    esperado: "Antes de valorar, la tarjeta «Titular de la cotización» muestra: Nombre «Visitante Revision», Documento «77100001» (con «(tipo no registrado)» si el visitante no eligió tipo; nunca se supone «CC»), Teléfono «3115550000», Correo y Nacimiento «No registrado», «Origen: Solicitud de hotel bajo solicitud · visitante del tarifario público (sin sesión)» y las cantidades de la solicitud (Menores 0 · Niños 0 · Infantes 0); la cuenta de venta ve la misma tarjeta. La cotización deja de estar «pendiente de tarifa»: pasa a «abierta» con precio de venta (1.126.000) y aparecen los botones «Confirmar → generar contrato» y «Descartar». La cuenta de venta, antes de esto, solo ve «Pendiente de valoración» y no puede cargar la neta ni generar el contrato.",
    async verificar(c) {
      const [id, codigo] = c.sql(`select id || '|' || codigo from public.cotizaciones where cliente_documento = '${DOC_VISITANTE}' order by id desc limit 1`).split("|");
      // Antes de valorar, venta NO puede cargar la neta ni convertir (la solicitud no tiene precio).
      await comoOtro(c, "venta", `/dashboard/cotizaciones/${id}`, async (pg) => {
        const t = await pg.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
        c.check("venta ve «Pendiente de valoración» y no tiene formulario de neta ni botón de generar contrato", /Pendiente de valoración/.test(t) && (await pg.locator("#neta-hotel").count()) === 0 && (await pg.getByRole("button", { name: /Confirmar → generar contrato/ }).count()) === 0, t.slice(t.indexOf("Pendiente de valoración"), t.indexOf("Pendiente de valoración") + 160));
        const fv = await leerFicha(pg);
        c.check("venta ve la misma tarjeta del titular (nombre y teléfono) aunque no pueda cargar la neta", fv.nombre === "Visitante Revision" && fv.telefono === "3115550000", JSON.stringify(fv));
      });
      await c.ir(`/dashboard/cotizaciones/${id}`);
      // rev2: ANTES de cargar la neta se lee quién pide y qué pide, en la propia ficha (sin «Ver / Imprimir»).
      const fp = await leerFicha(c.page);
      c.check("la tarjeta del titular precede a la valoración: nombre, documento, teléfono y «No registrado» donde no hay dato", fp.nombre === "Visitante Revision" && /^(?:CC )?77100001/.test(fp.documento) && fp.telefono === "3115550000" && fp.email === "No registrado" && fp.nacimiento === "No registrado", JSON.stringify(fp));
      c.check("origen: solicitud de hotel de un visitante sin sesión; cantidades guardadas sin inventar", /^Origen: Solicitud de hotel bajo solicitud · visitante del tarifario público \(sin sesión\)$/.test(fp.origen) && /Menores: 0/.test(fp.composicion) && /Niños: 0 · Infantes: 0/.test(fp.composicion), `${fp.origen} | ${fp.composicion}`);
      c.check("el titular de la solicitud (aún sin precio) no ofrece generar contrato y la tarjeta está sobre «Pendiente de valoración»", (await c.page.getByTestId("desglose-pendiente").count()) === 1 && (await c.page.getByTestId("ficha-titular-cotizacion").boundingBox()).y < (await c.page.getByTestId("desglose-pendiente").boundingBox()).y);
      await c.page.locator("#neta-hotel").fill("900000");
      await c.page.getByRole("button", { name: /Cargar neta y valorar/ }).click();
      await esperarTexto(c.page, /Precio de venta/, 60000);
      const fila = c.sql(`select estado || '|' || coalesce(precio_venta::text, '') from public.cotizaciones where id = ${id}`);
      c.check("la cotización quedó «abierta» y con precio (no «pendiente_tarifa»)", /^abierta\|/.test(fila), fila);
      const t = await c.texto();
      c.check("la ficha ofrece «Confirmar → generar contrato» y muestra el precio 1.126.000", /Confirmar → generar contrato/.test(t) && /1\.126\.000/.test(t), t.slice(0, 200));
      c.check("todavía NO existe contrato de esa cotización", c.sql(`select count(*) from public.cotizaciones where id = ${id} and numero_contrato is not null`) === "0" && codigo.length > 0, "");
      // rev2: ya valorada, el titular sigue ARRIBA de las decisiones (generar contrato / descartar).
      const fa = await leerFicha(c.page);
      const yFicha = (await c.page.getByTestId("ficha-titular-cotizacion").boundingBox()).y;
      c.check("tras valorar, el titular sigue visible y encima de «Confirmar → generar contrato» y «Descartar»", fa.nombre === "Visitante Revision" && yFicha < (await boton(c.page, "Confirmar → generar contrato").boundingBox()).y && yFicha < (await boton(c.page, /Descartar/).boundingBox()).y);
    },
  },
  {
    id: "B2-12", entrega: "bloque2", rol: "venta", titulo: "Leído es por persona; convertir la cotización en contrato (REAL) y solo entonces «Atendida · convertida a contrato»", ruta: "/dashboard/cotizaciones",
    accion: "Con la cuenta de venta pulsa la campana, abre el aviso «Nueva cotización de un visitante del tarifario: COT-…» y revisa la ficha (ya valorada en el paso anterior): arriba está la tarjeta «Titular de la cotización» con el visitante, su documento y su teléfono, sin abrir «Ver / Imprimir». Pulsa «Confirmar → generar contrato»; en «Datos de los pasajeros (2)» pulsa «Editar» en el pasajero 1 y escribe su nacimiento 01/01/1985; en el pasajero 2 escribe Nombres «Acompañante», Apellidos «Revision», tipo CC, N° doc «77100002» y nacimiento 02/02/1986; deja «Rev Venta» como asesor y pulsa «Generar contrato». Cuando abra la ficha del contrato, vuelve a abrir la campana.",
    esperado: "El asesor de venta recibe el aviso y puede abrir la ficha (no ve «pendiente_tarifa» crudo sino «pendiente»), y antes de decidir lee quién es el titular en la tarjeta «Titular de la cotización» (Visitante Revision, 77100001, 3115550000). Una vez convertida, esa misma tarjeta sigue mostrando al titular con el estado «convertida» y el enlace «Ver contrato →». Al abrirlo, el aviso queda leído SOLO para él: los demás lo siguen viendo sin leer. Mientras la cotización no se convierte, la campana NO dice «Atendida». Al generar el contrato (acción real, no una instrucción de base) se crea UN contrato con el número DTM-…, la cotización queda «convertida» enlazada a él y entonces la campana muestra «Atendida · convertida a contrato» en ese aviso; leerlo o descartarlo nunca lo marca como atendido.",
    async verificar(c) {
      const [id, codigo] = c.sql(`select id || '|' || codigo from public.cotizaciones where cliente_documento = '${DOC_VISITANTE}' order by id desc limit 1`).split("|");
      await c.ir("/dashboard/cotizaciones"); await c.espera(2500);
      await campana(c.page).click(); await c.espera(900);
      const panel0 = (await panelCampana(c.page).locator("a", { hasText: codigo }).first().innerText()).replace(/\s+/g, " ");
      c.check("el asesor de venta recibe el aviso, aún sin «Atendida»", /Nueva cotización de un visitante del tarifario/.test(panel0) && !/Atendida/.test(panel0), panel0);
      await panelCampana(c.page).locator("a", { hasText: codigo }).first().click();
      await c.page.waitForURL(new RegExp(`/dashboard/cotizaciones/${id}$`), { timeout: 30000 });
      await esperarTexto(c.page, new RegExp(codigo));
      const ficha = await c.texto();
      c.check("la ficha abre con su código y el estado legible", ficha.includes(codigo) && !/pendiente_tarifa/.test(ficha), ficha.slice(0, 160));
      // rev2: el asesor ve al titular en la ficha ANTES de decidir; el resto del paso (lectura por persona y conversión real) no cambia.
      const fvta = await leerFicha(c.page);
      c.check("antes de pulsar «Confirmar → generar contrato» la ficha muestra al titular (nombre, documento y teléfono)", fvta.nombre === "Visitante Revision" && /^(?:CC )?77100001/.test(fvta.documento) && fvta.telefono === "3115550000", JSON.stringify(fvta));
      await c.espera(2500);
      const venta = c.sql("select id from public.usuarios where email = 'venta@consolidada.test'");
      c.check("leído solo para quien lo abrió", c.sql(`select count(*) from public.avisos where cotizacion_id = ${id} and usuario_id = '${venta}' and leido_en is not null`) === "1" && Number(c.sql(`select count(*) from public.avisos where cotizacion_id = ${id} and leido_en is null`)) >= 4);
      const contratos0 = c.sql("select count(*) from public.ventas");
      // Conversión REAL por la ficha (nada de base): pasajeros, asesor y «Generar contrato».
      const p = c.page;
      await boton(p, "Confirmar → generar contrato").click(); await c.espera(1500);
      await p.getByRole("button", { name: "Editar pasajero 1" }).click(); await c.espera(500);
      await fechaIn(p, "Nacimiento", "1985-01-01", 0);
      const ocho = (et, n) => p.locator(`xpath=(//label[normalize-space(.)="${et}"])[${n + 1}]/parent::*`).locator("input:not([type=hidden]), select").first();
      await ocho("Nombres", 1).fill("Acompañante"); await ocho("Apellidos", 1).fill("Revision");
      await ocho("Tipo doc", 1).selectOption("CC"); await ocho("N° doc", 1).fill("77100002");
      await fechaIn(p, "Nacimiento", "1986-02-02", 1);
      // «Confirmar → generar contrato» (abre el panel) y «Generar contrato» (lo ejecuta) coinciden por nombre: se pulsa el del panel de pasajeros, exacto.
      await p.getByTestId("captura-pasajeros").getByRole("button", { name: "Generar contrato", exact: true }).click();
      const llego = await p.waitForURL(/\/dashboard\/contratos\/(?!nuevo)[^/?]+$/, { timeout: 150000 }).then(() => true, () => false);
      const numero = llego ? decodeURIComponent(new URL(p.url()).pathname.split("/").pop()) : "";
      c.check("la acción real creó el contrato y abrió su ficha", llego && /^DTM-/.test(numero), p.url());
      c.check("hay UN contrato más y la cotización quedó convertida y enlazada a ese número", Number(c.sql("select count(*) from public.ventas")) === Number(contratos0) + 1 && c.sql(`select estado || '|' || coalesce(numero_contrato, '') from public.cotizaciones where id = ${id}`) === `convertida|${numero}`, c.sql(`select estado || '|' || coalesce(numero_contrato, '') from public.cotizaciones where id = ${id}`));
      // rev2: ya convertida, la ficha de trabajo conserva al titular y apunta al contrato (convertir no borra ni cambia al titular).
      await c.ir(`/dashboard/cotizaciones/${id}`);
      const fcon = await leerFicha(c.page);
      const tcon = await c.texto();
      c.check("convertida: la tarjeta sigue mostrando al titular, con el estado «convertida» y el contrato enlazado", fcon.nombre === "Visitante Revision" && /convertida/i.test(tcon) && tcon.includes(numero), JSON.stringify(fcon));
      await c.ir("/dashboard/cotizaciones"); await c.espera(2500);
      await campana(c.page).click(); await c.espera(900);
      const panel1 = (await panelCampana(c.page).locator("a", { hasText: codigo }).first().innerText()).replace(/\s+/g, " ");
      c.check("tras convertir, la campana muestra «Atendida · convertida a contrato»", /Atendida · convertida a contrato/.test(panel1), panel1);
    },
  },
];
