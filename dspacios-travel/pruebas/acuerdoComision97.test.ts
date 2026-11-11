// #97 — reglas puras del acuerdo de comisión de la cotización dinámica (espejo de p97_priv.importes, migración 286).
import { test } from "node:test";
import assert from "node:assert/strict";
import { acuerdoComision, participacionAliado, validarBnc } from "../lib/cotizacion/acuerdoComision.ts";

// Tabla compartida con supabase/scripts/test_97_acuerdo_grid.sql (mismos números, calculados con la regla confirmada).
// [caso, total, bnc, recobro, participación, pct, base, ordinaria, totalAliado]
export const CASOS: [string, number, number, number, number, number, number, number, number][] = [
  ["cero: el recobro PERMANECE en la base", 2_000_000, 400_000, 100_000, 0, 0.10, 1_600_000, 160_000, 160_000],
  ["parcial: el recobro COMPLETO sale de la base", 2_000_000, 400_000, 100_000, 50_000, 0.10, 1_500_000, 150_000, 200_000],
  ["total (100 % del recobro al aliado)", 2_000_000, 400_000, 100_000, 100_000, 0.10, 1_500_000, 150_000, 250_000],
  ["sin recobro", 2_000_000, 400_000, 0, 0, 0.12, 1_600_000, 192_000, 192_000],
  ["BNC = 0 escrita", 1_000_000, 0, 0, 0, 0.11, 1_000_000, 110_000, 110_000],
  ["BNC = total: base 0", 1_000_000, 1_000_000, 0, 0, 0.10, 0, 0, 0],
  ["recobro mayor que la base restante: base no baja de 0", 500_000, 450_000, 200_000, 10_000, 0.10, 0, 0, 10_000],
  ["redondeo de la ordinaria (mitad hacia arriba)", 1_000_005, 0, 0, 0, 0.10, 1_000_005, 100_001, 100_001],
  ["redondeo con participación (base 949.999 × 9,23 % = 87.684,9 → 87.685)", 1_234_567, 234_567, 50_001, 25_001, 0.0923, 949_999, 87_685, 112_686],
];

for (const [caso, total, bnc, recobro, participacion, pct, base, ordinaria, totalAliado] of CASOS) {
  test(`acuerdo: ${caso}`, () => {
    const r = acuerdoComision({ total, bnc, recobroTotal: recobro, participacion, pct });
    assert.deepEqual([r.base, r.ordinaria, r.totalAliado], [base, ordinaria, totalAliado]);
    assert.equal(r.excluyeRecobro, participacion > 0);
  });
}

test("participación por VALOR: se acota a [0, recobro]", () => {
  assert.equal(participacionAliado(100_000, { modo: "valor", valor: 40_000 }), 40_000);
  assert.equal(participacionAliado(100_000, { modo: "valor", valor: 150_000 }), 100_000);
  assert.equal(participacionAliado(100_000, { modo: "valor", valor: -5 }), 0);
  assert.equal(participacionAliado(100_000, { modo: "valor", valor: Number.NaN }), 0);
});

test("participación por PORCENTAJE: importe final redondeado; la condición > 0 se evalúa sobre el importe", () => {
  assert.equal(participacionAliado(100_000, { modo: "pct", pct: 0.4 }), 40_000);
  assert.equal(participacionAliado(100_000, { modo: "pct", pct: 1 }), 100_000);
  assert.equal(participacionAliado(100_000, { modo: "pct", pct: 0 }), 0);
  // 0,004 % de 100 = 0,004 pesos → 0: el aliado no recibe nada, así que el recobro permanece en la base.
  const p = participacionAliado(100, { modo: "pct", pct: 0.00004 });
  assert.equal(p, 0);
  assert.equal(acuerdoComision({ total: 1_000_000, bnc: 0, recobroTotal: 100, participacion: p, pct: 0.1 }).base, 1_000_000);
  // 0,5 pesos redondea hacia arriba a 1 → ya recibe algo → el recobro sale de la base.
  const q = participacionAliado(100, { modo: "pct", pct: 0.005 });
  assert.equal(q, 1);
  assert.equal(acuerdoComision({ total: 1_000_000, bnc: 0, recobroTotal: 100, participacion: q, pct: 0.1 }).base, 999_900);
});

test("valor y porcentaje equivalentes producen el mismo acuerdo", () => {
  const porValor = acuerdoComision({ total: 2_000_000, bnc: 400_000, recobroTotal: 100_000, participacion: participacionAliado(100_000, { modo: "valor", valor: 50_000 }), pct: 0.1 });
  const porPct = acuerdoComision({ total: 2_000_000, bnc: 400_000, recobroTotal: 100_000, participacion: participacionAliado(100_000, { modo: "pct", pct: 0.5 }), pct: 0.1 });
  assert.deepEqual(porValor, porPct);
});

test("BNC explícita: ausente/vacía/NaN se rechazan; 0 escrito vale; no supera el total", () => {
  for (const v of [undefined, null, "", "  ", "abc", Number.NaN, -1, "-5"]) assert.equal(validarBnc(v, 1_000).ok, false, String(v));
  assert.deepEqual(validarBnc(0, 1_000), { ok: true, bnc: 0 });
  assert.deepEqual(validarBnc("0", 1_000), { ok: true, bnc: 0 });
  assert.deepEqual(validarBnc("250", 1_000), { ok: true, bnc: 250 });
  assert.equal(validarBnc(1_001, 1_000).ok, false);
});

// ── Importes máximos, USD y límites de redondeo (mismos números que test_97_acuerdo_dinamica.sql, sección D) ──
test("máximo COP: 9.999.999.999.999, participación 1/3 del recobro y 12,35 %", () => {
  const r = acuerdoComision({ total: 9_999_999_999_999, bnc: 1_000_000_000_000, recobroTotal: 3_000_000_000_000, participacion: 1_000_000_000_000, pct: 0.1235 });
  assert.deepEqual([r.base, r.ordinaria, r.totalAliado], [5_999_999_999_999, 741_000_000_000, 1_741_000_000_000]);
});
test("máximo COP: participación 0 deja el recobro en la base", () => {
  const r = acuerdoComision({ total: 9_999_999_999_999, bnc: 1_000_000_000_000, recobroTotal: 3_000_000_000_000, participacion: 0, pct: 0.1235 });
  assert.deepEqual([r.base, r.ordinaria, r.totalAliado], [8_999_999_999_999, 1_111_500_000_000, 1_111_500_000_000]);
});
test("límite .5 en el máximo: 50 % de 9.999.999.999.999 = 4.999.999.999.999,5 sube", () => {
  assert.equal(acuerdoComision({ total: 9_999_999_999_999, bnc: 0, recobroTotal: 0, participacion: 0, pct: 0.5 }).ordinaria, 5_000_000_000_000);
});
test("participación de 1 peso sobre el recobro máximo", () => {
  const r = acuerdoComision({ total: 9_999_999_999_999, bnc: 0, recobroTotal: 9_999_999_999_998, participacion: 1, pct: 0.5 });
  assert.deepEqual([r.base, r.ordinaria, r.totalAliado, r.excluyeRecobro], [1, 1, 2, true]);
});
test("USD: 33 de 100 con 12,35 % (11.900 × 12,35 % = 1.469,65 → 1.470)", () => {
  const r = acuerdoComision({ total: 12_345, bnc: 345, recobroTotal: 100, participacion: 33, pct: 0.1235 });
  assert.deepEqual([r.base, r.ordinaria, r.totalAliado], [11_900, 1_470, 1_503]);
});
test("porcentaje 1/3 sobre un recobro máximo da el importe exacto (no se desvía por coma flotante)", () => {
  assert.equal(participacionAliado(3_000_000_000_000, { modo: "pct", pct: 1 / 3 }), 1_000_000_000_000);
  assert.equal(participacionAliado(9_999_999_999_999, { modo: "pct", pct: 1 }), 9_999_999_999_999);
  assert.equal(participacionAliado(9_999_999_999_999, { modo: "pct", pct: 0.5 }), 5_000_000_000_000);
});

// ── NETO nuevas (mismas cuentas que la sección E del SQL): la participación monetaria final decide, la casilla sola no ──
import { calcularNetoHija } from "../lib/cotizacion/netoHija.ts";
const servNeto = [
  { id: 1, orden: 0, tipo: "hotel", valor: 1_000_000, costoNeto: 800_000 },
  { id: 2, orden: 1, tipo: "aereo", valor: 500_000, costoNeto: 400_000 },
];
const neto = (reconoceRecobro: boolean, recobroAliado: number, reglaParticipacion = true) => {
  const r = calcularNetoHija({ servicios: servNeto, precioVenta: 1_600_000, recobro: 100_000, ninos: 0, tarifaNino: 0, recobroAliado, reconoceRecobro, pct: 0.1, reglaParticipacion });
  return [Number(r.base) / 100, Number(r.ordinaria) / 100, Number(r.participacion) / 100, Number(r.descuento) / 100];
};
test("NETO: casilla sin marcar → el recobro permanece en la base", () => assert.deepEqual(neto(false, 50_000), [1_100_000, 110_000, 0, 110_000]));
test("NETO: casilla marcada pero participación 0 → el recobro PERMANECE en la base (antes salía)", () => assert.deepEqual(neto(true, 0), [1_100_000, 110_000, 0, 110_000]));
test("NETO: participación parcial → TODO el recobro sale de la base", () => assert.deepEqual(neto(true, 50_000), [1_000_000, 100_000, 50_000, 150_000]));
test("NETO: participación total", () => assert.deepEqual(neto(true, 100_000), [1_000_000, 100_000, 100_000, 200_000]));
test("NETO: participación mayor que el recobro se acota al recobro", () => assert.deepEqual(neto(true, 999_999), [1_000_000, 100_000, 100_000, 200_000]));

// ── Política de redondeo de la comisión ordinaria (USD 1.469,65) ──
// Demuestra QUÉ política vigente se reproduce y QUÉ queda sin resolver. No decide nada: documenta el hecho medible.
import { planComisionReserva } from "../lib/reservar/comisionReserva.ts";
import { calcComisionB2B } from "../lib/calc/finanzas.ts";
test("USD 1.469,65: el acuerdo coincide con Reservar (Math.round a la unidad, sin distinguir moneda)", () => {
  const p = planComisionReserva({ modoCompra: "comisionable", precioVenta: 12_245, impuesto: 345, pct: 0.1235 }); // base 11.900 (Reservar no tiene recobro)
  assert.ok(p.ok);
  assert.equal(p.plan.comision, 1_470); // misma cifra que acuerdoComision().ordinaria
  assert.equal(acuerdoComision({ total: 12_245, bnc: 345, recobroTotal: 0, participacion: 0, pct: 0.1235 }).ordinaria, 1_470);
});
test("USD 1.469,65: la fila de aliados_b2b se liquida SIN redondear (calcComisionB2B) — diferencia preexistente con la cifra sellada", () => {
  const fila = calcComisionB2B({ precioVenta: 12_345, baseComisionable: 11_900, baseExplicita: true, comisionValor: null, pctComision: 0.1235, recobroTotal: 100, pctRecobroAliado: 0.33 });
  assert.equal(Number(fila.totalComision.toFixed(2)), 1_502.65); // acuerdo sellado: 1.503 (1.470 + 33)
  // Con comision_valor = ordinaria sellada la fila coincidiría con el acuerdo (opción B del informe; NO aplicada).
  const exacta = calcComisionB2B({ precioVenta: 12_345, baseComisionable: 11_900, baseExplicita: true, comisionValor: 1_470, pctComision: 0.1235, recobroTotal: 100, pctRecobroAliado: 0.33 });
  assert.equal(Number(exacta.totalComision.toFixed(2)), 1_503);
});

// Antes de la activación (fase 1) y para lo histórico: la regla de siempre (decide la casilla), idéntica a p50_priv.calcular de la 222.
test("NETO sin activar: casilla marcada y participación 0 → el recobro SALE de la base (cálculo de siempre)", () => assert.deepEqual(neto(true, 0, false), [1_000_000, 100_000, 0, 100_000]));
test("NETO sin activar: casilla sin marcar → el recobro permanece en la base", () => assert.deepEqual(neto(false, 50_000, false), [1_100_000, 110_000, 0, 110_000]));
test("NETO sin indicar la regla = regla de siempre (compatibilidad con quien no la pasa)", () => {
  const r = calcularNetoHija({ servicios: servNeto, precioVenta: 1_600_000, recobro: 100_000, ninos: 0, tarifaNino: 0, recobroAliado: 0, reconoceRecobro: true, pct: 0.1 });
  assert.equal(Number(r.base) / 100, 1_000_000);
});

// ── Documentos de cobro en USD: centavos (sin cambiar el formato global de precios) ──
import { formatMonedaDocumento, formatMoneda, formatUSD } from "../lib/utils.ts";
import { pesosEnLetras } from "../lib/utils/numeroALetras.ts";
test("USD en documentos de cobro: muestra centavos; el formato global sigue en dólares enteros", () => {
  assert.equal(formatMonedaDocumento(1337.67, "USD"), "USD $1,337.67");
  assert.equal(formatMonedaDocumento(1503, "USD"), "USD $1,503.00");
  assert.equal(formatUSD(1337.67), "USD $1,338", "formatUSD (global) NO cambia");
  assert.equal(formatMoneda(1337.67, "USD"), "USD $1,338", "formatMoneda (global) NO cambia");
  assert.equal(formatMonedaDocumento(1_234_567, "COP"), formatMoneda(1_234_567, "COP"), "COP idéntico al global");
});
test("importe en letras: USD con centavos solo si se pide; el comportamiento de siempre no cambia", () => {
  assert.equal(pesosEnLetras(1337.67, "USD", true), "Mil trescientos treinta y siete dólares con 67/100");
  assert.equal(pesosEnLetras(1503, "USD", true), "Mil quinientos tres dólares");
  assert.equal(pesosEnLetras(1337.67, "USD"), pesosEnLetras(1338, "USD"), "sin la bandera redondea como siempre");
  assert.equal(pesosEnLetras(1_000_000, "COP"), "Un millón de pesos");
});

// ── Ciclo de vida: el respaldo ventas.comision_b2b no permite cobrar un contrato pendiente ──
import { comisionVisibleAliado, estadoExigible } from "../lib/finanzas/comisionB2B.ts";
test("estadoExigible: confirmado y el histórico 'activo' sí; pendiente, anulado y sin estado no (falla cerrado)", () => {
  assert.equal(estadoExigible("confirmado"), true);
  assert.equal(estadoExigible("activo"), true);
  for (const e of ["pendiente", "anulado", "", null, undefined]) assert.equal(estadoExigible(e as string | null | undefined), false, String(e));
});
test("comisionVisibleAliado (vía ventas): pendiente = importe informativo NO cobrable; confirmado = cobrable", () => {
  const base = { modo_compra: "comisionable", comision_b2b: 80_000, comision_estado: "pendiente", tipo_asesor: "agencia" };
  const u = { aliadoId: 7 } as never;
  const pend = comisionVisibleAliado([], { ...base, estado: "pendiente" }, u);
  assert.deepEqual([pend.total, pend.fuente, pend.cobrable], [80_000, "ventas", false]);
  const conf = comisionVisibleAliado([], { ...base, estado: "confirmado" }, u);
  assert.deepEqual([conf.total, conf.fuente, conf.cobrable], [80_000, "ventas", true]);
  assert.equal(comisionVisibleAliado([], base, u).cobrable, false, "sin estado conocido: no cobrable");
});
