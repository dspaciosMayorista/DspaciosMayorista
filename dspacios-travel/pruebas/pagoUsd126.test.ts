// #126-A — pagos en USD con TRM propia por pago. Los esperados están calculados a mano (no con la función bajo prueba).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarTrmPago, usdAcreditadoDeCop, copDeUsdNativo, resumenCobroUsd, previsualizarPagoUsd,
} from "../lib/finanzas/pagoUsd.ts";

test("ejemplo del dueño: USD 1000; 1.230.000 a 4.100 = USD 300; 2.940.000 a 4.200 = USD 700; saldo 0 y COP real 4.170.000", () => {
  // 1.230.000 / 4.100 = 300 ; 2.940.000 / 4.200 = 700 (divisiones exactas hechas a mano)
  assert.equal(usdAcreditadoDeCop(1_230_000, 4100), 300);
  assert.equal(usdAcreditadoDeCop(2_940_000, 4200), 700);
  const abonos = [{ valor_abono: 300, monto_cop: 1_230_000 }, { valor_abono: 700, monto_cop: 2_940_000 }];
  const r = resumenCobroUsd(1000, abonos, 4300);
  assert.equal(r.abonado, 1000);
  assert.equal(r.saldo, 0);
  assert.equal(r.cobradoCop, 4_170_000);
  assert.equal(r.definitivo, true);
  assert.equal(r.totalCop, 4_170_000);          // definitivo = lo cobrado; la TRM de referencia NO interviene
  assert.equal(r.estimadoSaldoCop, null);
  assert.equal(r.trmPromedio, 4_170_000 / 1000);
});

test("pago parcial: lo cobrado es hecho; el saldo en USD solo se estima y el total queda provisional", () => {
  const r = resumenCobroUsd(1000, [{ valor_abono: 300, monto_cop: 1_230_000 }], 4200);
  assert.equal(r.saldo, 700);
  assert.equal(r.definitivo, false);
  assert.equal(r.cobradoCop, 1_230_000);
  assert.equal(r.estimadoSaldoCop, 700 * 4200);  // 2.940.000
  assert.equal(r.trmEstimacion, 4200);
  assert.equal(r.totalCop, 1_230_000 + 2_940_000);
});

test("sin TRM de referencia la estimación usa la TRM media de lo cobrado; sin pagos no hay estimación ni total", () => {
  const a = resumenCobroUsd(1000, [{ valor_abono: 300, monto_cop: 1_230_000 }], null);
  assert.equal(a.trmEstimacion, 4100);
  assert.equal(a.estimadoSaldoCop, 700 * 4100);
  const b = resumenCobroUsd(1000, [], null);
  assert.equal(b.saldo, 1000);
  assert.equal(b.estimadoSaldoCop, null);
  assert.equal(b.totalCop, null);
  assert.equal(b.cobradoCop, 0);
});

test("la tolerancia de 0,01 USD cierra el saldo (centavo de redondeo) pero 0,02 no", () => {
  // 1.000.000 / 4.100 = 243,902439… → 243,90 por pago; dos pagos iguales = 487,80 sobre 487,81
  assert.equal(usdAcreditadoDeCop(1_000_000, 4100), 243.9);
  assert.equal(resumenCobroUsd(487.81, [{ valor_abono: 243.9, monto_cop: 1_000_000 }, { valor_abono: 243.9, monto_cop: 1_000_000 }]).saldo, 0);
  assert.equal(resumenCobroUsd(487.82, [{ valor_abono: 243.9, monto_cop: 1_000_000 }, { valor_abono: 243.9, monto_cop: 1_000_000 }]).saldo, 0.02);
});

test("anular un pago devuelve el saldo y retira su aporte en COP (reversión)", () => {
  const dos = [{ valor_abono: 300, monto_cop: 1_230_000 }, { valor_abono: 700, monto_cop: 2_940_000 }];
  const tras = resumenCobroUsd(1000, [dos[0]], 4200);
  assert.equal(tras.saldo, 700);
  assert.equal(tras.cobradoCop, 1_230_000);
  assert.equal(tras.definitivo, false);
});

test("TRM inválida: vacía, cero, negativa, ≤ 1, NaN, texto y desmesurada se rechazan; nunca hay valor por defecto", () => {
  for (const malo of [undefined, null, "", "  ", 0, "0", -4100, 1, 0.5, 4.1, "4.1", "4,1", 99.99, NaN, Infinity, "abc", true, 1e12]) {
    const r = validarTrmPago(malo);
    assert.equal(r.ok, false, `debía rechazar ${String(malo)}`);
  }
  assert.deepEqual(validarTrmPago(100), { ok: true, trm: 100 });
  assert.deepEqual(validarTrmPago("4.100"), { ok: true, trm: 4100 });
  assert.deepEqual(validarTrmPago("4.100,50"), { ok: true, trm: 4100.5 });
  assert.deepEqual(validarTrmPago("4100.5"), { ok: true, trm: 4100.5 });
  assert.deepEqual(validarTrmPago("4100,5"), { ok: true, trm: 4100.5 });
  assert.equal(usdAcreditadoDeCop(1_230_000, 0), null);
  assert.equal(usdAcreditadoDeCop(0, 4100), null);
});

test("pago nativo en USD: acredita exactamente lo digitado; la TRM solo da el equivalente en pesos", () => {
  assert.equal(copDeUsdNativo(300, 4100), 1_230_000);
  const p = previsualizarPagoUsd({ principalUsd: 1000, abonadoUsd: 0, modo: "usd", monto: 300, trm: 4100 });
  assert.deepEqual(p, { usdAcreditado: 300, copEquivalente: 1_230_000, saldoDespues: 700, excede: false });
});

test("vista previa en COP: acredita USD, muestra saldo después y marca el exceso", () => {
  const a = previsualizarPagoUsd({ principalUsd: 1000, abonadoUsd: 300, modo: "cop", monto: 2_940_000, trm: 4200 });
  assert.deepEqual(a, { usdAcreditado: 700, copEquivalente: 2_940_000, saldoDespues: 0, excede: false });
  const b = previsualizarPagoUsd({ principalUsd: 1000, abonadoUsd: 300, modo: "cop", monto: 3_360_000, trm: 4200 });  // 800 USD sobre 700 de saldo
  assert.deepEqual(b, { usdAcreditado: 800, copEquivalente: 3_360_000, saldoDespues: 0, excede: true });
  assert.ok("error" in previsualizarPagoUsd({ principalUsd: 1000, abonadoUsd: 0, modo: "cop", monto: 1000, trm: "" }));
  assert.ok("error" in previsualizarPagoUsd({ principalUsd: 1000, abonadoUsd: 0, modo: "cop", monto: 0, trm: 4100 }));
});

test("dólares recibidos vs pesos recibidos: el equivalente contable de un pago nativo en USD NO cuenta como pesos recibidos", () => {
  // USD 300 recibidos como dólares (equivalente contable 1.230.000 a 4.100) + COP 2.940.000 recibidos a 4.200 = USD 700
  const abonos = [{ valor_abono: 300, monto_cop: 1_230_000, moneda_pago: "USD" }, { valor_abono: 700, monto_cop: 2_940_000, moneda_pago: "COP" }];
  const r = resumenCobroUsd(1000, abonos);
  assert.equal(r.cobradoCop, 2_940_000, "solo los pesos efectivamente recibidos");
  assert.equal(r.recibidoUsd, 300);
  assert.equal(r.equivalenteContableCop, 1_230_000);
  assert.equal(r.saldo, 0);
  assert.equal(r.definitivo, true);
  assert.equal(r.totalCop, 4_170_000, "el total contable sí suma ambos");
  // sin la marca (abonos previos o pagos en pesos) todo se lee como pesos recibidos, igual que antes
  const previo = resumenCobroUsd(1000, [{ valor_abono: 300, monto_cop: 1_230_000 }, { valor_abono: 700, monto_cop: 2_940_000, moneda_pago: null }]);
  assert.deepEqual({ c: previo.cobradoCop, u: previo.recibidoUsd, e: previo.equivalenteContableCop }, { c: 4_170_000, u: 0, e: 0 });
  // todo en dólares: cero pesos recibidos
  const soloUsd = resumenCobroUsd(1000, [{ valor_abono: 1000, monto_cop: 4_100_000, moneda_pago: "USD" }]);
  assert.deepEqual({ c: soloUsd.cobradoCop, u: soloUsd.recibidoUsd, e: soloUsd.equivalenteContableCop, t: soloUsd.totalCop }, { c: 0, u: 1000, e: 4_100_000, t: 4_100_000 });
});
