// #42 — los recordatorios de cobro NO piden lo que el cliente ya pagó. Valores esperados escritos a mano. Sin correo ni base de datos.
import test from "node:test";
import assert from "node:assert/strict";
import { recordatoriosDeCuotas, type CuotaGuardada } from "../lib/cobros/recordatorioCuotas.ts";

const plan = (numero: string, montos: number[]): CuotaGuardada[] => montos.map((monto, i) => ({
  numero_contrato: numero, orden: i, tipo: i === 0 ? "abono" : "cuota", monto,
  fecha_limite: ["2026-11-23", "2026-12-01", "2027-01-01", "2027-02-01"][i],
}));
const LIMITE = "2027-01-15"; // vencen: 11-23, 12-01, 01-01 (la de 02-01 queda fuera)
const sinPagos = new Map<string, number>();

test("sin pagos: se recuerdan las tres cuotas dentro del límite por su monto completo", () => {
  const r = recordatoriosDeCuotas(plan("C-1", [300_000, 233_333, 233_333, 233_334]), sinPagos, new Map(), LIMITE);
  assert.deepEqual(r.map((x) => [x.fecha, x.faltante, x.parcial]), [["2026-11-23", 300_000, false], ["2026-12-01", 233_333, false], ["2027-01-01", 233_333, false]]);
});

test("el abono inicial ya pagado NO se recuerda; las cuotas siguientes sí por su monto", () => {
  const r = recordatoriosDeCuotas(plan("C-1", [300_000, 233_333, 233_333, 233_334]), new Map([["C-1", 300_000]]), new Map(), LIMITE);
  assert.deepEqual(r.map((x) => [x.fecha, x.faltante]), [["2026-12-01", 233_333], ["2027-01-01", 233_333]]);
});

test("pago parcial de una cuota: se recuerda solo lo que falta (marcada como saldo de la cuota)", () => {
  // pagado 400.000: cubre el abono (300.000) y 100.000 de la cuota de 12-01 → falta 133.333
  const r = recordatoriosDeCuotas(plan("C-1", [300_000, 233_333, 233_333, 233_334]), new Map([["C-1", 400_000]]), new Map(), LIMITE);
  assert.deepEqual(r.map((x) => [x.fecha, x.faltante, x.parcial]), [["2026-12-01", 133_333, true], ["2027-01-01", 233_333, false]]);
});

test("pagado por completo (o en exceso): no hay ningún recordatorio", () => {
  assert.deepEqual(recordatoriosDeCuotas(plan("C-1", [300_000, 233_333, 233_333, 233_334]), new Map([["C-1", 1_000_000]]), new Map(), LIMITE), []);
  assert.deepEqual(recordatoriosDeCuotas(plan("C-1", [300_000, 233_333, 233_333, 233_334]), new Map([["C-1", 1_500_000]]), new Map(), LIMITE), []);
});

test("cada contrato con sus propios pagos y su moneda de cobro; USD con centavos", () => {
  const todas = [...plan("C-1", [300_000, 700_000]), ...plan("D-2", [30.15, 23.45, 23.45, 23.45])];
  const r = recordatoriosDeCuotas(todas, new Map([["C-1", 300_000], ["D-2", 40]]), new Map([["D-2", "USD" as const]]), LIMITE);
  // C-1: el abono está pagado; 12-01 cuota 700.000 pendiente. D-2 (USD): pagado 40,00 → abono 30,15 cubierto y 9,85 de la cuota de 23,45 → falta 13,60; luego 23,45 (01-01).
  assert.deepEqual(r.map((x) => [x.numero, x.fecha, x.faltante, x.moneda]), [["C-1", "2026-12-01", 700_000, "COP"], ["D-2", "2026-12-01", 13.6, "USD"], ["D-2", "2027-01-01", 23.45, "USD"]]);
});

test("la tolerancia de la moneda evita recordar centavos de diferencia", () => {
  const r = recordatoriosDeCuotas(plan("C-1", [300_000, 233_333, 233_333, 233_334]), new Map([["C-1", 299_999.7]]), new Map(), LIMITE);
  assert.ok(!r.some((x) => x.fecha === "2026-11-23"), "falta 0,3 ≤ 0,5 COP: se considera cubierta");
});
