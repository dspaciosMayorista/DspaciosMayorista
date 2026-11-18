import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liquidarHotelNochesConTemporadas, toTemporadaRango, marcar, componerTarifa, type NocheNinoGratis } from "../lib/calc/paquetes.ts";
import type { FilaTemporadaHotelRaw, FilaTarifaHotelRaw } from "../lib/reservar/liquidacionHotel.ts";
import { basesPromoDeFilas, filasPorClave, netosDeColumna } from "../lib/calc/netosPorTemporada.ts";
import { calcularBeneficioNinoGratis, type HabitacionOcupada } from "../lib/hoteles/ninoGratis.ts";
import { ajustarNochesNinoGratis, ventaNinoCondonada, type BaseVentaNino } from "../lib/reservar/ninoGratisPrecio.ts";
import { aplicarDescuentoNeta } from "../lib/calc/descuentoHotel.ts";
import { construirResumenCarrito, type UnidadBase } from "../lib/cotizacion/resumenCarrito.ts";

// #125 R1/R2 de la re-auditoría — promociones SUCESIVAS que regalan alojamiento al MISMO niño (o a niños distintos): lo condonado se suma por niño real y su precio de venta se
// recompone y redondea UNA sola vez; el resumen por pasajero consume todo lo condonado de cada pasajero.
const HOY = "2026-11-17";
const raw = (o: Partial<FilaTemporadaHotelRaw> & { nombre: string }): FilaTemporadaHotelRaw => ({
  fecha_inicio: null, fecha_fin: null, prioridad: 1, compra_inicio: null, compra_fin: null,
  tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null, ...o,
});
const tar = (temporada: string, o: Partial<FilaTarifaHotelRaw>): FilaTarifaHotelRaw =>
  ({ tipo_habitacion: "Estandar", alimentacion: "PAM", temporada, neto_sencilla: null, neto_doble: null, neto_triple: null, neto_multiple: null, neto_nino: null, neto_nino2: null, neto_infante: null, ...o });
const COL: Record<string, string> = { doble: "neto_doble", nino: "neto_nino", nino2: "neto_nino2" };
const promo = (id: number, nombre: string, ini: string, fin: string, extra: Record<string, unknown> = {}) => raw({
  id, nombre, fecha_inicio: ini, fecha_fin: fin, prioridad: 5, tipo: "descuento_pct", descuento_valor: 10,
  promo_sigue_base: true, nino_gratis: true, hotel_promocion_reglas: [{ grupo_id: null, valor: 10, dias: null }], ...extra,
} as never);
function liquidar(vigs: FilaTemporadaHotelRaw[], tarifas: FilaTarifaHotelRaw[], acom: keyof typeof COL, ida: string, n: number) {
  const porClave = filasPorClave(tarifas);
  return liquidarHotelNochesConTemporadas({
    fechaIda: ida, numNoches: n, temporadas: vigs.map(toTemporadaRango), netoPorTemporada: netosDeColumna(porClave, COL[acom]),
    hoy: HOY, regimen: "PAM", basePromoPorClave: basesPromoDeFilas(porClave), acomodacion: acom, ocupantes: acom === "doble" ? 2 : undefined,
  })!;
}
const hab = (indice: number, adultos: number, nino: number, nino2 = 0): HabitacionOcupada => ({ indice, adultos, nino, nino2, infantes: 0 });
const BASE0: BaseVentaNino = { pctMk: 0, impuesto: 0, vuelo: 0, feeInfante: 0, servicios: [] };

describe("#125 R1 — el mismo niño con dos promociones sucesivas: una sola recomposición y un solo redondeo", () => {
  // Reproducción de la re-auditoría: niño 56.000/noche, 2 noches, cada una de una promoción distinta (−10 %, niño gratis), markup 0.
  const BASE = raw({ id: 1, nombre: "BASE", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-10" });
  const TAR = [tar("BASE", { neto_doble: 100_000, neto_nino: 56_000, neto_nino2: 40_000 })];
  const P1 = promo(10, "PROMO UNO", "2026-12-04", "2026-12-04");
  const P2 = promo(11, "PROMO DOS", "2026-12-05", "2026-12-05");
  const nino = liquidar([BASE, P1, P2], TAR, "nino", "2026-12-04", 2);
  const conPvp = (pvp: number, neto: number, moneda: string, base: BaseVentaNino = BASE0) => (clase: "nino" | "nino2", n: number) =>
    ventaNinoCondonada({ pvpCobrado: pvp, netoPagadero: neto, netoCondonado: n, base, moneda });

  test("el motor reporta una noche por promoción para el MISMO niño: 50.400 + 50.400 = 100.800 pagaderos", () => {
    assert.deepEqual(nino.ninoGratisNoches?.map((n) => [n.promocion, n.indice, n.neto]), [["PROMO UNO", 0, 50_400], ["PROMO DOS", 1, 50_400]]);
    assert.equal(nino.total, 100_800);
  });
  test("COP: se condona 101.000 (PVP completo del niño), no 100.000; el niño queda en 0", () => {
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], edades: [8], nochesNino: nino.ninoGratisNoches, pctMk: 0, ventaCondonada: conPvp(101_000, 100_800, "COP") })!;
    assert.equal(b.total, -101_000);
    assert.equal(b.costoNeto, 100_800);
    assert.equal(b.ninos.length, 1, "UN solo niño real, una sola entrada");
    assert.deepEqual(b.ninos[0].promociones.map((p) => [p.promocion, p.noches]), [["PROMO UNO", 1], ["PROMO DOS", 1]]);
    assert.equal(b.ninos[0].promociones.reduce((t, p) => t + p.venta, 0), 101_000, "la procedencia suma exactamente lo condonado");
    assert.match(b.descripcion, /PROMO UNO, PROMO DOS/);
  });
  test("la suma de dos recomposiciones separadas sería 100.000 (el defecto): se documenta con la fórmula vieja", () => {
    const f = conPvp(101_000, 100_800, "COP");
    const separadas = f("nino", 50_400) + f("nino", 50_400); // 50.400 → PVP restante 51.000 → condona 50.000 cada vez
    assert.equal(separadas, 100_000);
  });
  test("USD (unidad 1): neto 100,80 USD → PVP 101 USD; se condona 101", () => {
    const BASE_USD = raw({ id: 2, nombre: "BASE", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-10" });
    const t = [tar("BASE", { neto_nino: 56 })];
    const n = liquidar([BASE_USD, P1, P2], t, "nino", "2026-12-04", 2); // 50,4 + 50,4
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], edades: [8], nochesNino: n.ninoGratisNoches, pctMk: 0, ventaCondonada: conPvp(101, 100.8, "USD") })!;
    assert.equal(b.total, -101);
    assert.equal(b.costoNeto, 100.8);
  });
  test("niño de solo hotel con markup 20 %: PVP redondeado al mil se condona completo aunque el neto venga de dos promociones", () => {
    // neto 100.800 → 126.000 con markup (100.800 / 0,8) → PVP 126.000: se condona 126.000
    const f = conPvp(126_000, 100_800, "COP", { ...BASE0, pctMk: 0.2 });
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], edades: [8], nochesNino: nino.ninoGratisNoches, pctMk: 0.2, ventaCondonada: f })!;
    assert.equal(b.total, -126_000);
  });
  test("estadía PARCIAL con vuelo y servicio retenidos: 3 noches (P1, P2 y una de base); se condonan solo las 2 noches de hotel; vuelo y servicio se conservan y el redondeo se rehace UNA vez", () => {
    const n3 = liquidar([BASE, P1, P2], TAR, "nino", "2026-12-04", 3); // noche 3 (6 dic) a tarifa base 56.000
    assert.equal(n3.total, 156_800);
    const base: BaseVentaNino = { pctMk: 0.2, impuesto: 0, vuelo: 400_000, feeInfante: 0, servicios: [{ nombre: "Traslado", neto: 24_000, netoMenor: 24_000 }] };
    const pvpCobrado = componerTarifa({ aporteHotel: marcar(156_800, 0.2), aporteServicios: marcar(24_000, 0.2), aporteVuelo: 400_000, impuesto: 0, moneda: "COP" }).pvp;
    const f = (clase: "nino" | "nino2", neto: number) => ventaNinoCondonada({ pvpCobrado, netoPagadero: 156_800, netoCondonado: neto, base, moneda: "COP" });
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], edades: [8], nochesNino: n3.ninoGratisNoches, pctMk: 0.2, ventaCondonada: f })!;
    // restante: hotel 56.000 (noche de base) + servicio 24.000 + vuelo 400.000, recompuesto y redondeado UNA vez
    const sinHotelGratis = componerTarifa({ aporteHotel: marcar(56_000, 0.2), aporteServicios: marcar(24_000, 0.2), aporteVuelo: 400_000, impuesto: 0, moneda: "COP" }).pvp;
    assert.equal(-b.total, pvpCobrado - sinHotelGratis);
    assert.equal(pvpCobrado - -b.total, sinHotelGratis, "el niño paga exactamente la noche de base + traslado + vuelo");
    assert.ok(-b.total < pvpCobrado && sinHotelGratis >= 400_000, "nunca se condona el vuelo ni el servicio");
    assert.equal(b.costoNeto, 100_800, "el costo del hotel condonado son solo las dos noches promocionales");
  });
  test("el ajuste EBB / Long Stay se aplica UNA vez a la suma de las dos promociones: lo condonado = lo pagadero del niño al céntimo", () => {
    const d = { etiqueta: "EBB", tipo: "ebb" as const, umbral: 30, pct: 12 };
    const nn = ajustarNochesNinoGratis(nino.ninoGratisNoches, (s) => aplicarDescuentoNeta(s, d, "COP"))!;
    const pagadero = aplicarDescuentoNeta(nino.total, d, "COP"); // 100.800 × 0,88 = 88.704
    const b = calcularBeneficioNinoGratis({ habitaciones: [hab(0, 2, 1)], edades: [8], nochesNino: nn, pctMk: 0, ventaCondonada: (c, n) => ventaNinoCondonada({ pvpCobrado: 89_000, netoPagadero: pagadero, netoCondonado: n, base: BASE0, moneda: "COP" }) })!;
    assert.equal(b.costoNeto, pagadero);
    assert.equal(b.total, -89_000);
  });
  test("a USD con EBB el redondeo a centavos tampoco deja un resto: Σ ajustada = ajustar(Σ)", () => {
    const d = { etiqueta: "EBB", tipo: "ebb" as const, umbral: 30, pct: 12 };
    const noches: NocheNinoGratis[] = [{ indice: 0, neto: 33.33, promocion: "A", edadMin: null, edadMax: null }, { indice: 1, neto: 33.33, promocion: "B", edadMin: null, edadMax: null }];
    const nn = ajustarNochesNinoGratis(noches, (s) => aplicarDescuentoNeta(s, d, "USD"))!;
    const esperado = aplicarDescuentoNeta(66.66, d, "USD");
    assert.ok(Math.abs(nn.reduce((t, n) => t + n.neto, 0) - esperado) < 1e-9);
  });
});

describe("#125 R1 — promociones sucesivas que benefician a niños DISTINTOS de la misma habitación", () => {
  const BASE = raw({ id: 1, nombre: "BASE", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-10" });
  const TAR = [tar("BASE", { neto_doble: 100_000, neto_nino: 60_000, neto_nino2: 40_000 })];
  // P1 solo para 3–6 años (noche 1), P2 solo para 7–10 años (noche 2): con niños [9, 5] el de 5 años (Niño 2) lo regala P1 y el de 9 (Niño 1) lo regala P2.
  const P1 = promo(10, "PROMO PEQUES", "2026-12-04", "2026-12-04", { nino_gratis_edad_min: 3, nino_gratis_edad_max: 6 });
  const P2 = promo(11, "PROMO GRANDES", "2026-12-05", "2026-12-05", { nino_gratis_edad_min: 7, nino_gratis_edad_max: 10 });
  const n1 = liquidar([BASE, P1, P2], TAR, "nino", "2026-12-04", 2);
  const n2 = liquidar([BASE, P1, P2], TAR, "nino2", "2026-12-04", 2);
  test("cada niño recibe SU promoción y su propia recomposición (no se mezclan entre ranuras)", () => {
    const venta = (neto: number) => Math.round(neto / 1000) * 1000; // PVP de prueba: neto redondeado al mil
    const b = calcularBeneficioNinoGratis({
      habitaciones: [hab(0, 2, 1, 1)], edades: [9, 5], nochesNino: n1.ninoGratisNoches, nochesNino2: n2.ninoGratisNoches, pctMk: 0,
      ventaCondonada: (clase, neto) => venta(neto),
    })!;
    assert.equal(b.ninos.length, 2);
    const porClase = Object.fromEntries(b.ninos.map((n) => [n.clase, n]));
    assert.equal(porClase.nino2.edad, 5);
    assert.equal(porClase.nino2.promocion, "PROMO PEQUES");
    assert.equal(porClase.nino.edad, 9);
    assert.equal(porClase.nino.promocion, "PROMO GRANDES");
    assert.equal(porClase.nino2.neto, 36_000, "Niño 2, noche 1: 40.000 × 0,9");
    assert.equal(porClase.nino.neto, 54_000, "Niño 1, noche 2: 60.000 × 0,9");
    assert.equal(b.costoNeto, 90_000);
  });
});

describe("#125 R2 — el resumen por pasajero consume todo lo condonado de cada pasajero", () => {
  const unidad = (condonado: number[]): UnidadBase => ({
    ref: "u1", paquete: { id: 1, nombre: null }, hotel: "H", categoria: "E", regimen: "PAM", paxTotal: 3, infantes: 0, grupoIncluido: 0,
    personas: [
      { clave: "adulto:doble", etiqueta: "Adulto · Doble", tipo: "adulto", cantidad: 2, tarifa: 100_000 },
      { clave: "nino", etiqueta: "Niño 1", tipo: "nino", cantidad: 1, tarifa: 180_000, condonado },
    ],
  });
  const resumen = (cond: number[]) => construirResumenCarrito({ unidades: [unidad(cond)], servicios: [], modalidad: "pvp", moneda: "COP", total: 200_000 + 180_000 - cond.reduce((t, x) => t + x, 0) });
  test("ejemplo de la re-auditoría: tarifa del niño 180.000 y dos aportes de 90.000 ⇒ el niño queda en 0 y el resumen cuadra", () => {
    const r = resumen([180_000]);
    assert.equal(r.ok, true, r.ok ? "" : r.motivo);
  });
  test("transferir solo la primera entrada (90.000) NO cuadra: la guarda de conciliación sigue activa (no se silencia)", () => {
    const r = resumen([90_000]);
    // total = 200.000 + 180.000 − 90.000 = 290.000 pero el resumen por pasajero suma 200.000 + 90.000: aquí coincide porque el total se calculó con lo mismo; el desajuste real
    // es total (con los DOS aportes restados) vs resumen (con uno): se modela así.
    const rMal = construirResumenCarrito({ unidades: [unidad([90_000])], servicios: [], modalidad: "pvp", moneda: "COP", total: 200_000 });
    assert.equal(rMal.ok, false);
    assert.match(rMal.ok ? "" : rMal.motivo, /no cuadra/);
    assert.equal(r.ok, true);
  });
  test("checkout suma TODAS las entradas de un pasajero (no `.find` de la primera) y no desactiva la guarda", () => {
    const src = readFileSync(new URL("../app/tarifario/checkout/actions.ts", import.meta.url), "utf8");
    assert.match(src, /\.filter\(\(n\) => n\.clase === lm\.clase && n\.posicion === i\)\.reduce\(\(t, n\) => t \+ n\.venta, 0\)/);
    assert.doesNotMatch(src, /beneficioNinoGratis\?\.ninos\.find\(/);
    const resumen = readFileSync(new URL("../lib/cotizacion/resumenCarrito.ts", import.meta.url), "utf8");
    assert.match(resumen, /no cuadra con el total de la cotización/, "la guarda de conciliación y su motivo siguen en pie");
  });
});
