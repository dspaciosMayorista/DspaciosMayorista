// Se ejecuta con npm run test:react (loader del arnés).
//
// Fechas de negocio en reservar/actions.ts y contratos/actions.ts — reloj fijo
// antes y después de las 7 p. m. de Bogotá del 30-sep. Código REAL contra la BD
// en memoria del arnés (asientos reales de lib/contabilidad/asientos.ts):
//   · reservarPrograma: condición de pago congelada (`fechaPagoCond`) y CxP del
//     programa + su asiento (`fechaProg`). El 30-sep es el día LÍMITE del saldo
//     (viaje 30-oct, saldo a 30 días): pagar ese día exige el anticipo (30%);
//     con el "hoy" UTC de antes, a las 19:30 ya era 1-oct y exigía el 100%.
//   · crearContrato (contrato manual): CxP + asiento con la fecha de emisión
//     elegida en el formulario, o el día de Bogotá si viene vacía (`hoyCxP`).
//   · actualizarServiciosContrato: CxP nueva y asiento re-posteado de una CxP
//     existente con el día de la edición (`hoyCxp`); la fecha de obligación de
//     la CxP existente no se toca.
// Fuera de alcance aquí: reservarDesdeTarifario (motor de precios completo; su
// `fechaPagoCond`/`hoyISO` usan la misma función y lo cubre la guarda de
// cableado de pruebas/fechaNegocio.test.ts) y el carrito (pendiente separado).
import { DIA_BOGOTA, DESPUES_DEL_CORTE, MOMENTOS, asientos, reloj, soltarReloj, usarBD } from "./support/fechaNegocioArnes.ts";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

const { reservarPrograma } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { crearContrato, actualizarServiciosContrato } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");

afterEach(() => soltarReloj());

// ── reservarPrograma ───────────────────────────────────────────────────────
const semillaPrograma = () => ({
  programas: [{
    id: 3, nombre: "Circuito Andino", subtitulo: null, moneda: "COP", pct_mk: 0.1, pct_fee_tarjeta: 0,
    asistencia_medica_dia: 0, modo_precio: "categoria", dias: 5, noches: 4, proveedor_id: 9,
    vigencia_desde: null, vigencia_hasta: null, edad_nino_max: 11, edad_infante_max: 1,
    condicion_pago_tipo: "anticipo_saldo", condicion_pago_pct_inicial: 0.3, condicion_pago_dias_saldo: 30,
    restriccion_comercial: "normal",
    proveedores: { nombre: "Operador Andes", aplica_retencion: false, pct_retencion: 0 },
  }],
  programa_categorias: [{ id: 5, programa_id: 3, nombre: "Turista" }],
  programa_precios: [{ categoria_id: 5, acomodacion: "doble", neto: 1_000_000, bajo_solicitud: false }],
  // PR #409: reservar exige el itinerario completo (días 1..N del programa, aquí 5).
  programa_dias: [1, 2, 3, 4, 5].map((dia) => ({ programa_id: 3, dia, titulo: `Día ${dia}`, desayuno: false, almuerzo: false, cena: false, descripcion: "x" })),
});
const inputPrograma = {
  programaId: 3, categoriaId: 5, fechaIda: "2026-10-30", paxPorAcom: { doble: 1 }, ninos: 0,
  cliente: { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "1010", telefono: "300", email: "" },
  tipoAsesor: "interno" as const, asesorInterno: "Asesor", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
  plazo: "2026-10-10", pasajeros: [],
  // #57: el importe que el usuario confirmó (1 hab. doble = 2 pax × 1.112.000: neto 1.000.000, mk 10 %).
  precioConfirmado: 2_224_000,
};

for (const [momento, instante] of MOMENTOS) {
  test(`reservarPrograma a las ${momento}, día límite del saldo: exige el anticipo (30%) y la CxP y su asiento llevan ${DIA_BOGOTA}`, async () => {
    reloj(instante);
    const bd = usarBD(semillaPrograma(), { congelar_condiciones_contrato: () => "OK" });
    const r = await reservarPrograma(inputPrograma);
    assert.equal(r.ok, true, JSON.stringify(r));

    const congelar = bd.llamadasRpc.find((c) => c.fn === "congelar_condiciones_contrato");
    assert.ok(congelar, "se congelaron las condiciones de pago");
    const [fila] = congelar!.args.p_snapshot as Array<{ valor_componente: number; monto_exigido: number; condicion_pago_pct_aplicable: number | null }>;
    // Límite del saldo = viaje (30-oct) − 30 días = 30-sep. Pagar ESE día aún
    // admite el anticipo; desde el día siguiente se exige el 100% (bump de cierre).
    assert.equal(fila.condicion_pago_pct_aplicable, 0.3, "% de anticipo configurado del programa");
    assert.ok(Math.abs(fila.monto_exigido - fila.valor_componente * 0.3) < 1, `monto exigido = 30% (${fila.monto_exigido} de ${fila.valor_componente})`);

    const [cxp] = bd.filas("cuentas_por_pagar");
    assert.equal(cxp?.tipo_proveedor, "programa");
    assert.equal(cxp?.fecha_obligacion, DIA_BOGOTA, "fecha de obligación de la CxP del programa");
    assert.equal(asientos(bd, "cxp")[0]?.fecha, DIA_BOGOTA, "asiento de la CxP");
  });
}

// ── crearContrato (contrato manual) ────────────────────────────────────────
function contratoManual(fechaEmision: string) {
  return {
    tipoPaquete: "dinamico" as const, paqueteId: null, bloqueoId: null,
    cliente: "Ana Ruiz", clienteDocumento: "CC 1010", clienteTelefono: "300", clienteDireccion: "",
    destino: "CARTAGENA", fechaSalida: "2026-11-01", fechaRegreso: "2026-11-04", fechaEmision,
    asistenciaMedica: false, planNombre: "", toursTraslados: "",
    asesorNombre: "Asesor", asesorCargo: "Asesora", asesorCc: "1", asesorTel: "300",
    pasajeros: [],
    hoteles: [{
      nombre: "Hotel Sol", categoria: "Estándar", proveedor: "Operador Sol", ciudad: "Cartagena", alimentacion: "PC",
      acomodacion: "Doble", detalleAcomodacion: "", fechaIngreso: "2026-11-01", fechaSalida: "2026-11-04", costo: 1_000_000,
    }],
    vuelos: [],
    items: [{ descripcion: "Paquete Cartagena", adultos: 2, ninos: 0, tarifaAdulto: 1_500_000, tarifaNino: 0 }],
    tipoVenta: "interno" as const,
  };
}

for (const [momento, instante] of MOMENTOS) {
  test(`contrato manual a las ${momento} sin fecha de emisión: CxP del hotel y su asiento con ${DIA_BOGOTA}`, async () => {
    reloj(instante);
    const bd = usarBD();
    const r = await crearContrato(contratoManual(""));
    assert.equal(r.ok, true, JSON.stringify(r));
    const [cxp] = bd.filas("cuentas_por_pagar");
    assert.equal(cxp?.tipo_proveedor, "hotel");
    assert.equal(cxp?.fecha_obligacion, DIA_BOGOTA);
    assert.equal(asientos(bd, "cxp")[0]?.fecha, DIA_BOGOTA);
  });
}

test("contrato manual a las 19:30 con fecha de emisión elegida: CxP y asiento la conservan", async () => {
  reloj(DESPUES_DEL_CORTE);
  const bd = usarBD();
  const r = await crearContrato(contratoManual("2026-09-15"));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("cuentas_por_pagar")[0]?.fecha_obligacion, "2026-09-15");
  assert.equal(asientos(bd, "cxp")[0]?.fecha, "2026-09-15");
});

// ── actualizarServiciosContrato ────────────────────────────────────────────
const semillaServicios = (cxpExistente: boolean) => ({
  ventas: [{
    numero_contrato: "DTM-0451", tenant: "mayorista", moneda: "COP", estado: "pendiente", pax: 2, precio_venta: 3_000_000,
    paquete_armado_id: 7, fecha_salida: "2026-11-01", fecha_regreso: "2026-11-04", plazo: "2026-10-15",
  }],
  // SIN «GENERAL»: el servicio se vende y se costea desde una vigencia que cubre la fecha de salida (misma re-liquidación que la búsqueda y el carrito).
  tarifario_resultado_publicable: [{ paquete_id: 7, modulo: "servicios", paquete_activo: true, servicio_id: 11, servicio_nombre: "Tour bahía", destino_nombre: "CARTAGENA", descripcion: null, tipo_tarifa: "persona", precio_pvp: 150_000 }],
  armado_paquetes: [{ id: 7, pct_mk: 0.2 }],
  servicios_adicionales: [{ id: 11, precio_persona: null, recargo_individual: null, liquidacion: null, moneda: "COP", categoria: "tour", proveedor_id: null }],
  servicio_temporadas: [{ servicio_id: 11, nombre: "VIG", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: 100_000, precio_infante: null, recargo_individual: null }],
  servicio_tarifa_pax: [], contrato_vuelos: [],
  armado_servicios: [{
    paquete_id: 7, servicio_id: 11, modo: "persona",
    servicios_adicionales: { precio_persona: 100_000, categoria: "tour", nombre: "Tour bahía", liquidacion: null, proveedores: { nombre: "Operador Bahía", aplica_retencion: false, pct_retencion: 0 } },
  }],
  cuentas_por_pagar: cxpExistente
    ? [{ id: 70, numero_contrato: "DTM-0451", tenant: "mayorista", servicio_id: 11, tipo_proveedor: "receptivo", proveedor: "Operador Bahía", servicio: "Tour bahía", valor_total: 150_000, fecha_obligacion: "2026-09-01" }]
    : [],
});

for (const [momento, instante] of MOMENTOS) {
  test(`editar servicios a las ${momento}: CxP nueva y su asiento con ${DIA_BOGOTA}`, async () => {
    reloj(instante);
    const bd = usarBD(semillaServicios(false));
    const r = await actualizarServiciosContrato("DTM-0451", [11]);
    assert.equal(r.ok, true, JSON.stringify(r));
    const [cxp] = bd.filas("cuentas_por_pagar");
    assert.equal(cxp?.servicio_id, 11);
    assert.equal(cxp?.fecha_obligacion, DIA_BOGOTA);
    assert.equal(asientos(bd, "cxp")[0]?.fecha, DIA_BOGOTA);
  });
}

test("editar servicios a las 19:30 con CxP existente: el asiento se re-postea con el día de Bogotá; la obligación original no cambia", async () => {
  reloj(DESPUES_DEL_CORTE);
  const bd = usarBD(semillaServicios(true));
  const r = await actualizarServiciosContrato("DTM-0451", [11]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const cxp = bd.filas("cuentas_por_pagar").find((c) => c.id === 70);
  assert.equal(cxp?.fecha_obligacion, "2026-09-01", "la fecha de obligación existente no se reescribe");
  const cx = asientos(bd, "cxp");
  assert.equal(cx.length, 1);
  assert.equal(cx[0].referencia, "cxp:70");
  assert.equal(cx[0].fecha, DIA_BOGOTA, "regla vigente: el asiento lleva el día de la edición (calculado en Bogotá)");
});

// ── 255 · editar servicios de un contrato PENDIENTE: SIN «GENERAL» y con horario de traslado ─────────────────────────────────────────────────────────
// DEFECTO anterior: el precio salía del tarifario publicado (con rango más alto como respaldo) y el costo del precio base GENERAL del servicio, sin importar si
// había vigencia, rango u hora. AHORA: la misma re-liquidación que la búsqueda y el carrito (vigencia + rango + suplemento horario + margen) y el costo de la
// CxP con la misma función; lo que falte rechaza la edición sin escribir nada.
const FRANJA_NOCTURNA = { id: 1, hora_desde: "19:00", hora_hasta: "06:00", tramo: "llegada", tipo: "monto", valor: 40_000, cobro: "grupo" };
function semillaTraslado(opts: { vigencia?: boolean; franja?: boolean; horaLlegada?: string | null }) {
  const base = semillaServicios(false);
  return {
    ...base,
    servicio_temporadas: opts.vigencia === false ? [] : [{
      ...(base.servicio_temporadas[0] as Record<string, unknown>), id: 501,
      ...(opts.franja ? { servicio_suplementos_franja: [FRANJA_NOCTURNA] } : {}),
    }],
    contrato_vuelos: opts.horaLlegada ? [{ numero_contrato: "DTM-0451", direccion: "ida", hora_llegada: opts.horaLlegada, hora_salida: null, orden: 1 }] : [],
  };
}

test("255 · servicio solo con precio GENERAL (sin vigencia): se rechaza la edición y NO se escribe nada", async () => {
  reloj(DESPUES_DEL_CORTE);
  const bd = usarBD(semillaTraslado({ vigencia: false }));
  const r = await actualizarServiciosContrato("DTM-0451", [11]);
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /vigencia de tarifa/i);
  assert.equal(bd.filas("cuentas_por_pagar").length, 0, "no se crea ninguna CxP");
  assert.equal(bd.filas("ventas")[0]?.precio_venta, 3_000_000, "el precio del contrato no cambia");
});

test("255 · traslado con franja nocturna y SIN hora capturada: se pide la hora (no se cotiza supuesta) y no se escribe nada", async () => {
  reloj(DESPUES_DEL_CORTE);
  const bd = usarBD(semillaTraslado({ franja: true, horaLlegada: null }));
  const r = await actualizarServiciosContrato("DTM-0451", [11]);
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /hora de llegada/i);
  assert.equal(bd.filas("cuentas_por_pagar").length, 0);
  assert.equal(bd.filas("ventas")[0]?.precio_venta, 3_000_000);
});

test("255 · traslado con franja y hora nocturna (21:15): precio, ítem y CxP llevan el MISMO suplemento neto y el mismo margen", async () => {
  reloj(DESPUES_DEL_CORTE);
  const bd = usarBD(semillaTraslado({ franja: true, horaLlegada: "21:15" }));
  const r = await actualizarServiciosContrato("DTM-0451", [11]);
  assert.equal(r.ok, true, JSON.stringify(r));
  // Costo neto: 100.000 × 2 pax + 40.000 de suplemento = 240.000 (CxP al proveedor). Venta: 240.000 / (1 − 0,2) = 300.000.
  const [cxp] = bd.filas("cuentas_por_pagar");
  assert.equal(cxp?.valor_total, 240_000);
  assert.equal(bd.filas("ventas")[0]?.precio_venta, 3_000_000 + 300_000);
  const item = bd.filas("contrato_items").find((i) => String(i.descripcion).startsWith("Servicio · "));
  assert.equal(item?.tarifa_adulto, 300_000);
});

test("255 · el mismo traslado con hora diurna (14:00) no lleva suplemento: 200.000 de costo y 250.000 de venta", async () => {
  reloj(DESPUES_DEL_CORTE);
  const bd = usarBD(semillaTraslado({ franja: true, horaLlegada: "14:00" }));
  const r = await actualizarServiciosContrato("DTM-0451", [11]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("cuentas_por_pagar")[0]?.valor_total, 200_000);
  assert.equal(bd.filas("ventas")[0]?.precio_venta, 3_000_000 + 250_000);
});
