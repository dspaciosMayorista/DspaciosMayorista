import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolverDescuentoHotel, aplicarDescuentoNeta, diasEntre, type ReglaDescuentoHotel } from "../lib/calc/descuentoHotel.ts";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaTemporadaHotelRaw, type FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";

// #90 — EBB (días entre reserva y check-in) y Long Stay (noches). Un solo
// descuento: el MAYOR %. BASE: la neta hotelera, ANTES del markup.
// Configuración de ejemplo (datos, no código del hotel): EBB 30/60/90 = 18/23/28 %, Long Stay 4 = 25 %.
const REGLAS: ReglaDescuentoHotel[] = [
  { tipo: "ebb", umbral: 30, pct: 18 },
  { tipo: "ebb", umbral: 60, pct: 23 },
  { tipo: "ebb", umbral: 90, pct: 28 },
  { tipo: "long_stay", umbral: 4, pct: 25 },
];
const RESERVA = "2026-03-01";
const ida = (dias: number) => new Date(Date.parse(`${RESERVA}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const pct = (dias: number, noches: number) => resolverDescuentoHotel(REGLAS, { fechaReserva: RESERVA, fechaIda: ida(dias), numNoches: noches })?.pct ?? 0;

describe("1. límites de EBB (días de anticipación) con 3 noches", () => {
  test("29/30, 59/60 y 89/90 días", () => {
    assert.equal(pct(29, 3), 0);
    assert.equal(pct(30, 3), 18);
    assert.equal(pct(59, 3), 18);
    assert.equal(pct(60, 3), 23);
    assert.equal(pct(89, 3), 23);
    assert.equal(pct(90, 3), 28);
    assert.equal(pct(400, 3), 28);
  });
  test("check-in el mismo día o en el pasado nunca descuenta", () => {
    assert.equal(pct(0, 3), 0);
    assert.equal(pct(-5, 3), 0);
  });
});

describe("2. límites de Long Stay y solapamiento (nunca se suma ni se encadena)", () => {
  test("3 noches sin Long Stay, 4 noches con 25 %", () => {
    assert.equal(pct(10, 3), 0);
    assert.equal(pct(10, 4), 25);
  });
  test("EBB 18 % + Long Stay 25 % → 25 % (no 43 %, no 38,5 %)", () => assert.equal(pct(45, 4), 25));
  test("EBB 23 % + Long Stay 25 % → 25 %", () => assert.equal(pct(75, 6), 25));
  test("EBB 28 % + Long Stay 25 % → 28 %", () => assert.equal(pct(120, 4), 28));
  test("sin condición cumplida → null (tarifa base)", () => {
    assert.equal(resolverDescuentoHotel(REGLAS, { fechaReserva: RESERVA, fechaIda: ida(10), numNoches: 3 }), null);
    assert.equal(resolverDescuentoHotel([], { fechaReserva: RESERVA, fechaIda: ida(120), numNoches: 9 }), null);
    assert.equal(resolverDescuentoHotel(undefined, { fechaReserva: RESERVA, fechaIda: ida(120), numNoches: 9 }), null);
  });
  test("reglas inactivas o inválidas se ignoran (fallan hacia sin descuento)", () => {
    const malas: ReglaDescuentoHotel[] = [
      { tipo: "ebb", umbral: 30, pct: 50, activa: false },
      { tipo: "ebb", umbral: 30, pct: 100 },
      { tipo: "ebb", umbral: 0, pct: 10 },
      { tipo: "long_stay", umbral: 2, pct: -5 },
      { tipo: "long_stay", umbral: Number.NaN, pct: 10 },
    ];
    assert.equal(resolverDescuentoHotel(malas, { fechaReserva: RESERVA, fechaIda: ida(100), numNoches: 9 }), null);
  });
  test("fechas inválidas no producen descuento EBB", () => {
    assert.ok(Number.isNaN(diasEntre("x", "2026-01-01")));
    assert.equal(resolverDescuentoHotel(REGLAS, { fechaReserva: "x", fechaIda: "2026-05-01", numNoches: 3 }), null);
  });
});

describe("3. aplicarDescuentoNeta — redondeo por moneda", () => {
  const d = { tipo: "ebb" as const, umbral: 30, pct: 18 };
  test("COP a peso entero, USD a centavos, null no cambia nada", () => {
    assert.equal(aplicarDescuentoNeta(301_234, d, "COP"), 247_012);
    assert.equal(aplicarDescuentoNeta(301.65, d, "USD"), 247.35);
    assert.equal(aplicarDescuentoNeta(301.65, null, "USD"), 301.65);
  });
});

// ── Integración con el motor real de liquidación por fechas ──
function temp(nombre: string, ini: string, fin: string): FilaTemporadaHotelRaw {
  return { nombre, fecha_inicio: ini, fecha_fin: fin, prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null };
}
function tar(temporada: string, o: Partial<FilaTarifaHotelRaw> = {}): FilaTarifaHotelRaw {
  return { tipo_habitacion: "Estandar", alimentacion: "FULL", temporada, neto_sencilla: 150_000, neto_doble: 100_000, neto_triple: null, neto_multiple: null, neto_nino: 50_000, neto_nino2: 30_000, neto_infante: 20_000, ...o };
}
function datos(o: Partial<DatosHotelPaquete> = {}): DatosHotelPaquete {
  return {
    paquete: { pct_mk: 0.2, impuesto_fijo: 0, destino_nombre: "San Andres", fecha_viaje_inicio: "2026-01-01", fecha_viaje_fin: "2027-12-31" },
    armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel X", hotel_moneda: "COP" },
    temporadas: [temp("ANUAL", "2026-01-01", "2027-12-31")],
    tarifas: [tar("ANUAL")],
    serviciosIncluidos: [], blackouts: [],
    reglasDescuento: REGLAS, fechaReserva: RESERVA,
    ...o,
  };
}
const combo = (r: ReturnType<typeof evaluarHotelPorFechas>) => r!.combos[0];

describe("4. integración: la base es la NETA hotelera, antes del markup", () => {
  test("sin reglas = tarifa base de siempre (neto 300.000 → PVP 375.000)", () => {
    const r = evaluarHotelPorFechas(datos({ reglasDescuento: [] }), ida(10), 3);
    assert.equal(combo(r).netos!.doble, 300_000);
    assert.equal(combo(r).precios.doble, 375_000);
    assert.equal(r!.descuentoHotel, null);
  });
  test("EBB 30 días: neta 300.000 × 0,82 = 246.000 → /(1−0,20) = 307.500 → 308.000 (redondeo de venta)", () => {
    const r = evaluarHotelPorFechas(datos(), ida(30), 3);
    assert.equal(combo(r).netos!.doble, 246_000);
    assert.equal(combo(r).precios.doble, 308_000);
    assert.equal(r!.descuentoHotel?.pct, 18);
  });
  test("29 días: sin descuento", () => {
    const r = evaluarHotelPorFechas(datos(), ida(29), 3);
    assert.equal(combo(r).netos!.doble, 300_000);
  });
  test("servicios incluidos y vuelo NO se descuentan: solo cambia el aporte del hotel", () => {
    const vuelo = { aporte: 400_000, feeInfante: 0 };
    const base = evaluarHotelPorFechas(datos({ reglasDescuento: [], vuelo }), ida(90), 3);
    const con = evaluarHotelPorFechas(datos({ vuelo }), ida(90), 3);
    // base: (300.000/0,8)+400.000 = 775.000 ; con 28 %: (216.000/0,8)+400.000 = 670.000
    assert.equal(combo(base).precios.doble, 775_000);
    assert.equal(combo(con).precios.doble, 670_000);
  });
  test("Long Stay 4 noches cruzando temporadas: descuento sobre la suma noche por noche", () => {
    const d = datos({
      temporadas: [temp("ALTA", "2026-09-01", "2026-09-15"), temp("MEDIA", "2026-09-16", "2026-09-30")],
      tarifas: [tar("ALTA"), tar("MEDIA", { neto_doble: 80_000 })],
      fechaReserva: "2026-09-10",
    });
    const r = evaluarHotelPorFechas(d, "2026-09-14", 4); // 2×100.000 + 2×80.000 = 360.000 × 0,75
    assert.equal(combo(r).netos!.doble, 270_000);
    assert.equal(r!.descuentoHotel?.tipo, "long_stay");
    const tres = evaluarHotelPorFechas(d, "2026-09-14", 3); // 4 noches sí, 3 no (reserva 4 días antes: tampoco EBB)
    assert.equal(combo(tres).netos!.doble, 280_000);
  });
  test("menores: niño e infante reciben el mismo descuento sobre su neta", () => {
    const r = evaluarHotelPorFechas(datos(), ida(60), 3); // 23 %
    assert.equal(combo(r).netos!.nino, 115_500);   // 150.000 × 0,77
    assert.equal(combo(r).netos!.nino2, 69_300);   // 90.000 × 0,77
    assert.equal(combo(r).netos!.infante, 46_200); // 60.000 × 0,77
  });
  test("USD: centavos, y la moneda se conserva", () => {
    const d = datos({ armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "H", hotel_moneda: "USD" }, tarifas: [tar("ANUAL", { neto_doble: 100.55 })] });
    const r = evaluarHotelPorFechas(d, ida(30), 3); // 301,65 × 0,82 = 247,353
    assert.equal(combo(r).netos!.doble, 247.35);
    assert.equal(r!.moneda, "USD");
  });
  test("la fecha de reserva sale del dato del servidor: el mismo viaje cotizado más tarde pierde el porcentaje", () => {
    const viaje = "2026-06-01";
    const temprano = evaluarHotelPorFechas(datos({ fechaReserva: "2026-03-03" }), viaje, 3); // 90 días
    const tarde = evaluarHotelPorFechas(datos({ fechaReserva: "2026-03-04" }), viaje, 3);    // 89 días
    assert.equal(temprano!.descuentoHotel?.pct, 28);
    assert.equal(tarde!.descuentoHotel?.pct, 23);
    assert.ok(combo(tarde).precios.doble > combo(temprano).precios.doble, "un precio cotizado antes NO es el de hoy: la conversión debe detectar el cambio");
  });
});
