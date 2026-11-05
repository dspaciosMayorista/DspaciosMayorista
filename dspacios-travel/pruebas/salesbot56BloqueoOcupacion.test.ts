import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFalso, type TablasFalsas } from "./support/fakeSupabase.ts";

// #56 — Bloqueos: una ocupación que `validarReservaHabitaciones` rechaza no muestra precio ni
// «Cotización ORIENTATIVA». Se ejecuta el motor REAL (`computarReserva`, con el cliente de Supabase
// simulado del repo) y el flujo REAL de la conversación (`avanzar`) sobre ese motor.
//
// Hotel 7: la sencilla NO tiene fila de configuración (capacidad por defecto: 1 pax, 1 niño, 1 infante)
// y la doble admite hasta 3 pax con 2 niños y 2 infantes.

process.env.SUPABASE_SERVICE_ROLE_KEY = "valor-de-prueba";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://prueba.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "valor-de-prueba";

const IDA = "2027-03-10";
const REGRESO = "2027-03-13";
const HOY = "2026-10-20";

const fila = (acomodacion: string, precio_pvp: number) => ({
  paquete_id: 5, hotel_id: 7, bloqueo_id: 10, empaquetado_id: null, salida_id: null, categoria: "Estándar", regimen: "PAE",
  acomodacion, precio_pvp, hotel_nombre: "Hotel Caribe", destino_nombre: "SAN ANDRÉS", fecha_ida: IDA, fecha_regreso: REGRESO, moneda: "COP",
});

const TABLAS: TablasFalsas = {
  hoteles: [{
    id: 7, modelo_tarifario: "persona", nombre: "Hotel Caribe", moneda: "COP", edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12,
    pax_min: 1, pax_max: 6, nino_nota: null, pet_costo_neto: 0, pet_costo_desc: null, pet_nota: null, adults_only: false, pet_friendly: false,
  }],
  armado_paquetes: [{ id: 5, pct_mk: 0.2, impuesto_fijo: 50_000, destino_id: 1, destinos_aereos_alternativos: false, tarifario_generacion_publicada: 1 }],
  bloqueos_vuelo: [{ id: 10, destino_id: 1, ruta: "BOG-ADZ", record: null }],
  empaquetados: [],
  empaquetados_basica: [],
  tarifario_resultado_publicable: [fila("doble", 1_000_000), fila("sencilla", 1_500_000), fila("nino", 400_000), { ...fila("infante", 0), precio_pvp_menor2: 0 }],
  hotel_acomodaciones: [{ hotel_id: 7, acomodacion: "doble", pax_tarifa: 2, pax_max: 3, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 }],
  hotel_temporadas: [{
    id: 70, hotel_id: 7, nombre: "Alta", fecha_inicio: "2027-01-01", fecha_fin: "2027-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa",
    descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null, condicion_pago_tipo: null, condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null,
  }],
  tarifa_hotel: [{
    id: 700, hotel_id: 7, tipo_habitacion: "Estándar", alimentacion: "PAE", temporada: "Alta", neto_sencilla: 1_000_000, neto_doble: 700_000, neto_triple: null, neto_multiple: null,
    neto_nino: 250_000, neto_nino2: null, neto_infante: 0, nota_infante: null, notas: null, edad_infante_min: null, edad_infante_max: null, edad_nino_min: null, edad_nino_max: null, precio_final_autoritativo: false,
  }],
  armado_servicios: [],
  servicios_adicionales: [],
  servicio_tarifa_pax: [],
  servicio_temporadas: [],
  tarifario_composicion_publicada: [{ paquete_id: 5, fecha_ida: IDA, generacion: 1, regla: 1, servicios_incluidos: [] }],
};

const CLIENTE = crearClienteFalso(TABLAS, { joins: { armado_servicios: { servicios_adicionales: "servicio_id" } } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => CLIENTE } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => { throw new Error("createClient() real nunca se invoca."); } } });

const { computarReserva } = await import("@/lib/reservar/computo.ts");
const { entradaComputoBloqueo, ofertasBloqueo, resolverCotizacion, disponibilidadVuelo, validarSeleccionBloqueo, buscarEnOfertas, validarCriteriosBloqueos } = await import("../lib/salesbot/paquetes/bloqueo.ts");
const { esRechazoOcupacion } = await import("../lib/salesbot/paquetes/contrato.ts");
const { avanzar } = await import("../lib/salesbot/conversacion/flujo.ts");
const { estadoInicial } = await import("../lib/salesbot/conversacion/contrato.ts");
const { crearSello } = await import("../lib/salesbot/contrato.ts");

type Sesion = Parameters<typeof computarReserva>[0];
type FilaT = Parameters<typeof ofertasBloqueo>[0][number];
const CUPOS = { 10: 10 };
const OFERTAS = ofertasBloqueo(TABLAS.tarifario_resultado_publicable.map((f) => ({ ...f, modulo: "bloqueo", bloqueo_label: "BOG-ADZ", noches: 3, paquete_nombre: "San Andrés marzo" }) as unknown as FilaT), CUPOS);
const OF = OFERTAS[0];

/** Cotización de Bloqueos tal como la arma el canal: entrada del bot → motor real → lista blanca. */
async function cotizarConMotorReal(e: Record<string, string | undefined>) {
  const v = validarSeleccionBloqueo({ oferta: OF.clave, ...e });
  if (!v.ok) throw new Error("selección inválida: " + v.campos.join(","));
  const r = await computarReserva(CLIENTE as unknown as Sesion, entradaComputoBloqueo(OF, v.seleccion));
  return resolverCotizacion("bloqueo", { paqueteId: OF.paquete_id, hotelId: OF.hotel_id, categoria: v.seleccion.categoria, regimen: v.seleccion.regimen }, r, disponibilidadVuelo(10, CUPOS), { markupConfiable: true });
}

const llamadas: string[] = [];
const servicios = {
  buscarBloqueos: async (e: Record<string, string | undefined>) => {
    llamadas.push("buscarBloqueos");
    const v = validarCriteriosBloqueos(e);
    if (!v.ok) throw new Error("criterios inválidos");
    return { ok: true as const, datos: buscarEnOfertas(OFERTAS, v.criterios), sello: crearSello("buscarBloqueos") };
  },
  ofertaBloqueo: async (c: string) => OFERTAS.find((o) => o.clave === c) ?? null,
  cotizarBloqueo: async (e: Record<string, string | undefined>) => {
    llamadas.push("cotizarBloqueo");
    const r = await cotizarConMotorReal({ oferta: OF.clave, ...e });
    return r.ok
      ? { ok: true as const, datos: r.cotizacion, sello: crearSello("cotizarBloqueo") }
      : { ok: false as const, codigo: r.codigo, motivo: r.motivo, sello: crearSello("cotizarBloqueo") };
  },
  destinosPorcion: async () => [],
  buscarProgramas: async () => { throw new Error("no debía llamarse"); },
  detallePrograma: async () => { throw new Error("no debía llamarse"); },
  buscarPorcion: async () => { throw new Error("no debía llamarse"); },
  cotizarPorcion: async () => { throw new Error("no debía llamarse"); },
  listarAgencias: async () => { throw new Error("no debía llamarse"); },
  porcentajeAgencia: async () => { throw new Error("no debía llamarse"); },
} as unknown as Parameters<typeof avanzar>[2];

async function charla(entradas: (string | { op: string })[]) {
  llamadas.length = 0;
  let estado: unknown = estadoInicial();
  const respuestas = [];
  for (const x of entradas) {
    const r = await avanzar(estado, typeof x === "string" ? { tipo: "texto", texto: x } : { tipo: "opcion", valor: x.op }, servicios, HOY);
    respuestas.push(r);
    estado = r.estado;
  }
  return respuestas;
}
const textos = (r: { mensajes: { texto: string; lineas?: string[] }[] }) => r.mensajes.map((m) => [m.texto, ...(m.lineas ?? [])].join(" | ")).join(" || ");
const hasta = (adultos: string, hab: string, menores: string) => [{ op: "producto:bloqueo" }, "San Andrés", { op: "fechas:*" }, adultos, { op: `sel:blo:${OF.clave}` }, { op: "combo:Estándar|PAE" }, { op: hab }, menores] as (string | { op: string })[];

describe("el motor real: ocupación rechazada por validarReservaHabitaciones", () => {
  test("1 adulto + niño de 5 años en sencilla (capacidad por defecto de 1): el motor lo rechaza y no hay cotización", async () => {
    const r = await computarReserva(CLIENTE as unknown as Sesion, entradaComputoBloqueo(OF, { clave: OF.clave, categoria: "Estándar", regimen: "PAE", composicion: { habitaciones: { sencilla: 1 }, edadesMenores: [5] } }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /La habitación seleccionada admite máximo 0 niño\(s\); hay 1\./, "regla de distribución del motor: pax_max − pax_tarifa = 0");
    const c = await cotizarConMotorReal({ hab_sencilla: "1", edadesMenores: "5", combo: "Estándar|PAE" });
    assert.equal(c.ok, false);
    if (!c.ok) {
      assert.equal(c.codigo, "no_cotizable");
      assert.equal(esRechazoOcupacion(c.motivo), true);
      assert.match(c.motivo ?? "", /admite máximo 0 niño/, "el motivo comercial sale tal cual, no el genérico");
    }
  });
  test("el mismo grupo en una doble válida cotiza: 2 × 1.000.000 + niño × 400.000", async () => {
    const c = await cotizarConMotorReal({ hab_doble: "1", edadesMenores: "5", combo: "Estándar|PAE" });
    assert.ok(c.ok);
    if (c.ok) assert.equal(c.cotizacion.total_orientativo, 2_400_000);
  });
  test("regresiones: 1 adulto en doble, con y sin infante, cotizan; 2 adultos + niño + infante también", async () => {
    for (const [edades, esperado] of [["", 2_000_000], ["1", 2_000_000], ["5 1", 2_400_000]] as const) {
      const c = await cotizarConMotorReal({ hab_doble: "1", ...(edades ? { edadesMenores: edades.replace(" ", ",") } : {}), combo: "Estándar|PAE" });
      assert.ok(c.ok, `edades «${edades}»`);
      if (c.ok) assert.equal(c.cotizacion.total_orientativo, esperado, `edades «${edades}»`);
    }
  });
});

describe("validarReservaHabitaciones en la cotización del bot: tope del hotel", () => {
  test("el mínimo de pax del hotel se respeta aunque no haya pasajeros (antes se omitía)", async () => {
    const h = TABLAS.hoteles[0] as { pax_min: number };
    h.pax_min = 3;
    try {
      const c = await cotizarConMotorReal({ hab_doble: "1", combo: "Estándar|PAE" });
      assert.equal(c.ok, false, "2 pax no cumplen el mínimo de 3 del hotel");
      if (!c.ok) {
        assert.equal(esRechazoOcupacion(c.motivo), true);
        assert.match(c.motivo ?? "", /El hotel exige mínimo 3 pax por reserva; hay 2\./);
      }
      const rs = await charla(hasta("2", "habitaciones:doble=1", { op: "menores:no" } as never));
      assert.doesNotMatch(textos(rs[7]), /ORIENTATIVA/);
      assert.equal(rs[7].estado.pendiente, "habitaciones");
    } finally {
      h.pax_min = 1;
    }
  });
});

describe("la conversación sobre el motor real", () => {
  test("1 adulto + niño en sencilla: sin precio ni «Cotización ORIENTATIVA»; nombra la habitación y conserva todo", async () => {
    const rs = await charla(hasta("1", "habitaciones:sencilla=1", "5"));
    const r = rs[7];
    const t = textos(r);
    assert.doesNotMatch(t, /ORIENTATIVA|\$ ?\d/);
    assert.match(t, /admite máximo 0 niño\(s\); hay 1/);
    assert.match(t, /Habitación a revisar: 1 sencilla/);
    assert.equal(r.mensajes[0].aviso, true);
    const e = r.estado;
    assert.equal(e.pendiente, "habitaciones");
    assert.equal(e.habitaciones, null);
    assert.deepEqual(e.edadesMenores, [5]);
    assert.equal(e.adultos, 1);
    assert.equal(e.seleccion, `blo:${OF.clave}`);
    assert.equal(e.combo, "Estándar|PAE");
    assert.equal(e.destino, rs[6].estado.destino);
    assert.equal(e.cualquierFecha, true);
    assert.equal(llamadas.filter((l) => l === "buscarBloqueos").length, 1, "solo la búsqueda inicial: no se repite al pedir la corrección");
  });
  test("corregir a una doble: cotiza con el motor real, sin aviso, y mantiene hotel, combo, adultos y edades", async () => {
    const rs = await charla([...hasta("1", "habitaciones:sencilla=1", "5"), { op: "habitaciones:doble=1" }]);
    const t = textos(rs[8]);
    assert.match(t, /Cotización ORIENTATIVA: .*2\.400\.000/);
    assert.doesNotMatch(t, /máximo|Habitación a revisar/);
    assert.equal(rs[8].estado.adultos, 1);
    assert.deepEqual(rs[8].estado.edadesMenores, [5]);
    assert.equal(rs[8].estado.seleccion, `blo:${OF.clave}`);
  });
  test("también se puede corregir escribiendo la habitación", async () => {
    const rs = await charla([...hasta("1", "habitaciones:sencilla=1", "5"), "1 doble"]);
    assert.match(textos(rs[8]), /Cotización ORIENTATIVA/);
  });
  test("regresiones: 1 adulto en doble, con infante y sin menores, cotizan sin aviso", async () => {
    for (const menores of [{ op: "menores:no" }, "1"] as const) {
      const rs = await charla(hasta("1", "habitaciones:doble=1", menores as never));
      const t = textos(rs[7]);
      assert.match(t, /Cotización ORIENTATIVA/);
      assert.doesNotMatch(t, /Indicaste|máximo|No alcanzan/);
      assert.equal(rs[7].estado.adultos, 1);
    }
  });
  test("regresión: 3 adultos en 1 doble sigue sin cotizar (adultos por encima de las plazas)", async () => {
    const rs = await charla(hasta("3", "habitaciones:doble=1", { op: "menores:no" } as never));
    assert.doesNotMatch(textos(rs[7]), /ORIENTATIVA/);
    assert.match(textos(rs[7]), /Indicaste 3 adulto/);
    assert.equal(rs[7].estado.pendiente, "habitaciones");
  });
});
