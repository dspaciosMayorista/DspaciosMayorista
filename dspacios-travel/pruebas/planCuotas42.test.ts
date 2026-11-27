// #42 — el plan de cobro descuenta lo YA PAGADO y solo reparte el saldo en cuotas futuras.
// Todos los valores esperados están calculados a mano (no con el código bajo prueba).
// Escenario base: hoy 2026-11-23, salida 2027-03-01 → última cuota 2027-02-01 (1 mes antes); cuotas mensuales futuras: 2026-12-01, 2027-01-01, 2027-02-01.
import test from "node:test";
import assert from "node:assert/strict";
import { planDeCuotas, estadoDeCuotas } from "../lib/calc/cuotas.ts";

const HOY = "2026-11-23";
const base = { checkIn: "2027-03-01", pctAbono: 0.3, hoy: HOY, frecuencia: "mensual" as const };
const montos = (p: ReturnType<typeof planDeCuotas>) => p.map((c) => c.monto);
const fechas = (p: ReturnType<typeof planDeCuotas>) => p.map((c) => c.fecha);
const suma = (p: ReturnType<typeof planDeCuotas>) => Math.round(montos(p).reduce((s, m) => s + m, 0) * 100) / 100;
const FECHAS3 = [HOY, "2026-12-01", "2027-01-01", "2027-02-01"];

test("sin pagos: abono inicial del 30 % hoy y el saldo parejo (la última cuota ajusta el redondeo)", () => {
  const p = planDeCuotas({ ...base, precio: 1_000_000 });
  assert.deepEqual(montos(p), [300_000, 233_333, 233_333, 233_334]);
  assert.deepEqual(fechas(p), FECHAS3);
  assert.deepEqual(p.map((c) => c.tipo), ["abono", "cuota", "cuota", "cuota"]);
});

test("pago parcial menor al mínimo: el plan conserva el mínimo y NO reparte de más; falta solo la diferencia", () => {
  const p = planDeCuotas({ ...base, precio: 1_000_000, pagado: 100_000 });
  assert.deepEqual(montos(p), [300_000, 233_333, 233_333, 233_334]); // mismo calendario acordado
  const e = estadoDeCuotas(montos(p), 100_000);
  assert.deepEqual(e.map((x) => x.faltante), [200_000, 233_333, 233_333, 233_334]);
  assert.equal(e[0].parcial, true);
  assert.equal(e.reduce((s, x) => s + x.faltante, 0), 900_000); // 1.000.000 − 100.000
});

test("pago exacto del mínimo: la fila inicial queda cubierta y el saldo es 700.000", () => {
  const p = planDeCuotas({ ...base, precio: 1_000_000, pagado: 300_000 });
  assert.deepEqual(montos(p), [300_000, 233_333, 233_333, 233_334]);
  const e = estadoDeCuotas(montos(p), 300_000);
  assert.deepEqual(e.map((x) => x.cubierta), [true, false, false, false]);
  assert.equal(e.reduce((s, x) => s + x.faltante, 0), 700_000);
});

test("pago mayor al mínimo (400.000): lo pagado va primero y SOLO 600.000 se reparte en las 3 cuotas futuras", () => {
  const p = planDeCuotas({ ...base, precio: 1_000_000, pagado: 400_000 });
  assert.deepEqual(montos(p), [400_000, 200_000, 200_000, 200_000]);
  assert.equal(suma(p), 1_000_000);
  const e = estadoDeCuotas(montos(p), 400_000);
  assert.deepEqual(e.map((x) => x.cubierta), [true, false, false, false]);
  assert.equal(e.reduce((s, x) => s + x.faltante, 0), 600_000);
});

test("pagado por completo: una sola fila por el total, cubierta, sin cuotas pendientes", () => {
  const p = planDeCuotas({ ...base, precio: 1_000_000, pagado: 1_000_000 });
  assert.deepEqual(montos(p), [1_000_000]);
  assert.deepEqual(estadoDeCuotas(montos(p), 1_000_000).map((x) => x.faltante), [0]);
});

test("pago en exceso (1.200.000 de 1.000.000): el excedente no se planifica, nunca hay filas negativas", () => {
  const p = planDeCuotas({ ...base, precio: 1_000_000, pagado: 1_200_000 });
  assert.deepEqual(montos(p), [1_000_000]);
  assert.ok(p.every((c) => c.monto >= 0));
  const e = estadoDeCuotas(montos(p), 1_200_000);
  assert.deepEqual(e.map((x) => [x.cubierta, x.faltante]), [[true, 0]]);
});

test("regenerar dos veces con los mismos pagos da exactamente el mismo plan", () => {
  const a = planDeCuotas({ ...base, precio: 1_000_000, pagado: 400_000 });
  const b = planDeCuotas({ ...base, precio: 1_000_000, pagado: 400_000 });
  assert.deepEqual(a, b);
});

test("USD conserva los centavos: 100,50 con mínimo 30 % → 30,15 + 3 × 23,45", () => {
  const p = planDeCuotas({ ...base, precio: 100.5, moneda: "USD" });
  assert.deepEqual(montos(p), [30.15, 23.45, 23.45, 23.45]);
  assert.equal(suma(p), 100.5);
});

test("USD con pago de 40,00: fila inicial 40,00 y 60,50 repartidos (20,16 + 20,16 + 20,18)", () => {
  const p = planDeCuotas({ ...base, precio: 100.5, moneda: "USD", pagado: 40 });
  assert.deepEqual(montos(p), [40, 20.16, 20.16, 20.18]);
  assert.equal(suma(p), 100.5);
  assert.equal(estadoDeCuotas(montos(p), 40, "USD").reduce((s, x) => s + x.faltante, 0), 60.5);
});

test("viaje a menos de un mes: 100 % ya (fila total hoy) y lo pagado reduce lo que falta", () => {
  const p = planDeCuotas({ ...base, checkIn: "2026-12-10", precio: 1_000_000, pagado: 250_000 });
  assert.deepEqual(p.map((c) => [c.tipo, c.fecha, c.monto]), [["total", HOY, 1_000_000]]);
  assert.equal(estadoDeCuotas(montos(p), 250_000)[0].faltante, 750_000);
});

test("cuotas quincenales: fechas cada 15 días hacia atrás y solo el saldo se reparte (pagado 500.000)", () => {
  // salida 2027-01-10 → última 2026-12-10; −15 días: 2026-11-25 (futura); la siguiente, 2026-11-10, ya pasó.
  const sin = planDeCuotas({ ...base, checkIn: "2027-01-10", frecuencia: "quincenal", precio: 1_000_000 });
  assert.deepEqual(fechas(sin), [HOY, "2026-11-25", "2026-12-10"]);
  assert.deepEqual(montos(sin), [300_000, 350_000, 350_000]);
  const con = planDeCuotas({ ...base, checkIn: "2027-01-10", frecuencia: "quincenal", precio: 1_000_000, pagado: 500_000 });
  assert.deepEqual(montos(con), [500_000, 250_000, 250_000]);
});

test("el porcentaje y las fechas acordadas no cambian con los pagos (solo cambian los montos)", () => {
  const sin = planDeCuotas({ ...base, precio: 1_000_000 });
  const con = planDeCuotas({ ...base, precio: 1_000_000, pagado: 100_000 });
  assert.deepEqual(fechas(con), fechas(sin));
});

test("estadoDeCuotas: tolerancia de 0,5 en COP y 0,01 en USD; entradas inválidas cuentan como 0; nunca negativo", () => {
  assert.deepEqual(estadoDeCuotas([300_000, 350_000], 299_999.7).map((x) => x.cubierta), [true, false]); // falta 0,3 ≤ 0,5
  assert.deepEqual(estadoDeCuotas([300_000], 299_999.4).map((x) => [x.cubierta, x.faltante]), [[false, 1]]); // falta 0,6 > 0,5: pendiente, y se muestra en pesos enteros
  assert.deepEqual(estadoDeCuotas([30.15, 23.45], 30.145, "USD").map((x) => x.cubierta), [true, false]); // falta 0,005 ≤ 0,01
  assert.deepEqual(estadoDeCuotas([100], -50).map((x) => x.faltante), [100]);
  assert.deepEqual(estadoDeCuotas([100], Number.NaN).map((x) => x.faltante), [100]);
  assert.ok(estadoDeCuotas([100, 100], 1_000).every((x) => x.faltante === 0));
});

test("sin valor o sin fecha de salida", () => {
  assert.deepEqual(planDeCuotas({ ...base, precio: 0 }), []);
  assert.deepEqual(planDeCuotas({ ...base, checkIn: null, precio: 500_000, pagado: 100_000 }).map((c) => [c.tipo, c.monto]), [["total", 500_000]]);
});
