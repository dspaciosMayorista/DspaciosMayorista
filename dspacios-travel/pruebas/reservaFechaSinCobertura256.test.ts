import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFalso, type TablasFalsas } from "./support/fakeSupabase.ts";

// 256 — RESERVA DIRECTA (computarReserva real, cliente falso) en una fecha SIN cobertura. El tarifario publicado puede traer filas viejas o con el servicio
// «parcialmente disponible»: la reserva re-valida SIEMPRE contra las vigencias vivas de la fecha pedida y rechaza ANTES de numerar. Las fechas cubiertas se venden.
//   · opcional: la vigencia cubre solo el tramo 01–10/09; el viaje del paquete es todo septiembre. Antes de la 256 la referencia exigía el viaje completo
//     (rechazaba TAMBIÉN las fechas cubiertas); ahora vende el 05/09 y rechaza el 17/09.
//   · incluido: forma parte del precio del hotel; sin vigencia en la fecha de ida no se vende ese hotel (jamás sin el servicio).

const HOTEL_ID = 217;
const PAQUETE_ID = 50;
const OPCIONAL = 8;
const INCLUIDO = 9;
const INCLUIDO2 = 10; // asistencia incluida SIN vigencias y con tarifa base 100 → tarifa permanente (aplica en cualquier fecha)
const TRASLADO_SIN_VIG = 11; // traslado incluido sin vigencias aunque tenga base: sigue exigiendo vigencia
const ASIST_SIN_BASE = 12; // asistencia incluida sin vigencias NI tarifa base válida: se rechaza
const S50 = 50, S112 = 112, T132 = 132, T133 = 133; // los cuatro del «Incluye» manual: 50 y 112 con vigencia 01–10/09; 132 y 133 (traslados) sin ninguna
const ASIST_CON_VIG = 13; // asistencia con vigencia 01–10/09: respeta SU vigencia, la base no rellena el hueco

const tablas: TablasFalsas = {
  hoteles: [{
    id: HOTEL_ID, modelo_tarifario: "persona", nombre: "Hotel prueba", moneda: "COP",
    edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12,
    pax_min: 1, pax_max: 6, nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null,
    adults_only: false, pet_friendly: false,
  }],
  armado_paquetes: [{ id: PAQUETE_ID, pct_mk: 0, impuesto_fijo: 0, destino_id: 1, fecha_viaje_inicio: "2026-09-01", fecha_viaje_fin: "2026-09-30" }],
  destinos: [{ id: 1, nombre: "SAN ANDRÉS" }],
  armado_hoteles: [{ paquete_id: PAQUETE_ID, hotel_id: HOTEL_ID, categorias: null, regimenes: null }],
  hotel_temporadas: [{
    id: 1, hotel_id: HOTEL_ID, nombre: "Base", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31",
    prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null,
    rangos: null, blackouts: null, min_noches: null, regimen_restringido: null,
    condicion_pago_tipo: null, condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null,
  }],
  tarifa_hotel: [{
    id: 10, hotel_id: HOTEL_ID, tipo_habitacion: "Estándar", alimentacion: "PAE", temporada: "Base",
    neto_sencilla: null, neto_doble: 300000, neto_triple: 250000, neto_multiple: null,
    neto_nino: null, neto_nino2: null, neto_infante: null, nota_infante: null,
    notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null,
    precio_final_autoritativo: false,
  }],
  hotel_blackouts: [],
  hotel_acomodaciones: [
    { hotel_id: HOTEL_ID, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 },
  ],
  armado_servicios: [],
  servicios_adicionales: [
    { id: OPCIONAL, nombre: "Tour parcial", categoria: "tour_traslado", proveedor_id: null, moneda: "COP", precio_persona: null, precio_infante: null, recargo_individual: null, liquidacion: null },
    { id: INCLUIDO2, nombre: "Asistencia 1 incluida", categoria: "asistencia", proveedor_id: null, moneda: "COP", precio_persona: 100, precio_infante: null, recargo_individual: null, liquidacion: null },
    { id: TRASLADO_SIN_VIG, nombre: "Traslado sin vigencia", categoria: "tour_traslado", proveedor_id: null, moneda: "COP", precio_persona: 100, precio_infante: null, recargo_individual: null, liquidacion: null },
    { id: ASIST_SIN_BASE, nombre: "Asistencia sin base", categoria: "asistencia", proveedor_id: null, moneda: "COP", precio_persona: null, precio_infante: null, recargo_individual: null, liquidacion: null },
    { id: ASIST_CON_VIG, nombre: "Asistencia con vigencia", categoria: "asistencia", proveedor_id: null, moneda: "COP", precio_persona: 100, precio_infante: null, recargo_individual: null, liquidacion: null },
    { id: S50, nombre: "Servicio 50", categoria: "tour_traslado", proveedor_id: 1, moneda: "COP", precio_persona: null, precio_infante: null, recargo_individual: null, liquidacion: null },
    { id: S112, nombre: "Servicio 112", categoria: "tour_traslado", proveedor_id: 1, moneda: "COP", precio_persona: null, precio_infante: null, recargo_individual: null, liquidacion: null },
    { id: T132, nombre: "Traslado 132", categoria: "tour_traslado", proveedor_id: 1, moneda: "COP", precio_persona: 10, precio_infante: null, recargo_individual: null, liquidacion: null },
    { id: T133, nombre: "Traslado 133", categoria: "tour_traslado", proveedor_id: 1, moneda: "COP", precio_persona: 10, precio_infante: null, recargo_individual: null, liquidacion: null },
    { id: INCLUIDO, nombre: "Seguro incluido", categoria: "asistencia", proveedor_id: null, moneda: "COP", precio_persona: null, precio_infante: null, recargo_individual: null, liquidacion: null },
  ],
  servicio_temporadas: [],
  servicio_tarifa_pax: [],
  tarifario_resultado_publicable: [],
};

const JOINS = {
  armado_paquetes: { destinos: "destino_id" },
  armado_hoteles: { hoteles: "hotel_id" },
  armado_servicios: { servicios_adicionales: "servicio_id" },
};

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

const admin = crearClienteFalso(tablas, { joins: JOINS });
const sb = crearClienteFalso(tablas, { joins: JOINS });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => admin } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => { throw new Error("createClient() real NUNCA debe invocarse: sb se inyecta."); } } });

const { computarReserva } = await import("@/lib/reservar/computo.ts");

const pax = (n: number) => ({ nombres: `P${n}`, apellidos: "Prueba", tipoDoc: "CC", numeroDoc: `10${n}`, fechaNacimiento: "1990-01-01", nacionalidad: "CO", esInfante: false });
const base = (fechaIda: string, fechaRegreso: string, servicios: number[]) => ({
  paqueteId: PAQUETE_ID, bloqueoId: null, modulo: "porcion_terrestre" as const,
  hotelId: HOTEL_ID, fechaIda, fechaRegreso,
  categoria: "Estándar", regimen: "PAE",
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0,
  servicios,
  cliente: { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", telefono: "300", email: "a@a.com" },
  tipoAsesor: "interno" as const, asesorInterno: "Asesor Uno", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
  plazo: "24 horas",
  pasajeros: [1, 2].map(pax),
});

const vigencia = (servicio_id: number, nombre: string, ini: string, fin: string, precio: number) => ({
  id: servicio_id * 10, servicio_id, nombre, fecha_inicio: ini, fecha_fin: fin, compra_inicio: null, compra_fin: null, prioridad: 1,
  precio_persona: precio, precio_infante: null, recargo_individual: null,
});
const fila = (servicio_id: number, nombre: string, precio: number) => ({
  paquete_id: PAQUETE_ID, modulo: "servicios", servicio_id, servicio_nombre: nombre, tipo_tarifa: "persona",
  pax_desde: null, pax_hasta: null, precio_pvp: precio, precio_pvp_menor2: null, recargo_individual: null,
});

function correr(o: { opcional?: boolean; incluido?: boolean; incluido2?: boolean; extra?: number[]; ida: string; reg: string }) {
  tablas.armado_servicios = [
    ...(o.extra ?? []).map((id) => ({ paquete_id: PAQUETE_ID, servicio_id: id, modo: "persona", incluido: true })),
    ...(o.incluido2 ? [{ paquete_id: PAQUETE_ID, servicio_id: INCLUIDO2, modo: "persona", incluido: true }] : []),
    ...(o.opcional ? [{ paquete_id: PAQUETE_ID, servicio_id: OPCIONAL, modo: "persona", incluido: false }] : []),
    ...(o.incluido ? [{ paquete_id: PAQUETE_ID, servicio_id: INCLUIDO, modo: "persona", incluido: true }] : []),
  ];
  // Cada servicio tiene vigencia SOLO del 01 al 10 de septiembre (el viaje del paquete es todo septiembre).
  tablas.servicio_temporadas = [vigencia(OPCIONAL, "V1", "2026-09-01", "2026-09-10", 80000), vigencia(INCLUIDO, "V1", "2026-09-01", "2026-09-10", 20000), vigencia(ASIST_CON_VIG, "V1", "2026-09-01", "2026-09-10", 100), vigencia(S50, "V1", "2026-09-01", "2026-09-10", 30000), vigencia(S112, "V1", "2026-09-01", "2026-09-10", 87000)];
  // Snapshot «viejo»: sigue trayendo el opcional publicado aunque la fecha pedida no tenga vigencia.
  tablas.tarifario_resultado_publicable = [fila(OPCIONAL, "Tour parcial", 100000)];
  return computarReserva(sb as unknown as Parameters<typeof computarReserva>[0], base(o.ida, o.reg, o.opcional ? [OPCIONAL] : []));
}

const OPC_CUBIERTA = await correr({ opcional: true, ida: "2026-09-05", reg: "2026-09-06" });
const OPC_SIN_COBERTURA = await correr({ opcional: true, ida: "2026-09-17", reg: "2026-09-18" });
const INC_CUBIERTO = await correr({ incluido: true, ida: "2026-09-05", reg: "2026-09-06" });
const INC_SIN_COBERTURA = await correr({ incluido: true, ida: "2026-09-17", reg: "2026-09-18" });

describe("opcional con cobertura parcial del viaje (tramo 01–10/09)", () => {
  test("fecha CUBIERTA (05/09): se vende con la tarifa de su vigencia aunque el viaje del paquete no esté cubierto completo", () => {
    assert.equal(OPC_CUBIERTA.ok, true, OPC_CUBIERTA.ok ? "" : `falló: ${(OPC_CUBIERTA as { error: string }).error}`);
    if (!OPC_CUBIERTA.ok) return;
    assert.equal(OPC_CUBIERTA.data.serviciosItems.length, 1);
    assert.equal(OPC_CUBIERTA.data.serviciosItems[0].precio, 2 * 100000, "2 pasajeros × el PVP publicado (la vigencia coincide con la referencia)");
  });

  test("fecha SIN cobertura (17/09) con una fila publicada vieja: se RECHAZA antes de numerar, nombrando el servicio", () => {
    assert.equal(OPC_SIN_COBERTURA.ok, false, "una fila antigua no puede vender una fecha sin vigencia");
    if (OPC_SIN_COBERTURA.ok) return;
    assert.match(OPC_SIN_COBERTURA.error, /Tour parcial/);
    assert.equal("data" in OPC_SIN_COBERTURA, false, "no queda venta que numerar");
  });
});

// Incluidos SIN tarifa vigente en la fecha de ida: se OMITEN (no entran al PVP, ni al costo, ni a la CxP, ni a «Incluye»/documentos) y la reserva del hotel sale igual.
// Asistencia médica sin vigencias: su tarifa base vale en cualquier fecha; con vigencias, solo ellas. Errores de configuración (franjas) siguen rechazando.
const SOLO_HOTEL = await correr({ ida: "2026-09-17", reg: "2026-09-18" });
const ASIST_PERMANENTE = await correr({ extra: [INCLUIDO2], ida: "2026-09-17", reg: "2026-09-18" });
const ASIST_PERMANENTE_Y_INCLUIDO_SIN_COB = await correr({ incluido: true, incluido2: true, ida: "2026-09-17", reg: "2026-09-18" });
const ASIST_PERMANENTE_Y_INCLUIDO_COB = await correr({ incluido: true, incluido2: true, ida: "2026-09-05", reg: "2026-09-06" });
const TRASLADO_SIN_VIGENCIA = await correr({ extra: [TRASLADO_SIN_VIG], ida: "2026-09-05", reg: "2026-09-06" });
const ASISTENCIA_SIN_BASE = await correr({ extra: [ASIST_SIN_BASE], ida: "2026-09-05", reg: "2026-09-06" });
const ASIST_VIG_CUBIERTA = await correr({ extra: [ASIST_CON_VIG], ida: "2026-09-05", reg: "2026-09-06" });
const ASIST_VIG_HUECO = await correr({ extra: [ASIST_CON_VIG], ida: "2026-09-17", reg: "2026-09-18" });
const ok = (r: { ok: boolean }) => r.ok;
const err = (r: { ok: boolean }) => (r as { error?: string }).error ?? "";
const ids = (r: Awaited<ReturnType<typeof correr>>) => (r.ok ? r.data.serviciosIncluidos.map((s) => s.servicioId).sort() : []);
const pvp = (r: Awaited<ReturnType<typeof correr>>) => (r.ok ? r.data.precioVenta : NaN);
const costo = (r: Awaited<ReturnType<typeof correr>>) => (r.ok ? r.data.serviciosIncluidos.reduce((t, s) => t + s.costoNeto, 0) : NaN);

describe("incluido sin tarifa vigente: se omite y la reserva del hotel sale (precio, costo y CxP coherentes)", () => {
  test("incluido cubierto (05/09): sale con el servicio; PVP = hotel + servicio, costo = tarifa de su vigencia", () => {
    assert.equal(ok(INC_CUBIERTO), true, err(INC_CUBIERTO));
    assert.deepEqual(ids(INC_CUBIERTO), [INCLUIDO]);
    assert.equal(pvp(INC_CUBIERTO) - pvp(SOLO_HOTEL), 2 * 20000, "2 pasajeros × 20.000 de SU vigencia (pct_mk 0)");
    assert.equal(costo(INC_CUBIERTO), 40000);
  });
  test("incluido descubierto (17/09): la reserva sale SIN el servicio — mismo PVP que el hotel solo, sin costo ni CxP del servicio", () => {
    assert.equal(ok(INC_SIN_COBERTURA), true, err(INC_SIN_COBERTURA));
    assert.deepEqual(ids(INC_SIN_COBERTURA), [], "no figura entre los servicios incluidos (resumen, documento, CxP)");
    assert.equal(pvp(INC_SIN_COBERTURA), pvp(SOLO_HOTEL));
    assert.equal(costo(INC_SIN_COBERTURA), 0);
  });
  test("33: la asistencia permanente (base 100, sin vigencias) está en CUALQUIER fecha; el incluido con vigencia decide solo la suya", () => {
    assert.equal(ok(ASIST_PERMANENTE_Y_INCLUIDO_COB), true, err(ASIST_PERMANENTE_Y_INCLUIDO_COB));
    assert.deepEqual(ids(ASIST_PERMANENTE_Y_INCLUIDO_COB), [INCLUIDO, INCLUIDO2].sort());
    assert.equal(ok(ASIST_PERMANENTE_Y_INCLUIDO_SIN_COB), true, err(ASIST_PERMANENTE_Y_INCLUIDO_SIN_COB));
    assert.deepEqual(ids(ASIST_PERMANENTE_Y_INCLUIDO_SIN_COB), [INCLUIDO2], "17/09: el servicio con vigencia se omite, la asistencia permanente se conserva");
    assert.equal(costo(ASIST_PERMANENTE), 2 * 100, "costo = tarifa base × pax; el mismo neto que se cobra (PVP − hotel)");
    assert.equal(pvp(ASIST_PERMANENTE) - pvp(SOLO_HOTEL), 2000, "PVP: +200 de la asistencia, redondeado al millar como todo precio de venta");
  });
  test("asistencia CON vigencias: dentro usa su vigencia; en el hueco se omite (la base no rellena)", () => {
    assert.deepEqual(ids(ASIST_VIG_CUBIERTA), [ASIST_CON_VIG]);
    assert.equal(ok(ASIST_VIG_HUECO), true, err(ASIST_VIG_HUECO));
    assert.deepEqual(ids(ASIST_VIG_HUECO), []);
    assert.equal(pvp(ASIST_VIG_HUECO), pvp(SOLO_HOTEL));
  });
  test("traslado incluido sin vigencias (aunque tenga base) y asistencia sin base: se omiten, sin inventar tarifa", () => {
    assert.equal(ok(TRASLADO_SIN_VIGENCIA), true, err(TRASLADO_SIN_VIGENCIA));
    assert.deepEqual(ids(TRASLADO_SIN_VIGENCIA), []);
    assert.equal(ok(ASISTENCIA_SIN_BASE), true, err(ASISTENCIA_SIN_BASE));
    assert.deepEqual(ids(ASISTENCIA_SIN_BASE), []);
    assert.equal(pvp(TRASLADO_SIN_VIGENCIA), pvp(ASISTENCIA_SIN_BASE), "ambas dejan el hotel solo");
  });
});

// Los cuatro servicios del «Incluye» manual (50, 112, 132, 133) en la reserva directa, con y sin cobertura. 132/133 no tienen vigencias: se omiten siempre.
const CUATRO_COB = await correr({ extra: [S50, S112, T132, T133], ida: "2026-09-05", reg: "2026-09-06" });
const CUATRO_SIN = await correr({ extra: [S50, S112, T132, T133], ida: "2026-09-17", reg: "2026-09-18" });
describe("50/112/132/133: PVP, costo y CxP solo de lo que efectivamente se incluye", () => {
  test("fecha cubierta: 50 y 112 incluidos y cobrados (PVP = hotel + sus tarifas, costo = suma de sus netos); 132 y 133 omitidos", () => {
    assert.equal(ok(CUATRO_COB), true, err(CUATRO_COB));
    assert.deepEqual(ids(CUATRO_COB), [S50, S112].sort(), "la lista de la que salen el resumen/documento y las CxP");
    assert.equal(costo(CUATRO_COB), 2 * 30000 + 2 * 87000);
    assert.equal(pvp(CUATRO_COB) - pvp(SOLO_HOTEL), 2 * 30000 + 2 * 87000, "precio y costo no divergen (pct_mk 0)");
  });
  test("fecha descubierta: ninguno de los cuatro; PVP = hotel solo; sin costo ni CxP", () => {
    assert.equal(ok(CUATRO_SIN), true, err(CUATRO_SIN));
    assert.deepEqual(ids(CUATRO_SIN), []);
    assert.equal(pvp(CUATRO_SIN), pvp(SOLO_HOTEL));
    assert.equal(costo(CUATRO_SIN), 0);
  });
});
