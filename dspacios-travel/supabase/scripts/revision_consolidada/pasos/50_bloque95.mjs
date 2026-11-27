// Bloque #95 · #61 · #41 · #42 · #51 · #33 — copia manual del catálogo, duplicar paquetes y vuelos, plan de cobro con pagos, asistencia opcional y comparativa con niño gratis.
// Datos: semillas/tras_perfiles/20_bloque95.sql (ids 80000–89999; contratos DTM-8101…8103 y DTM-8150). Lo que produce la aplicación (tarifario del paquete 80101, contrato con asistencia opcional,
// comparativas y sus contratos) NO se siembra: lo crea el dueño con la pantalla (B95-01, B95-02, B95-16…) y cada paso siguiente lo busca en la base por su marca («B95 …»).
// Los pasos corren en orden; los de escritura dejan el dato listo para el siguiente.

// ── utilidades ──────────────────────────────────────────────────────────────
const hoyMas = (c, n) => c.sql(`select (public.fecha_negocio() + ${n})::text`);
const n0 = (s) => Number(String(s ?? "").replace(/[^0-9.\-]/g, "")) || 0;
const aBogota = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
/** Campo de un formulario por el texto exacto de su <label> (n = coincidencia, desde 0): el primer input/select/textarea de su contenedor. */
const campo = (page, etiqueta, n = 0) => page.locator(`xpath=(//label[normalize-space(.)="${etiqueta}"])[${n + 1}]/parent::*`).locator("input:not([type=hidden]), select, textarea").first();
/** Campo de fecha (DateInput: texto dd/mm/aaaa con aria-label). */
const fecha = async (page, etiqueta, iso, n = 0) => { const el = page.getByLabel(etiqueta, { exact: true }).nth(n); await el.fill(aBogota(iso)); await el.press("Tab"); };
/** Espera a que el plan mostrado tenga n filas (el panel se refresca después de guardar). */
const esperaFilasPlan = async (c, n) => { await c.page.waitForFunction((k) => document.querySelectorAll('[data-testid="estado-cuota"]').length === k, n, { timeout: 40000 }).catch(() => {}); await c.espera(500); };
const boton = (page, nombre) => page.getByRole("button", { name: nombre }).first();
/** Destino del catálogo (lista con buscador): escribe el comienzo del nombre y hace clic en la opción (ya no se escribe a mano). */
const elegirDestino = async (page, nombre) => {
  const combo = page.locator('[data-testid="campo-destino"] input[role="combobox"]').first();
  await combo.click(); await combo.fill(nombre.slice(0, 6));
  await page.locator('[role="option"]', { hasText: nombre }).first().click();
};
/** Valores de las opciones de una lista <datalist> (los hoteles que realmente se ofrecen). */
const opcionesDe = (page, selector) => page.locator(`${selector} option`).evaluateAll((os) => os.map((o) => o.value));
const esperaUrl = (page, re, ms = 60000) => page.waitForURL(re, { timeout: ms }).then(() => true).catch(() => false);
const sinTildes = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");

// Huella de TODO lo que define un paquete armado (cabecera sin sello de hora + hijos + conteo del tarifario): sirve para probar que duplicar no toca el original.
const huellaPaquete = (c, id) => c.sql(`select md5(
    coalesce((select (to_jsonb(p) - 'updated_at')::text from public.armado_paquetes p where p.id = ${id}), '') ||
    coalesce((select string_agg(to_jsonb(x)::text, ',' order by to_jsonb(x)::text) from public.armado_hoteles x where x.paquete_id = ${id}), '') ||
    coalesce((select string_agg(to_jsonb(x)::text, ',' order by to_jsonb(x)::text) from public.armado_servicios x where x.paquete_id = ${id}), '') ||
    coalesce((select string_agg(to_jsonb(x)::text, ',' order by to_jsonb(x)::text) from public.armado_vuelos x where x.paquete_id = ${id}), '') ||
    coalesce((select string_agg(to_jsonb(x)::text, ',' order by to_jsonb(x)::text) from public.armado_empaquetados x where x.paquete_id = ${id}), '') ||
    coalesce((select string_agg((to_jsonb(x) - 'created_at')::text, ',' order by to_jsonb(x)::text) from public.salidas_dinamicas x where x.paquete_id = ${id}), '') ||
    (select count(*)::text from public.tarifario_resultado t where t.paquete_id = ${id}))`);
const hijosPaquete = (c, id) => c.sql(`select (select count(*) from public.armado_hoteles where paquete_id = ${id}) || '/' || (select count(*) from public.armado_servicios where paquete_id = ${id}) || '/' ||
    (select count(*) from public.armado_vuelos where paquete_id = ${id}) || '/' || (select count(*) from public.armado_empaquetados where paquete_id = ${id}) || '/' || (select count(*) from public.salidas_dinamicas where paquete_id = ${id})`);

// Contrato que el dueño crea en B95-02 (cliente «Cliente B95 Reserva», paquete 80101).
const contratoReserva = (c) => c.sql(`select numero_contrato from public.ventas where paquete_armado_id = 80101 and cliente ilike '%B95 Reserva%' order by created_at desc limit 1`);
const resumenVenta = (c, n) => c.sql(`select coalesce(precio_venta,0)::bigint || '|' || coalesce(costo_receptivo,0)::bigint || '|' || coalesce(costo_asistencia,0)::bigint || '|' || coalesce(asistencia_medica::text,'-') || '|' || coalesce(estado,'-') from public.ventas where numero_contrato = '${n}'`);
// Obligaciones de servicios del contrato (previstas aún sin materializar + cuentas por pagar reales): «servicio_id:tipo:valor».
const obligaciones = (c, n) => c.sql(`select coalesce(string_agg(servicio_id || ':' || tipo || ':' || v::bigint, ',' order by servicio_id, tipo), '-') from (
    select servicio_id, tipo_proveedor tipo, valor_total v from public.cuentas_por_pagar where numero_contrato = '${n}' and servicio_id is not null
    union all
    select (payload->>'servicio_id')::bigint, payload->>'tipo_proveedor', (payload->>'valor_total')::numeric from public.contrato_obligaciones_previstas where numero_contrato = '${n}' and clase = 'cxp' and materializada_en is null) o`);
const lineasServicio = (c, n) => c.sql(`select coalesce(string_agg(descripcion, ' ; ' order by orden, id), '-') from public.contrato_items where numero_contrato = '${n}' and descripcion like 'Servicio · %'`);
const cuotas = (c, n) => c.sql(`select coalesce(string_agg(tipo || ':' || monto::text, ' ; ' order by orden), '-') from public.cuotas where numero_contrato = '${n}'`);
const filasCuotas = (c, n) => c.sql(`select tipo, monto::text, fecha_limite::text from public.cuotas where numero_contrato = '${n}' order by orden`).split("\n").filter(Boolean).map((l) => l.split("|"));
const suma = (xs) => Math.round(xs.reduce((s, x) => s + Number(x), 0) * 100) / 100;

// ── recorridos reutilizables (los usan varios pasos) ───────────────────────
/** Formulario «Nueva cotización» comparativa con dos hoteles (A: niño gratis, B: niño con tarifa) y un traslado común. Devuelve el id de la madre. */
async function crearComparativa(c, cfg) {
  const { apellido, moneda, adultos, hotelA, hotelB, comun, tarifaA, tarifaB, incluyeA, incluyeB, noIncluyeA, noIncluyeB } = cfg;
  const p = c.page;
  await c.ir("/dashboard/cotizaciones/nueva");
  await campo(p, "Tipo de documento").selectOption("CC");
  await campo(p, "Número de documento").fill(cfg.documento);
  await campo(p, "Nombres").fill("Cliente");
  await campo(p, "Apellidos").fill(apellido);
  await fecha(p, "Fecha de nacimiento", "1985-05-05");
  await campo(p, "Teléfono").fill("3000000000");
  await elegirDestino(p, "CARTAGENA B95");
  await fecha(p, "Fecha ida", hoyMas(c, 70));
  await fecha(p, "Fecha regreso", hoyMas(c, 73));
  await campo(p, "Adultos").fill(String(adultos));
  await campo(p, "Niños").fill("1");
  await campo(p, "Moneda").selectOption(moneda);
  await p.getByRole("button", { name: "interno", exact: true }).click().catch(() => {});
  await campo(p, "Asesor").selectOption({ index: 1 });
  await boton(p, /Cotización comparativa/).click();
  await p.locator("label", { hasText: "Markup general" }).locator("input").fill("0");           // markup 0: el valor de cada servicio = su costo (totales exactos)
  await p.getByRole("button", { name: "Hotel", exact: true }).click();
  await p.getByRole("button", { name: "Hotel", exact: true }).click();
  await p.getByRole("button", { name: "Traslado", exact: true }).click();
  const filas = p.locator("section:has(h2:text-is('Servicios')) div.rounded-lg.border.border-gray-200.p-3");
  // REV2 (F6): cada hotel declara cómo se compra (directa: el proveedor del catálogo) y sus habitaciones por tipo (la Doble aloja 2 adultos; la Triple, 3), que deben cuadrar con los adultos y niños del viaje.
  const rellenar = async (i, nombre, costo, opcion, habitacion) => {
    const f = filas.nth(i);
    if (opcion) await f.locator('select[aria-label="Opción de la comparativa"]').selectOption(opcion);
    await f.locator("xpath=.//label[normalize-space(.)='Nombre del servicio']/parent::*//input").fill(nombre);
    if (habitacion) {
      await f.locator('select[aria-label="Origen de la compra"]').selectOption("directa");
      await f.getByLabel(`Habitaciones ${habitacion}`, { exact: true }).fill("1");
    }
    await f.locator("xpath=.//label[normalize-space(.)='Costo neto']/parent::*//input").fill(String(costo));
  };
  await rellenar(0, hotelA.nombre, hotelA.costo, "A", cfg.habitacion ?? "Doble");
  await rellenar(1, hotelB.nombre, hotelB.costo, "B", cfg.habitacion ?? "Doble");
  await rellenar(2, comun.nombre, comun.costo, null);
  await p.getByLabel("Tarifa por niño de la Opción A", { exact: true }).fill(String(tarifaA));
  await p.getByLabel("Tarifa por niño de la Opción B", { exact: true }).fill(String(tarifaB));
  await c.espera(400);
  await p.locator('textarea[id^="inc-A"]').fill(incluyeA); await p.locator('textarea[id^="no-A"]').fill(noIncluyeA);
  await p.locator('textarea[id^="inc-B"]').fill(incluyeB); await p.locator('textarea[id^="no-B"]').fill(noIncluyeB);
  await boton(p, "Generar comparativa").click();
  await esperaUrl(p, /\/dashboard\/cotizaciones\/\d+$/);
  const id = (p.url().match(/cotizaciones\/(\d+)/) ?? [])[1];
  return id ? Number(id) : null;
}
/** Pagos previos de una cotización manual: un primer pago congela las condiciones y fija el mínimo exigido; luego se completa hasta ese mínimo (sin él «Generar contrato →» se niega). */
async function pagarMinimoPrevio(c, cot, primero, trm) {
  const pagar = async (v) => {
    await c.ir(`/dashboard/cotizaciones/${cot}`); await c.espera(800);
    const f = c.page.locator("form", { has: c.page.getByRole("button", { name: "Registrar pago previo" }) });
    await f.locator("input[type=number]").first().fill(String(v));
    if (trm) { const t = f.locator("label", { hasText: "TRM" }).locator("input"); if (await t.count()) await t.first().fill(String(trm)); }
    await f.getByRole("button", { name: "Registrar pago previo" }).click(); await c.espera(4500);
  };
  const pagadoCop = () => n0(c.sql(`select coalesce(sum(monto_cop), 0) from public.cotizacion_pagos_previos where cotizacion_id = ${cot} and estado = 'activo'`));
  await pagar(primero);
  const exigidoCop = n0(c.sql(`select coalesce(monto_exigido_total_cop, monto_exigido_total) from public.cotizaciones where id = ${cot}`));
  const faltaCop = exigidoCop - pagadoCop();
  if (faltaCop > 0) await pagar(trm ? Math.ceil((faltaCop / trm) * 100) / 100 : Math.ceil(faltaCop));
  return { exigidoCop, pagadoCop: pagadoCop() };
}
/** Elige la opción B en la comparativa (madre) y devuelve el id de la cotización hija. */
async function elegirOpcion(c, madre, opcion) {
  await c.ir(`/dashboard/cotizaciones/${madre}`); await c.espera(1500);
  await c.page.locator("article", { hasText: `Opción ${opcion}` }).first().getByRole("button", { name: /Elegir esta opción/ }).click();
  await c.espera(4000);
  return c.sql(`select id from public.cotizaciones where cotizacion_origen_id = ${madre} order by id desc limit 1`);
}
/** Desde la cotización hija: «Generar contrato →». Devuelve el número de contrato. */
async function generarContratoDeCotizacion(c, hija) {
  await c.ir(`/dashboard/cotizaciones/${hija}`); await c.espera(1200);
  await boton(c.page, /Generar contrato/).click();
  await esperaUrl(c.page, /\/dashboard\/contratos\/(?!nuevo)[^/?]+$/);
  return decodeURIComponent((c.page.url().match(/contratos\/([^/?]+)/) ?? [])[1] ?? "");
}
const totalItems = (c, n) => c.sql(`select coalesce(sum(adultos * tarifa_adulto + ninos * tarifa_nino), 0)::text from public.contrato_items where numero_contrato = '${n}'`);

const COMPARATIVA_COP = { apellido: "B95 Comparativa", documento: "1012340001", moneda: "COP", adultos: 2,
  hotelA: { nombre: "Hotel Niño Gratis B95", costo: 830455 }, hotelB: { nombre: "Hotel Mar B95", costo: 930455 }, comun: { nombre: "Traslado aeropuerto B95 — tour_traslado (#80303)", costo: 500000 },
  tarifaA: 0, tarifaB: 150000,
  incluyeA: "Desayuno buffet A\nPiscina A", noIncluyeA: "Propinas A", incluyeB: "Media pensión B\nSpa B", noIncluyeB: "Bebidas B" };
const COMPARATIVA_USD = { apellido: "B95 Dolares", documento: "1012340002", moneda: "USD", adultos: 3, habitacion: "Triple",
  hotelA: { nombre: "Hotel Niño Gratis B95", costo: 831 }, hotelB: { nombre: "Hotel Mar B95", costo: 932 }, comun: { nombre: "Traslado aeropuerto B95 — tour_traslado (#80303)", costo: 500 },
  tarifaA: 0, tarifaB: 150.55,
  incluyeA: "Desayuno buffet A", noIncluyeA: "Propinas A", incluyeB: "Media pensión B", noIncluyeB: "Bebidas B" };

export const pasos = [
  // ═════════════════════════ #51 · asistencia opcional en el contrato ═════════════════════════
  {
    id: "B95-01", entrega: "bloque95", rol: "operaciones", titulo: "Generar el tarifario del paquete «B95 Porción terrestre — Hotel Mar»", ruta: "/dashboard/paquetes/80101",
    accion: "1) Abre el paquete «B95 Porción terrestre — Hotel Mar» (3 noches, hotel «Hotel Mar B95», tour de ciudad INCLUIDO y asistencia médica OPCIONAL). 2) Entra a la pestaña «Tarifario resultado». 3) Pulsa «Generar tarifario» y espera a que termine.",
    esperado: "El estado del tarifario pasa a «Publicado» con un número de tarifas mayor que cero (habitación doble, sencilla, triple, niño e infante del hotel, y el servicio opcional de asistencia). Este paso crea el tarifario con la propia pantalla: no se sembró ningún dato derivado.",
    async verificar(c) {
      await c.ir("/dashboard/paquetes/80101");
      await c.page.getByRole("tab", { name: "Tarifario resultado" }).click(); await c.espera(1500);
      await c.page.locator('[data-testid="generar-tarifario"]').click();
      await c.page.waitForSelector('[data-testid="estado-tarifario"][data-estado="publicado"]', { timeout: 120000 }).catch(() => {});
      await c.espera(1500);
      c.check("el estado del tarifario es «Publicado»", await c.page.locator('[data-testid="estado-tarifario"][data-estado="publicado"]').count() > 0, await c.page.locator('[data-testid="estado-tarifario"]').innerText().catch(() => "sin estado"));
      c.check("la base lo marca listo", c.sql(`select tarifario_estado from public.armado_paquetes where id = 80101`) === "listo", c.sql(`select tarifario_estado || ' ' || coalesce(tarifario_error, '') from public.armado_paquetes where id = 80101`));
      c.check("hay tarifas de habitación publicadas (doble, sencilla, triple, niño, infante)", n0(c.sql(`select count(*) from public.tarifario_resultado where paquete_id = 80101 and modulo = 'porcion_terrestre'`)) >= 5);
      c.check("el servicio opcional (asistencia) quedó publicado y el tour incluido no es opcional", n0(c.sql(`select count(*) from public.tarifario_resultado where paquete_id = 80101 and modulo = 'servicios' and servicio_id = 80302`)) > 0);
      const doble = n0(c.sql(`select min(precio_pvp) from public.tarifario_resultado where paquete_id = 80101 and modulo = 'porcion_terrestre' and acomodacion = 'doble'`));
      c.check("la tarifa doble por persona = (3 noches × 100.000 + tour incluido 40.000) / (1 − 20 %) = 425.000", doble === 425000, String(doble));
    },
  },
  {
    id: "B95-02", entrega: "bloque95", rol: "superadmin", titulo: "Reservar el paquete con la asistencia opcional", ruta: "/dashboard/reservar/nuevo?paquete=80101&hotel=80201&modulo=porcion_terrestre",
    accion: "1) Fecha de ida: 90 días después de hoy; fecha de regreso: 3 noches después; pulsa «Ver tarifas para estas fechas». 2) Habitaciones: 1 Doble. 3) En «Servicios adicionales» marca «Asistencia médica B95». 4) Cliente: nombres «Cliente», apellidos «B95 Reserva», documento 1012340100 (CC). 5) Asesor interno: el primero de la lista. 6) Pasajeros: dos adultos con nombre, documento y fecha de nacimiento. 7) Pulsa «Generar cotización» y, en la cotización, «Confirmar → generar contrato».",
    esperado: "Se crea un contrato PENDIENTE del paquete con 2 pasajeros. En su documento («Contrato» del cliente), «Asistencia médica B95» aparece descrita en «Servicios incluidos» SIN precio propio: su importe va dentro de la tarifa por adulto y las filas suman el total. El tour INCLUIDO queda como obligación con su proveedor (40.000 × 2 pax = 80.000 en costo de receptivos) y la asistencia elegida como obligación aparte (30.000 × 2 = 60.000 en costo de asistencia); el contrato marca asistencia médica «Sí».",
    async verificar(c) {
      const p = c.page; const ida = hoyMas(c, 90), reg = hoyMas(c, 93);
      await c.ir("/dashboard/reservar/nuevo?paquete=80101&hotel=80201&modulo=porcion_terrestre");
      c.check("la pantalla de reservar abre con el paquete generado", (await c.texto()).includes("Fechas del viaje"), (await c.texto()).slice(0, 200));
      await fecha(p, "Fecha de ida", ida); await fecha(p, "Fecha de regreso", reg);
      await boton(p, "Ver tarifas para estas fechas").click(); await c.espera(5000);
      await p.locator("xpath=//label[starts-with(normalize-space(.),'Doble')]/parent::*//input").first().fill("1");
      await p.locator("li", { hasText: "Asistencia médica B95" }).locator("input[type=checkbox]").check();
      await campo(p, "Número de documento").fill("1012340100");
      await campo(p, "Tipo de documento").selectOption("CC");
      await campo(p, "Nombres *", 0).fill("Cliente"); await campo(p, "Apellidos *", 0).fill("B95 Reserva");
      await campo(p, "Asesor interno *").selectOption({ index: 1 });
      for (const [i, nom, doc, nac] of [[1, "Ana", "1012340101", "1988-03-03"], [2, "Luis", "1012340102", "1986-07-07"]]) {
        await campo(p, "Nombres *", i).fill(nom); await campo(p, "Apellidos *", i).fill("B95 Pasajero");
        await campo(p, "Número doc", i - 1).fill(doc);
        await fecha(p, "Fecha nacimiento", nac, i - 1);
      }
      await boton(p, "Generar cotización").click();
      await esperaUrl(p, /\/dashboard\/cotizaciones\/\d+$/);
      c.check("se creó la cotización", /\/dashboard\/cotizaciones\/\d+$/.test(p.url()), p.url() + " · " + (await c.texto()).slice(0, 200));
      await boton(p, /Confirmar → generar contrato/).click();
      await esperaUrl(p, /\/dashboard\/contratos\/(?!nuevo)[^/?]+$/);
      const n = contratoReserva(c);
      c.check("se creó el contrato del cliente «B95 Reserva»", !!n, p.url());
      const [precio, rec, asis, flag, estado] = resumenVenta(c, n).split("|");
      c.check("el contrato queda pendiente", estado === "pendiente", estado);
      c.check("costo de receptivos = tour incluido 40.000 × 2 pax", n0(rec) === 80000, rec);
      c.check("costo de asistencia = asistencia elegida 30.000 × 2 pax", n0(asis) === 60000, asis);
      c.check("la bandera de asistencia médica está activa", flag === "true", flag);
      const ob = obligaciones(c, n);
      c.check("hay una obligación por el tour incluido (80301) y otra por la asistencia (80302)", /80301:[a-z_]+:80000/.test(ob) && /80302:asistencia:60000/.test(ob), ob);
      c.check("la línea «Servicio · Asistencia médica B95» está en el contrato y el tour incluido NO es una línea opcional", /Asistencia médica B95/.test(lineasServicio(c, n)) && !/Tour de ciudad/.test(lineasServicio(c, n)), lineasServicio(c, n));
      c.check("el precio del contrato es mayor que cero", n0(precio) > 0, precio);
      // REV2 (B95-02): el documento del cliente describe la asistencia SIN su propio precio; su importe va dentro de la tarifa de los adultos y las filas suman el total.
      await c.ir(`/contrato/${n}`);
      const d = (await c.texto()).replace(/\$\s+/g, "$");
      const iServ = d.indexOf("Servicios incluidos");
      const iFin = d.indexOf("Condiciones de pago", iServ);
      const bloque = iServ >= 0 ? d.slice(iServ, iFin > iServ ? iFin : iServ + 400) : "";   // solo el bloque «Servicios incluidos», hasta la sección siguiente
      c.check("el documento describe «Asistencia médica B95» en «Servicios incluidos»", iServ >= 0 && /Asistencia m[eé]dica B95/.test(bloque), d.slice(0, 300));
      c.check("el servicio NO muestra un precio propio (sin importes en su bloque)", !/\$\s?\d/.test(bloque.split("CONTRATO DE PRESTACI")[0]), bloque);
      c.check("no existe la antigua tabla «Servicios adicionales» con «Valor total» por servicio", !/Servicios adicionales\s+Servicio\s+Pax\s+Valor total/.test(d), "");
      c.check("el total impreso es el precio del contrato", d.replace(/[.\s]/g, "").toLowerCase().includes(`totaldelcontrato$${n0(precio)}`), d.slice(d.indexOf("Valores y Pagos"), d.indexOf("Valores y Pagos") + 200));
    },
  },
  {
    id: "B95-03", entrega: "bloque95", rol: "operaciones", titulo: "Quitar la asistencia opcional: el documento y las finanzas la siguen", ruta: "/dashboard/contratos",
    accion: "1) En Contratos abre el contrato del cliente «Cliente B95 Reserva» (estado pendiente). 2) En «Servicios adicionales (contrato pendiente)» desmarca «Asistencia médica B95» y pulsa «Guardar servicios». 3) Abre el documento del contrato («/contrato/…») y mira «Asistencia Médica».",
    esperado: "Mensaje «Servicios actualizados». El precio baja exactamente el valor de la asistencia; el costo de asistencia queda en 0 y la asistencia médica en «No» en el contrato y en su documento. El tour INCLUIDO sigue intacto: mismo costo de receptivos (80.000) y su obligación con el proveedor sin cambios; la obligación de la asistencia desaparece.",
    async verificar(c) {
      const n = contratoReserva(c);
      c.check("existe el contrato de B95-02", !!n, "ejecuta antes B95-02");
      const antes = resumenVenta(c, n).split("|"), obAntes = obligaciones(c, n);
      await c.ir(`/dashboard/contratos/${n}`);
      const caja = c.page.locator("li", { hasText: "Asistencia médica B95" }).locator("input[type=checkbox]");
      c.check("la asistencia aparece marcada al abrir", await caja.isChecked(), "");
      await caja.uncheck();
      await boton(c.page, "Guardar servicios").click();
      await c.page.getByText("Servicios actualizados").first().waitFor({ timeout: 40000 }).catch(() => {});
      const [precio, rec, asis, flag] = resumenVenta(c, n).split("|"), ob = obligaciones(c, n);
      c.check("mensaje «Servicios actualizados»", (await c.texto()).includes("Servicios actualizados"), (await c.texto()).slice(0, 200));
      c.check("el precio baja exactamente lo que valía la asistencia (> 0)", n0(antes[0]) - n0(precio) > 0, `${antes[0]} → ${precio}`);
      c.check("costo de asistencia = 0", n0(asis) === 0, asis);
      c.check("el costo del tour incluido se conserva (80.000)", n0(rec) === 80000 && n0(rec) === n0(antes[1]), rec);
      c.check("la bandera de asistencia pasa a «No»", flag === "false", flag);
      c.check("la obligación del tour incluido queda igual y la de la asistencia desaparece", /80301:[a-z_]+:80000/.test(ob) && !/80302/.test(ob), `${obAntes} → ${ob}`);
      c.check("la línea de la asistencia ya no está en el contrato", !/Asistencia médica B95/.test(lineasServicio(c, n)), lineasServicio(c, n));
      await c.ir(`/contrato/${n}`);
      const t = await c.texto();
      c.check("el documento dice «Asistencia Médica No»", /asistencia m[eé]dica\s*no\b/i.test(t), t.slice(0, 300));
    },
  },
  {
    id: "B95-04", entrega: "bloque95", rol: "operaciones", titulo: "Volver a agregar la asistencia y quitarla otra vez", ruta: "/dashboard/contratos",
    accion: "1) En el mismo contrato, marca de nuevo «Asistencia médica B95» y «Guardar servicios»; abre el documento. 2) Desmárcala otra vez y vuelve a guardar.",
    esperado: "Al agregarla: precio, costo de asistencia 60.000, asistencia «Sí» en el documento y su obligación de vuelta (sin duplicarse). Al quitarla: todo regresa al estado de B95-03. En ambos casos el costo y la obligación del tour incluido siguen exactamente iguales.",
    async verificar(c) {
      const n = contratoReserva(c);
      const base = resumenVenta(c, n).split("|");
      await c.ir(`/dashboard/contratos/${n}`);
      const caja = () => c.page.locator("li", { hasText: "Asistencia médica B95" }).locator("input[type=checkbox]");
      await caja().check(); await boton(c.page, "Guardar servicios").click();
      await c.page.getByText("Servicios actualizados").first().waitFor({ timeout: 40000 }).catch(() => {});
      let [precio, rec, asis, flag] = resumenVenta(c, n).split("|"); let ob = obligaciones(c, n);
      c.check("al agregarla el costo de asistencia vuelve a 60.000", n0(asis) === 60000, asis);
      c.check("el precio sube respecto al contrato sin asistencia", n0(precio) > n0(base[0]), `${base[0]} → ${precio}`);
      c.check("la asistencia vuelve a «Sí»", flag === "true", flag);
      c.check("una sola obligación por asistencia (no duplicada) y el tour incluido intacto", (ob.match(/80302/g) ?? []).length === 1 && /80301:[a-z_]+:80000/.test(ob) && n0(rec) === 80000, ob);
      c.check("la suma de las obligaciones coincide con las columnas de costo (80.000 + 60.000)", suma(ob.split(",").map((x) => x.split(":")[2])) === n0(rec) + n0(asis), `${ob} vs ${rec}+${asis}`);
      await c.ir(`/contrato/${n}`);
      c.check("el documento dice «Asistencia Médica Sí»", /asistencia m[eé]dica\s*s[ií](?![a-z])/i.test(await c.texto()), (await c.texto()).slice(0, 300));
      await c.ir(`/dashboard/contratos/${n}`);
      await caja().uncheck(); await boton(c.page, "Guardar servicios").click();
      await c.page.getByText("Servicios actualizados").first().waitFor({ timeout: 40000 }).catch(() => {});
      [precio, rec, asis, flag] = resumenVenta(c, n).split("|"); ob = obligaciones(c, n);
      c.check("al quitarla otra vez regresa al estado sin asistencia (precio, costo y bandera)", n0(precio) === n0(base[0]) && n0(asis) === 0 && flag === "false", `${precio} · ${asis} · ${flag}`);
      c.check("el tour incluido sigue con su costo y su obligación", n0(rec) === 80000 && /80301:[a-z_]+:80000/.test(ob) && !/80302/.test(ob), ob);
    },
  },

  // ═════════════════════════ #42 · plan de cobro que descuenta lo pagado ═════════════════════════
  {
    id: "B95-05", entrega: "bloque95", rol: "administracion", titulo: "Regenerar el plan de cobro con un pago parcial", ruta: "/dashboard/contratos/DTM-8101?tab=cartera",
    accion: "Contrato DTM-8101 (precio 1.000.000, pagado 400.000, con un plan VIEJO de 2 filas calculado antes del pago). 1) En Cartera pulsa «Regenerar plan». 2) Pulsa «Regenerar plan» dos veces más. 3) Registra un abono de 100.000 (Transferencia) y vuelve a regenerar.",
    esperado: "Tras regenerar: «Abono inicial 400.000» (lo ya pagado, estado «Cubierta») y tres cuotas mensuales de 200.000 «Pendiente»; solo queda por cobrar el saldo (600.000). Regenerar de nuevo no acumula planes: siempre 4 filas, que suman 1.000.000. Tras el abono de 100.000 el plan pasa a 500.000 + 3 cuotas (166.666, 166.666, 166.668) = 1.000.000.",
    async verificar(c) {
      await c.ir("/dashboard/contratos/DTM-8101?tab=cartera");
      c.check("al abrir el plan viejo tiene 2 filas", cuotas(c, "DTM-8101").split(";").length === 2, cuotas(c, "DTM-8101"));
      await boton(c.page, "Regenerar plan").click();
      await c.page.getByText(/Plan de \d+ pago/).first().waitFor({ timeout: 40000 }).catch(() => {});
      let f = filasCuotas(c, "DTM-8101");
      c.check("el plan nuevo tiene 4 filas: abono inicial 400.000 + 3 cuotas de 200.000", f.length === 4 && f[0][0] === "abono" && n0(f[0][1]) === 400000 && f.slice(1).every((x) => x[0] === "cuota" && n0(x[1]) === 200000), JSON.stringify(f));
      c.check("las filas suman el precio (1.000.000)", suma(f.map((x) => x[1])) === 1000000, "");
      const t = await c.texto();
      c.check("el aviso dice lo ya aplicado y el saldo por cobrar (600.000)", /Ya aplicado:\s*\$\s*400\.000/.test(t) && /Saldo por cobrar:\s*\$\s*600\.000/.test(t), t.slice(0, 400));
      await esperaFilasPlan(c, 4);
      const estados = await c.page.locator('[data-testid="estado-cuota"]').allInnerTexts();
      c.check("estados: Cubierta, Pendiente, Pendiente, Pendiente", estados.join("|") === "Cubierta|Pendiente|Pendiente|Pendiente", estados.join("|"));
      for (let i = 0; i < 2; i++) { await boton(c.page, "Regenerar plan").click(); await c.espera(3500); }
      f = filasCuotas(c, "DTM-8101");
      c.check("regenerar varias veces no acumula planes (siguen 4 filas, suman 1.000.000)", f.length === 4 && suma(f.map((x) => x[1])) === 1000000, JSON.stringify(f));
      c.check("los abonos no se tocaron (siguen 400.000)", n0(c.sql(`select sum(valor_abono) from public.abonos where numero_contrato = 'DTM-8101'`)) === 400000, "");
      await campo(c.page, "Valor del abono").fill("100000");
      await campo(c.page, "Forma de pago").selectOption("Transferencia");
      await boton(c.page, "Registrar abono").click(); await c.espera(4000);
      c.check("el abono de 100.000 quedó registrado", n0(c.sql(`select sum(valor_abono) from public.abonos where numero_contrato = 'DTM-8101'`)) === 500000, "");
      await boton(c.page, "Regenerar plan").click();
      await c.page.getByText(/Plan de \d+ pago/).first().waitFor({ timeout: 40000 }).catch(() => {});
      f = filasCuotas(c, "DTM-8101");
      c.check("con 500.000 pagados: abono inicial 500.000 y cuotas 166.666, 166.666, 166.668", f.length === 4 && n0(f[0][1]) === 500000 && n0(f[1][1]) === 166666 && n0(f[2][1]) === 166666 && n0(f[3][1]) === 166668, JSON.stringify(f));
      c.check("lo pendiente por cobrar es solo el saldo (500.000 en cuotas)", suma(f.slice(1).map((x) => x[1])) === 500000, "");
    },
  },
  {
    id: "B95-06", entrega: "bloque95", rol: "administracion", titulo: "Contrato pagado por completo: no queda nada por cobrar", ruta: "/dashboard/contratos/DTM-8102?tab=cartera",
    accion: "Contrato DTM-8102 (precio 1.000.000, pagado 1.000.000, sin plan). En Cartera pulsa «Generar plan de cobro».",
    esperado: "Mensaje «Contrato pagado por completo: no hay saldo por cobrar.»; el plan tiene una sola fila de 1.000.000 en estado «Cubierta» (no se vuelve a pedir lo que ya se pagó) y el saldo del contrato es 0.",
    async verificar(c) {
      await c.ir("/dashboard/contratos/DTM-8102?tab=cartera");
      await boton(c.page, "Generar plan de cobro").click();
      await c.page.getByText(/pagado por completo/).first().waitFor({ timeout: 40000 }).catch(() => {});
      const t = await c.texto();
      c.check("mensaje de contrato pagado por completo", /Contrato pagado por completo: no hay saldo por cobrar/.test(t), t.slice(0, 300));
      const f = filasCuotas(c, "DTM-8102");
      c.check("una sola fila de 1.000.000", f.length === 1 && n0(f[0][1]) === 1000000, JSON.stringify(f));
      await esperaFilasPlan(c, 1);
      const estados = await c.page.locator('[data-testid="estado-cuota"]').allInnerTexts();
      c.check("estado «Cubierta»", estados.join("|") === "Cubierta", estados.join("|"));
      c.check("el saldo es 0", n0(c.sql(`select v.precio_venta - coalesce((select sum(valor_abono) from public.abonos a where a.numero_contrato = v.numero_contrato), 0) from public.ventas v where v.numero_contrato = 'DTM-8102'`)) === 0, "");
    },
  },
  {
    id: "B95-07", entrega: "bloque95", rol: "administracion", titulo: "Plan de cobro en dólares con centavos", ruta: "/dashboard/contratos/DTM-8103?tab=cartera",
    accion: "Contrato DTM-8103 (precio USD 100,50; pagado USD 40,00). En Cartera pulsa «Generar plan de cobro».",
    esperado: "Plan en dólares con sus centavos: abono inicial USD 40,00 (lo ya pagado, «Cubierta») y tres cuotas de USD 20,16, USD 20,16 y USD 20,18 (suman 100,50). El saldo por cobrar mostrado es USD 60,50 (sin redondear a dólares enteros).",
    async verificar(c) {
      await c.ir("/dashboard/contratos/DTM-8103?tab=cartera");
      await boton(c.page, "Generar plan de cobro").click();
      await c.page.getByText(/Plan de \d+ pago/).first().waitFor({ timeout: 40000 }).catch(() => {});
      const f = filasCuotas(c, "DTM-8103");
      c.check("filas 40,00 · 20,16 · 20,16 · 20,18", f.map((x) => Number(x[1]).toFixed(2)).join(" ") === "40.00 20.16 20.16 20.18", JSON.stringify(f));
      c.check("suman 100,50", suma(f.map((x) => x[1])) === 100.5, "");
      const t = await c.texto();
      c.check("el aviso muestra el saldo USD 60,50 con centavos", /Saldo por cobrar:\s*USD\s*\$?\s*60[.,]50/.test(t), t.slice(0, 400));
      await esperaFilasPlan(c, 4);
      const estados = await c.page.locator('[data-testid="estado-cuota"]').allInnerTexts();
      c.check("primera fila «Cubierta», las demás «Pendiente»", estados.join("|") === "Cubierta|Pendiente|Pendiente|Pendiente", estados.join("|"));
    },
  },
  {
    id: "B95-08", entrega: "bloque95", rol: "administracion", titulo: "Plan de cobro impreso (pesos y dólares), también en el celular", ruta: "/plan-cobro/DTM-8101", solo_lectura: true,
    accion: "Abre «/plan-cobro/DTM-8101» (pesos) y «/plan-cobro/DTM-8103» (dólares). Repite en pantalla de teléfono.",
    esperado: "Cada documento muestra el plan con sus estados («Cubierta», «Pendiente»). En dólares los importes llevan centavos (USD $20.16). Nada se corta ni obliga a desplazar la página de lado en 390 px; la columna «Estado» se ve completa.",
    async verificar(c) {
      await c.ir("/plan-cobro/DTM-8101");
      let t = await c.texto();
      c.check("el plan en pesos lista los 500.000 cubiertos y las cuotas", /500\.000/.test(t) && /166\.666/.test(t) && /Cubierta/.test(t) && /Pendiente/.test(t), t.slice(0, 400));
      const celdas = await c.page.locator("td, th").evaluateAll((els) => els.filter((e) => /Estado|Cubierta|Pendiente|Parcial/.test(e.textContent ?? "")).map((e) => { const r = e.getBoundingClientRect(); return r.right; }));
      c.check("la columna de estado queda dentro de la pantalla", celdas.every((x) => x <= c.ancho + 1), JSON.stringify(celdas) + " ancho " + c.ancho);
      await c.ir("/plan-cobro/DTM-8103");
      t = await c.texto();
      c.check("el plan en dólares muestra los centavos (USD $20.16 y USD $20.18)", /USD\s*\$\s*20[.,]16/.test(t) && /USD\s*\$\s*20[.,]18/.test(t), t.slice(0, 400));
      const celdas2 = await c.page.locator("td, th").evaluateAll((els) => els.filter((e) => /Estado|Cubierta|Pendiente|Parcial/.test(e.textContent ?? "")).map((e) => e.getBoundingClientRect().right));
      c.check("en dólares también cabe en pantalla", celdas2.every((x) => x <= c.ancho + 1), JSON.stringify(celdas2));
    },
  },

  // ═════════════════════════ #61 · duplicar paquetes ═════════════════════════
  {
    id: "B95-09", entrega: "bloque95", rol: "operaciones", titulo: "Duplicar paquetes armados de cada tipo como borrador", ruta: "/dashboard/paquetes",
    accion: "Para cada uno de los cuatro paquetes B95 (Porción terrestre, Bloqueo, Servicios sueltos, Dinámico con salida): ábrelo y pulsa «Duplicar». Revisa el aviso de la copia y confirma que el original no cambió.",
    esperado: "Cada copia se abre con el aviso de duplicado, con el nombre «… (copia)» editable, INACTIVA y sin tarifario ni publicación; trae su configuración y sus hijos (hoteles, servicios, vuelo, empaquetado, salida) apuntando a los MISMOS registros del catálogo. El paquete original queda idéntico (misma huella) y ninguna copia aparece en el tarifario público.",
    async verificar(c) {
      const casos = [
        { id: 80101, nombre: "B95 Porción terrestre — Hotel Mar", hijos: "1/2/0/0/0" },
        { id: 80102, nombre: "B95 Bloqueo — vuelo y hotel", hijos: "2/0/1/1/0" },
        { id: 80103, nombre: "B95 Servicios sueltos", hijos: "0/2/0/0/0" },
        { id: 80104, nombre: "B95 Dinámico con salida", hijos: "1/0/0/0/1" },
      ];
      for (const k of casos) {
        const antes = huellaPaquete(c, k.id), nAntes = n0(c.sql(`select count(*) from public.armado_paquetes where nombre = '${k.nombre} (copia)'`));
        await c.ir(`/dashboard/paquetes/${k.id}`);
        await c.page.getByRole("button", { name: /^Duplicar el paquete/ }).first().click();
        await esperaUrl(c.page, /duplicado=1/);
        const nuevo = n0((c.page.url().match(/paquetes\/(\d+)/) ?? [])[1]);
        c.check(`${k.nombre}: se abre la copia con el aviso de duplicado`, nuevo > 0 && nuevo !== k.id && (await c.page.locator('[data-testid="aviso-duplicado"]').count()) > 0, c.page.url());
        const nombre = await c.page.getByPlaceholder("Cartagena 4D/3N — Bloqueo junio").inputValue().catch(() => "");
        c.check(`${k.nombre}: el nombre es «… (copia)» y se puede editar`, nombre === `${k.nombre} (copia)` && await c.page.getByPlaceholder("Cartagena 4D/3N — Bloqueo junio").isEditable(), nombre);
        const fila = c.sql(`select activo::text || '|' || coalesce(tarifario_estado, '-') || '|' || (select count(*) from public.tarifario_resultado where paquete_id = ${nuevo}) from public.armado_paquetes where id = ${nuevo}`);
        c.check(`${k.nombre}: la copia está inactiva, sin tarifario ni publicación`, fila === "false|pendiente|0", fila);
        c.check(`${k.nombre}: hijos copiados (hoteles/servicios/vuelos/empaquetados/salidas = ${k.hijos})`, hijosPaquete(c, nuevo) === k.hijos && hijosPaquete(c, k.id) === k.hijos, `${hijosPaquete(c, nuevo)} vs ${hijosPaquete(c, k.id)}`);
        c.check(`${k.nombre}: el catálogo se reutiliza por referencia (mismos hoteles/servicios/vuelos)`, c.sql(`select (select coalesce(string_agg(hotel_id::text, ',' order by hotel_id), '') from public.armado_hoteles where paquete_id = ${nuevo}) = (select coalesce(string_agg(hotel_id::text, ',' order by hotel_id), '') from public.armado_hoteles where paquete_id = ${k.id}) and (select coalesce(string_agg(servicio_id::text, ',' order by servicio_id), '') from public.armado_servicios where paquete_id = ${nuevo}) = (select coalesce(string_agg(servicio_id::text, ',' order by servicio_id), '') from public.armado_servicios where paquete_id = ${k.id})`) === "t", "");
        c.check(`${k.nombre}: el original no cambió (misma huella)`, huellaPaquete(c, k.id) === antes, "");
        c.check(`${k.nombre}: la copia no aparece en el tarifario público`, n0(c.sql(`select count(*) from public.tarifario_resultado_publicable where paquete_id = ${nuevo}`)) === 0, "");
        c.check(`${k.nombre}: no quedaron copias de más`, n0(c.sql(`select count(*) from public.armado_paquetes where nombre = '${k.nombre} (copia)'`)) === nAntes + 1, "");
      }
      c.check("el paquete porción original conserva su tarifario publicado (B95-01)", n0(c.sql(`select count(*) from public.tarifario_resultado where paquete_id = 80101`)) > 0, "");
    },
  },
  {
    id: "B95-10", entrega: "bloque95", rol: "operaciones", titulo: "Duplicar el paquete dinámico total", ruta: "/dashboard/paquetes",
    accion: "En «Paquetes dinámicos totales» pulsa «Duplicar» en «B95 Paquete dinámico total — Cartagena 3 noches». Revisa el formulario precargado y pulsa «Guardar paquete».",
    esperado: "El formulario abre con el aviso «Duplicando …», el nombre termina en «(copia)» y trae sus hoteles (uno con ficha, uno manual) y su servicio. Al guardar se crea un paquete NUEVO sin publicar; el original sigue publicado e idéntico.",
    async verificar(c) {
      const hash = () => c.sql(`select md5(coalesce((select (to_jsonb(p) - 'updated_at')::text from public.paquete_din p where id = 80101), '') || coalesce((select string_agg((to_jsonb(h))::text, ',' order by id) from public.paquete_din_hoteles h where paquete_id = 80101), '') || coalesce((select string_agg((to_jsonb(s))::text, ',' order by id) from public.paquete_din_servicios s where paquete_id = 80101), ''))`);
      const antes = hash();
      await c.ir("/dashboard/paquetes");
      await c.page.locator("li", { hasText: "B95 Paquete dinámico total — Cartagena 3 noches" }).filter({ hasNotText: "(copia)" }).locator('[data-testid="duplicar-paquete-din"]').click();
      await esperaUrl(c.page, /total\/nuevo\?copiarDe=\d+/);
      c.check("se abre el formulario de copia", /copiarDe=80101/.test(c.page.url()), c.page.url());
      const aviso = await c.page.locator('[data-testid="aviso-duplicado"]').innerText().catch(() => "");
      c.check("aviso «Duplicando …» sin publicar", /Duplicando/.test(aviso) && /sin publicar/i.test(aviso), aviso.slice(0, 200));
      const nombre = await campo(c.page, "Nombre").inputValue();
      c.check("el nombre termina en «(copia)»", /\(copia\)$/.test(nombre), nombre);
      await boton(c.page, "Guardar paquete").click(); await c.espera(5000);
      const nuevo = c.sql(`select id from public.paquete_din where nombre = '${nombre.replace(/'/g, "''")}' order by id desc limit 1`);
      c.check("se creó un paquete nuevo", !!nuevo && nuevo !== "80101", (await c.texto()).slice(0, 300));
      c.check("el nuevo NO está publicado y trae hoteles y servicio", c.sql(`select publicado::text || '|' || (select count(*) from public.paquete_din_hoteles where paquete_id = ${nuevo || 0}) || '|' || (select count(*) from public.paquete_din_servicios where paquete_id = ${nuevo || 0}) from public.paquete_din where id = ${nuevo || 0}`) === "false|2|1", "");
      c.check("el original sigue idéntico y publicado", hash() === antes && c.sql(`select publicado::text from public.paquete_din where id = 80101`) === "true", "");
    },
  },

  // ═════════════════════════ #41 · duplicar vuelos ═════════════════════════
  {
    id: "B95-11", entrega: "bloque95", rol: "operaciones", titulo: "Duplicar un bloqueo con nuevas fechas", ruta: "/dashboard/vuelos/80101",
    accion: "Abre el bloqueo B95AA1 y pulsa «Duplicar con nuevas fechas». 1) Escribe record B95AA2, fecha de ida 130 días y de regreso 127 días desde hoy y pulsa «Crear bloqueo». 2) Corrige: regreso a 133 días, devolución a 80 y emisión a 65. 3) Prueba también con el record B95AA1 (repetido). 4) Con B95AA2 crea el bloqueo.",
    esperado: "El formulario viene con la configuración (aerolínea, ruta, cupos, tarifas, moneda) y el record VACÍO. Un regreso anterior a la ida se rechaza («La fecha de regreso no puede ser anterior a la fecha de ida.») y un record repetido también. La copia nace con sus 6 sillas disponibles; el bloqueo original conserva sus sillas (1 confirmada, 2 en plazo, 3 disponibles) y sus fechas.",
    async verificar(c) {
      const p = c.page;
      const sillasOrig = () => c.sql(`select string_agg(estado::text || ':' || count, ',' order by estado::text) from (select estado, count(*) from public.sillas where bloqueo_id = 80101 group by estado) x`);
      const antes = sillasOrig(); const fIdaOrig = c.sql(`select fecha_ida::text from public.bloqueos_vuelo where id = 80101`);
      await c.ir("/dashboard/vuelos/80101");
      await p.locator('[data-testid="duplicar-bloqueo"]').click();
      await esperaUrl(p, /vuelos\/nuevo\?copiarDe=80101/);
      const aviso = await p.locator('[data-testid="aviso-duplicado"]').innerText().catch(() => "");
      c.check("aviso «Duplicando el bloqueo B95AA1»", /Duplicando el bloqueo\s*B95AA1/.test(aviso), aviso.slice(0, 200));
      c.check("el record viene vacío y la aerolínea precargada", (await campo(p, "Record (PNR) *").inputValue()) === "" && (await campo(p, "Aerolínea").inputValue()) === "Aerolínea B95", "");
      await campo(p, "Record (PNR) *").fill("B95AA2");
      await fecha(p, "Fecha ida", hoyMas(c, 130)); await fecha(p, "Fecha regreso", hoyMas(c, 127));
      await boton(p, "Crear bloqueo").click(); await c.espera(2500);
      c.check("regreso antes de la ida se rechaza", (await c.texto()).includes("La fecha de regreso no puede ser anterior a la fecha de ida"), (await c.texto()).slice(0, 300));
      c.check("no se creó nada todavía", n0(c.sql(`select count(*) from public.bloqueos_vuelo where record = 'B95AA2'`)) === 0, "");
      await fecha(p, "Fecha regreso", hoyMas(c, 133)); await fecha(p, "Fecha devolución", hoyMas(c, 80)); await fecha(p, "Fecha límite de emisión", hoyMas(c, 65));
      await campo(p, "Record (PNR) *").fill("B95AA1");
      await boton(p, "Crear bloqueo").click(); await c.espera(3000);
      c.check("un record repetido se rechaza (sigue habiendo un solo B95AA1)", n0(c.sql(`select count(*) from public.bloqueos_vuelo where record = 'B95AA1'`)) === 1 && /\/vuelos\/nuevo/.test(p.url()), p.url());
      await campo(p, "Record (PNR) *").fill("B95AA2");
      await boton(p, "Crear bloqueo").click();
      await esperaUrl(p, /\/dashboard\/vuelos$/);
      const nuevo = c.sql(`select id from public.bloqueos_vuelo where record = 'B95AA2'`);
      c.check("se creó el bloqueo B95AA2", !!nuevo, p.url());
      c.check("la copia tiene las fechas nuevas y la configuración del original", c.sql(`select (fecha_ida = public.fecha_negocio() + 130)::text || '|' || (fecha_regreso = public.fecha_negocio() + 133)::text || '|' || cupos_total || '|' || aerolinea || '|' || ruta from public.bloqueos_vuelo where id = ${nuevo}`) === "true|true|6|Aerolínea B95|BOG - CGB - BOG", "");
      c.check("la copia nace con 6 sillas disponibles y sin contrato", c.sql(`select count(*) || '|' || count(*) filter (where estado = 'disponible' and numero_contrato is null) from public.sillas where bloqueo_id = ${nuevo}`) === "6|6", "");
      c.check("el original conserva sus sillas (confirmada 1, disponible 3, en plazo 2) y su fecha", sillasOrig() === antes && c.sql(`select fecha_ida::text from public.bloqueos_vuelo where id = 80101`) === fIdaOrig, `${antes} → ${sillasOrig()}`);
      c.check("el contrato de la silla confirmada sigue en el original", c.sql(`select numero_contrato from public.sillas where bloqueo_id = 80101 and estado = 'confirmada'`) === "DTM-8150", "");
    },
  },
  {
    id: "B95-12", entrega: "bloque95", rol: "operaciones", titulo: "Duplicar un empaquetado con nuevas fechas", ruta: "/dashboard/vuelos/empaquetados/80101",
    accion: "Abre el empaquetado «Sin record» (JetSMART B95) y pulsa «Duplicar con nuevas fechas». Pon fecha de ida 140 días y de regreso 143 días desde hoy, vigencia de compra hasta 100 días, y pulsa «Crear empaquetado».",
    esperado: "El formulario trae la configuración con el aviso de duplicado. La copia se crea con las fechas nuevas, SIN vínculos con paquetes; el original sigue vinculado a «B95 Bloqueo — vuelo y hotel» y con sus fechas.",
    async verificar(c) {
      const p = c.page;
      const fOrigEmp = c.sql("select fecha_ida::text from public.empaquetados where id = 80101");   // la fecha sembrada depende del día de la siembra: se compara con la de antes, no con «hoy + 110»
      await c.ir("/dashboard/vuelos/empaquetados/80101");
      await p.locator('[data-testid="duplicar-empaquetado"]').click();
      await esperaUrl(p, /empaquetados\/nuevo\?copiarDe=80101/);
      const aviso = await p.locator('[data-testid="aviso-duplicado"]').innerText().catch(() => "");
      c.check("aviso «Duplicando el empaquetado»", /Duplicando el empaquetado/.test(aviso), aviso.slice(0, 200));
      c.check("aerolínea precargada y record vacío", (await campo(p, "Aerolínea").inputValue()) === "JetSMART B95" && (await campo(p, "Record (PNR)").inputValue()) === "", "");
      await fecha(p, "Fecha ida", hoyMas(c, 140)); await fecha(p, "Fecha regreso", hoyMas(c, 143)); await fecha(p, "Vigencia de compra: hasta", hoyMas(c, 100));
      await boton(p, "Crear empaquetado").click();
      await esperaUrl(p, /vuelos\?vista=empaquetados/);
      const nuevo = c.sql(`select id from public.empaquetados where id <> 80101 and fecha_ida = public.fecha_negocio() + 140 and aerolinea = 'JetSMART B95' order by id desc limit 1`);
      c.check("se creó el empaquetado nuevo con las fechas nuevas", !!nuevo, p.url());
      c.check("la copia no está vinculada a ningún paquete", n0(c.sql(`select count(*) from public.armado_empaquetados where empaquetado_id = ${nuevo || 0}`)) === 0, "");
      c.check("el original sigue vinculado a su paquete (80102) y con sus fechas", c.sql(`select (select count(*) from public.armado_empaquetados where empaquetado_id = 80101 and paquete_id = 80102) || '|' || (fecha_ida::text = '${fOrigEmp}')::text from public.empaquetados where id = 80101`) === "1|true", "");
    },
  },

  // ═════════════════════════ #95 · copia editable del catálogo en formularios manuales ═════════════════════════
  // REV2 (F6, B95-13/14/15/20): el destino se ELIGE del catálogo (lista), los hoteles del catálogo se ofrecen SOLO para ese destino (por el destino guardado de cada hotel), el origen de la compra
  // (directa / plataforma) y las habitaciones por tipo son campos obligatorios y las fechas/infantes/ocupación se validan en pantalla antes de enviar. El servidor repite cada regla (pruebas reales: pruebas/formulariosManuales95f6.pg.ts).
  {
    id: "B95-13", entrega: "bloque95", rol: "superadmin", titulo: "Contrato manual: destino del catálogo, hoteles de ESE destino, compra, habitaciones y fechas; editar la copia y reabrir", ruta: "/dashboard/contratos/nuevo",
    accion: "1) Tipo «Dinámico (todo manual)», asesor interno, cliente «Cliente» «Catálogo B95». 2) Fechas: salida a 60 días y regreso a 63. 3) «+ Agregar hotel» y, SIN elegir destino, abre la lista del hotel. 4) En «Destino» elige «BOGOTÁ B95» de la lista y mira los hoteles; escribe «Hotel Duplicado B95» (el de Bogotá, solo adultos). 5) Cambia el destino a «CARTAGENA B95» y vuelve a escribir «Hotel Duplicado B95» (ahora es el de Cartagena). 6) Sin elegir «Cómo se compra» mira el aviso; elige «Compra directa al hotel». 7) Mueve la SALIDA a 66 días (después del regreso) y devuélvela a 60. 8) Categoría «Superior B95», alimentación «PAM», proveedor «Proveedor editado B95», habitaciones: Doble = 1, costo 500.000. Con UN solo pasajero adulto mira el aviso de habitaciones y agrega un segundo pasajero adulto. 9) «+ Agregar servicio» tipo Traslado: «Traslado aeropuerto B95» (hay dos) y elige «… (#80304)»; costo 40.000. 10) Ítem «Paquete B95», 2 adultos, tarifa 1.200.000; «Generar contrato» y reabre el contrato.",
    esperado: "Sin destino: la lista de hoteles está vacía y dice «Elige primero el destino para ver los hoteles del catálogo». Con BOGOTÁ B95 solo sale «Hotel Duplicado B95» (el de Bogotá, con «Solo adultos (Adults Only)»); al cambiar a CARTAGENA B95 ese hotel se QUITA con el aviso «Se quitó el hotel «Hotel Duplicado B95»: no pertenece al destino elegido…», y la lista ofrece UN solo «Hotel Duplicado B95» (sin etiqueta #id: el gemelo de Bogotá ya no se ofrece). Al elegirlo: «Hotel del catálogo», proveedor «Proveedor Hotel Mar B95» y Ciudad «CARTAGENA B95» ya puestos (copias editables). Sin origen: «Indica cómo se compra…». Con la salida después del regreso: «La fecha de regreso no puede ser anterior a la fecha de salida» y «Generar contrato» desactivado. Con 1 adulto y 1 Doble: «necesitan 2 adulto(s); el viaje tiene 1»; con 2 adultos desaparece. El servicio elegido (#80304) trae su proveedor «Receptivo Alterno B95» y no su precio. El contrato guarda la COPIA editada («Superior B95», «PAM», proveedor escrito) con la acomodación derivada «1 hab Doble» y origen «directa»; el catálogo queda intacto.",
    async verificar(c) {
      const p = c.page; const salida = hoyMas(c, 60), regreso = hoyMas(c, 63);
      const hashCat = () => c.sql(`select md5(coalesce((select to_jsonb(h)::text from public.hoteles h where id = 80202), '') || (select string_agg(categoria_id::text, ',' order by categoria_id) from public.hotel_categorias where hotel_id = 80202) || (select string_agg(plan_id::text, ',' order by plan_id) from public.hotel_regimenes where hotel_id = 80202) || (select string_agg(to_jsonb(s)::text, ',' order by id) from public.servicios_adicionales s where id in (80303, 80304)))`);
      const cat0 = hashCat();
      await c.ir("/dashboard/contratos/nuevo");
      await campo(p, "Tipo *").selectOption("dinamico");
      await campo(p, "Asesor interno *").selectOption({ index: 1 });
      await campo(p, "Nombres *").fill("Cliente"); await campo(p, "Apellidos *").fill("Catálogo B95");
      await fecha(p, "Fecha de salida (viaje)", salida); await fecha(p, "Fecha de regreso", regreso);
      await boton(p, "+ Agregar hotel").click();
      const hotel = p.locator('[data-testid="fila-hotel"]').first();
      const nombreHotel = hotel.getByPlaceholder("Hotel", { exact: true });
      const chip = hotel.locator('[data-testid="vinculo-hotel"]');
      c.check("sin destino elegido NO se ofrece ningún hotel del catálogo y se explica por qué", (await opcionesDe(p, "datalist#hoteles-catalogo")).length === 0 && /Elige primero el destino para ver los hoteles del catálogo/.test(await c.texto()), JSON.stringify(await opcionesDe(p, "datalist#hoteles-catalogo")));
      await elegirDestino(p, "BOGOTÁ B95");
      const enBogota = await opcionesDe(p, "datalist#hoteles-catalogo");
      c.check("con BOGOTÁ B95 solo se ofrece el hotel de Bogotá, sin etiqueta de homónimo", enBogota.length === 1 && enBogota[0] === "Hotel Duplicado B95", JSON.stringify(enBogota));
      await nombreHotel.fill("Hotel Duplicado B95"); await c.espera(300);
      c.check("el de Bogotá: «Hotel del catálogo» y «Solo adultos (Adults Only)»", /Hotel del catálogo/.test(await chip.innerText()) && /Solo adultos \(Adults Only\)/.test(await chip.innerText()), await chip.innerText());
      await elegirDestino(p, "CARTAGENA B95");
      const aviso = await p.locator('[data-testid="aviso-destino"]').innerText().catch(() => "");
      c.check("al cambiar de destino el hotel incompatible se QUITA y se avisa cuál fue", /Se quitó el hotel «Hotel Duplicado B95»: no pertenece al destino elegido/.test(aviso) && (await nombreHotel.inputValue()) === "", aviso + " | hotel=" + (await nombreHotel.inputValue()));
      const enCartagena = await opcionesDe(p, "datalist#hoteles-catalogo");
      c.check("con CARTAGENA B95: UN solo «Hotel Duplicado B95» (el gemelo de Bogotá ya no se ofrece, no hay etiqueta #id)", enCartagena.filter((x) => /Hotel Duplicado B95/.test(x)).length === 1 && !enCartagena.some((x) => /#\d+|BOGOT/.test(x)), JSON.stringify(enCartagena));
      await nombreHotel.fill("Hotel Duplicado B95"); await c.espera(300);
      const t1 = await chip.innerText();
      c.check("elegido el de Cartagena: «Hotel del catálogo», proveedor precargado y ciudad precargada (sin volver a escribirlas)", /Hotel del catálogo/.test(t1) && (await hotel.getByPlaceholder("Proveedor del hotel").inputValue()) === "Proveedor Hotel Mar B95" && /Proveedor del catálogo/.test(t1) && (await hotel.getByPlaceholder("Ciudad").inputValue()) === "CARTAGENA B95", t1 + " | ciudad=" + (await hotel.getByPlaceholder("Ciudad").inputValue()));
      c.check("con varias categorías/regímenes no se precarga nada (solo sugerencias)", (await hotel.getByPlaceholder("Categoría habitación").inputValue()) === "" && (await hotel.getByPlaceholder("Alimentación (P.A, PAM…)").inputValue()) === "", "");
      const errHotel = hotel.locator('[data-testid="errores-hotel"]');
      c.check("sin elegir «Cómo se compra» el formulario lo exige (no hay valor por defecto)", /Indica cómo se compra/.test(await errHotel.innerText().catch(() => "")), await errHotel.innerText().catch(() => ""));
      await hotel.locator('select[aria-label="Origen de la compra"]').selectOption("directa");
      // Fechas: el regreso nunca puede quedar antes de la salida, tampoco cuando se mueve la SALIDA después de haber puesto el regreso.
      await fecha(p, "Fecha de salida (viaje)", hoyMas(c, 66)); await c.espera(300);
      c.check("salida después del regreso: error en línea y «Generar contrato» desactivado", /La fecha de regreso no puede ser anterior a la fecha de salida/.test(await p.locator('[data-testid="error-fechas"]').innerText().catch(() => "")) && await p.getByRole("button", { name: "Generar contrato", exact: true }).isDisabled(), "");
      await fecha(p, "Fecha de salida (viaje)", salida); await c.espera(300);
      c.check("al corregir la salida el aviso de fechas desaparece", (await p.locator('[data-testid="error-fechas"]').count()) === 0, "");
      await hotel.getByPlaceholder("Categoría habitación").fill("Superior B95");
      await hotel.getByPlaceholder("Alimentación (P.A, PAM…)").fill("PAM");
      await hotel.getByPlaceholder("Proveedor del hotel").fill("Proveedor editado B95"); await c.espera(300);
      c.check("al editar el proveedor pasa a «Proveedor en texto libre» (el hotel sigue del catálogo)", /Proveedor en texto libre/.test(await chip.innerText()) && /Hotel del catálogo/.test(await chip.innerText()), await chip.innerText());
      await hotel.getByPlaceholder("Costo neto (COP)").fill("500000");
      // Habitaciones por tipo (ya no hay texto libre de acomodación) frente a los pasajeros reales.
      c.check("ya no existe la caja de texto «Acomodación»: hay contadores por tipo (solo los que ese hotel ofrece: Doble y Triple)", (await hotel.getByPlaceholder("Acomodación (Doble…)").count()) === 0 && (await hotel.getByLabel("Habitaciones Doble", { exact: true }).count()) === 1 && (await hotel.getByLabel("Habitaciones Triple", { exact: true }).count()) === 1 && (await hotel.getByLabel("Habitaciones Sencilla", { exact: true }).count()) === 0, `texto libre=${await hotel.getByPlaceholder("Acomodación (Doble…)").count()} · Doble=${await hotel.getByLabel("Habitaciones Doble", { exact: true }).count()} · Triple=${await hotel.getByLabel("Habitaciones Triple", { exact: true }).count()} · Sencilla=${await hotel.getByLabel("Habitaciones Sencilla", { exact: true }).count()} · Múltiple=${await hotel.getByLabel("Habitaciones Múltiple", { exact: true }).count()}`);
      await hotel.getByLabel("Habitaciones Doble", { exact: true }).fill("1");
      const pas = p.getByPlaceholder("Nombres").last();
      await pas.fill("Pasajero"); await p.getByPlaceholder("Apellidos").last().fill("Adulto B95");
      await p.getByPlaceholder("Identificación").last().fill("1012340200");
      await fecha(p, "Fecha de nacimiento", "1985-01-01", (await p.getByLabel("Fecha de nacimiento", { exact: true }).count()) - 1); await c.espera(300);
      c.check("1 pasajero adulto frente a 1 Doble: «necesitan 2 adulto(s); el viaje tiene 1» y no se puede enviar", /necesitan 2 adulto\(s\); el viaje tiene 1/.test(await errHotel.innerText().catch(() => "")) && await p.getByRole("button", { name: "Generar contrato", exact: true }).isDisabled(), await errHotel.innerText().catch(() => ""));
      await boton(p, "+ Agregar pasajero").click();
      await p.getByPlaceholder("Nombres").last().fill("Segundo"); await p.getByPlaceholder("Apellidos").last().fill("Adulto B95");
      await p.getByPlaceholder("Identificación").last().fill("1012340201");
      await fecha(p, "Fecha de nacimiento", "1986-02-02", (await p.getByLabel("Fecha de nacimiento", { exact: true }).count()) - 1); await c.espera(300);
      c.check("con 2 pasajeros adultos la Doble cuadra: sin errores de habitaciones", (await errHotel.count()) === 0 || !/necesitan|alojan/.test(await errHotel.innerText()), await errHotel.innerText().catch(() => ""));
      await boton(p, "+ Agregar servicio").click();
      const srv = p.locator("section", { hasText: "Servicios y proveedores" }).locator("div.rounded-lg.bg-gray-50").first();
      await srv.locator("select").selectOption("traslado");
      await srv.getByPlaceholder("Descripción (Traslado aeropuerto-hotel…)").fill("Traslado aeropuerto B95"); await c.espera(300);
      const chipS = p.locator('[data-testid="vinculo-servicio"]').first();
      c.check("servicio repetido sin elegir: aviso «Hay varios servicios con este nombre»", /Hay varios servicios con este nombre/.test(await chipS.innerText()), await chipS.innerText());
      await srv.getByPlaceholder("Descripción (Traslado aeropuerto-hotel…)").fill("Traslado aeropuerto B95 — tour_traslado (#80304)"); await c.espera(300);
      c.check("elegido el #80304: «Servicio del catálogo» con SU proveedor y sin precio", /Servicio del catálogo/.test(await chipS.innerText()) && (await srv.getByPlaceholder("Proveedor").inputValue()) === "Receptivo Alterno B95" && ["", "0"].includes(await srv.getByPlaceholder("Costo neto (COP)").inputValue()), `${await chipS.innerText()} | prov=${await srv.getByPlaceholder("Proveedor").inputValue()} | costo=${await srv.getByPlaceholder("Costo neto (COP)").inputValue()}`);
      await srv.getByPlaceholder("Costo neto (COP)").fill("40000");
      const item = p.locator("div.bg-gray-50", { has: p.locator("label", { hasText: "Ítem" }) }).last();
      await item.locator("xpath=.//label[normalize-space(.)='Ítem']/parent::*//input").fill("Paquete B95");
      await item.locator("xpath=.//label[normalize-space(.)='Adultos']/parent::*//input").fill("2");
      await item.locator("xpath=.//label[normalize-space(.)='Tarifa adulto']/parent::*//input").fill("1200000");
      const invalidos = await p.evaluate(() => [...document.querySelectorAll("form :invalid")].map((e) => `${e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.name || e.tagName}: ${e.validationMessage}`));
      c.check("el formulario no tiene campos inválidos antes de enviar (el navegador bloquearía el envío en silencio)", invalidos.length === 0, invalidos.join(" || "));
      const antes = n0(c.sql(`select count(*) from public.ventas where cliente ilike '%Catálogo B95%'`));
      await boton(p, "Generar contrato").click();
      // El guardado puede tardar bajo carga (el servidor puede pasar de 60 s): se espera la redirección y, si no llega, se consulta la base hasta que aparezca el contrato nuevo.
      let redirigio = await esperaUrl(p, /\/dashboard\/contratos\/(?!nuevo)[^/?]+$/, 150000);
      for (let i = 0; i < 12 && !redirigio && n0(c.sql(`select count(*) from public.ventas where cliente ilike '%Catálogo B95%'`)) <= antes; i++) await c.espera(5000);
      const n = n0(c.sql(`select count(*) from public.ventas where cliente ilike '%Catálogo B95%'`)) > antes
        ? c.sql(`select numero_contrato from public.ventas where cliente ilike '%Catálogo B95%' order by created_at desc limit 1`) : "";
      const avisos = (await p.locator("form p.text-red-600, form div.bg-amber-50").allInnerTexts()).join(" || ");
      c.check("se creó el contrato", !!n, "mensajes del formulario: " + avisos);
      const h = c.sql(`select nombre || '|' || coalesce(categoria, '') || '|' || coalesce(alimentacion, '') || '|' || coalesce(acomodacion, '') || '|' || coalesce(proveedor, '') || '|' || coalesce(compra_origen, '') || '|' || coalesce(plataforma, '') from public.contrato_hoteles where numero_contrato = '${n}' limit 1`);
      c.check("el contrato guardó la COPIA editada del hotel, la acomodación DERIVADA de las habitaciones y el origen de la compra", h === "Hotel Duplicado B95|Superior B95|PAM|1 hab Doble|Proveedor editado B95|directa|", h);
      c.check("el destino guardado es el nombre del catálogo", c.sql(`select destino from public.ventas where numero_contrato = '${n}'`) === "CARTAGENA B95", c.sql(`select destino from public.ventas where numero_contrato = '${n}'`));
      c.check("el servicio quedó con su proveedor de catálogo y el costo escrito (no el del catálogo)", c.sql(`select count(*) from public.contrato_servicios where numero_contrato = '${n}' and descripcion = 'Traslado aeropuerto B95' and proveedor = 'Receptivo Alterno B95'`) === "1", "");
      c.check("la obligación del hotel se paga al proveedor escrito (compra directa), no a una plataforma", /Proveedor editado B95/.test(c.sql(`select coalesce(string_agg(p, ','), '-') from (select proveedor p from public.cuentas_por_pagar where numero_contrato = '${n}' and servicio like 'Hotel%' union all select payload->>'proveedor' from public.contrato_obligaciones_previstas where numero_contrato = '${n}' and clase = 'cxp' and payload->>'servicio' like 'Hotel%') q`)), "");
      c.check("el catálogo (hotel, categorías, regímenes, servicios) quedó idéntico", hashCat() === cat0, "");
      await c.ir(`/contrato/${n}`);
      const t = await c.texto();
      c.check("al reabrir, el documento muestra la copia guardada", /Hotel Duplicado B95/.test(t) && /Superior B95/.test(t), t.slice(0, 300));
    },
  },
  {
    id: "B95-14", entrega: "bloque95", rol: "superadmin", titulo: "Hotel solo para adultos: avisa y NO deja enviar con menores", ruta: "/dashboard/contratos/nuevo",
    accion: "En «Nuevo contrato (manual)»: tipo Dinámico, asesor, cliente «Cliente» «Adultos B95», destino «BOGOTÁ B95» (de la lista), fechas (salida 60 días, regreso 63). Hotel: escribe «Hotel Duplicado B95» (con Bogotá solo sale el de Bogotá), Compra directa, Doble = 1. Ítem «Paquete», 2 adultos, tarifa 1.000.000. Pasajero MENOR (nacido hace 5 años, tipo RC). Intenta pulsar «Generar contrato».",
    esperado: "Al elegir el hotel aparecen las marcas «Solo adultos (Adults Only)»; con el menor, el aviso rojo «Este hotel es solo para adultos y hay pasajeros menores de 18 años.» y, bajo el hotel, «El hotel «Hotel Duplicado B95» es solo para adultos (Adults Only) y el viaje incluye niños o infantes.». El botón «Generar contrato» queda DESACTIVADO (no se puede enviar) y no se crea ningún contrato. (El servidor repite la regla aunque alguien salte la pantalla: prueba real aparte.) «Acepta mascotas» solo informa: no bloquea.",
    async verificar(c) {
      const p = c.page; const salida = hoyMas(c, 60), regreso = hoyMas(c, 63);
      const nac = c.sql(`select (public.fecha_negocio() - 365 * 5)::text`);
      await c.ir("/dashboard/contratos/nuevo");
      await campo(p, "Tipo *").selectOption("dinamico");
      await campo(p, "Asesor interno *").selectOption({ index: 1 });
      await campo(p, "Nombres *").fill("Cliente"); await campo(p, "Apellidos *").fill("Adultos B95");
      await elegirDestino(p, "BOGOTÁ B95");
      await fecha(p, "Fecha de salida (viaje)", salida); await fecha(p, "Fecha de regreso", regreso);
      await boton(p, "+ Agregar hotel").click();
      const hotel = p.locator('[data-testid="fila-hotel"]').first();
      await hotel.getByPlaceholder("Hotel", { exact: true }).fill("Hotel Duplicado B95"); await c.espera(300);
      const chip = hotel.locator('[data-testid="vinculo-hotel"]');
      c.check("marcas del hotel: «Solo adultos (Adults Only)» y proveedor «Proveedor Adultos B95»", /Solo adultos \(Adults Only\)/.test(await chip.innerText()) && (await hotel.getByPlaceholder("Proveedor del hotel").inputValue()) === "Proveedor Adultos B95", await chip.innerText());
      c.check("con una sola categoría y régimen, se precargan (Estándar, PA)", (await hotel.getByPlaceholder("Categoría habitación").inputValue()) === "Estándar" && (await hotel.getByPlaceholder("Alimentación (P.A, PAM…)").inputValue()) === "PA", "");
      await hotel.locator('select[aria-label="Origen de la compra"]').selectOption("directa");
      await hotel.getByLabel("Habitaciones Doble", { exact: true }).fill("1");
      await hotel.getByPlaceholder("Costo neto (COP)").fill("300000");
      const item = p.locator("div.bg-gray-50", { has: p.locator("label", { hasText: "Ítem" }) }).last();
      await item.locator("xpath=.//label[normalize-space(.)='Ítem']/parent::*//input").fill("Paquete");
      await item.locator("xpath=.//label[normalize-space(.)='Adultos']/parent::*//input").fill("2");
      await item.locator("xpath=.//label[normalize-space(.)='Tarifa adulto']/parent::*//input").fill("1000000");
      await p.getByPlaceholder("Nombres").last().fill("Menor"); await p.getByPlaceholder("Apellidos").last().fill("B95");
      await p.getByPlaceholder("Tipo ID").last().fill("RC"); await p.getByPlaceholder("Identificación").last().fill("1012340201");
      await fecha(p, "Fecha de nacimiento", nac, (await p.getByLabel("Fecha de nacimiento", { exact: true }).count()) - 1); await c.espera(400);
      c.check("aviso rojo de menores con hotel solo adultos (marca del hotel)", /solo para adultos y hay pasajeros menores de 18 años/.test(await chip.innerText()), await chip.innerText());
      const err = await hotel.locator('[data-testid="errores-hotel"]').innerText().catch(() => "");
      c.check("bajo el hotel: «es solo para adultos (Adults Only) y el viaje incluye niños o infantes»", /es solo para adultos \(Adults Only\) y el viaje incluye niños o infantes/.test(err), err);
      c.check("«Generar contrato» está DESACTIVADO y la lista roja de pendientes lo explica", await p.getByRole("button", { name: "Generar contrato", exact: true }).isDisabled() && (await p.locator('[data-testid="bloqueo-formulario"]').count()) === 1, "");
      c.check("no se crea ningún contrato", n0(c.sql(`select count(*) from public.ventas where cliente ilike '%Adultos B95%'`)) === 0, "");
    },
  },
  {
    id: "B95-15", entrega: "bloque95", rol: "superadmin", titulo: "Cotización manual: destino, hotel del catálogo, infantes, compra y habitaciones; y su paso a contrato", ruta: "/dashboard/cotizaciones/nueva",
    accion: "0) (Esta cotización se paga antes de convertir: en «Pagos previos» registra un pago de 300.000 y, si el mínimo exigido es mayor, completa hasta él.) 1) Nueva cotización: cliente «Cliente» «B95 Cotizacion» (CC 1012340300, nacimiento 1985-05-05), destino «CARTAGENA B95» (de la lista), fechas (ida 70, regreso 73 días), 2 adultos, 1 INFANTE, asesor. Prueba antes: regreso anterior a la ida (movimiento de la ida a 80 días) y devuélvela. 2) Agrega un servicio Hotel: nombre «Hotel Duplicado B95» (al abrir la lista solo hay hoteles de Cartagena), «Cómo se compra» = Compra directa al hotel (mira antes el aviso sin elegir), categoría «Superior B95», régimen «PAM», habitaciones Doble = 1 (mira antes «3 adultos»), costo neto 800.000. 3) «Generar cotización» y luego «Generar contrato →».",
    esperado: "Sin elegir el origen: «Indica cómo se compra «Hotel Duplicado B95»…». Con el regreso antes de la ida: «La fecha de regreso no puede ser anterior…» y «Generar cotización» desactivado. La lista del hotel NO trae hoteles de otro destino ni etiquetas #id. La fila muestra «Del catálogo», proveedor «Proveedor del catálogo» y, con 3 adultos y 1 Doble, «alojan 2 adulto(s); el viaje tiene 3». La cotización guarda destino «CARTAGENA B95», 1 infante, compra «directa», habitaciones {Doble: 1}, acomodación «1 hab Doble» y los textos EDITADOS. El contrato convertido muestra en «Servicio / Plan» «Hotel Duplicado B95 · Superior B95 · PAM · 1 hab Doble», su hotel en «Hoteles y Servicios» del documento y queda pendiente.",
    async verificar(c) {
      const p = c.page;
      await c.ir("/dashboard/cotizaciones/nueva");
      await campo(p, "Tipo de documento").selectOption("CC");
      await campo(p, "Número de documento").fill("1012340300");
      await campo(p, "Nombres").fill("Cliente"); await campo(p, "Apellidos").fill("B95 Cotizacion");
      await fecha(p, "Fecha de nacimiento", "1985-05-05");
      await elegirDestino(p, "CARTAGENA B95");
      await fecha(p, "Fecha ida", hoyMas(c, 70)); await fecha(p, "Fecha regreso", hoyMas(c, 73));
      await fecha(p, "Fecha ida", hoyMas(c, 80)); await c.espera(300);
      c.check("regreso anterior a la ida: error en línea y «Generar cotización» desactivado", /La fecha de regreso no puede ser anterior a la fecha de salida/.test(await p.locator('[data-testid="error-fechas"]').innerText().catch(() => "")) && await p.getByRole("button", { name: "Generar cotización", exact: true }).isDisabled(), "");
      await fecha(p, "Fecha ida", hoyMas(c, 70)); await c.espera(300);
      await campo(p, "Adultos").fill("2");
      await campo(p, "Infantes").fill("1");
      await campo(p, "Asesor").selectOption({ index: 1 });
      await p.getByRole("button", { name: "Hotel", exact: true }).click();
      const f = p.locator("section:has(h2:text-is('Servicios')) div.rounded-lg.border.border-gray-200.p-3").first();
      const opciones = await opcionesDe(p, 'datalist[id^="nombres-cot-"]');
      c.check("la lista del hotel solo trae hoteles de CARTAGENA B95 y sin etiqueta #id", opciones.includes("Hotel Duplicado B95") && !opciones.some((x) => /#\d+|BOGOT/.test(x)) && opciones.filter((x) => x === "Hotel Duplicado B95").length === 1, JSON.stringify(opciones));
      await f.locator("xpath=.//label[normalize-space(.)='Nombre del servicio']/parent::*//input").fill("Hotel Duplicado B95"); await c.espera(300);
      const chip = f.locator('[data-testid="vinculo-cotizacion"]');
      c.check("fila del hotel: «Del catálogo» y proveedor del catálogo", /Del catálogo/.test(await chip.innerText()) && /Proveedor del catálogo/.test(await chip.innerText()), await chip.innerText());
      const errF = f.locator('[data-testid="errores-hotel"]');
      c.check("sin elegir «Cómo se compra» el formulario lo exige", /Indica cómo se compra «Hotel Duplicado B95»/.test(await errF.innerText().catch(() => "")), await errF.innerText().catch(() => ""));
      await f.locator('select[aria-label="Origen de la compra"]').selectOption("directa");
      await f.locator("xpath=.//label[normalize-space(.)='Categoría de habitación']/parent::*//input").fill("Superior B95");
      await f.locator("xpath=.//label[normalize-space(.)='Régimen / alimentación']/parent::*//input").fill("PAM");
      await f.getByLabel("Habitaciones Doble", { exact: true }).fill("1");
      await campo(p, "Adultos").fill("3"); await c.espera(300);
      c.check("3 adultos en 1 Doble: «alojan 2 adulto(s); el viaje tiene 3» y «Generar cotización» desactivado", /alojan 2 adulto\(s\); el viaje tiene 3/.test(await errF.innerText().catch(() => "")) && await p.getByRole("button", { name: "Generar cotización", exact: true }).isDisabled(), await errF.innerText().catch(() => ""));
      await campo(p, "Adultos").fill("2"); await c.espera(300);
      c.check("con 2 adultos, 1 infante y 1 Doble no hay errores de habitaciones", (await errF.count()) === 0 || !/alojan|necesitan|infante/.test(await errF.innerText()), await errF.innerText().catch(() => ""));
      await f.locator("xpath=.//label[normalize-space(.)='Costo neto']/parent::*//input").fill("800000");
      await boton(p, "Generar cotización").click();
      await esperaUrl(p, /\/dashboard\/cotizaciones\/\d+$/);
      const id = (p.url().match(/cotizaciones\/(\d+)/) ?? [])[1];
      c.check("se creó la cotización", !!id, p.url() + " " + (await c.texto()).slice(0, 200));
      const pl = c.sql(`select payload::text from public.cotizaciones where id = ${id || 0}`);
      c.check("la cotización guardó categoría, régimen y el id del catálogo 80202; acomodación derivada «1 hab Doble», compra «directa» e infantes = 1", /Superior B95/.test(pl) && /PAM/.test(pl) && /80202/.test(pl) && /1 hab Doble/.test(pl) && /"compra": ?"directa"/.test(pl) && /"infantes": ?1/.test(pl), pl.slice(0, 400));
      c.check("el destino guardado es el del catálogo («CARTAGENA B95»)", c.sql(`select destino from public.cotizaciones where id = ${id || 0}`) === "CARTAGENA B95", "");
      const pp = await pagarMinimoPrevio(c, id, 300000);
      c.check("el pago previo cubre el mínimo exigido", pp.pagadoCop >= pp.exigidoCop && pp.exigidoCop > 0, JSON.stringify(pp));
      const n = await generarContratoDeCotizacion(c, id);
      c.check("se generó el contrato", !!n, p.url() + " " + (await c.texto()).slice(0, 300));
      const plan = c.sql(`select coalesce(plan_nombre, '') || '|' || estado from public.ventas where numero_contrato = '${n}'`);
      c.check("«Servicio / Plan» = «Hotel Duplicado B95 · Superior B95 · PAM · 1 hab Doble»", sinTildes(plan).startsWith("Hotel Duplicado B95 · Superior B95 · PAM · 1 hab Doble"), plan);
      c.check("el contrato conserva el hotel elegido (REV2 f95docs): nombre, categoría, plan, acomodación y origen de la compra", c.sql(`select nombre || '|' || coalesce(categoria, '') || '|' || coalesce(alimentacion, '') || '|' || coalesce(acomodacion, '') || '|' || coalesce(compra_origen, '') from public.contrato_hoteles where numero_contrato = '${n}' limit 1`) === "Hotel Duplicado B95|Superior B95|PAM|1 hab Doble|directa", c.sql(`select count(*) from public.contrato_hoteles where numero_contrato = '${n}'`));
      await c.ir(`/contrato/${n}`);
      const d = await c.texto();
      c.check("el documento imprime ese plan y el hotel en «Hoteles y Servicios»", /Hotel Duplicado B95 · Superior B95 · PAM · 1 hab Doble/.test(d) && /Hoteles y Servicios/.test(d), "");
    },
  },

  // ═════════════════════════ #33 · comparativa con tarifas de niño distintas ═════════════════════════
  {
    id: "B95-16", entrega: "bloque95", rol: "superadmin", titulo: "Crear una comparativa: niño gratis en A, niño con tarifa en B", ruta: "/dashboard/cotizaciones/nueva",
    accion: "Cotización nueva en modo «Cotización comparativa» (markup general 0): cliente «Cliente» «B95 Comparativa» (CC 1012340001, nacimiento 1985-05-05), destino «CARTAGENA B95» elegido de la lista, ida 70 y regreso 73 días, 2 adultos, 1 niño, asesor. Servicios: Hotel A «Hotel Niño Gratis B95» (costo 830.455) y Hotel B «Hotel Mar B95» (930.455), cada uno con «Cómo se compra» = Compra directa al hotel y Habitaciones Doble = 1, y un Traslado común «Traslado aeropuerto B95 — … (#80303)» (500.000). Tarifa por niño: Opción A 0, Opción B 150.000. Escribe un Incluye y un No incluye DISTINTOS en cada opción y pulsa «Generar comparativa».",
    esperado: "El total por opción es A $1.330.455 y B $1.580.455. La comparativa guardada muestra cada opción con SU incluye / no incluye (nada prestado de la otra), el niño de la A como «Niño gratis · Sin costo» y el de la B con su tarifa $150.000, sin costos ni proveedores visibles para el cliente.",
    async verificar(c) {
      const id = await crearComparativa(c, COMPARATIVA_COP);
      c.check("se creó la comparativa", !!id, c.page.url() + " " + (await c.texto()).slice(0, 300));
      const m = c.sql(`select modo || '|' || estado || '|' || moneda from public.cotizaciones where id = ${id || 0}`);
      c.check("queda como comparativa (madre) en COP", m === "comparativa|abierta|COP", m);
      const t = await c.texto();
      c.check("totales por opción: $1.330.455 y $1.580.455", /1\.330\.455/.test(t) && /1\.580\.455/.test(t), t.slice(0, 500));
      const a = (await c.page.locator("article", { hasText: "Opción A" }).first().innerText()).replace(/\s+/g, " ");
      const b = (await c.page.locator("article", { hasText: "Opción B" }).first().innerText()).replace(/\s+/g, " ");
      c.check("opción A: niño gratis · sin costo; su incluye propio y no el de B", /Niño gratis/i.test(a) && /Sin costo/i.test(a) && /Desayuno buffet A/.test(a) && !/Spa B/.test(a), a.slice(0, 400));
      c.check("opción B: el niño con tarifa $150.000; su incluye propio y no el de A", /150\.000/.test(b) && /Media pensión B|Spa B/.test(b) && !/Piscina A/.test(b), b.slice(0, 400));
      c.check("ni costo neto ni proveedor en la vista", !/Proveedor Hotel Mar B95|costo neto/i.test(t), "");
    },
  },
  {
    id: "B95-17", entrega: "bloque95", rol: "administracion", titulo: "La comparativa en el celular", ruta: "/dashboard/cotizaciones", solo_lectura: true,
    accion: "Abre la comparativa «Cliente B95 Comparativa» (lista de Cotizaciones) y revísala en pantalla de teléfono.",
    esperado: "Las dos opciones se apilan, con su total, su niño (gratis / $150.000) y sus incluye / no incluye; nada se corta ni obliga a desplazar la página de lado en 390 px.",
    async verificar(c) {
      const id = c.sql(`select id from public.cotizaciones where modo = 'comparativa' and cliente ilike '%B95 Comparativa%' order by id desc limit 1`);
      c.check("existe la comparativa de B95-16", !!id, "ejecuta antes B95-16");
      await c.ir(`/dashboard/cotizaciones/${id}`); await c.espera(1000);
      const t = await c.texto();
      c.check("se ven las dos opciones con sus totales y el niño de cada una", /Opción A/.test(t) && /Opción B/.test(t) && /1\.330\.455/.test(t) && /1\.580\.455/.test(t) && /Niño gratis/i.test(t) && /150\.000/.test(t), t.slice(0, 400));
      const caja = await c.page.locator("article").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
      c.check("las tarjetas de opción caben en el ancho de pantalla", caja.length >= 2 && caja.every(([l, r]) => l >= -1 && r <= c.ancho + 1), JSON.stringify(caja) + " ancho " + c.ancho);
    },
  },
  {
    id: "B95-18", entrega: "bloque95", rol: "administracion", titulo: "Elegir la opción B y convertirla en contrato", ruta: "/dashboard/cotizaciones",
    accion: "En la comparativa «Cliente B95 Comparativa» pulsa «Elegir esta opción» en la Opción B. Abre la cotización creada, registra en «Pagos previos» un primer pago de 300.000 y completa hasta el «Pago mínimo exigido», y pulsa «Generar contrato →» (sin pago mínimo el sistema se niega a convertir).",
    esperado: "Se crea la cotización de la opción B por $1.580.455 y de ella el contrato por el mismo total. El contrato (documento «Contrato» del cliente) muestra «Hoteles y Servicios» con el hotel de la Opción B (Hotel Mar B95 · Estándar, Alimentación PAM —la del catálogo—, acomodación «1 hab Doble» y proveedor/compra solo internos), el «Incluye / No incluye» de ESA opción y UNA fila agrupada del paquete: 2 adultos, 1 niño, tarifa por adulto $715.227,50, tarifa REAL del niño $150.000 y Valor total $1.580.455. NO hay fila «Ajuste por redondeo» (el −$1 queda dentro de la tarifa del adulto: 2 × 715.227,50 + 150.000 = 1.580.455). Nada del Hotel A ni de su incluye.",
    async verificar(c) {
      const madre = c.sql(`select id from public.cotizaciones where modo = 'comparativa' and cliente ilike '%B95 Comparativa%' order by id desc limit 1`);
      const hija = await elegirOpcion(c, madre, "B");
      c.check("se creó la cotización hija de la opción B", !!hija, (await c.texto()).slice(0, 300));
      c.check("la hija vale $1.580.455", n0(c.sql(`select precio_venta from public.cotizaciones where id = ${hija || 0}`)) === 1580455, "");
      const pp = await pagarMinimoPrevio(c, hija, 300000);
      c.check("el pago previo cubre el mínimo exigido", pp.pagadoCop >= pp.exigidoCop && pp.exigidoCop > 0, JSON.stringify(pp));
      const n = await generarContratoDeCotizacion(c, hija);
      c.check("se generó el contrato", !!n, c.page.url());
      c.check("precio del contrato = $1.580.455", n0(c.sql(`select precio_venta from public.ventas where numero_contrato = '${n}'`)) === 1580455, "");
      c.check("la suma exacta de las líneas es $1.580.455", n0(totalItems(c, n)) === 1580455, totalItems(c, n));
      const l = c.sql(`select string_agg(adultos || 'x' || tarifa_adulto::bigint || '+' || ninos || 'x' || tarifa_nino::bigint, ' ; ' order by orden, id) from public.contrato_items where numero_contrato = '${n}'`);
      c.check("líneas GUARDADAS (el dato no cambia): paquete 2 × 715.228 con el niño a 150.000 y el ajuste de −1 que las hace sumar el precio", /2x715228\+1x150000/.test(l) && /1x-1\+0x0/.test(l), l);
      // REV2 (B95-15/18): el documento del cliente conserva el hotel elegido y sus inclusiones, y no imprime la fila de ajuste.
      await c.ir(`/contrato/${n}`);
      const d = (await c.texto()).replace(/\$\s+/g, "$");
      c.check("«Hoteles y Servicios» trae el hotel de la Opción B con su categoría, plan de alimentación y acomodación derivada de las habitaciones", /Hotel Mar B95\s*·\s*Est[aá]ndar/.test(d) && /Alimentaci[oó]n:\s*PAM/.test(d) && /1 hab Doble/.test(d), d.slice(d.indexOf("Hoteles y Servicios"), d.indexOf("Hoteles y Servicios") + 400));
      c.check("«Incluye / No incluye» de la opción elegida", /Incluye \/ No incluye/.test(d), "");
      c.check("la fila agrupada: 2 adultos, tarifa 715.227,50, niño $150.000, total $1.580.455 (una sola fila)", /PAQUETE TURÍSTICO[^]*?2\s+1\s+\$715\.227,50\s+\$150\.000\s+\$1\.580\.455/.test(d), d.slice(d.indexOf("Valores y Pagos"), d.indexOf("Valores y Pagos") + 500));
      c.check("NO aparece «Ajuste por redondeo» ni el texto interno", !/Ajuste por redondeo/i.test(d) && !/reparto del hotel/i.test(d), "");
      c.check("ni proveedor ni plataforma ni costos en el documento del cliente", !/Booking|Despegar|plataforma|costo neto/i.test(d), "");
    },
  },
  {
    id: "B95-19", entrega: "bloque95", rol: "administracion", titulo: "Pagar el contrato por completo: saldo cero y sin fila de ajuste", ruta: "/dashboard/contratos",
    accion: "En el contrato de «Cliente B95 Comparativa», pestaña Cartera: el contrato ya trae el pago previo aplicado como abono; registra un abono por el SALDO (precio 1.580.455 menos lo ya pagado) con Transferencia. Abre el documento del contrato.",
    esperado: "Pagado $1.580.455 y saldo $0. El documento imprime «Total del contrato $1.580.455» y «Saldo pendiente $0»; NO imprime ninguna fila «Ajuste por redondeo» (ni el texto interno «reparto del hotel»): la tarifa del adulto ($715.227,50) ya lleva el residuo y las filas suman exactamente el total.",
    async verificar(c) {
      const n = c.sql(`select numero_contrato from public.ventas where cliente ilike '%B95 Comparativa%' order by created_at desc limit 1`);
      c.check("existe el contrato de B95-18", !!n, "");
      await c.ir(`/dashboard/contratos/${n}?tab=cartera`);
      const previo = n0(c.sql(`select coalesce(sum(valor_abono), 0) from public.abonos where numero_contrato = '${n}'`));
      c.check("el contrato nace con el pago previo ya aplicado como abono (menor que el precio)", previo > 0 && previo < 1580455, String(previo));
      await c.ir(`/dashboard/contratos/${n}?tab=cartera`);
      await campo(c.page, "Valor del abono").fill(String(1580455 - previo));
      await campo(c.page, "Forma de pago").selectOption("Transferencia");
      await boton(c.page, "Registrar abono").click(); await c.espera(5000);
      const pagado = n0(c.sql(`select coalesce(sum(valor_abono), 0) from public.abonos where numero_contrato = '${n}'`));
      c.check("pagado = precio (sin diferencias de peso)", pagado === 1580455, String(pagado));
      c.check("el saldo es exactamente cero", n0(c.sql(`select precio_venta - ${pagado} from public.ventas where numero_contrato = '${n}'`)) === 0, "");
      await c.ir(`/contrato/${n}`);
      const t = (await c.texto()).replace(/\$\s+/g, "$");
      c.check("«Total del contrato $1.580.455»", /Total del contrato\s*\$1\.580\.455/i.test(t), t.slice(0, 400));
      c.check("«Saldo pendiente $0»", /Saldo pendiente\s*\$0\b/i.test(t), t.slice(0, 400));
      c.check("NO aparece «Ajuste por redondeo» ni el texto interno (B95-19: la fila ya no se imprime)", !/Ajuste por redondeo/i.test(t) && !/reparto del hotel/i.test(t), "");
      c.check("la tarifa del adulto lleva el residuo: \$715.227,50", /715\.227,50/.test(t), "");
    },
  },
  {
    id: "B95-20", entrega: "bloque95", rol: "superadmin", titulo: "Comparativa en dólares: centavos y ajuste de un centavo", ruta: "/dashboard/cotizaciones/nueva",
    accion: "Repite la comparativa en USD con 3 adultos y 1 niño (cliente «Cliente» «B95 Dolares», CC 1012340002, destino «CARTAGENA B95» de la lista): Hotel A 831, Hotel B 932 (compra directa y Habitaciones Triple = 1 en cada uno, porque 3 adultos no caben en una Doble), Traslado común 500; niño A 0 y niño B 150,55. Elige la Opción B, registra el pago previo mínimo (primer pago de 300.000 y luego el mínimo exigido), genera el contrato y abre su documento (también en el teléfono).",
    esperado: "Opción A USD $1,331.00 y B USD $1,582.55. El contrato conserva los centavos: total USD $1,582.55, niño USD $150.55 y SIN fila «Ajuste por redondeo»: el centavo queda dentro del total de los 3 adultos (1.432,00; tarifa por adulto USD $477.33 a su precisión de cálculo — decisión O-1 por confirmar); las líneas guardadas suman exactamente 1.582,55. En 390 px el documento no se corta.",
    async verificar(c) {
      const madre = await crearComparativa(c, COMPARATIVA_USD);
      c.check("se creó la comparativa en USD", !!madre, c.page.url() + " " + (await c.texto()).slice(0, 300));
      const t = await c.texto();
      c.check("totales por opción USD $1,331.00 y USD $1,582.55 (con centavos)", /1[.,]331(?:[.,]00)?/.test(t) && /1[.,]582[.,]55/.test(t), t.slice(0, 500));
      const hija = await elegirOpcion(c, madre, "B");
      c.check("se creó la hija de la opción B", !!hija, "");
      const pp = await pagarMinimoPrevio(c, hija, 100, 4000);
      c.check("el pago previo (USD, TRM 4.000) cubre el mínimo exigido", pp.pagadoCop >= pp.exigidoCop - 1 && pp.exigidoCop > 0, JSON.stringify(pp));
      const n = await generarContratoDeCotizacion(c, hija);
      c.check("se generó el contrato en USD", !!n && c.sql(`select moneda from public.ventas where numero_contrato = '${n}'`) === "USD", c.page.url());
      c.check("precio del contrato 1582,55 y suma de líneas idéntica al centavo", Number(c.sql(`select precio_venta::text from public.ventas where numero_contrato = '${n}'`)) === 1582.55 && Number(totalItems(c, n)) === 1582.55, totalItems(c, n));
      const l = c.sql(`select string_agg(adultos || 'x' || tarifa_adulto::text || '+' || ninos || 'x' || tarifa_nino::text, ' ; ' order by orden, id) from public.contrato_items where numero_contrato = '${n}'`);
      c.check("líneas: 3 × 477,33 + niño 150,55 + ajuste de 0,01", /3x477\.33/.test(l) && /150\.55/.test(l) && /0\.01/.test(l), l);
      await c.ir(`/contrato/${n}`);
      const d = (await c.texto()).replace(/\$\s+/g, "$");
      c.check("el documento imprime USD con centavos (total y niño) y NO la fila de ajuste", /USD\s*\$1[.,]582[.,]55/.test(d) && /150[.,]55/.test(d) && !/Ajuste por redondeo/i.test(d), d.slice(0, 500));
      await c.page.setViewportSize({ width: 390, height: 844 }); await c.espera(500);
      c.check("en 390 px la página no se desplaza de lado", await c.sinDesborde(), "");
    },
  },
];
