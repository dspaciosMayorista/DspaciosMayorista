import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFalso, type TablasFalsas } from "./support/fakeSupabase.ts";

// EJECUCIÓN REAL de `computarReserva` (mismo arnés que reservaOrquestadorE2E.test.ts: cliente Supabase falso en memoria + mock de los módulos de cliente).
// Caso: un servicio por GRUPO cuya VIGENCIA cubre 5 pasajeros (rangos 1–4 y 5–6) pero cuyo SNAPSHOT publicado (tarifario_resultado_publicable) quedó atrás
// y solo trae el rango 1–4. `precioServicio` caería al rango más alto (el de 1–4) y cobraría 5 pax con esa tarifa: debe rechazar ANTES de numerar.

const HOTEL_ID = 217;
const PAQUETE_ID = 50;
const SERVICIO_ID = 7;

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
    { hotel_id: HOTEL_ID, acomodacion: "triple", pax_tarifa: 3, pax_max: 4, adt_min: 1, adt_max: 3, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 },
  ],
  // El servicio opcional por GRUPO: el catálogo, su vigencia y los rangos de ESA vigencia (cubren 1–6 pax).
  armado_servicios: [{ paquete_id: PAQUETE_ID, servicio_id: SERVICIO_ID, modo: "grupo", incluido: false }],
  servicios_adicionales: [{ id: SERVICIO_ID, nombre: "Tour grupal", categoria: "tour_traslado", proveedor_id: null, moneda: "COP", precio_persona: null, precio_infante: null, recargo_individual: null, liquidacion: null }],
  servicio_temporadas: [{
    id: 1, servicio_id: SERVICIO_ID, nombre: "V1", fecha_inicio: "2026-01-01", fecha_fin: "2026-12-31", compra_inicio: null, compra_fin: null,
    prioridad: 1, precio_persona: null, precio_infante: null, recargo_individual: null,
  }],
  servicio_tarifa_pax: [
    { id: 1, servicio_id: SERVICIO_ID, pax_desde: 1, pax_hasta: 4, precio: 400000, temporada: "V1" },
    { id: 2, servicio_id: SERVICIO_ID, pax_desde: 5, pax_hasta: 6, precio: 500000, temporada: "V1" },
  ],
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
const INPUT = {
  paqueteId: PAQUETE_ID, bloqueoId: null, modulo: "porcion_terrestre" as const,
  hotelId: HOTEL_ID, fechaIda: "2026-09-17", fechaRegreso: "2026-09-18",
  categoria: "Estándar", regimen: "PAE",
  habitaciones: { doble: 1, triple: 1 }, ninos: 0, ninos2: 0, infantes: 0,
  servicios: [SERVICIO_ID],
  cliente: { nombres: "Juan", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123", telefono: "300", email: "a@a.com" },
  tipoAsesor: "interno" as const, asesorInterno: "Asesor Uno", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
  plazo: "24 horas",
  pasajeros: [1, 2, 3, 4, 5].map(pax),
};

// Snapshot publicado del servicio (PVP por rango). Se cambia entre ejecuciones; el cliente falso lee `tablas` en cada consulta.
const fila = (desde: number, hasta: number, precio: number) => ({
  paquete_id: PAQUETE_ID, modulo: "servicios", servicio_id: SERVICIO_ID, servicio_nombre: "Tour grupal", tipo_tarifa: "grupo",
  pax_desde: desde, pax_hasta: hasta, precio_pvp: precio, precio_pvp_menor2: null, recargo_individual: null,
});
const correr = (snapshot: ReturnType<typeof fila>[]) => {
  tablas.tarifario_resultado_publicable = snapshot;
  return computarReserva(sb as unknown as Parameters<typeof computarReserva>[0], INPUT);
};

const ACTUAL = await correr([fila(1, 4, 400000), fila(5, 6, 500000)]);
const ATRASADO = await correr([fila(1, 4, 400000)]);

describe("computarReserva (ejecución real): servicio por grupo, la vigencia cubre 5 pax pero el snapshot publicado solo 1–4", () => {
  test("control: con el snapshot al día (rangos 1–4 y 5–6) la reserva sale y cobra el rango de 5 pax", () => {
    assert.equal(ACTUAL.ok, true, ACTUAL.ok ? "" : `falló: ${(ACTUAL as { error: string }).error}`);
    if (!ACTUAL.ok) return;
    assert.equal(ACTUAL.data.serviciosItems.length, 1);
    assert.equal(ACTUAL.data.serviciosItems[0].precio, 500000, "el rango de 5 pax, no el de 1–4");
  });

  test("snapshot atrasado (solo 1–4): se RECHAZA con mensaje legible, sin precio por aproximación", () => {
    assert.equal(ATRASADO.ok, false, "debía rechazar: antes cobraba 5 pax con el rango más alto publicado (1–4)");
    if (ATRASADO.ok) return;
    assert.match(ATRASADO.error, /Tour grupal/);
    assert.match(ATRASADO.error, /no tiene publicado un rango que cubra 5 pasajeros/);
    assert.match(ATRASADO.error, /regenera el tarifario/);
  });

  test("el rechazo no deja ningún resultado de venta (ni total ni ítems): nada que numerar", () => {
    assert.equal(ATRASADO.ok, false);
    assert.equal("data" in ATRASADO, false);
  });
});
