import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFalso, type ClienteFalso, type TablasFalsas } from "./support/fakeSupabase.ts";

// #56 multiproducto — BLOQUEO, paridad con el motor REAL de venta.
//
// Se ejecuta `computarReserva` (lib/reservar/computo.ts) de verdad, con el
// cliente de Supabase simulado del repo (pruebas/support/fakeSupabase.ts),
// y se compara la entrada que arma el bot con la que arma el checkout
// (app/tarifario/checkout/actions.ts:698-722, copiada campo a campo, con datos
// del cliente). El precio no puede depender de quién pregunta: el resultado
// del motor debe ser IDÉNTICO, y el total que muestra el bot, exactamente su
// `precioVenta`.
//
// También: cupos (¿alcanzan?), vigencia de compra vencida, empaquetado
// desactivado, Bernalo, error técnico del motor (no sale crudo) y H-PQ1
// (servicio incluido por grupo sin markup para una sesión que no lee el
// paquete — el bot no presenta ese total).

process.env.SUPABASE_SERVICE_ROLE_KEY = "valor-de-prueba";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://prueba.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "valor-de-prueba";

const IDA = "2027-03-10";
const REGRESO = "2027-03-13";

function tarifario(paqueteId: number, hotelId: number, origen: { bloqueo_id?: number | null; empaquetado_id?: number | null }, precios: Record<string, number>) {
  return Object.entries(precios).map(([acomodacion, precio_pvp]) => ({
    paquete_id: paqueteId,
    hotel_id: hotelId,
    bloqueo_id: origen.bloqueo_id ?? null,
    empaquetado_id: origen.empaquetado_id ?? null,
    salida_id: null,
    categoria: "Estándar",
    regimen: "PAE",
    acomodacion,
    precio_pvp,
    hotel_nombre: hotelId === 7 ? "Hotel Caribe" : `Hotel ${hotelId}`,
    destino_nombre: "SAN ANDRÉS",
    fecha_ida: IDA,
    fecha_regreso: REGRESO,
    moneda: "COP",
  }));
}

const hotel = (id: number, sobre: Record<string, unknown> = {}) => ({
  id,
  modelo_tarifario: "persona",
  nombre: `Hotel ${id}`,
  moneda: "COP",
  edad_infante_min: 0,
  edad_infante_max: 2,
  edad_nino_min: 3,
  edad_nino_max: 12,
  pax_min: 1,
  pax_max: 6,
  nino_nota: "Niño comparte cama con los padres",
  pet_costo_neto: 0,
  pet_costo_desc: null,
  pet_nota: null,
  adults_only: false,
  pet_friendly: false,
  ...sobre,
});

const temporada = (hotelId: number, sobre: Record<string, unknown> = {}) => ({
  id: hotelId * 10,
  hotel_id: hotelId,
  nombre: "Alta",
  fecha_inicio: "2027-01-01",
  fecha_fin: "2027-12-31",
  prioridad: 1,
  compra_inicio: null,
  compra_fin: null,
  tipo: "tarifa",
  descuento_valor: null,
  rangos: null,
  blackouts: null,
  min_noches: null,
  regimen_restringido: null,
  condicion_pago_tipo: null,
  condicion_pago_pct_inicial: null,
  condicion_pago_dias_saldo: null,
  ...sobre,
});

const neto = (hotelId: number) => ({
  id: hotelId * 100,
  hotel_id: hotelId,
  tipo_habitacion: "Estándar",
  alimentacion: "PAE",
  temporada: "Alta",
  neto_sencilla: 1_000_000,
  neto_doble: 700_000,
  neto_triple: null,
  neto_multiple: null,
  neto_nino: 250_000,
  neto_nino2: null,
  neto_infante: 0,
  nota_infante: null,
  notas: "No reembolsable",
  edad_infante_min: null,
  edad_infante_max: null,
  edad_nino_min: null,
  edad_nino_max: null,
  precio_final_autoritativo: false,
});

const acomodaciones = (hotelId: number) => [
  { hotel_id: hotelId, acomodacion: "sencilla", pax_tarifa: 1, pax_max: 3, adt_min: 1, adt_max: 1, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 1 },
  { hotel_id: hotelId, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 },
];

const PRECIOS = { doble: 1_000_000, sencilla: 1_500_000, nino: 400_000, infante: 0 };

function construirTablas(): TablasFalsas {
  return {
    // 7 normal · 8 Bernalo (por unidad) · 9 Adults Only · 12 vigencia de compra vencida
    hoteles: [hotel(7, { nombre: "Hotel Caribe" }), hotel(8, { modelo_tarifario: "unidad" }), hotel(9, { adults_only: true }), hotel(12)],
    // 5 sin incluidos · 6 con un servicio incluido cobrado POR GRUPO
    // destino_id + check de alternativas: el motor valida el destino aéreo de la fuente (#67).
    armado_paquetes: [
      { id: 5, pct_mk: 0.2, impuesto_fijo: 50_000, destino_id: 1, destinos_aereos_alternativos: false, tarifario_generacion_publicada: 1 },
      { id: 6, pct_mk: 0.2, impuesto_fijo: 50_000, destino_id: 1, destinos_aereos_alternativos: false, tarifario_generacion_publicada: 1 },
    ],
    bloqueos_vuelo: [{ id: 10, destino_id: 1, ruta: "BOG-ADZ", record: null }],
    // La vigencia del empaquetado la lee la SESIÓN por la vista; el destino aéreo, el cliente de servicio en la tabla.
    empaquetados: [
      { id: 3, activo: true, compra_inicio: null, compra_fin: null, destino_id: 1, ruta: "BOG-ADZ", record: null },
      { id: 4, activo: false, compra_inicio: null, compra_fin: null, destino_id: 1, ruta: "BOG-ADZ", record: null },
    ],
    empaquetados_basica: [
      { id: 3, activo: true, compra_inicio: null, compra_fin: null },
      { id: 4, activo: false, compra_inicio: null, compra_fin: null },
    ],
    tarifario_resultado_publicable: [
      ...tarifario(5, 7, { bloqueo_id: 10 }, PRECIOS),
      ...tarifario(5, 7, { empaquetado_id: 3 }, { doble: 900_000 }),
      ...tarifario(5, 7, { empaquetado_id: 4 }, { doble: 900_000 }),
      ...tarifario(5, 9, { bloqueo_id: 10 }, PRECIOS),
      ...tarifario(5, 12, { bloqueo_id: 10 }, PRECIOS),
      ...tarifario(6, 7, { bloqueo_id: 10 }, PRECIOS),
    ],
    hotel_acomodaciones: [...acomodaciones(7), ...acomodaciones(9), ...acomodaciones(12)],
    hotel_temporadas: [temporada(7), temporada(9), temporada(12, { compra_fin: "2026-01-31" })],
    tarifa_hotel: [neto(7), neto(9), neto(12)],
    armado_servicios: [{ paquete_id: 6, servicio_id: 20, modo: "grupo", incluido: true }],
    servicios_adicionales: [{ id: 20, nombre: "Traslado privado", categoria: "traslado", precio_persona: null, liquidacion: null, proveedor_id: 66 }],
    servicio_tarifa_pax: [{ servicio_id: 20, pax_desde: 1, pax_hasta: 10, precio: 100_000, temporada: "GENERAL" }],
    // Desde #262/#421 un incluido exige una vigencia que cubra la fecha de ida (la tarifa de grupo cuelga de su nombre).
    servicio_temporadas: [{ id: 1, servicio_id: 20, nombre: "GENERAL", fecha_inicio: "2027-01-01", fecha_fin: "2027-12-31", compra_inicio: null, compra_fin: null, prioridad: 0, precio_persona: null, precio_infante: null, recargo_individual: 0 }],
    // Evidencia de composición publicada (migración 258): generación vigente + regla 1 + los incluidos horneados.
    tarifario_composicion_publicada: [
      { paquete_id: 5, fecha_ida: IDA, generacion: 1, regla: 1, servicios_incluidos: [] },
      { paquete_id: 6, fecha_ida: IDA, generacion: 1, regla: 1, servicios_incluidos: [20] },
    ],
  };
}

const JOINS = { armado_servicios: { servicios_adicionales: "servicio_id" } };
const TABLAS = construirTablas();
const ADMIN = crearClienteFalso(TABLAS, { joins: JOINS });
/** Sesión de un rol que lee el paquete (superadmin, gerencia, administración, operaciones). */
const SESION_INTERNA = crearClienteFalso(TABLAS, { joins: JOINS });
/** Sesión de `venta`: la RLS de `armado_*` (018) no le devuelve filas, sin error. */
const SESION_VENTA = crearClienteFalso({ ...TABLAS, armado_paquetes: [], armado_servicios: [] }, { joins: JOINS });

/** Cliente cuya lectura de una tabla falla como falla PostgREST (mensaje crudo de Postgres). */
function conError(base: ClienteFalso, tabla: string, mensaje: string): ClienteFalso {
  return {
    ...base,
    from(t: string) {
      if (t !== tabla) return base.from(t);
      const b = base.from(t);
      const fallo = { data: null, error: { message: mensaje } };
      const roto = {
        ...b,
        select: () => roto,
        eq: () => roto,
        in: () => roto,
        order: () => roto,
        maybeSingle: async () => fallo,
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(fallo).then(ok, ko),
      };
      return roto as unknown as ReturnType<ClienteFalso["from"]>;
    },
  };
}

mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => ADMIN } });
mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => {
      throw new Error("createClient() real nunca se invoca: la sesión se inyecta.");
    },
  },
});

const { computarReserva } = await import("@/lib/reservar/computo.ts");
const { entradaComputoBloqueo, ofertasBloqueo, resolverCotizacion, disponibilidadVuelo, cargoFueraDeLineas, MOTIVO_CARGO_GRUPO_SIN_MARKUP } = await import("../lib/salesbot/paquetes/bloqueo.ts");
const { clavesProhibidasEn } = await import("../lib/salesbot/contrato.ts");

type Sesion = Parameters<typeof computarReserva>[0];
type FilaT = Parameters<typeof ofertasBloqueo>[0][number];

/** Oferta tal como la arma el bot desde las filas publicadas (mismo agrupador de producción). */
function oferta(paqueteId: number, hotelId: number, origen: { bloqueo_id?: number; empaquetado_id?: number }) {
  const filas = TABLAS.tarifario_resultado_publicable
    .filter((f) => f.paquete_id === paqueteId && f.hotel_id === hotelId && f.bloqueo_id === (origen.bloqueo_id ?? null) && f.empaquetado_id === (origen.empaquetado_id ?? null))
    .map((f) => ({ ...f, modulo: "bloqueo", bloqueo_label: "BOG-ADZ", noches: 3, paquete_nombre: "San Andrés marzo" }) as unknown as FilaT);
  const [o] = ofertasBloqueo(filas, { 10: 3 });
  assert.ok(o, "la oferta debe existir");
  return o;
}

const COMPOSICION = { habitaciones: { doble: 1 }, edadesMenores: [5] };
const seleccion = (o: ReturnType<typeof oferta>, composicion = COMPOSICION) => ({ clave: o.clave, categoria: "Estándar", regimen: "PAE", composicion });

/** Entrada del checkout (checkout/actions.ts:698-722), con datos del cliente: no deben mover el precio. */
const entradaCheckout = (o: ReturnType<typeof oferta>, composicion = COMPOSICION) => ({
  paqueteId: o.paquete_id,
  bloqueoId: o.bloqueo_id,
  modulo: "bloqueo" as const,
  hotelId: o.hotel_id,
  fechaIda: undefined,
  fechaRegreso: undefined,
  categoria: "Estándar",
  regimen: "PAE",
  habitaciones: composicion.habitaciones,
  ninos: 0,
  ninos2: 0,
  infantes: 0,
  edadesMenores: composicion.edadesMenores,
  cantidadMenores: composicion.edadesMenores.length,
  cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "1234567", telefono: "3001234567", email: "ana@example.com" },
  tipoAsesor: "interno" as const,
  asesorInterno: "",
  agenciaNombre: "",
  agenciaAsesor: "",
  freelanceNombre: "",
  aliadoId: null,
  plazo: "",
  pasajeros: [],
  servicios: [],
});

const BASE = (o: ReturnType<typeof oferta>) => ({ paqueteId: o.paquete_id, hotelId: o.hotel_id, categoria: "Estándar", regimen: "PAE" });

// ── Ejecuciones reales (una vez, a nivel de módulo) ──────────────────────
const OF = oferta(5, 7, { bloqueo_id: 10 });
const BOT = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaComputoBloqueo(OF, seleccion(OF)));
const CHECKOUT = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaCheckout(OF));
const BOT_VENTA = await computarReserva(SESION_VENTA as unknown as Sesion, entradaComputoBloqueo(OF, seleccion(OF)));

describe("paridad de precio: bot = checkout con el motor real", () => {
  test("el motor acepta la entrada del bot", () => {
    assert.equal(BOT.ok, true, BOT.ok ? "" : BOT.error);
  });

  test("resultado IDÉNTICO al del checkout (los datos del cliente no mueven el precio)", () => {
    assert.deepEqual(BOT, CHECKOUT);
  });

  test("y al de una sesión de venta (sin incluidos por grupo, el % de la sesión no participa)", () => {
    assert.ok(BOT.ok && BOT_VENTA.ok);
    if (!BOT.ok || !BOT_VENTA.ok) return;
    assert.equal(BOT_VENTA.data.precioVenta, BOT.data.precioVenta);
  });

  test("el total del bot es exactamente precioVenta: 2 × 1.000.000 + niño de 5 años × 400.000", () => {
    assert.ok(BOT.ok);
    if (!BOT.ok) return;
    assert.equal(BOT.data.precioVenta, 2_400_000);
    const r = resolverCotizacion("bloqueo", BASE(OF), BOT, disponibilidadVuelo(10, { 10: 3 }), { markupConfiable: true });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.cotizacion.total_orientativo, BOT.data.precioVenta);
    assert.deepEqual(r.cotizacion.lineas, [{ acomodacion: "doble", habitaciones: 1, pax: 2, pvp_por_persona: 1_000_000 }]);
    assert.deepEqual(r.cotizacion.menores, { nino: 1, nino2: 0, infante: 0 });
    assert.equal(r.cotizacion.nota_nino, "Niño comparte cama con los padres");
    assert.deepEqual(r.cotizacion.condiciones_tarifa, ["No reembolsable"]);
  });

  test("el motor trae netos e impuesto; la salida del bot no", () => {
    assert.ok(BOT.ok);
    if (!BOT.ok) return;
    assert.equal(BOT.data.netoPorAcom.doble, 2_100_000); // 3 noches × 700.000: el motor sí lo calcula
    assert.equal(BOT.data.impuestoTotal, 150_000);
    const r = resolverCotizacion("bloqueo", BASE(OF), BOT, disponibilidadVuelo(10, { 10: 3 }), { markupConfiable: true });
    assert.deepEqual(clavesProhibidasEn(r), []);
    const json = JSON.stringify(r);
    for (const v of ["2100000", "750000", "150000", "netoPorAcom", "impuesto"]) assert.equal(json.includes(v), false, v);
  });
});

describe("cupos: las sillas libres al consultar contra los pax con silla del motor", () => {
  const con = (cupos: Record<number, number>) => {
    const r = resolverCotizacion("bloqueo", BASE(OF), BOT, disponibilidadVuelo(10, cupos), { markupConfiable: true });
    return r.ok ? [r.cotizacion.disponibilidad_vuelo, r.cotizacion.sillas_libres, r.cotizacion.alcanzan_sillas] : r;
  };
  test("3 pax con silla (2 adultos + niño); el infante no ocupa silla", () => {
    assert.ok(BOT.ok);
    if (BOT.ok) assert.equal(BOT.data.paxConSilla, 3);
  });
  test("2 libres no alcanzan; 3 y 5 sí; 0 sin sillas; sin dato no verificado", () => {
    assert.deepEqual(con({ 10: 2 }), ["sillas_libres", 2, false]);
    assert.deepEqual(con({ 10: 3 }), ["sillas_libres", 3, true]);
    assert.deepEqual(con({ 10: 5 }), ["sillas_libres", 5, true]);
    assert.deepEqual(con({ 10: 0 }), ["sin_sillas", 0, false]);
    assert.deepEqual(con({}), ["no_verificada", null, null]);
  });
});

describe("origen del vuelo y vigencia: el motor decide, el bot no inventa precio", () => {
  test("tiquete de sistema activo: cotiza con su propia fila, sujeto a confirmación", async () => {
    const o = oferta(5, 7, { empaquetado_id: 3 });
    const r = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaComputoBloqueo(o, seleccion(o, { habitaciones: { doble: 1 }, edadesMenores: [] })));
    const c = resolverCotizacion("bloqueo", BASE(o), r, disponibilidadVuelo(o.bloqueo_id, { 10: 3 }), { markupConfiable: true });
    assert.ok(c.ok);
    if (!c.ok) return;
    assert.equal(c.cotizacion.total_orientativo, 1_800_000);
    assert.equal(c.cotizacion.disponibilidad_vuelo, "sujeto_a_confirmacion");
    assert.equal(c.cotizacion.alcanzan_sillas, null);
  });

  test("empaquetado desactivado después de publicar: no_cotizable, sin total", async () => {
    const o = oferta(5, 7, { empaquetado_id: 4 });
    const r = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaComputoBloqueo(o, seleccion(o, { habitaciones: { doble: 1 }, edadesMenores: [] })));
    assert.equal(r.ok, false);
    const c = resolverCotizacion("bloqueo", BASE(o), r, null, { markupConfiable: true });
    assert.equal(c.ok, false);
    if (!c.ok) assert.equal(c.codigo, "no_cotizable");
  });

  test("vigencia de compra del hotel vencida: el motor rechaza y el bot no da precio", async () => {
    const o = oferta(5, 12, { bloqueo_id: 10 });
    const r = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaComputoBloqueo(o, seleccion(o)));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /ya no está vigente para compra/);
    const c = resolverCotizacion("bloqueo", BASE(o), r, null, { markupConfiable: true });
    assert.equal(c.ok, false);
    if (!c.ok) assert.equal(c.codigo, "no_cotizable");
  });

  test("Adults Only con un menor: no_cotizable con el motivo comercial del motor", async () => {
    const o = oferta(5, 9, { bloqueo_id: 10 });
    const r = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaComputoBloqueo(o, seleccion(o)));
    const c = resolverCotizacion("bloqueo", BASE(o), r, null, { markupConfiable: true });
    assert.deepEqual(c, { ok: false, codigo: "no_cotizable", motivo: "Este hotel es Adults Only: no acepta niños ni infantes." });
  });

  test("hotel Bernalo (por unidad): excluido, sin nombres internos en el motivo", async () => {
    const o = { ...OF, hotel_id: 8 };
    const r = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaComputoBloqueo(o, seleccion(o)));
    assert.equal(r.ok, false);
    const c = resolverCotizacion("bloqueo", BASE(o), r, null, { markupConfiable: true });
    assert.equal(c.ok, false);
    if (c.ok) return;
    assert.equal(c.codigo, "no_cotizable");
    assert.doesNotMatch(c.motivo ?? "", /hotel_tarifas_unidad|Bernalo|Reservar/);
  });

  test("error técnico del motor (mensaje crudo de Postgres): error_tecnico sin el mensaje", async () => {
    const roto = conError(SESION_INTERNA, "tarifario_resultado_publicable", 'permission denied for view tarifario_resultado_publicable');
    const r = await computarReserva(roto as unknown as Sesion, entradaComputoBloqueo(OF, seleccion(OF)));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /permission denied/);
    const c = resolverCotizacion("bloqueo", BASE(OF), r, null, { markupConfiable: true });
    assert.deepEqual(c, { ok: false, codigo: "error_tecnico" });
  });
});

describe("H-PQ1: servicio incluido por grupo y una sesión que no lee el % del paquete", () => {
  const o = oferta(6, 7, { bloqueo_id: 10 });
  const sel = seleccion(o, { habitaciones: { doble: 1 }, edadesMenores: [] });

  test("el motor cobra el grupo con markup para una sesión interna y SIN markup para venta (reproducción del hallazgo)", async () => {
    const interna = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaComputoBloqueo(o, sel));
    const venta = await computarReserva(SESION_VENTA as unknown as Sesion, entradaComputoBloqueo(o, sel));
    assert.ok(interna.ok && venta.ok, interna.ok ? (venta.ok ? "" : venta.error) : interna.error);
    if (!interna.ok || !venta.ok) return;
    // 2 × 1.000.000 + traslado por grupo: 100.000 / (1 − 0,2) = 125.000 con markup; 100.000 sin él.
    assert.equal(cargoFueraDeLineas(interna.data), 125_000);
    assert.equal(cargoFueraDeLineas(venta.data), 100_000);
    assert.equal(interna.data.precioVenta - venta.data.precioVenta, 25_000);
  });

  test("el bot no presenta el total de venta (falla cerrado) y sí el de la sesión interna", async () => {
    const interna = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaComputoBloqueo(o, sel));
    const venta = await computarReserva(SESION_VENTA as unknown as Sesion, entradaComputoBloqueo(o, sel));
    assert.deepEqual(resolverCotizacion("bloqueo", BASE(o), venta, null, { markupConfiable: false }), { ok: false, codigo: "no_cotizable", motivo: MOTIVO_CARGO_GRUPO_SIN_MARKUP });
    const ok = resolverCotizacion("bloqueo", BASE(o), interna, null, { markupConfiable: true });
    assert.ok(ok.ok);
    if (ok.ok && interna.ok) assert.equal(ok.cotizacion.total_orientativo, interna.data.precioVenta);
  });

  test("ninguna clave del servicio incluido (costo, proveedor) sale en la cotización", async () => {
    const interna = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaComputoBloqueo(o, sel));
    const r = resolverCotizacion("bloqueo", BASE(o), interna, null, { markupConfiable: true });
    assert.deepEqual(clavesProhibidasEn(r), []);
    assert.equal(JSON.stringify(r).includes("Traslado privado"), false);
  });
});
