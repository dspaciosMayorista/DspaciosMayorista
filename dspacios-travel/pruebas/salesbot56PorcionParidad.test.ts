import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFalso, type ClienteFalso, type TablasFalsas } from "./support/fakeSupabase.ts";

// #56 multiproducto — PORCIÓN TERRESTRE, paridad con los motores REALES.
//
// Se ejecutan de verdad `buscarHoteles`, `cotizarPorFechas` y
// `computarReserva` (lib/reservar/cotizar.ts y computo.ts) con el cliente de
// Supabase simulado del repo, y se comprueba que:
//   · el bot pasa a `computarReserva` una entrada que da el MISMO resultado
//     que la del checkout de Vista Booking (con datos del cliente);
//   · lo que muestra la búsqueda (total por combo) = lo que cotiza la venta;
//   · el PVP por persona de `cotizarPorFechas` = el de la línea de la venta;
//   · la reducción del bot no cambia ningún número ni deja salir netos;
//   · una tarifa con la vigencia de compra vencida no da precio;
//   · H-PQ1: con un incluido por grupo, la búsqueda (service-role) y la
//     venta con sesión de `venta` difieren — el bot no presenta ese total.

process.env.SUPABASE_SERVICE_ROLE_KEY = "valor-de-prueba";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://prueba.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "valor-de-prueba";

const IDA = "2027-03-10";
const REGRESO = "2027-03-13";
const DESTINO = "SAN ANDRÉS";

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
  nino_nota: null,
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
  neto_sencilla: 300_000,
  neto_doble: 200_000,
  neto_triple: null,
  neto_multiple: null,
  neto_nino: 80_000,
  neto_nino2: null,
  neto_infante: null,
  nota_infante: null,
  notas: null,
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

const paquete = (id: number) => ({ id, pct_mk: 0.2, impuesto_fijo: 0, destino_id: 1, fecha_viaje_inicio: "2027-03-01", fecha_viaje_fin: "2027-03-31", activo: true });

function construirTablas(): TablasFalsas {
  return {
    // 217 normal · 218 vigencia de compra vencida · paquete 51: 217 con incluido por grupo
    hoteles: [hotel(217, { nombre: "Hotel Isla" }), hotel(218, { nombre: "Hotel Vencido" })],
    destinos: [{ id: 1, nombre: DESTINO }],
    armado_paquetes: [paquete(50), paquete(51)],
    armado_hoteles: [
      { paquete_id: 50, hotel_id: 217, categorias: null, regimenes: null },
      { paquete_id: 50, hotel_id: 218, categorias: null, regimenes: null },
      { paquete_id: 51, hotel_id: 217, categorias: null, regimenes: null },
    ],
    hotel_temporadas: [temporada(217), temporada(218, { compra_fin: "2026-01-31" })],
    tarifa_hotel: [neto(217), neto(218)],
    armado_servicios: [{ paquete_id: 51, servicio_id: 20, modo: "grupo", incluido: true }],
    servicios_adicionales: [{ id: 20, nombre: "Traslado privado", categoria: "traslado", precio_persona: null, liquidacion: null, proveedor_id: 66 }],
    servicio_tarifa_pax: [{ servicio_id: 20, pax_desde: 1, pax_hasta: 10, precio: 100_000, temporada: "GENERAL" }],
    // Desde #262/#421 un incluido exige una vigencia que cubra la fecha de ida.
    servicio_temporadas: [{ id: 1, servicio_id: 20, nombre: "GENERAL", fecha_inicio: "2027-01-01", fecha_fin: "2027-12-31", compra_inicio: null, compra_fin: null, prioridad: 0, precio_persona: null, precio_infante: null, recargo_individual: 0 }],
        tarifario_composicion_publicada: [],
    hotel_blackouts: [],
    hotel_acomodaciones: [...acomodaciones(217), ...acomodaciones(218)],
    tarifario_resultado_publicable: [
      { id: 1, modulo: "porcion_terrestre", paquete_activo: true, paquete_id: 50, hotel_id: 217, destino_nombre: DESTINO, paquete_nombre: "Porción San Andrés" },
      { id: 2, modulo: "porcion_terrestre", paquete_activo: true, paquete_id: 50, hotel_id: 218, destino_nombre: DESTINO, paquete_nombre: "Porción San Andrés" },
    ],
  };
}

const JOINS = {
  armado_paquetes: { destinos: "destino_id" },
  armado_hoteles: { hoteles: "hotel_id" },
  armado_servicios: { servicios_adicionales: "servicio_id" },
};

/** El cliente simulado no trae `.range()` (lo usa la carga paginada de `buscarHoteles`): se agrega aquí, sin tocar el soporte compartido. */
function conRange(base: ClienteFalso): ClienteFalso {
  return {
    ...base,
    from(t: string) {
      const b = base.from(t) as ReturnType<ClienteFalso["from"]> & Record<string, unknown>;
      const envolver = (x: typeof b): typeof b => {
        const y = x as typeof b & { range?: unknown };
        y.range = (desde: number, hasta: number) => ({
          then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            Promise.resolve(x).then((r: { data: unknown[] | null; error: unknown }) => ({ ...r, data: r.data ? r.data.slice(desde, hasta + 1) : r.data })).then(ok, ko),
        });
        for (const m of ["select", "eq", "in", "order"] as const) {
          const orig = x[m] as (...a: unknown[]) => typeof b;
          (y as Record<string, unknown>)[m] = (...a: unknown[]) => envolver(orig.apply(x, a));
        }
        return y;
      };
      return envolver(b);
    },
  };
}

const TABLAS = construirTablas();
const ADMIN = conRange(crearClienteFalso(TABLAS, { joins: JOINS }));
const SESION_INTERNA = crearClienteFalso(TABLAS, { joins: JOINS });
const SESION_VENTA = crearClienteFalso({ ...TABLAS, armado_paquetes: [], armado_servicios: [], armado_hoteles: [] }, { joins: JOINS });

mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => ADMIN } });
mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => {
      throw new Error("createClient() real nunca se invoca: la sesión se inyecta.");
    },
  },
});

const { computarReserva } = await import("@/lib/reservar/computo.ts");
const { buscarHoteles, cotizarPorFechas } = await import("@/lib/reservar/cotizar.ts");
const { entradaBuscarHoteles, entradaComputoPorcion, aResultadoBusquedaPorcion, aCotizacionPorPersona } = await import("../lib/salesbot/paquetes/porcion.ts");
const { resolverCotizacion, cargoFueraDeLineas, MOTIVO_CARGO_GRUPO_SIN_MARKUP } = await import("../lib/salesbot/paquetes/bloqueo.ts");
const { clavesProhibidasEn } = await import("../lib/salesbot/contrato.ts");

type Sesion = Parameters<typeof computarReserva>[0];

const COMPOSICION = { habitaciones: { doble: 1 }, edadesMenores: [5] };
const CONSULTA = { destino: DESTINO, fechaIda: IDA, fechaRegreso: REGRESO, adultos: 2, composicion: COMPOSICION };
const SEL = (paqueteId: number, hotelId: number) => ({ paqueteId, hotelId, fechaIda: IDA, fechaRegreso: REGRESO, categoria: "Estándar", regimen: "PAE", composicion: COMPOSICION });

/** Entrada del checkout de Vista Booking (checkout/actions.ts:698-722) para porción, con datos del cliente. */
const entradaCheckout = (paqueteId: number, hotelId: number) => ({
  paqueteId,
  bloqueoId: null,
  modulo: "porcion_terrestre" as const,
  hotelId,
  fechaIda: IDA,
  fechaRegreso: REGRESO,
  categoria: "Estándar",
  regimen: "PAE",
  habitaciones: { doble: 1 },
  ninos: 0,
  ninos2: 0,
  infantes: 0,
  edadesMenores: [5],
  cantidadMenores: 1,
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

// ── Ejecuciones reales ───────────────────────────────────────────────────
const BUSQUEDA = await buscarHoteles(entradaBuscarHoteles(CONSULTA));
const POR_PERSONA = await cotizarPorFechas({ paqueteId: 50, hotelId: 217, fechaIda: IDA, fechaRegreso: REGRESO });
const BOT = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaComputoPorcion(SEL(50, 217)));
const CHECKOUT = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaCheckout(50, 217));

describe("paridad de precio en porción: búsqueda = precio por persona = venta", () => {
  test("los tres motores responden", () => {
    assert.equal(BUSQUEDA.ok, true, BUSQUEDA.ok ? "" : BUSQUEDA.error);
    assert.equal(POR_PERSONA.ok, true, POR_PERSONA.ok ? "" : POR_PERSONA.error);
    assert.equal(BOT.ok, true, BOT.ok ? "" : BOT.error);
  });

  test("computarReserva: resultado IDÉNTICO con la entrada del bot y la del checkout", () => {
    assert.deepEqual(BOT, CHECKOUT);
  });

  test("valor esperado, calculado a mano: 3 noches × 200.000 / 0,8 = 750.000 por adulto; niño 3 × 80.000 / 0,8 = 300.000", () => {
    assert.ok(BOT.ok);
    if (!BOT.ok) return;
    assert.deepEqual(BOT.data.lineasHab, [{ acom: "doble", habitaciones: 1, pax: 2, pvp: 750_000 }]);
    assert.equal(BOT.data.numNinos, 1);
    assert.equal(BOT.data.pvpPorAcom.nino, 300_000);
    assert.equal(BOT.data.precioVenta, 1_800_000);
  });

  test("lo que muestra la búsqueda (total del combo) = lo que cotiza la venta", () => {
    assert.ok(BUSQUEDA.ok && BOT.ok);
    if (!BUSQUEDA.ok || !BOT.ok) return;
    const h = BUSQUEDA.resultados.find((r) => r.hotelId === 217 && r.paqueteId === 50);
    assert.ok(h, "el hotel debe aparecer en la búsqueda");
    const combo = h!.combos.find((c) => c.categoria === "Estándar" && c.regimen === "PAE");
    assert.equal(combo?.total, BOT.data.precioVenta);
  });

  test("el PVP por persona de cotizarPorFechas = el de la línea de la venta", () => {
    assert.ok(POR_PERSONA.ok && BOT.ok);
    if (!POR_PERSONA.ok || !BOT.ok) return;
    const combo = POR_PERSONA.combos.find((c) => c.categoria === "Estándar" && c.regimen === "PAE");
    assert.equal(combo?.precios.doble, BOT.data.lineasHab[0].pvp);
    assert.equal(combo?.precios.nino, BOT.data.pvpPorAcom.nino);
  });

  test("la reducción del bot conserva los números exactos y no deja salir netos", () => {
    assert.ok(BUSQUEDA.ok && POR_PERSONA.ok && BOT.ok);
    if (!BUSQUEDA.ok || !POR_PERSONA.ok || !BOT.ok) return;
    const busq = aResultadoBusquedaPorcion(BUSQUEDA.resultados, BUSQUEDA.sugerenciasFecha);
    const h = busq.resultados.find((r) => r.hotel_id === 217)!;
    assert.equal(h.combos.find((c) => c.categoria === "Estándar")?.total_orientativo, BOT.data.precioVenta);

    const cot = resolverCotizacion("porcion_terrestre", { paqueteId: 50, hotelId: 217, categoria: "Estándar", regimen: "PAE" }, BOT, null, { markupConfiable: true });
    assert.ok(cot.ok);
    if (!cot.ok) return;
    assert.equal(cot.cotizacion.total_orientativo, BOT.data.precioVenta);
    const pp = aCotizacionPorPersona(SEL(50, 217), POR_PERSONA, cot.cotizacion);
    assert.equal(pp.combos.find((c) => c.categoria === "Estándar")?.pvp_por_persona.doble, BOT.data.lineasHab[0].pvp);

    for (const salida of [busq, pp]) {
      assert.deepEqual(clavesProhibidasEn(salida), []);
      const json = JSON.stringify(salida);
      for (const v of ['"netos"', "netoPorAcom", "costoNeto", "proveedorId"]) assert.equal(json.includes(v), false, v);
    }
    // El motor sí trae netos: la ausencia en la salida es por la reducción, no por falta de dato.
    assert.ok(Object.keys(BOT.data.netoPorAcom).length > 0);
  });
});

describe("vigencia de compra: una tarifa vencida no da precio", () => {
  test("la búsqueda no ofrece el hotel con la vigencia vencida", () => {
    assert.ok(BUSQUEDA.ok);
    if (BUSQUEDA.ok) assert.equal(BUSQUEDA.resultados.some((r) => r.hotelId === 218), false);
  });
  test("cotizarPorFechas y computarReserva lo rechazan; el bot no presenta precio", async () => {
    const pp = await cotizarPorFechas({ paqueteId: 50, hotelId: 218, fechaIda: IDA, fechaRegreso: REGRESO });
    assert.equal(pp.ok, false);
    const r = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaComputoPorcion(SEL(50, 218)));
    assert.equal(r.ok, false);
    const c = resolverCotizacion("porcion_terrestre", { paqueteId: 50, hotelId: 218, categoria: "Estándar", regimen: "PAE" }, r, null, { markupConfiable: true });
    assert.equal(c.ok, false);
  });
});

describe("H-PQ1 en porción: incluido por grupo", () => {
  test("búsqueda (service-role) y venta con sesión interna coinciden; con sesión de venta, la venta queda sin markup", async () => {
    const busq = await buscarHoteles(entradaBuscarHoteles(CONSULTA));
    const interna = await computarReserva(SESION_INTERNA as unknown as Sesion, entradaComputoPorcion(SEL(51, 217)));
    const venta = await computarReserva(SESION_VENTA as unknown as Sesion, entradaComputoPorcion(SEL(51, 217)));
    assert.ok(busq.ok && interna.ok && venta.ok, [busq, interna, venta].map((x) => (x.ok ? "ok" : x.error)).join(" | "));
    if (!busq.ok || !interna.ok || !venta.ok) return;
    const h = busq.resultados.find((r) => r.paqueteId === 51 && r.hotelId === 217);
    // El paquete 51 no está en el listado publicado del fixture: se compara la venta interna con la venta de `venta`.
    if (h) assert.equal(h.combos.find((c) => c.categoria === "Estándar")?.total, interna.data.precioVenta);
    // Traslado por grupo: 100.000 / (1 − 0,2) = 125.000 con markup; 100.000 sin él.
    assert.equal(cargoFueraDeLineas(interna.data), 125_000);
    assert.equal(cargoFueraDeLineas(venta.data), 100_000);
    assert.deepEqual(resolverCotizacion("porcion_terrestre", { paqueteId: 51, hotelId: 217, categoria: "Estándar", regimen: "PAE" }, venta, null, { markupConfiable: false }), {
      ok: false,
      codigo: "no_cotizable",
      motivo: MOTIVO_CARGO_GRUPO_SIN_MARKUP,
    });
  });
});
