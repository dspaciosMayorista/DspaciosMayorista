import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compararPlanesB2B, MENSAJE_TERMINOS_CAMBIARON, type PlanB2BCotizacion } from "@/lib/cotizacion/asistidaB2B";
import { mensajeAcomodacionComparativa, totalPublicoOpcion, validarAcomodacionComparativa } from "@/lib/cotizacion/comparativa";

const plan = (extra: Partial<PlanB2BCotizacion> = {}): PlanB2BCotizacion => ({
  version: 1, aliado_id: 7, aliado_nombre: "Agencia Sol", tipo_asesor: "agencia", modo_compra: "comisionable", moneda: "COP", pvp: 2_600_000, impuesto: 300_000, base: 2_300_000,
  pct: 0.1, pct_origen: "aliado", comision: 230_000, comision_estado: "pendiente", total_exigible: 2_600_000,
  lineas: [{ clave: "item-0", pvp: 1_800_000, impuesto: 200_000 }, { clave: "manual-0", pvp: 800_000, impuesto: 100_000 }],
  asistido_por: { id: "u1", email: "a@x.test", rol: "venta" }, congelado_en: "2030-01-01T00:00:00Z", ...extra,
});

describe("compararPlanesB2B: el plan de UNA opción re-liquidado debe ser el congelado", () => {
  test("igual (aun con otra fecha de congelado) pasa", () => {
    assert.deepEqual(compararPlanesB2B(plan(), plan({ congelado_en: "2031-01-01T00:00:00Z" })), { ok: true });
  });
  for (const [que, vivo] of [
    ["precio", plan({ pvp: 2_700_000 })], ["impuesto", plan({ impuesto: 310_000 })], ["porcentaje", plan({ pct: 0.12 })], ["comisión", plan({ comision: 1 })],
    ["aliado", plan({ aliado_id: 8 })], ["modalidad", plan({ modo_compra: "neta" })], ["moneda", plan({ moneda: "USD" })], ["exigible", plan({ total_exigible: 1 })],
    ["línea", plan({ lineas: [{ clave: "item-0", pvp: 1_800_000, impuesto: 200_000 }] })],
    ["importe de una línea", plan({ lineas: [{ clave: "item-0", pvp: 1_801_000, impuesto: 200_000 }, { clave: "manual-0", pvp: 800_000, impuesto: 100_000 }] })],
  ] as const) {
    test(`cambia ${que}: rechaza con el mensaje de términos`, () => {
      assert.deepEqual(compararPlanesB2B(plan(), vivo), { ok: false, error: MENSAJE_TERMINOS_CAMBIARON });
    });
  }
});

describe("validarAcomodacionComparativa: una sola acomodación con vuelos y varios destinos", () => {
  const it = (hotelNombre: string, destino: string, habitaciones: Record<string, number>) => ({ hotelNombre, destino, habitaciones });
  test("multidestino doble/doble se permite", () => assert.equal(validarAcomodacionComparativa([it("A", "CARTAGENA", { doble: 1 }), it("B", "SANTA MARTA", { doble: 2 })], true), null));
  test("multidestino doble/triple se rechaza aunque cada hotel tenga un solo tipo", () => {
    assert.deepEqual(validarAcomodacionComparativa([it("A", "CARTAGENA", { doble: 1 }), it("B", "SANTA MARTA", { triple: 1 })], true), { tipo: "distintas", hotel: "B" });
  });
  test("multidestino con un hotel de varios tipos se rechaza (mensaje propio)", () => {
    assert.deepEqual(validarAcomodacionComparativa([it("A", "CARTAGENA", { doble: 1, triple: 1 }), it("B", "SANTA MARTA", { doble: 1 })], true), { tipo: "mixta", hotel: "A" });
  });
  test("unidestino (aunque con varias fechas) admite varias acomodaciones", () => {
    assert.equal(validarAcomodacionComparativa([it("A", "CARTAGENA", { doble: 1 }), it("B", " cartagena ", { triple: 1 }), it("C", "Cartagena", { doble: 1, triple: 1 })], true), null);
  });
  test("sin vuelos manuales la regla no aplica", () => assert.equal(validarAcomodacionComparativa([it("A", "CARTAGENA", { doble: 1 }), it("B", "SANTA MARTA", { triple: 1 })], false), null));
  test("los tipos con 0 habitaciones no cuentan", () => assert.equal(validarAcomodacionComparativa([it("A", "CARTAGENA", { doble: 1, triple: 0 }), it("B", "SANTA MARTA", { doble: 1 })], true), null));
  test("el mensaje nombra el hotel y la regla", () => {
    assert.match(mensajeAcomodacionComparativa({ tipo: "distintas", hotel: "Hotel X" }), /«Hotel X».*misma acomodación|misma acomodación.*«Hotel X»/);
  });
});

describe("totalPublicoOpcion", () => {
  test("NETO: el exigible; sin él, el total de la columna", () => {
    assert.equal(totalPublicoOpcion(2_600_000, { total_exigible: 2_370_000 }), 2_370_000);
    assert.equal(totalPublicoOpcion(2_600_000, { total: 2_600_000 }), 2_600_000);
    assert.equal(totalPublicoOpcion(2_600_000, null), 2_600_000);
    assert.equal(totalPublicoOpcion(2_600_000, { total_exigible: "x" }), 2_600_000);
  });
});
