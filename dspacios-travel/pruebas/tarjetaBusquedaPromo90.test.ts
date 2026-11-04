import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFalso, type ClienteFalso, type FilaFalsa, type TablasFalsas } from "./support/fakeSupabase.ts";

// #90 — Tarjeta pública de la búsqueda POR FECHAS (buscarHoteles REAL): el precio que muestra y la etiqueta salen del MISMO cálculo (evaluarHotelPorFechas).
// EBB 1/2/3, Long Stay ganador, EBB + Long Stay simultáneos (solo la ganadora) y sin descuento. Las netas y temporadas base no se tocan.

process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";

let adminActual: ClienteFalso = crearClienteFalso({});
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => adminActual } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => adminActual } }); // la acción pública de la tarjeta usa createClient(); aquí ambos clientes ven el mismo fixture

const { buscarHoteles } = await import("@/lib/reservar/cotizar.ts");
const { cotizarTarjetaHotel } = await import("@/app/tarifario/cotizarTarjetaActions.ts");
const { marcar, redondearVenta } = await import("@/lib/calc/paquetes.ts");

const fechaBogota = (d: number) => new Date(Date.now() + d * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const PAQUETE = 61, HOTEL = 72, NETO_NOCHE = 100_000, MK = 0.2;
const REGLAS: FilaFalsa[] = [{ tipo: "ebb", umbral: 30, pct: 18, activa: true }, { tipo: "ebb", umbral: 60, pct: 23, activa: true }, { tipo: "ebb", umbral: 90, pct: 28, activa: true }, { tipo: "long_stay", umbral: 4, pct: 25, activa: true }];

function tablas(reglas: FilaFalsa[]): TablasFalsas {
  return {
    tarifario_resultado_publicable: [{ paquete_id: PAQUETE, hotel_id: HOTEL, destino_nombre: "SAN ANDRES", paquete_nombre: "Porción San Andrés", modulo: "porcion_terrestre", paquete_activo: true, id: 1 }],
    hoteles: [{ id: HOTEL, modelo_tarifario: "persona", nombre: "Grand Sirenis", moneda: "COP", edad_infante_min: 0, edad_infante_max: 2, edad_nino_min: 3, edad_nino_max: 12, pax_min: 1, pax_max: 4, adults_only: false, destino_id: 1, destinos: { nombre: "SAN ANDRES" } }],
    armado_paquetes: [{ id: PAQUETE, pct_mk: MK, impuesto_tipo: "fijo", impuesto_fijo: 0, destino_id: 1, tipo: "porcion_terrestre", noches: 3, fecha_viaje_inicio: "2000-01-01", fecha_viaje_fin: "2099-12-31", modo_oferta: "legacy", destinos: { nombre: "SAN ANDRES" } }],
    armado_hoteles: [{ paquete_id: PAQUETE, hotel_id: HOTEL, categorias: null, regimenes: null, hoteles: { nombre: "Grand Sirenis", moneda: "COP" } }],
    armado_servicios: [], servicios_adicionales: [], servicio_temporadas: [], servicio_tarifa_pax: [],
    hotel_temporadas: [{ id: 1, hotel_id: HOTEL, nombre: "Base", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: null, blackouts: null, min_noches: null, regimen_restringido: null }],
    tarifa_hotel: [{ id: 10, hotel_id: HOTEL, tipo_habitacion: "Estándar King", alimentacion: "FULL", temporada: "Base", neto_sencilla: null, neto_doble: NETO_NOCHE, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, precio_final_autoritativo: false }],
    hotel_blackouts: [],
    hotel_acomodaciones: [{ hotel_id: HOTEL, acomodacion: "doble", pax_tarifa: 2, pax_max: 4, adt_min: 1, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 }],
    hotel_reglas_descuento: reglas.map((r) => ({ hotel_id: HOTEL, ...r })),
  };
}

async function buscar(diasAnticipo: number, noches: number, reglas = REGLAS) {
  const t = tablas(reglas);
  const baseAntes = JSON.stringify([t.tarifa_hotel, t.hotel_temporadas]);
  adminActual = crearClienteFalso(t);
  const r = await buscarHoteles({ fechaIda: fechaBogota(diasAnticipo), fechaRegreso: fechaBogota(diasAnticipo + noches), habitaciones: [{ acom: "doble" }], adultos: 2, cantidadMenores: 0, edadesMenores: [] });
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  assert.equal(JSON.stringify([t.tarifa_hotel, t.hotel_temporadas]), baseAntes, "netas y temporadas originales intactas");
  return r.ok ? r.resultados : [];
}
// Total esperado, calculado aparte: 2 pax en una doble; neta por noche con el % de la regla anunciada, markup y redondeo de venta.
const esperado = (noches: number, pct: number) => 2 * redondearVenta(marcar(Math.round(NETO_NOCHE * noches * (1 - pct / 100)), MK), "COP");

describe("tarjeta de búsqueda por fechas: etiqueta y precio del mismo cálculo", () => {
  const casos: [string, number, number, string | null, number][] = [
    ["EBB 1 (30 días)", 30, 3, "EBB 1 · 30+ días · 18 %", 18],
    ["EBB 2 (60 días)", 60, 3, "EBB 2 · 60+ días · 23 %", 23],
    ["EBB 3 (90 días)", 90, 3, "EBB 3 · 90+ días · 28 %", 28],
    ["Long Stay ganador (10 días, 4 noches)", 10, 4, "Long Stay · 25 %", 25],
    ["EBB 3 y Long Stay a la vez: solo la ganadora (28 % > 25 %)", 90, 4, "EBB 3 · 90+ días · 28 %", 28],
    ["Long Stay gana a EBB 1 (45 días, 4 noches: 25 % > 18 %)", 45, 4, "Long Stay · 25 %", 25],
    ["sin descuento (29 días, 3 noches)", 29, 3, null, 0],
  ];
  for (const [nombre, dias, noches, etiqueta, pct] of casos) {
    test(nombre, async () => {
      const [r] = await buscar(dias, noches);
      assert.ok(r, "el hotel aparece con precio para esas fechas");
      assert.equal(r.descuentoHotel?.etiqueta ?? null, etiqueta);
      assert.equal(r.total, esperado(noches, pct), "el precio de la tarjeta corresponde exactamente a la promoción indicada (o a la base si no hay)");
      assert.equal(r.combos[0].total, r.total);
    });
  }
  test("una regla inactiva no se aplica ni se etiqueta", async () => {
    const [r] = await buscar(90, 3, REGLAS.map((x) => (x.umbral === 90 ? { ...x, activa: false } : x)));
    assert.equal(r.descuentoHotel?.etiqueta, "EBB 2 · 60+ días · 23 %");
    assert.equal(r.total, esperado(3, 23));
  });
  test("sin reglas cargadas el precio es el base y no hay etiqueta", async () => {
    const [r] = await buscar(90, 4, []);
    assert.equal(r.descuentoHotel ?? null, null);
    assert.equal(r.total, esperado(4, 0));
  });
});

// Tarjeta «desde» de porción terrestre: al elegir fechas, la acción pública cotiza con el motor en vivo (computarReserva) y devuelve precio + etiqueta del MISMO cálculo.
describe("tarjeta pública de porción terrestre al elegir fechas (cotizarTarjetaHotel)", () => {
  async function tarjeta(diasAnticipo: number, noches: number, reglas = REGLAS) {
    adminActual = crearClienteFalso(tablas(reglas));
    return cotizarTarjetaHotel({ modulo: "porcion_terrestre", paqueteId: PAQUETE, hotelId: HOTEL, fechaIda: fechaBogota(diasAnticipo), fechaRegreso: fechaBogota(diasAnticipo + noches), combos: [{ categoria: "Estándar King", regimen: "FULL" }] });
  }
  const casos: [string, number, number, string | null, number][] = [
    ["EBB 1", 30, 3, "EBB 1 · 30+ días · 18 %", 18], ["EBB 2", 60, 3, "EBB 2 · 60+ días · 23 %", 23], ["EBB 3", 90, 3, "EBB 3 · 90+ días · 28 %", 28],
    ["Long Stay ganador", 10, 4, "Long Stay · 25 %", 25], ["EBB 3 y Long Stay a la vez: solo la ganadora", 90, 4, "EBB 3 · 90+ días · 28 %", 28], ["sin descuento", 29, 3, null, 0],
  ];
  for (const [nombre, dias, noches, etiqueta, pct] of casos) {
    test(nombre, async () => {
      const r = await tarjeta(dias, noches);
      assert.equal(r.ok, true, r.ok ? "" : r.error);
      if (!r.ok) return;
      assert.equal(r.descuentoHotel?.etiqueta ?? null, etiqueta);
      // Por persona (la tarjeta muestra por persona): el total de la búsqueda de 2 pax / 2.
      assert.equal(r.precio, esperado(noches, pct) / 2);
      assert.equal(r.noches, noches);
      // Y es el mismo precio y la misma regla que la tarjeta de búsqueda por fechas.
      adminActual = crearClienteFalso(tablas(REGLAS));
      const b = await buscarHoteles({ fechaIda: fechaBogota(dias), fechaRegreso: fechaBogota(dias + noches), habitaciones: [{ acom: "doble" }], adultos: 2, cantidadMenores: 0, edadesMenores: [] });
      assert.ok(b.ok && b.resultados[0]);
      if (b.ok) { assert.equal(b.resultados[0].total / 2, r.precio); assert.equal(b.resultados[0].descuentoHotel?.etiqueta ?? null, r.descuentoHotel?.etiqueta ?? null); }
    });
  }
  test("con dos combinaciones se muestra la más barata y la etiqueta es la del descuento de la estadía (no se suma por combinación)", async () => {
    const t = tablas(REGLAS);
    t.tarifa_hotel.push({ ...t.tarifa_hotel[0], id: 11, tipo_habitacion: "Superior", neto_doble: NETO_NOCHE * 2 });
    adminActual = crearClienteFalso(t);
    const r = await cotizarTarjetaHotel({ modulo: "porcion_terrestre", paqueteId: PAQUETE, hotelId: HOTEL, fechaIda: fechaBogota(60), fechaRegreso: fechaBogota(63), combos: [{ categoria: "Superior", regimen: "FULL" }, { categoria: "Estándar King", regimen: "FULL" }] });
    assert.ok(r.ok);
    if (r.ok) { assert.equal(r.categoria, "Estándar King"); assert.equal(r.precio, esperado(3, 23) / 2); assert.equal(r.descuentoHotel?.etiqueta, "EBB 2 · 60+ días · 23 %"); }
  });
});
