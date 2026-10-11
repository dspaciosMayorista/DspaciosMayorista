// EJECUCIÓN REAL de `crearSolicitudReserva` (app/tarifario/checkout/actions.ts)
// con el vínculo hotel ↔ servicios adicionales. Se reemplazan SOLO las
// fronteras externas (Supabase, `next/headers`) y los motores de
// liquidación (`computarReserva`, `computarReservaBernalo`,
// `liquidarServicioPuntual`) por dobles deterministas — la validación de
// entrada, el vínculo, las decisiones de inclusión/exclusión, la suma y el
// insert de la cotización son el código de producción tal cual.
//
// Reglas probadas:
//   · el vínculo es una declaración del navegador: se valida contra la propia
//     solicitud (hotel presente, mismo paquete) y contra lo que el servidor
//     resolvió para el hotel (fechas, pasajeros);
//   · un hotel con servicios vinculados se cotiza COMPLETO o la solicitud
//     falla con un mensaje claro — nunca cotización parcial del conjunto;
//   · hoteles sin servicios y tours independientes conservan el
//     comportamiento de siempre (exclusión avisada, la cotización sigue).
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

type Insert = { tabla: string; fila: Record<string, unknown> };
const inserts: Insert[] = [];
function clienteFalso() {
  const builder = (tabla: string) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b, eq: () => b, order: () => b, limit: () => b, in: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: { id: 77, codigo: "COT-77", share_token: "tok" }, error: null }),
      insert: (fila: Record<string, unknown>) => { inserts.push({ tabla, fila }); return b; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko),
    });
    return b;
  };
  return { from: builder, auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
}

// Hoteles que "resuelve el servidor": moneda, fechas autoritativas y pax.
type HotelFalso = { nombre: string; moneda: string; ida: string; regreso: string; pax: number; pvp: number; infantes?: number };
const HOTELES: Record<number, HotelFalso> = {
  1: { nombre: "Hotel Almirante", moneda: "COP", ida: "2030-03-01", regreso: "2030-03-04", pax: 2, pvp: 600_000 },
  2: { nombre: "Hotel Caribe", moneda: "COP", ida: "2030-03-04", regreso: "2030-03-07", pax: 2, pvp: 500_000 },
  3: { nombre: "Hotel Dólar", moneda: "USD", ida: "2030-03-01", regreso: "2030-03-04", pax: 2, pvp: 300 },
  // 4 adultos.
  4: { nombre: "Hotel Familiar", moneda: "COP", ida: "2030-03-01", regreso: "2030-03-04", pax: 4, pvp: 400_000 },
  // 2 adultos + 1 infante (gratis): el servidor re-liquida 3 viajeros.
  5: { nombre: "Hotel con bebé", moneda: "COP", ida: "2030-03-01", regreso: "2030-03-04", pax: 2, pvp: 500_000, infantes: 1 },
};
mock.module("@/lib/reservar/computo", {
  namedExports: {
    computarReserva: async (_sb: unknown, r: { hotelId: number }) => {
      const h = HOTELES[r.hotelId];
      return {
        ok: true,
        data: {
          meta: { hotel_nombre: h.nombre, destino_nombre: "CARTAGENA", fecha_ida: h.ida, fecha_regreso: h.regreso },
          precioVenta: h.pvp * h.pax, monedaReserva: h.moneda,
          lineasHab: [{ acom: "doble", habitaciones: 1, pax: h.pax, pvp: h.pvp }], pvpPorAcom: { doble: h.pvp },
          numNinos: 0, numNinos2: 0, numInfantes: h.infantes ?? 0, totalPax: h.pax + (h.infantes ?? 0),
          edadesMenoresUsadas: h.infantes ? [1] : [], serviciosIncluidos: [],
          distribucionMenores: [], condicionesTarifa: null,
        },
      };
    },
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", {
  namedExports: { computarReservaBernalo: async () => { throw new Error("no se usa en esta prueba"); } },
});
// Servicios publicados: clave paquete-servicio → precio/moneda. Lo que no
// está aquí "no está disponible para esas fechas/pax".
let SERVICIOS: Record<string, { nombre: string; total: number; moneda: string }> = {};
mock.module("@/lib/reservar/cotizar", {
  namedExports: {
    liquidarServicioPuntual: async (t: { paqueteId: number; servicioId: number; pax: number }) => {
      const s = SERVICIOS[`${t.paqueteId}-${t.servicioId}`];
      if (!s) return { ok: false, tipo: "no_disponible", mensaje: "Ese servicio no está disponible para esas fechas." };
      return { ok: true, resultado: { servicioId: t.servicioId, paqueteId: t.paqueteId, nombre: s.nombre, destino: "CARTAGENA", descripcion: null, total: s.total, pax: t.pax, noches: 3, moneda: s.moneda, categoria: "tour" } };
    },
  },
});
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => clienteFalso() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => clienteFalso() } });
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]) } });

const { crearSolicitudReserva } = await import("../app/tarifario/checkout/actions.ts");
const { vinculoTourCotizacion } = await import("../lib/reservar/vinculoServiciosCheckout.ts");

const cliente = { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "3000000000", email: "ana@example.com" };
function hotel(itemId: string | undefined, hotelId: number, paqueteId: number) {
  const h = HOTELES[hotelId];
  return {
    ...(itemId ? { itemId } : {}),
    modulo: "porcion_terrestre", paqueteId, hotelId, bloqueoId: null, hotelNombre: h.nombre, destino: "CARTAGENA",
    categoria: "Estandar", regimen: "Desayuno", fechaIda: h.ida, fechaRegreso: h.regreso, noches: 3,
    habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pax: h.pax, precio: 1, edadesMenores: [], cantidadMenores: 0,
  };
}
const tour = (servicioId: number, paqueteId: number, hotelItemId: string | null, ida = "2030-03-01", regreso = "2030-03-04", pax = 2) =>
  ({ servicioId, paqueteId, fechaIda: ida, fechaRegreso: regreso, pax, ...(hotelItemId !== undefined ? { hotelItemId } : {}) });

const cotizaciones = () => inserts.filter((i) => i.tabla === "cotizaciones").map((i) => i.fila);
async function enviar(items: unknown[], tours: unknown[]) {
  return crearSolicitudReserva({ items, tours, cliente }) as Promise<{ ok: boolean; error?: string }>;
}

describe("checkout — vínculo hotel ↔ servicios adicionales (ejecución real)", () => {
  beforeEach(() => {
    inserts.length = 0;
    SERVICIOS = {
      "10-55": { nombre: "Islas del Rosario", total: 180_000, moneda: "COP" },
      "10-56": { nombre: "City tour", total: 85_000, moneda: "COP" },
      "30-70": { nombre: "Chiva rumbera", total: 70_000, moneda: "COP" },
      "40-80": { nombre: "Tour independiente", total: 50_000, moneda: "COP" },
      "10-90": { nombre: "Tour en dólares", total: 40, moneda: "USD" },
    };
  });

  test("hotel + servicios válidos: una cotización con el hotel y sus servicios, precios del servidor", async () => {
    const r = await enviar([hotel("hA", 1, 10)], [tour(55, 10, "hA"), tour(56, 10, "hA")]);
    assert.equal(r.ok, true, r.error);
    const [cot] = cotizaciones();
    assert.equal(cot.precio_venta, 1_200_000 + 180_000 + 85_000);
    const payload = cot.payload as { items: unknown[]; tours: { servicioId: number; precio: number }[] };
    assert.equal(payload.items.length, 1);
    assert.deepEqual(payload.tours.map((t) => [t.servicioId, t.precio]), [[55, 180_000], [56, 85_000]]);
  });

  test("hotel excluido (otra moneda) con servicios vinculados: error claro y NINGUNA cotización", async () => {
    const r = await enviar([hotel("hA", 1, 10), hotel("hU", 3, 20)], [tour(90, 20, "hU")]);
    assert.equal(r.ok, false);
    assert.match(r.error!, /No se pudo cotizar «Hotel Dólar» con sus servicios adicionales: está en USD y el resto del carrito en COP/);
    assert.equal(cotizaciones().length, 0);
  });

  test("control: el MISMO hotel en otra moneda SIN servicios se sigue excluyendo como siempre (la cotización sigue)", async () => {
    const r = await enviar([hotel("hA", 1, 10), hotel("hU", 3, 20)], []);
    assert.equal(r.ok, true, r.error);
    assert.equal(cotizaciones()[0].precio_venta, 1_200_000);
  });

  test("servicio vinculado no disponible: el conjunto completo falla, sin cotización parcial", async () => {
    delete SERVICIOS["10-56"];
    const r = await enviar([hotel("hA", 1, 10)], [tour(55, 10, "hA"), tour(56, 10, "hA")]);
    assert.equal(r.ok, false);
    assert.match(r.error!, /«Hotel Almirante» con sus servicios adicionales: el servicio #56 no se pudo cotizar/);
    assert.equal(cotizaciones().length, 0);
  });

  test("servicio vinculado en otra moneda que su hotel: error claro, sin cotización", async () => {
    const r = await enviar([hotel("hA", 1, 10)], [tour(90, 10, "hA")]);
    assert.equal(r.ok, false);
    assert.match(r.error!, /el servicio «Tour en dólares» está en USD y el hotel en COP/);
    assert.equal(cotizaciones().length, 0);
  });

  test("dos hoteles con servicios propios: cada servicio se valida contra SU hotel y entra al conjunto correcto", async () => {
    const r = await enviar(
      [hotel("hA", 1, 10), hotel("hC", 2, 30)],
      [tour(55, 10, "hA"), tour(70, 30, "hC", "2030-03-04", "2030-03-07")],
    );
    assert.equal(r.ok, true, r.error);
    assert.equal(cotizaciones()[0].precio_venta, 1_200_000 + 1_000_000 + 180_000 + 70_000);
  });

  test("dos hoteles: un servicio con las fechas del OTRO hotel se rechaza (fechas autoritativas del servidor)", async () => {
    const r = await enviar([hotel("hA", 1, 10), hotel("hC", 2, 30)], [tour(70, 30, "hC", "2030-03-01", "2030-03-04")]);
    assert.equal(r.ok, false);
    assert.match(r.error!, /«Hotel Caribe».*sus fechas no coinciden con las confirmadas para el hotel/);
    assert.equal(cotizaciones().length, 0);
  });

  test("el navegador no puede cruzar vínculos: servicio de otro paquete o hotel inexistente se rechaza en la frontera", async () => {
    const cruzado = await enviar([hotel("hA", 1, 10), hotel("hC", 2, 30)], [tour(70, 30, "hA")]);
    assert.equal(cruzado.ok, false);
    assert.match(cruzado.error!, /no pertenece al paquete de «Hotel Almirante»/);
    const fantasma = await enviar([hotel("hA", 1, 10)], [tour(55, 10, "no-existe")]);
    assert.equal(fantasma.ok, false);
    assert.match(fantasma.error!, /pertenece a un hotel que ya no está en la solicitud/);
    const repetido = await enviar([hotel("hA", 1, 10)], [tour(55, 10, "hA"), tour(55, 10, "hA")]);
    assert.equal(repetido.ok, false);
    assert.match(repetido.error!, /está repetido para «Hotel Almirante»/);
    assert.equal(cotizaciones().length, 0);
  });

  test("pax exacto: una solicitud alterada con 1 pax para un hotel de 4 adultos se rechaza (y con 5 también)", async () => {
    const uno = await enviar([hotel("hF", 4, 10)], [tour(55, 10, "hF", "2030-03-01", "2030-03-04", 1)]);
    assert.equal(uno.ok, false);
    assert.match(uno.error!, /«Hotel Familiar».*debe cotizarse para los 4 viajeros del hotel \(infantes incluidos\) y la solicitud trae 1/);
    const cinco = await enviar([hotel("hF", 4, 10)], [tour(55, 10, "hF", "2030-03-01", "2030-03-04", 5)]);
    assert.equal(cinco.ok, false);
    assert.match(cinco.error!, /trae 5/);
    assert.equal(cotizaciones().length, 0);
    const cuatro = await enviar([hotel("hF", 4, 10)], [tour(55, 10, "hF", "2030-03-01", "2030-03-04", 4)]);
    assert.equal(cuatro.ok, true, cuatro.error);
  });

  test("infantes: el servicio vinculado cuenta TODOS los viajeros re-liquidados (2 adultos + 1 infante = 3)", async () => {
    const sinInfante = await enviar([hotel("hB", 5, 10)], [tour(55, 10, "hB", "2030-03-01", "2030-03-04", 2)]);
    assert.equal(sinInfante.ok, false);
    assert.match(sinInfante.error!, /debe cotizarse para los 3 viajeros del hotel/);
    assert.equal(cotizaciones().length, 0);
    const conInfante = await enviar([hotel("hB", 5, 10)], [tour(55, 10, "hB", "2030-03-01", "2030-03-04", 3)]);
    assert.equal(conInfante.ok, true, conInfante.error);
  });

  test("payload: dos hoteles del MISMO paquete conservan dos vínculos inequívocos (ref del servidor, nunca el id de localStorage)", async () => {
    const r = await enviar(
      [hotel("1791-aaaa", 1, 10), hotel("1791-bbbb", 2, 10)],
      [tour(55, 10, "1791-bbbb", "2030-03-04", "2030-03-07"), tour(55, 10, "1791-aaaa"), tour(80, 40, null, "2030-05-01", "2030-05-03")],
    );
    assert.equal(r.ok, true, r.error);
    const payload = cotizaciones()[0].payload as { items: { ref: string; hotelId: number }[]; tours: { servicioId: number; hotelRef: string | null }[] };
    assert.deepEqual(payload.items.map((i) => [i.ref, i.hotelId]), [["item-0", 1], ["item-1", 2]]);
    assert.deepEqual(payload.tours.map((t) => t.hotelRef), ["item-1", "item-0", null]);
    assert.doesNotMatch(JSON.stringify(cotizaciones()[0]), /1791-aaaa|1791-bbbb/, "el id de localStorage no se guarda");
    // El lector resuelve cada vínculo a SU hotel, sin ambigüedad.
    assert.deepEqual(payload.tours.map((t) => vinculoTourCotizacion(t, payload.items)), [
      { tipo: "hotel", indice: 1 }, { tipo: "hotel", indice: 0 }, { tipo: "independiente" },
    ]);
  });

  test("tour independiente (Receptivos) no disponible: se excluye como siempre y la cotización sigue", async () => {
    const r = await enviar([hotel("hA", 1, 10)], [tour(55, 10, "hA"), tour(81, 40, null)]);
    assert.equal(r.ok, true, r.error);
    assert.equal(cotizaciones()[0].precio_venta, 1_200_000 + 180_000);
  });

  test("tour independiente disponible: entra aunque no tenga hotel ni coincida en fechas", async () => {
    const r = await enviar([hotel(undefined, 1, 10)], [tour(80, 40, null, "2030-05-01", "2030-05-03")]);
    assert.equal(r.ok, true, r.error);
    assert.equal(cotizaciones()[0].precio_venta, 1_200_000 + 50_000);
  });
});

describe("cotizaciones guardadas — lectura del vínculo (nuevas y anteriores)", () => {
  test("cotización ANTERIOR (tours sin hotelRef): todos se leen como independientes, como siempre", () => {
    const items = [{ ref: "item-0" }, { ref: "item-1" }];
    const tours = [{ servicioId: 55, paqueteId: 10 }, { servicioId: 80, paqueteId: 40, hotelRef: null }];
    assert.deepEqual(tours.map((t) => vinculoTourCotizacion(t, items)), [{ tipo: "independiente" }, { tipo: "independiente" }]);
  });
  test("cotización anterior SIN ref en los ítems y sin hotelRef en los tours: se sigue leyendo", () => {
    assert.deepEqual(vinculoTourCotizacion({}, [{}, {}]), { tipo: "independiente" });
  });
  test("hotelRef que no existe, repetido o con tipo inválido: 'invalido' (la conversión debe rechazarlo, nunca adivinar)", () => {
    assert.deepEqual(vinculoTourCotizacion({ hotelRef: "item-9" }, [{ ref: "item-0" }]), { tipo: "invalido" });
    assert.deepEqual(vinculoTourCotizacion({ hotelRef: "item-0" }, [{ ref: "item-0" }, { ref: "item-0" }]), { tipo: "invalido" });
    assert.deepEqual(vinculoTourCotizacion({ hotelRef: 3 }, [{ ref: "item-0" }]), { tipo: "invalido" });
  });
});
