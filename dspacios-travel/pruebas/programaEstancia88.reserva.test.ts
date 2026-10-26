// Corre en test:unit (glob pruebas/**/*.test.ts) con el arnés en memoria de
// pruebas/support/fechaNegocioArnes.ts (el mismo de programaReservaPrecio57.test.ts).
//
// #88 — `reservarPrograma` REAL de un programa por hotel y vigencia con noches
// adicionales, contra la BD en memoria del arnés:
//   · paridad ficha (tablas de PVP) = formulario (cotizarEstanciaDesdePvp) = reserva = contrato = CxP;
//   · la selección, las vigencias y los precios usados quedan congelados en el contrato;
//   · el costo de las noches extra se registra UNA sola vez, en el proveedor correcto;
//   · el cambio de precio entre la vista previa y la confirmación exige aceptación expresa;
//   · lo que no se puede cotizar no escribe nada; los modos de siempre no cambian.
import { DIA_BOGOTA, MOMENTOS, asientos, reloj, soltarReloj, usarBD } from "./support/fechaNegocioArnes.ts";
import { DIAS, RPCS, base, entrada, hotel, noche, programa, semilla } from "./support/programaHotel88.ts";
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

const { reservarPrograma } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { cargarTablasPvp88 } = await import("../lib/programas/estanciaHotelDatos88.ts");
const { cotizarEstanciaDesdePvp } = await import("../lib/programas/precioReserva57.ts");
const { totalVisibleContratoItems } = await import("../lib/contrato/valorContratoItem.ts");

type Fila = Record<string, unknown>;
type BD = ReturnType<typeof usarBD>;
void base; void DIAS; void noche; void hotel; void programa;

beforeEach(() => reloj(MOMENTOS[0][1]));
afterEach(() => soltarReloj());

// Semillas y ayudas compartidas: ./support/programaHotel88.ts (USD, mk 15 %, fee 3 %, asistencia 4/día, 4 días / 3 noches; proveedor de asistencia 55; TRM de costos 4000).

/** Lo que muestra la ficha y calcula el formulario (solo PVP) para la selección. */
async function importeFicha(bd: BD, e: ReturnType<typeof entrada>) {
  const prog = bd.filas("programas")[0] as never;
  const r = await cargarTablasPvp88(bd.sb as never, 3, prog);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("tablas");
  assert.doesNotMatch(JSON.stringify(r.tablas), /neto/i, "la ficha jamás lleva netos");
  const tabla = r.tablas.find((t) => t.hotel.id === e.estancia.hotelId)!;
  const c = cotizarEstanciaDesdePvp(tabla, 3, {
    modalidad: e.estancia.modalidad, fechaEntrada: e.fechaIda, nochesAdicionales: e.estancia.nochesAdicionales,
    habitaciones: e.paxPorAcom, ninos: e.ninos,
  });
  return c;
}

const TABLAS_DE_ESCRITURA = [
  "ventas", "contrato_items", "contrato_hoteles", "contrato_pasajeros", "cuentas_por_pagar", "asientos_contables", "asiento_lineas",
  "aliados_b2b", "contrato_programa_estancia", "contrato_programa_estancia_costo",
];
function afirmarSinEscrituras(bd: BD) {
  for (const t of TABLAS_DE_ESCRITURA) assert.equal(bd.filas(t).length, 0, `no debe haber filas en ${t}`);
  assert.equal(bd.llamadasRpc.length, 0, "no debe haber RPC de escritura");
  const a = (globalThis as unknown as { __arnesFechas: { seq?: number } }).__arnesFechas;
  assert.equal(a.seq, undefined, "no se debe consumir un número de contrato");
}

async function reservar(bd: BD, e: ReturnType<typeof entrada>) {
  const c = await importeFicha(bd, e);
  assert.equal(c.ok, true, c.ok ? "" : c.error);
  if (!c.ok) throw new Error("cotización");
  const r = await reservarPrograma({ ...e, precioConfirmado: c.total });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { r, cotizado: c };
}

// ── Paridad ficha = formulario = reserva = contrato = CxP ──────────────────
for (const k of [0, 1, 3]) {
  test(`${k} noche(s) adicional(es): el importe de la ficha es el cobrado, el del contrato y la base de la CxP`, async () => {
    const bd = usarBD(semilla(), RPCS);
    const e = entrada({ nochesAdicionales: k });
    const { cotizado } = await reservar(bd, e);
    const esperadoPrecio = 1496 + [0, 254, 858][[0, 1, 3].indexOf(k)];
    const esperadoCosto = 1200 + [0, 200, 680][[0, 1, 3].indexOf(k)];
    assert.equal(cotizado.total, esperadoPrecio);

    const [venta] = bd.filas("ventas");
    assert.equal(venta.precio_venta, esperadoPrecio);
    assert.equal(venta.costo_receptivo, esperadoCosto);
    assert.equal(venta.pax, 2);
    // Fechas: ida + 3 noches incluidas + k adicionales (el regreso se desplaza).
    assert.equal(venta.fecha_salida, "2027-03-01");
    assert.equal(venta.fecha_regreso, ["2027-03-04", "2027-03-05", "2027-03-07"][[0, 1, 3].indexOf(k)]);

    // Contrato: la suma de las líneas visibles es el precio; base + noches, sin duplicar nada.
    const items = bd.filas("contrato_items") as never[];
    assert.equal(totalVisibleContratoItems(items), esperadoPrecio);
    const lineasNoches = items.filter((i: Fila) => i.modo_precio === "total");
    assert.equal(lineasNoches.length, k === 0 ? 0 : 1);
    assert.equal(items.filter((i: Fila) => i.modo_precio !== "total").length, 1, "la base no se repite");

    // CxP: UNA obligación (mismo proveedor) por la base + las noches, y UNA de asistencia por la estancia completa (4 USD × (4 + k) días × 2 pax).
    const cxp = bd.filas("cuentas_por_pagar");
    const asistencia = 4 * (4 + k) * 2;
    assert.equal(cxp.length, 2);
    const delPrograma = cxp.find((c) => c.tipo_proveedor === "programa")!;
    assert.equal(delPrograma.valor_total, esperadoCosto);
    assert.equal(cxp.find((c) => c.tipo_proveedor === "asistencia")?.valor_total, asistencia);
    assert.equal(venta.costo_asistencia, asistencia);
    assert.equal(cxp.reduce((s, c) => s + Number(c.valor_total), 0), Number(venta.costo_receptivo) + Number(venta.costo_asistencia));
    assert.equal(asientos(bd, "cxp").length, 2);
    assert.equal(delPrograma.fecha_obligacion, DIA_BOGOTA);
  });
}

test("el contrato congela hotel, modalidad, fechas exactas, vigencias, PVP por noche e itinerario desplazado (sin netos)", async () => {
  const bd = usarBD(semilla(), RPCS);
  await reservar(bd, entrada({ nochesAdicionales: 3 }));
  const [est] = bd.filas("contrato_programa_estancia");
  assert.equal(est.numero_contrato, bd.filas("ventas")[0].numero_contrato);
  assert.equal(est.hotel_nombre, "Hotel Centro");
  assert.equal(est.zona, "Centro");
  assert.equal(est.tipo_habitacion, "Estándar");
  assert.equal(est.modalidad_servicios, "privado");
  assert.equal(est.fecha_entrada, "2027-03-01");
  assert.equal(est.noches_incluidas, 3);
  assert.equal(est.noches_adicionales, 3);
  assert.equal(est.fecha_regreso, "2027-03-07");
  assert.deepEqual([est.base_vigencia_desde, est.base_vigencia_hasta], ["2027-03-01", "2027-03-31"]);
  assert.equal(est.precio_base, 1496);
  assert.equal(est.precio_noches, 858);
  const noches = est.noches as { fecha: string; vigencia_desde: string; vigencia_hasta: string; pvp_total: number }[];
  assert.deepEqual(noches.map((n) => n.fecha), ["2027-03-04", "2027-03-05", "2027-03-06"]);
  assert.deepEqual(noches.map((n) => [n.vigencia_desde, n.vigencia_hasta]), [["2027-03-01", "2027-03-04"], ["2027-03-05", "2027-03-31"], ["2027-03-05", "2027-03-31"]]);
  assert.deepEqual(noches.map((n) => n.pvp_total), [254, 302, 302]);
  assert.equal(noches.reduce((s, n) => s + n.pvp_total, 0), est.precio_noches);
  // Itinerario: días 1-3 intactos, 4-6 libres, recogida en el día 7 (desplazada 3).
  const it = est.itinerario as { dia: number; titulo: string; libre: boolean; fecha: string }[];
  assert.deepEqual(it.map((d) => [d.dia, d.titulo, d.libre]), [[1, "Llegada", false], [2, "Tour ciudad", false], [3, "Playa", false], [4, "Día libre", true], [5, "Día libre", true], [6, "Día libre", true], [7, "Salida", false]]);
  assert.equal(it.at(-1)!.fecha, est.fecha_regreso);
  assert.equal(it.filter((d) => d.titulo === "Tour ciudad").length, 1, "los tours no se duplican");
  assert.doesNotMatch(JSON.stringify(est), /neto/i, "la foto del contrato no lleva netos");
  // El hotel del contrato lleva sus fechas.
  const [ch] = bd.filas("contrato_hoteles");
  assert.equal(ch.nombre, "Hotel Centro");
  assert.equal(ch.fecha_ingreso, "2027-03-01");
  assert.equal(ch.fecha_salida, "2027-03-07");
});

test("el costo congelado cuadra con la CxP; la asistencia de las noches tiene su proveedor y su CxP, aparte de la del hotel", async () => {
  const bd = usarBD(semilla(), RPCS);
  await reservar(bd, entrada({ nochesAdicionales: 3 }));
  const [costo] = bd.filas("contrato_programa_estancia_costo");
  const delPrograma = bd.filas("cuentas_por_pagar").find((c) => c.tipo_proveedor === "programa")!;
  assert.equal(costo.neto_base, 1200);
  assert.equal(costo.neto_noches, 680);
  assert.equal(Number(costo.neto_base) + Number(costo.neto_noches), delPrograma.valor_total);
  // Asistencia: 4 USD × (4 días + 3 noches) × 2 pax = 56, de los cuales 24 son de las noches adicionales.
  assert.equal(costo.asistencia_total, 56);
  assert.equal(costo.asistencia_noches, 24);
  assert.equal(costo.proveedor_asistencia_id, 55);
  assert.equal(bd.filas("cuentas_por_pagar").filter((c) => c.tipo_proveedor === "asistencia").length, 1);
  const detalle = costo.detalle_noches as { fecha: string; neto_total: number }[];
  assert.equal(detalle.reduce((s, n) => s + n.neto_total, 0), costo.neto_noches);
});

test("OTRO proveedor para el hotel: las noches van en su propia obligación y la del programa conserva solo la base", async () => {
  const bd = usarBD(semilla({ programa_hoteles: [hotel({ proveedor_id: 77 })] }), RPCS);
  await reservar(bd, entrada({ nochesAdicionales: 3 }));
  const cxp = bd.filas("cuentas_por_pagar").filter((c) => c.tipo_proveedor === "programa");
  assert.equal(bd.filas("cuentas_por_pagar").length, 3, "programa + noches con otro proveedor + asistencia");
  assert.equal(cxp.length, 2);
  const [prog, noches] = cxp;
  assert.equal(prog.proveedor, "Operador Andes");
  assert.equal(prog.valor_total, 1200);
  assert.equal(noches.proveedor, "Hoteles Playa SAS");
  assert.equal(noches.valor_total, 680);
  assert.equal(noches.aplica_retencion, true);
  assert.match(String(noches.servicio), /Noches adicionales · Hotel Centro/);
  assert.equal(Number(prog.valor_total) + Number(noches.valor_total), bd.filas("ventas")[0].costo_receptivo, "el costo no se cuenta dos veces");
  assert.equal(asientos(bd, "cxp").length, 3, "un asiento por obligación");
  const [costo] = bd.filas("contrato_programa_estancia_costo");
  assert.equal(costo.proveedor_noches_id, 77);
  assert.equal(bd.filas("contrato_hoteles")[0].proveedor, "Hoteles Playa SAS");
});

test("0 noches con otro proveedor de hotel: no se crea obligación vacía", async () => {
  const bd = usarBD(semilla({ programa_hoteles: [hotel({ proveedor_id: 77 })] }), RPCS);
  await reservar(bd, entrada({ nochesAdicionales: 0 }));
  assert.equal(bd.filas("cuentas_por_pagar").filter((c) => c.tipo_proveedor === "programa").length, 1);
  assert.equal(bd.filas("cuentas_por_pagar").find((c) => c.tipo_proveedor === "programa")?.valor_total, 1200);
});

// ── Modalidades, acomodaciones, menores y fechas ───────────────────────────
test("servicios regulares: otra base; las noches son las mismas", async () => {
  const bd = usarBD(semilla(), RPCS);
  const { cotizado } = await reservar(bd, entrada({ modalidad: "regular", nochesAdicionales: 1 }));
  // (450 + 4×4)/0.8245 = 565,2 → 566 por persona; noche del 4/mar: 127 por persona.
  assert.equal(cotizado.total, 566 * 2 + 254);
  assert.equal(bd.filas("contrato_programa_estancia")[0].modalidad_servicios, "regular");
  assert.equal(bd.filas("contrato_items").find((i) => i.modo_precio !== "total")?.descripcion, "1 hab Doble (2 pax) · Hotel Centro · Servicios regulares");
});

test("cambio de acomodación y de fecha de entrada: la reserva sigue a la ficha", async () => {
  for (const [paxPorAcom, fechaIda] of [[{ sencilla: 1 }, "2027-03-02"], [{ triple: 1, doble: 1 }, "2027-03-10"]] as const) {
    const bd = usarBD(semilla(), RPCS);
    const e = entrada({ nochesAdicionales: 2 }, { paxPorAcom: { ...paxPorAcom }, fechaIda });
    const { cotizado } = await reservar(bd, e);
    assert.equal(bd.filas("ventas")[0].precio_venta, cotizado.total);
    assert.equal(totalVisibleContratoItems(bd.filas("contrato_items") as never[]), cotizado.total);
    assert.equal(bd.filas("ventas")[0].costo_receptivo, bd.filas("cuentas_por_pagar").filter((c) => c.tipo_proveedor === "programa").reduce((s, c) => s + Number(c.valor_total), 0));
  }
});

test("menores: con tarifa adicional explícita se cobran por noche; sin ella la selección no se cotiza ni se reserva", async () => {
  const bd = usarBD(semilla(), RPCS);
  const e = entrada({ nochesAdicionales: 1 }, { ninos: 1 });
  const { cotizado } = await reservar(bd, e);
  // base: 1496 + menor 505; noche del 4/mar: 254 + menor 78.
  assert.equal(cotizado.total, 1496 + 505 + 254 + 78);
  assert.equal(bd.filas("ventas")[0].pax, 3);

  const sin = usarBD(semilla({ programa_hotel_noches: [noche({ neto_nino: null })] }), RPCS);
  const c = await importeFicha(sin, e);
  assert.equal(c.ok, false);
  const r = await reservarPrograma({ ...e, precioConfirmado: 1 });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /tarifa adicional de menor/);
  afirmarSinEscrituras(sin);
});

test("dos hoteles: cada reserva usa SU base y SUS noches", async () => {
  const bd = usarBD(semilla({
    programa_hoteles: [hotel(), hotel({ id: 2, nombre: "Hotel Playa", orden: 1, zona: "Playa" })],
    programa_hotel_precios: [base(), base({ id: 3, hotel_id: 2, neto_doble: 700 })],
    programa_hotel_noches: [noche({ desde: "2027-03-01", hasta: "2027-03-31" }), noche({ id: 4, hotel_id: 2, desde: "2027-03-01", hasta: "2027-03-31", unidad_cobro: "habitacion", neto_doble: 180 })],
  }), RPCS);
  const { cotizado } = await reservar(bd, entrada({ hotelId: 2, nochesAdicionales: 2 }));
  // Base 700 → (716/0.8245=868,4) 869 × 2; noches por HABITACIÓN: (180 + 4×2)/0.8245 = 228,0 → 229 × 2 noches.
  assert.equal(cotizado.total, 869 * 2 + 229 * 2);
  assert.equal(bd.filas("contrato_programa_estancia")[0].hotel_nombre, "Hotel Playa");
  assert.equal(bd.filas("contrato_programa_estancia")[0].zona, "Playa");
});

// ── Lo que no se puede cotizar no escribe nada ─────────────────────────────
test("sin tarifa para una fecha extra, solapadas, sin base o hotel ajeno: se rechaza SIN escribir y sin numerar", async () => {
  const corta = usarBD(semilla({ programa_hotel_noches: [noche({ desde: "2027-03-01", hasta: "2027-03-05" })] }), RPCS);
  const r1 = await reservarPrograma({ ...entrada({ nochesAdicionales: 3 }), precioConfirmado: 1 });
  assert.equal(r1.ok, false);
  assert.match(r1.ok ? "" : r1.error, /06\/03\/2027/);
  afirmarSinEscrituras(corta);

  const solape = usarBD(semilla({ programa_hotel_noches: [noche(), noche({ id: 2, desde: "2027-03-04", hasta: "2027-03-31" })] }), RPCS);
  const r2 = await reservarPrograma({ ...entrada({ nochesAdicionales: 1 }), precioConfirmado: 1 });
  assert.equal(r2.ok, false);
  assert.match(r2.ok ? "" : r2.error, /a la vez/);
  afirmarSinEscrituras(solape);

  const sinBase = usarBD(semilla(), RPCS);
  const r3 = await reservarPrograma({ ...entrada({ nochesAdicionales: 0 }, { fechaIda: "2027-05-10" }), precioConfirmado: 1 });
  assert.equal(r3.ok, false);
  afirmarSinEscrituras(sinBase);

  const ajeno = usarBD(semilla(), RPCS);
  const r4 = await reservarPrograma({ ...entrada({ hotelId: 999 }), precioConfirmado: 1 });
  assert.equal(r4.ok, false);
  afirmarSinEscrituras(ajeno);

  const mala = usarBD(semilla(), RPCS);
  for (const k of [-1, 1.5, 31]) {
    const r = await reservarPrograma({ ...entrada({ nochesAdicionales: k }), precioConfirmado: 1 });
    assert.equal(r.ok, false, `k=${k}`);
  }
  afirmarSinEscrituras(mala);

  // Días y noches incoherentes (o sin días): no se adivina cuál vale.
  for (const prog of [programa({ noches: 5 }), programa({ dias: null, noches: null })]) {
    const incoherente = usarBD(semilla({ programas: [prog] }), RPCS);
    const rI = await reservarPrograma({ ...entrada({ nochesAdicionales: 0 }), precioConfirmado: 1 });
    assert.equal(rI.ok, false);
    assert.match(rI.ok ? "" : rI.error, /días/);
    afirmarSinEscrituras(incoherente);
  }

  const sinEstancia = usarBD(semilla(), RPCS);
  const r5 = await reservarPrograma({ ...entrada(), estancia: undefined, precioConfirmado: 1 });
  assert.equal(r5.ok, false);
  afirmarSinEscrituras(sinEstancia);
});

test("ocupación inválida (más menores de los que admite el hotel) se rechaza sin escribir", async () => {
  const bd = usarBD(semilla({ programa_hoteles: [hotel({ max_pax_habitacion: 6 })] }), RPCS);
  const r = await reservarPrograma({ ...entrada({ nochesAdicionales: 1 }, { ninos: 3 }), precioConfirmado: 1 });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /máximo 2 menor/);
  afirmarSinEscrituras(bd);
});

// ── Cambio de precio entre la vista previa y la confirmación ───────────────
test("si la tarifa cambia entre la vista previa y la confirmación: no se crea nada hasta aceptar el nuevo importe", async () => {
  const bd = usarBD(semilla(), RPCS);
  const e = entrada({ nochesAdicionales: 1 });
  const vista = await importeFicha(bd, e);
  assert.ok(vista.ok);
  const confirmado = vista.ok ? vista.total : 0;
  assert.equal(confirmado, 1750);
  // El proveedor sube la tarifa de la noche (100 → 110 neto: (114/0.8245)=138,3 → 139 por persona).
  bd.filas("programa_hotel_noches")[0].neto_doble = 110;
  const r = await reservarPrograma({ ...e, precioConfirmado: confirmado });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && "cambioPrecio" in r);
  if (!r.ok && "cambioPrecio" in r) assert.deepEqual(r.cambioPrecio, { anterior: 1750, nuevo: 1496 + 278, moneda: "USD" });
  afirmarSinEscrituras(bd);
  // También cambia si se piden más noches con el importe viejo.
  const r2 = await reservarPrograma({ ...entrada({ nochesAdicionales: 2 }), precioConfirmado: 1774 });
  assert.ok(!r2.ok && "cambioPrecio" in r2);
  afirmarSinEscrituras(bd);
  // Solo el importe vigente, aceptado de forma expresa, crea el contrato.
  const ok = await reservarPrograma({ ...e, precioConfirmado: 1496 + 278 });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(bd.filas("ventas")[0].precio_venta, 1774);
  assert.equal(bd.filas("contrato_programa_estancia")[0].precio_noches, 278);
});

test("un contrato ya reservado NO se recalcula si el catálogo cambia después", async () => {
  const bd = usarBD(semilla(), RPCS);
  await reservar(bd, entrada({ nochesAdicionales: 1 }));
  const antes = JSON.stringify([bd.filas("ventas"), bd.filas("contrato_items"), bd.filas("contrato_programa_estancia"), bd.filas("contrato_programa_estancia_costo"), bd.filas("cuentas_por_pagar")]);
  bd.filas("programa_hotel_noches")[0].neto_doble = 999;
  bd.filas("programa_hotel_precios")[0].neto_doble = 999;
  bd.filas("programas")[0].pct_mk = 0.4;
  const despues = JSON.stringify([bd.filas("ventas"), bd.filas("contrato_items"), bd.filas("contrato_programa_estancia"), bd.filas("contrato_programa_estancia_costo"), bd.filas("cuentas_por_pagar")]);
  assert.equal(despues, antes);
});

// ── Los modos de siempre no cambian ────────────────────────────────────────
test("un programa por salida ignora la selección de estancia: sin foto, sin costo, mismo precio de siempre", async () => {
  const bd = usarBD({
    programas: [programa({ modo_precio: "salida" })],
    programa_salidas: [{
      id: 11, programa_id: 3, orden: 0, etiqueta: "Marzo", fecha_desde: "2027-03-01", fecha_hasta: "2027-03-08", noches: null, columna: null,
      bajo_solicitud: false, neto_sencilla: null, neto_doble: 1000, neto_triple: null, neto_multiple: null, neto_nino: null,
      tarifa_sencilla: null, tarifa_doble: null, tarifa_triple: null, tarifa_multiple: null,
      impuesto_sencilla: null, impuesto_doble: null, impuesto_triple: null, impuesto_multiple: null,
    }],
    programa_categorias: [], programa_precios: [],
  }, RPCS);
  const r = await reservarPrograma({ ...entrada({ nochesAdicionales: 5 }), categoriaId: 11, salidaId: 11, precioConfirmado: 2466 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("ventas")[0].precio_venta, 2466);
  assert.equal(bd.filas("contrato_programa_estancia").length, 0);
  assert.equal(bd.filas("contrato_programa_estancia_costo").length, 0);
  assert.equal(bd.filas("cuentas_por_pagar").length, 1);
});

// ── Confirmar la venta no duplica el costo ─────────────────────────────────
test("confirmar la venta (asegurarCuentasPorPagar) NO crea una CxP duplicada por el mismo costo del programa y sus noches", async () => {
  const { asegurarCuentasPorPagar } = await import("../lib/reservar/asegurarCuentasPorPagar.ts");
  const bd = usarBD(semilla(), RPCS);
  await reservar(bd, entrada({ nochesAdicionales: 3 }));
  const antes = bd.filas("cuentas_por_pagar").map((c) => ({ ...c }));
  const r = await asegurarCuentasPorPagar(String(bd.filas("ventas")[0].numero_contrato));
  assert.equal(r.ok, true, JSON.stringify(r));
  const despues = bd.filas("cuentas_por_pagar");
  assert.equal(despues.length, antes.length, `la confirmación creó ${despues.length - antes.length} CxP extra: ${JSON.stringify(despues.slice(antes.length).map((c) => [c.tipo_proveedor, c.valor_total]))}`);
  assert.equal(despues.reduce((s, c) => s + Number(c.valor_total), 0), Number(bd.filas("ventas")[0].costo_receptivo) + Number(bd.filas("ventas")[0].costo_asistencia), "la suma de las CxP sigue siendo el costo del contrato (hotel/programa + asistencia)");
});
