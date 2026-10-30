import { test } from "node:test";
import assert from "node:assert/strict";
import { valoresNetosDocumento } from "../lib/contrato/valoresNetosDocumento.ts";

const porPersona = (id: number, adultos: number, ninos: number, tarifaAdulto: number, tarifaNino: number) => ({
  id, modo_precio: "por_persona", valor_total: null, adultos, ninos, tarifa_adulto: tarifaAdulto, tarifa_nino: tarifaNino,
});
const porTotal = (id: number, valorTotal: number) => ({
  id, modo_precio: "total", valor_total: valorTotal, adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0,
});

test("contrato manual: dos adultos muestran su tarifa NETO, no la tarifa original", () => {
  const valores = valoresNetosDocumento([porPersona(1, 2, 0, 1_000_000, 0)], 1_897_200);
  assert.deepEqual(valores?.get(1), {
    total: 1_897_200, tarifaAdulto: 948_600, tarifaNino: 0, adultoAproximado: false, ninoAproximado: false, adultoTotal: 1_897_200, ninoTotal: 0,
  });
});

test("adultos, niños y servicio reciben descuento proporcional; los subtotales cuadran", () => {
  const valores = valoresNetosDocumento([
    porPersona(1, 2, 1, 500_000, 300_000),
    porPersona(2, 1, 0, 200_000, 0),
  ], 1_350_000)!;
  assert.deepEqual(valores.get(1), {
    total: 1_170_000, tarifaAdulto: 450_000, tarifaNino: 270_000, adultoAproximado: false, ninoAproximado: false, adultoTotal: 900_000, ninoTotal: 270_000,
  });
  assert.equal(valores.get(2)?.total, 180_000);
  assert.equal([...valores.values()].reduce((s, v) => s + v.total, 0), 1_350_000);
});

test("un centavo residual queda en el subtotal exacto y la tarifa unitaria se marca aproximada", () => {
  const valores = valoresNetosDocumento([porPersona(1, 3, 0, 1, 0)], 0.01)!;
  assert.equal(valores.get(1)?.total, 0.01);
  assert.equal(valores.get(1)?.adultoAproximado, true);
});

test("líneas por total y por persona comparten el NETO sin inventar tarifas para Bernalo", () => {
  const valores = valoresNetosDocumento([porTotal(1, 500), porPersona(2, 1, 0, 500, 0)], 900)!;
  assert.equal(valores.get(1)?.total, 450);
  assert.equal(valores.get(1)?.tarifaAdulto, 0);
  assert.equal(valores.get(2)?.total, 450);
});

test("sin fuente conciliable no se fabrica un desglose", () => {
  assert.equal(valoresNetosDocumento([porPersona(1, 0, 0, 0, 0)], 100), null);
  assert.equal(valoresNetosDocumento([porPersona(1, 1, 0, 100, 0)], 101), null);
  assert.equal(valoresNetosDocumento([porPersona(1, 1, 0, 100, 0), porPersona(1, 1, 0, 100, 0)], 180), null);
});
