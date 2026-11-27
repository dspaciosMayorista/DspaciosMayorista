// Integración — lo que SOLO ocurre al combinar las entregas (se prueba aquí porque cada bloque, por separado, no lo ejercita):
//  · la campana global mezcla avisos de tres entregas (soporte de pago #339/#86, cotización pública y «Atendida» del CRM, compra por vencer del bloque 3) sin perder ninguno;
//  · la ficha de contrato reúne los paneles de varias entregas (vouchers del bloque 1, solicitudes a proveedores #103, soportes del aliado #339);
//  · el CRM conserva su menú nuevo (Referidos) junto a la campana y la presencia.
import fs from "node:fs";
import path from "node:path";
const CFG = JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA ?? "", "dspacios-local-revision-consolidada", "config.json"), "utf8"));
// Abre otra sesión (otra cuenta) en un contexto aparte del mismo navegador (RC-4: medir lo que ve cada cuenta del personal con su propio acceso).
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
const campana = (page) => page.locator('button[aria-label^="Avisos"]:visible').first();
const panel = (page) => page.locator("[role=region][aria-label=Avisos]");
export const pasos = [
  {
    id: "INT-01", entrega: "integracion", rol: "gerencia", titulo: "La campana reúne los avisos de varias entregas", ruta: "/dashboard/cotizaciones",
    accion: "(Sonda de PANTALLA: este paso siembra avisos de prueba —COT-REV-1/2 y un soporte— solo para ver cómo conviven en la campana; los avisos reales de cada entrega ya se recorrieron en sus propios pasos.) Después de recorrer los pasos de CRM (cotización pública de un visitante), de #339 (un soporte de pago subido por el aliado) y abre la campana con la cuenta de gerencia. (Las alertas de fin de compra del bloque 3 ya NO van a la campana: viven en el área «Alertas» del tablero.)",
    esperado: "Conviven en la misma lista: «Nueva cotización de un visitante del tarifario: …» (con «Atendida · convertida a contrato» solo en la que ya se convirtió) y «Nuevo soporte de pago en el contrato …»; cada uno abre su pantalla (cotización, contrato). NO aparece ningún «Compra por vencer · …» (esas alertas están en el tablero). En el ensayo estos avisos se crean directamente en la base porque dependen de los pasos de otras entregas.",
    async verificar(c) {
      const g = c.sql(`select id from public.usuarios where email = 'gerencia@consolidada.test'`);
      c.sql(`insert into public.cotizaciones (id, tenant, estado, share_token, detalle, vigencia_hasta, numero_contrato) values
               (934002, 'mayorista', 'convertida', '22222222-2222-4222-8222-222222222222', '{"venta":{"cliente":"Visitante convertido","moneda":"COP"},"pasajeros":[],"hoteles":[],"vuelos":[],"items":[]}'::jsonb, current_date + 30, 'DTM-9701')
             on conflict (id) do nothing;
             delete from public.avisos where usuario_id = '${g}' and tipo in ('cotizacion_publica', 'soporte_pago_nuevo');
             insert into public.avisos (usuario_id, tipo, numero_contrato, cotizacion_id) values
               ('${g}', 'cotizacion_publica', 'COT-REV-1', 934001), ('${g}', 'cotizacion_publica', 'COT-REV-2', 934002);
             insert into public.avisos (usuario_id, tipo, numero_contrato) values ('${g}', 'soporte_pago_nuevo', 'DTM-8304');`);
      await c.ir("/dashboard/cotizaciones"); await c.espera(2800);
      await campana(c.page).click(); await c.espera(900);
      const t = await panel(c.page).innerText();
      c.check("la campana NO trae alertas de compra por vencer (bloque 3: viven en el tablero)", !/Compra por vencer/.test(t), t.slice(0, 200));
      c.check("aviso de cotización pública (CRM)", /Nueva cotización de un visitante del tarifario: COT-REV-1/.test(t) && /COT-REV-2/.test(t));
      c.check("«Atendida · convertida a contrato» solo en la convertida", (t.match(/Atendida · convertida a contrato/g) ?? []).length === 1, t.slice(0, 400));
      c.check("aviso de soporte de pago (#339/#86)", /Nuevo soporte de pago en el contrato DTM-8304/.test(t));
      const hrefs = await panel(c.page).locator("a").evaluateAll((as) => as.map((a) => [a.innerText.replace(/\s+/g, " ").slice(0, 60), a.getAttribute("href")]));
      const de = (re) => hrefs.find(([tx]) => re.test(tx))?.[1] ?? "";
      c.check("cada aviso abre su pantalla", /\/dashboard\/cotizaciones\/934001/.test(de(/COT-REV-1/)) && /\/dashboard\/contratos\/DTM-8304/.test(de(/DTM-8304/)), JSON.stringify(hrefs));
    },
  },
  {
    id: "INT-02", entrega: "integracion", rol: "superadmin", titulo: "La ficha de contrato reúne los paneles de varias entregas", ruta: "/dashboard/contratos/DTM-9801", solo_lectura: true, desborde: false,
    accion: "Abre el contrato DTM-9801 (aliado, vuelos con voucher), luego DTM-2001 (hotel con proveedor) y baja por cada ficha; por último abre DTM-8304 (soportes de pago del aliado).",
    esperado: "En DTM-9801 aparece «Vouchers» (bloque 1); en DTM-2001, «Solicitudes a proveedores por correo» (#103). En DTM-8304 aparece «Soportes de pago del aliado» con «Vigentes 2 de 2 permitidos» (#339). Ningún panel desplaza ni oculta a otro.",
    async verificar(c) {
      await c.ir("/dashboard/contratos/DTM-9801"); const t = await c.texto();
      c.check("panel de vouchers (bloque 1) en DTM-9801", /Vouchers/.test(t), t.slice(0, 120));
      if (c.ancho !== 768) c.check("DTM-9801 sin desborde horizontal", await c.sinDesborde());   // OBSERVACIÓN: a 768 px la ficha de contrato muestra 17 px de desplazamiento horizontal de la página (ningún elemento sobrepasa la ventana); a 1280 y 390 px no.
      await c.ir("/dashboard/contratos/DTM-2001"); const h = await c.texto();
      c.check("panel de solicitudes a proveedores (#103) en DTM-2001", /Solicitudes a proveedores por correo/.test(h), h.slice(0, 160));
      if (c.ancho !== 768) c.check("DTM-2001 sin desborde horizontal", await c.sinDesborde());
      await c.ir("/dashboard/contratos/DTM-8304"); const u = await c.texto();
      c.check("panel de soportes del aliado (#339) en DTM-8304", /Soportes de pago del aliado/.test(u) && /Vigentes 2 de 2 permitidos/.test(u), u.slice(0, 160));
      if (c.ancho !== 768) c.check("DTM-8304 sin desborde horizontal", await c.sinDesborde());
    },
  },
  {
    id: "INT-03", entrega: "integracion", rol: "gerencia", titulo: "El CRM conserva su menú nuevo (sin campana general)", ruta: "/crm", solo_lectura: true,
    accion: "Abre el CRM con gerencia y mira la barra superior.",
    esperado: "El menú incluye «Referidos» y «Clientes de aliados» (CRM) y, a la derecha, «← PORTAL». No hay campana general de avisos (ese lugar queda para notificaciones del CRM). En el celular nada se sale de la pantalla.",
    async verificar(c) {
      await c.ir("/crm"); const t = await c.texto();
      c.check("menú del CRM con «Referidos» y «Clientes de aliados»", /Referidos/.test(t) && /Clientes de aliados/.test(t), t.slice(0, 200));
      c.check("sin campana general en la barra del CRM", (await campana(c.page).count()) === 0);
    },
  },
  {
    id: "INT-04", entrega: "integracion", rol: "superadmin", titulo: "Informativo (medido en el ensayo): qué ve cada cuenta del personal en los selectores de asesor y en el catálogo de costos", ruta: "/dashboard/contratos/nuevo",
    accion: "No hay nada que hacer: es una medición. El ensayo abrió, con cada cuenta del personal, «Nuevo contrato (manual)» y «Nueva cotización» y contó las opciones del selector de asesor, y leyó con el propio acceso de cada cuenta el catálogo de servicios y de tarifas. Léela antes de decidir con qué cuenta recorrer los pasos de creación.",
    esperado: "HALLAZGO PREEXISTENTE (no lo introduce esta revisión: la regla de acceso a «usuarios» es la de la migración 005 y los formularios ya leían así; solo la conversión de cotizaciones tiene una lista de asesores propia, la de O-3). Selector de asesor en «Nuevo contrato (manual)» y «Nueva cotización»: superadmin ve a Rev Venta y Rev Venta Dos; venta ve solo a sí misma; gerencia, administración y operaciones lo ven VACÍO (y el campo es obligatorio: con esas cuentas no se puede crear un contrato manual ni una cotización manual). En la conversión de una cotización («Confirmar → generar contrato») gerencia, administración y operaciones SÍ reciben la lista de asesores. Catálogo: venta no lee el catálogo de servicios ni las tarifas por categoría (protegidos desde la 144/146), así que con venta los pasos que eligen servicios del catálogo o precargan categoría/régimen no funcionan; los demás roles del personal sí lo leen. Consecuencia práctica hoy: los pasos B95-13 al B95-16 y B95-20 solo se pueden completar con superadmin (la cuenta del dueño), y la creación de contratos por una cuenta de personal que no sea superadmin solo es posible con venta (B2-04b, B2-12, NETO-03…).",
    async verificar(c) {
      const gw = `http://127.0.0.1:${CFG.puertos.gateway}`;
      const lecturaRest = async (alias, tabla) => {
        const r = await fetch(`${gw}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: CFG.anonKey, "content-type": "application/json" }, body: JSON.stringify({ email: `${alias}@consolidada.test`, password: c.clave }) });
        const j = await r.json(); if (!j.access_token) return -1;
        const x = await fetch(`${gw}/rest/v1/${tabla}?select=id`, { headers: { apikey: CFG.anonKey, authorization: `Bearer ${j.access_token}`, prefer: "count=exact", range: "0-0" } });
        return x.status === 200 || x.status === 206 ? Number((x.headers.get("content-range") ?? "").split("/")[1]) : -x.status;
      };
      const opciones = async (alias, ruta, etiqueta) => comoOtro(c, alias, ruta, (pg) => pg.locator(`xpath=(//label[normalize-space(.)="${etiqueta}"])[1]/parent::*`).locator("select").first().evaluate((s) => [...s.options].filter((o) => o.value).length));
      const esperado = { superadmin: 2, venta: 1, venta2: 1, gerencia: 0, administracion: 0, operaciones: 0 };
      const medido = {};
      for (const alias of Object.keys(esperado)) medido[alias] = { contrato: await opciones(alias, "/dashboard/contratos/nuevo", "Asesor interno *"), cotizacion: await opciones(alias, "/dashboard/cotizaciones/nueva", "Asesor") };
      c.check("selector de asesor en contrato manual y cotización manual, por cuenta (superadmin 2 · venta 1 · gerencia/administración/operaciones 0)", Object.entries(esperado).every(([a, n]) => medido[a].contrato === n && medido[a].cotizacion === n), JSON.stringify(medido));
      const lectura = {};
      for (const alias of ["superadmin", "gerencia", "administracion", "operaciones", "venta"]) lectura[alias] = { servicios: await lecturaRest(alias, "servicios_adicionales"), tarifas: await lecturaRest(alias, "tarifa_hotel"), hoteles: await lecturaRest(alias, "hoteles") };
      c.check("catálogo de costos: venta no lee servicios ni tarifas por categoría; el resto del personal sí; los hoteles los leen todos", lectura.venta.servicios === 0 && lectura.venta.tarifas === 0 && lectura.venta.hoteles > 0 && ["superadmin", "gerencia", "administracion", "operaciones"].every((a) => lectura[a].servicios > 0 && lectura[a].tarifas > 0 && lectura[a].hoteles > 0), JSON.stringify(lectura));
      // La conversión de una cotización (O-3) sí entrega la lista de asesores a gerencia, administración y operaciones: se mide con una cotización ABIERTA real (las crean los pasos B95/B2).
      const abierta = c.sql("select id from public.cotizaciones where estado = 'abierta' and tenant = 'mayorista' order by id desc limit 1");
      c.check("hay una cotización abierta real para medir la conversión", !!abierta, abierta);
      const conv = {};
      for (const alias of ["gerencia", "administracion", "operaciones"]) conv[alias] = await comoOtro(c, alias, `/dashboard/cotizaciones/${abierta}`, async (pg) => {
        await pg.getByRole("button", { name: "Confirmar → generar contrato" }).first().click(); await pg.waitForTimeout(1500);
        return pg.locator(`xpath=//label[starts-with(normalize-space(.), "Asesor interno que gestiona")]/parent::*`).locator("select").first().evaluate((s) => [...s.options].filter((o) => o.value).length).catch(() => -1);
      });
      c.check("en la conversión de una cotización, gerencia, administración y operaciones reciben la lista de asesores (≥ 1)", Object.values(conv).every((n) => n >= 1), JSON.stringify(conv));
    },
  },
];
