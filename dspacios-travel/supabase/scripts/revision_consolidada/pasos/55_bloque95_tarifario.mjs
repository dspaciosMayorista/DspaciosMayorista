// REV2 · B95-16 / B95-18 — la ruta del TARIFARIO (comparativa creada desde el carrito del tarifario público) hasta el contrato. Es una ruta DISTINTA de la comparativa manual (B95-16/B95-18):
// otro constructor (crearComparativaCarrito), otra hija (cotización de carrito) y otra conversión (convertirCotizacionCarrito). Datos: semillas/rev2/f95tarifario.sql (paquete 9560 «Porción 95T», ids 9560–9562).
// Lo que produce la aplicación (tarifario, comparativa, hija, contrato) NO se siembra: lo crean los pasos con la pantalla. Los pasos corren en orden.
// NO ejecutados todavía contra la aplicación compilada (falta el build final): ver docs/tecnico/rev2-f95tarifario-2026-11-26.md §6.
const IDA = "2030-03-01", REG = "2030-03-04";
const PAQ = 9560, HOT_A = 9561, HOT_B = 9562, S_ASIS = 9561;
const PREFIJO = "Visitante Tarifario16";
const DOC = "900956016";
const boton = (page, nombre, exacto = false) => page.getByRole("button", { name: nombre, exact: exacto }).first();

/** Lo mismo que guarda el carrito del tarifario en el navegador (lib/cart/CartContext.tsx, clave dspacios_cart_v1): dos hoteles del mismo paquete con la asistencia de cada uno. */
const carrito = (conNino = false) => ([
  ...[[HOT_A, "Hotel Alfa 95T", "Estandar", "Desayuno"], [HOT_B, "Hotel Beta 95T", "Superior", "Todo incluido"]].map(([h, nombre, categoria, regimen]) => ({
    id: `h${h}`, tipo: "hotel", modulo: "porcion_terrestre", paqueteId: PAQ, hotelId: h, bloqueoId: null, hotelNombre: nombre, destino: "CARTAGENA 95T", fotoUrl: null, categoria, regimen,
    fechaIda: IDA, fechaRegreso: REG, noches: 3, habitaciones: { doble: 1 }, ninos: conNino ? 1 : 0, ninos2: 0, infantes: 0, pax: 2, precio: 1, moneda: "COP", edadesMenores: conNino ? [8] : [], cantidadMenores: conNino ? 1 : 0,
  })),
  ...[HOT_A, HOT_B].map((h) => ({
    id: `t${h}`, tipo: "tour", paqueteId: PAQ, servicioId: S_ASIS, nombre: "Asistencia médica 95T", destino: "CARTAGENA 95T", fotoUrl: null, fechaIda: IDA, fechaRegreso: REG, noches: 3, pax: conNino ? 3 : 2, precio: conNino ? 120000 : 80000, moneda: "COP", hotelItemId: `h${h}`,
  })),
]);

export const pasos = [
  {
    id: "B95-16a", entrega: "bloque95", rol: "operaciones", titulo: "Generar el tarifario del paquete «Porción 95T» (dos hoteles) para la ruta del Tarifario", ruta: "/dashboard/paquetes/9560",
    accion: "1) Abre el paquete «Porción 95T» (3 noches, «Hotel Alfa 95T» Estandar/Desayuno y «Hotel Beta 95T» Superior/Todo incluido, asistencia médica opcional). 2) Pestaña «Tarifario resultado». 3) Pulsa «Generar tarifario» y espera a «Publicado».",
    esperado: "El tarifario queda «Publicado». La tarifa doble por persona es $375.000 en Hotel Alfa y $480.000 en Hotel Beta (neto por noche 100.000 y 128.000, 3 noches, markup 20 %); el niño es $150.000 en Alfa y gratis ($0) en Beta. Este paso es el mismo botón de B95-01: prepara datos para los dos pasos siguientes.",
    async verificar(c) {
      await c.ir(`/dashboard/paquetes/${PAQ}`);
      await c.page.getByRole("tab", { name: "Tarifario resultado" }).click(); await c.espera(1500);
      await c.page.locator('[data-testid="generar-tarifario"]').click();
      await c.page.waitForSelector('[data-testid="estado-tarifario"][data-estado="publicado"]', { timeout: 120000 }).catch(() => {});
      await c.espera(1500);
      c.check("el estado del tarifario es «Publicado»", await c.page.locator('[data-testid="estado-tarifario"][data-estado="publicado"]').count() > 0, "");
      const t = (h, a) => Number(c.sql(`select min(precio_pvp) from public.tarifario_resultado where paquete_id = ${PAQ} and hotel_id = ${h} and modulo = 'porcion_terrestre' and acomodacion = '${a}'`));
      c.check("doble por persona: Alfa 375.000 y Beta 480.000 (a mano: neto × 3 noches / 0,8)", t(HOT_A, "doble") === 375000 && t(HOT_B, "doble") === 480000, `${t(HOT_A, "doble")} / ${t(HOT_B, "doble")}`);
      c.check("niño: Alfa 150.000 y Beta gratis", t(HOT_A, "nino") === 150000 && t(HOT_B, "nino") === 0, `${t(HOT_A, "nino")} / ${t(HOT_B, "nino")}`);
    },
  },
  {
    id: "B95-16b", entrega: "bloque95", rol: null, titulo: "Visitante del Tarifario: crear la comparativa de dos hoteles con el carrito y elegir la opción B", ruta: "/tarifario/checkout?modo=comparativa",
    accion: "Sin iniciar sesión: 1) En el tarifario deja en el carrito «Hotel Alfa 95T» y «Hotel Beta 95T» (2 adultos, 1 habitación doble, 1 al 4 de marzo de 2030) cada uno con «Asistencia médica 95T»; activa «Cotización comparativa». (El paso carga ese mismo carrito por usted.) 2) En «Crear cotización comparativa» escribe nombres «Visitante», apellidos «Tarifario16», documento 900956016, teléfono 3009560016 y pulsa «Generar cotización comparativa». 3) Abre el enlace de la cotización, en la opción B pulsa «Continuar con esta opción», confirma tus datos y pulsa «Continuar con esta opción».",
    esperado: "La comparativa muestra dos opciones con el valor EXACTO por opción: A $830.000 y B $1.040.000 (2 × 375.000 + 2 × 40.000 de asistencia · 2 × 480.000 + 2 × 40.000). Al continuar con B se crea UNA cotización hija (la comparativa madre no se convierte) con «Hotel Beta 95T · Superior · Todo incluido» y el total $1.040.000, sin costos netos ni proveedores en pantalla. Con un niño en el carrito, un visitante SIN sesión hoy no puede cotizar (hallazgo pendiente de decisión: ver informe); por eso este paso es de solo adultos.",
    async verificar(c) {
      const p = c.page;
      await c.ir("/tarifario"); await c.espera(1500);
      await p.evaluate((items) => { localStorage.setItem("dspacios_cart_v1", JSON.stringify(items)); localStorage.setItem("dspacios_cart_modo_v1", "comparativa"); }, carrito());
      await c.ir("/tarifario/checkout?modo=comparativa"); await c.espera(2500);
      const lbl = (et) => p.locator(`xpath=(//label[contains(normalize-space(.),"${et}")])[1]/parent::*`).locator("input:not([type=hidden]), select").first();
      await lbl("Nombres").fill("Visitante"); await lbl("Apellidos").fill("Tarifario16");
      await p.locator("#checkout-numero-doc, input[name=numeroDoc]").first().fill(DOC).catch(async () => { await lbl("Documento").fill(DOC); });
      await lbl("Teléfono").fill("3009560016");
      await boton(p, "Generar cotización comparativa").click();
      await p.getByText(/Ver \/ descargar cotización/).first().waitFor({ timeout: 90000 }).catch(() => {});
      const madre = c.sql(`select id || '|' || share_token || '|' || version from public.cotizaciones where modo = 'comparativa' and cliente ilike '${PREFIJO}%' order by id desc limit 1`);
      c.check("se creó la comparativa (madre) del visitante", madre.length > 0, (await c.texto()).slice(0, 300));
      const [madreId, token] = madre.split("|");
      const ops = c.sql(`select string_agg(opcion_ref || ':' || total::bigint, ' ' order by orden) from public.cotizacion_opciones where cotizacion_id = ${madreId}`);
      c.check("dos opciones con el total exacto calculado a mano: A 830.000 y B 1.040.000", ops === "A:830000 B:1040000", ops);
      await c.ir(`/cot/${token}`); await c.espera(2000);
      const t = await c.texto();
      c.check("la cotización compartida muestra los dos totales y ningún neto ni proveedor", /830\.000/.test(t) && /1\.040\.000/.test(t) && !/Proveedor 95T|neto/i.test(t), t.slice(0, 400));
      const opcionB = p.locator("article", { hasText: "Hotel Beta 95T" }).first();
      await opcionB.getByRole("link", { name: /Continuar con esta opción/ }).or(opcionB.getByRole("button", { name: /Continuar con esta opción/ })).first().click();
      await p.waitForURL(/\/tarifario\/checkout\?.*comparativa=/, { timeout: 60000 }).catch(() => {});
      await c.espera(1500);
      await p.locator("#cmp-nombres").fill("Visitante"); await p.locator("#cmp-apellidos").fill("Tarifario16"); await p.locator("#cmp-doc").fill(DOC); await p.locator("#cmp-tel").fill("3009560016");
      await boton(p, "Continuar con esta opción").click();
      await p.getByText(/Ver \/ descargar cotización/).first().waitFor({ timeout: 90000 }).catch(() => {});
      const hija = c.sql(`select id || '|' || estado || '|' || precio_venta::bigint || '|' || coalesce(payload->'items'->0->>'hotelNombre','') || '|' || coalesce(payload->'items'->0->>'regimen','') from public.cotizaciones where coalesce(modo, '') <> 'comparativa' and cliente_documento = '${DOC}' and tipo <> 'comparativa_carrito' order by id desc limit 1`);
      c.check("nació UNA cotización hija con el hotel, plan y total de la opción B (la madre sigue sin contrato)", /\|abierta\|1040000\|Hotel Beta 95T\|Todo incluido$/.test(hija) && c.sql(`select coalesce(numero_contrato, '') from public.cotizaciones where id = ${madreId}`) === "", hija);
    },
  },
  {
    id: "B95-16c", entrega: "bloque95", rol: null, titulo: "Visitante del Tarifario CON UN NIÑO: crear la comparativa y ver el valor exacto de cada opción (antes fallaba con «admite máximo 0 niño(s)»)", ruta: "/tarifario/checkout?modo=comparativa",
    accion: "Sin iniciar sesión: 1) Deja en el carrito «Hotel Alfa 95T» y «Hotel Beta 95T» (2 adultos y 1 niño de 8 años, 1 habitación doble, 1 al 4 de marzo de 2030) con «Asistencia médica 95T» para 3 personas; activa «Cotización comparativa». (El paso carga ese carrito por usted.) 2) Escribe nombres «Visitante», apellidos «Tarifario17», documento 900956017, teléfono 3009560017 y pulsa «Generar cotización comparativa». 3) Abre el enlace de la cotización compartida.",
    esperado: "No aparece «La habitación seleccionada admite máximo 0 niño(s)». La comparativa muestra dos opciones con el valor EXACTO: A $1.020.000 (2 × 375.000 + niño 150.000 + 3 × 40.000 de asistencia) y B $1.080.000 (2 × 480.000 + niño gratis + 3 × 40.000). La cotización compartida no muestra costos netos ni proveedores. (Con 3 niños en una habitación doble la solicitud se rechaza por capacidad, también sin iniciar sesión: máximo 2 niños.)",
    async verificar(c) {
      const p = c.page;
      await c.ir("/tarifario"); await c.espera(1500);
      await p.evaluate((items) => { localStorage.setItem("dspacios_cart_v1", JSON.stringify(items)); localStorage.setItem("dspacios_cart_modo_v1", "comparativa"); }, carrito(true));
      await c.ir("/tarifario/checkout?modo=comparativa"); await c.espera(2500);
      const lbl = (et) => p.locator(`xpath=(//label[contains(normalize-space(.),"${et}")])[1]/parent::*`).locator("input:not([type=hidden]), select").first();
      await lbl("Nombres").fill("Visitante"); await lbl("Apellidos").fill("Tarifario17");
      await p.locator("#checkout-numero-doc, input[name=numeroDoc]").first().fill("900956017").catch(async () => { await lbl("Documento").fill("900956017"); });
      await lbl("Teléfono").fill("3009560017");
      await boton(p, "Generar cotización comparativa").click();
      await p.getByText(/Ver \/ descargar cotización/).first().waitFor({ timeout: 90000 }).catch(() => {});
      const t0 = await c.texto();
      c.check("no aparece el error de capacidad «máximo 0 niño(s)»", !/m[aá]ximo 0 ni[nñ]o/i.test(t0), t0.slice(0, 300));
      const madre = c.sql(`select id || '|' || share_token from public.cotizaciones where modo = 'comparativa' and cliente ilike 'Visitante Tarifario17%' order by id desc limit 1`);
      c.check("se creó la comparativa (madre) del visitante con un niño", madre.length > 0, t0.slice(0, 300));
      const [madreId, token] = madre.split("|");
      const ops = c.sql(`select string_agg(opcion_ref || ':' || total::bigint, ' ' order by orden) from public.cotizacion_opciones where cotizacion_id = ${madreId}`);
      c.check("dos opciones con el total exacto calculado a mano: A 1.020.000 y B 1.080.000", ops === "A:1020000 B:1080000", ops);
      await c.ir(`/cot/${token}`); await c.espera(2000);
      const t = await c.texto();
      c.check("la cotización compartida muestra los dos totales y ningún neto ni proveedor", /1\.020\.000/.test(t) && /1\.080\.000/.test(t) && !/Proveedor 95T|neto/i.test(t), t.slice(0, 400));
    },
  },
  {
    id: "B95-18b", entrega: "bloque95", rol: "venta", titulo: "Convertir la opción B del Tarifario en contrato: hotel, plan, tarifas y documento", ruta: "/dashboard/cotizaciones",
    accion: "1) En Cotizaciones abre la cotización de «Visitante Tarifario16». 2) Revisa la tarjeta «Titular de la cotización». 3) Pulsa «Confirmar → generar contrato», completa pasajeros (2 adultos), asesor y «Generar contrato». 4) En el contrato abre «Documento del contrato».",
    esperado: "Se crea UN contrato por $1.040.000 con «Hotel Beta 95T · Superior», alimentación «Todo incluido» y «1 hab Doble (2 pax)». El documento del cliente muestra UNA fila «Paquete Turístico» con la tarifa por adulto $520.000 (480.000 del hotel + 40.000 de la asistencia) y el valor total $1.040.000; «Asistencia médica 95T» aparece descrita en «Servicios incluidos» SIN precio propio, y no hay fila ni texto «Ajuste por redondeo». Nota: en este contrato «Acomodación» repite la categoría («Superior»); la habitación («1 hab Doble») va debajo: así guarda el Tarifario desde siempre.",
    async verificar(c) {
      const p = c.page;
      const [id] = c.sql(`select id from public.cotizaciones where coalesce(modo, '') <> 'comparativa' and cliente_documento = '${DOC}' and tipo <> 'comparativa_carrito' order by id desc limit 1`).split("|");
      c.check("existe la hija de B95-16b", !!id, "ejecuta antes B95-16b");
      await c.ir(`/dashboard/cotizaciones/${id}`); await c.espera(2500);
      const antes = Number(c.sql("select count(*) from public.ventas"));
      await boton(p, "Confirmar → generar contrato").click(); await c.espera(1500);
      const ocho = (et, n) => p.locator(`xpath=(//label[normalize-space(.)="${et}"])[${n + 1}]/parent::*`).locator("input:not([type=hidden]), select").first();
      await p.getByRole("button", { name: "Editar pasajero 1" }).click().catch(() => {}); await c.espera(500);
      await ocho("Nombres", 1).fill("Acompañante").catch(() => {}); await ocho("Apellidos", 1).fill("Tarifario16").catch(() => {});
      await ocho("Tipo doc", 1).selectOption("CC").catch(() => {}); await ocho("N° doc", 1).fill("900956017").catch(() => {});
      // La cotización del carrito se convierte con su propia pantalla: pide la moneda de cobro (una sola elección), el segundo pasajero y deja marcado quién viaja en cada unidad; el botón se llama «Generar contrato(s)».
      await p.getByLabel("Moneda de cobro").selectOption({ index: 1 }).catch(() => {});
      await ocho("Nacimiento", 0).fill("15/03/1985").catch(() => {}); await ocho("Nacimiento", 1).fill("20/08/1983").catch(() => {});
      await p.getByRole("button", { name: "Generar contrato(s)", exact: true }).click();
      const llego = await p.waitForURL(/\/dashboard\/contratos\/(?!nuevo)[^/?]+$/, { timeout: 150000 }).then(() => true, () => false);
      const numero = llego ? decodeURIComponent(new URL(p.url()).pathname.split("/").pop()) : "";
      c.check("la acción real creó el contrato", llego && /^DTM-/.test(numero) && Number(c.sql("select count(*) from public.ventas")) === antes + 1, p.url());
      const v = c.sql(`select precio_venta::bigint || '|' || estado from public.ventas where numero_contrato = '${numero}'`);
      c.check("el contrato nace por el total exacto de la opción B", v === "1040000|pendiente", v);
      const h = c.sql(`select nombre || '|' || categoria || '|' || alimentacion || '|' || coalesce(detalle_acomodacion, '') from public.contrato_hoteles where numero_contrato = '${numero}'`);
      c.check("el contrato conserva el hotel, la categoría, el plan y la habitación elegidos", h === "Hotel Beta 95T|Superior|Todo incluido|1 hab Doble (2 pax)", h);
      c.check("se congeló el resumen por pasajero (igual que el carrito normal)", c.sql(`select count(*) from public.contrato_resumen_precios where numero_contrato = '${numero}'`) === "1", "");
      await c.ir(`/contrato/${encodeURIComponent(numero)}`); await c.espera(2000);
      const t = await c.texto();
      c.check("el documento muestra el hotel, el plan y la tarifa por adulto con la asistencia incluida", /Hotel Beta 95T · Superior/.test(t) && /Alimentación: Todo incluido/.test(t) && /Paquete Turístico[^$]{0,30}2 0 \$\s?520\.000 \$\s?0 \$\s?1\.040\.000/.test(t), t.slice(0, 500));
      const valores = t.slice(t.indexOf("Valores y Pagos"), t.indexOf("CONTRATO DE PRESTACIÓN", t.indexOf("Valores y Pagos")));
      c.check("la asistencia se describe sin precio propio y no hay «Ajuste por redondeo»", /Asistencia médica 95T/.test(t) && !/Asistencia médica 95T[^$]{0,40}\$\s?80\.000/.test(t) && !/ajuste|redondeo/i.test(valores), valores.slice(0, 400));
    },
  },
];
