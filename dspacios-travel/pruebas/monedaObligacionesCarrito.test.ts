// #90 F — moneda REAL de las obligaciones (CxP) del carrito (lib/reservar/monedaObligacionesCarrito.ts). La ejecución del servidor está en cobroCarritoConversion.test.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  decidirCxP, evaluarObligacion, evaluarObligaciones, mensajeObligacionMonedaInvalida, mensajeObligacionSinMoneda, mensajeObligacionUsd, obligacionPositiva,
} from "../lib/reservar/monedaObligacionesCarrito.ts";
import { costoAereoBloqueo, costoHotelPersona, costoTourParaCxP, costoVueloBernalo } from "../lib/reservar/costosObligacionesCarrito.ts";

describe("evaluarObligacion: moneda real de cada costo", () => {
  test("COP → válida, con moneda COP explícita (en contrato COP o USD)", () => {
    assert.deepEqual(evaluarObligacion({ origen: "Hotel", moneda: "COP", monedaContrato: "COP" }), { ok: true, moneda: "COP" });
    assert.deepEqual(evaluarObligacion({ origen: "Hotel", moneda: "cop", monedaContrato: "USD" }), { ok: true, moneda: "COP" });
  });
  test("USD → se rechaza SIEMPRE (la ruta financiera del carrito la devengaría como pesos), también en un contrato COP: no se asigna la moneda del contrato", () => {
    assert.deepEqual(evaluarObligacion({ origen: "Hotel X", moneda: "USD", monedaContrato: "USD" }), { ok: false, error: mensajeObligacionUsd("Hotel X") });
    assert.deepEqual(evaluarObligacion({ origen: "Vuelo", moneda: "usd", monedaContrato: "COP" }), { ok: false, error: mensajeObligacionUsd("Vuelo") });
    assert.match(mensajeObligacionUsd("Hotel X"), /se contabilizaría como si fueran pesos/);
  });
  test("sin moneda: COP en un contrato COP (el default histórico, ahora explícito); en un contrato USD no se determina y se rechaza", () => {
    for (const vacia of [undefined, null, "", "  "]) {
      assert.deepEqual(evaluarObligacion({ origen: "Servicio", moneda: vacia, monedaContrato: "COP" }), { ok: true, moneda: "COP" });
      assert.deepEqual(evaluarObligacion({ origen: "Servicio", moneda: vacia, monedaContrato: "USD" }), { ok: false, error: mensajeObligacionSinMoneda("Servicio") });
    }
  });
  test("una moneda desconocida se rechaza", () => {
    assert.deepEqual(evaluarObligacion({ origen: "Servicio", moneda: "EUR", monedaContrato: "COP" }), { ok: false, error: mensajeObligacionMonedaInvalida("Servicio", "EUR") });
  });
});

describe("solo existen (y se evalúan) las obligaciones de importe POSITIVO", () => {
  test("obligacionPositiva: cero, negativo, NaN, no numérico y vacío no crean CxP", () => {
    for (const v of [0, -1, -0.01, NaN, undefined, null, "5", "", Infinity * 0]) assert.equal(obligacionPositiva(v), false, String(v));
    for (const v of [0.01, 1, 200_000]) assert.equal(obligacionPositiva(v), true, String(v));
  });
  test("un costo USD en CERO no bloquea; uno POSITIVO sí (hotel, vuelo, servicio, tour: mismo criterio)", () => {
    for (const origen of ["Hotel Dólar", "Vuelo de X", "ASISTENCIA MEDICA", "Islas del Rosario"]) {
      assert.deepEqual(evaluarObligaciones({ monedaContrato: "USD", obligaciones: [{ origen, moneda: "USD", valor: 0 }] }), { ok: true }, `${origen} cero`);
      assert.deepEqual(evaluarObligaciones({ monedaContrato: "USD", obligaciones: [{ origen, moneda: "USD", valor: 0.01 }] }), { ok: false, error: mensajeObligacionUsd(origen) }, `${origen} positivo`);
    }
  });
  test("una moneda indeterminable en un contrato USD solo importa si la obligación se crea", () => {
    assert.deepEqual(evaluarObligaciones({ monedaContrato: "USD", obligaciones: [{ origen: "A", moneda: undefined, valor: 0 }] }), { ok: true });
    assert.deepEqual(evaluarObligaciones({ monedaContrato: "USD", obligaciones: [{ origen: "A", moneda: undefined, valor: 5 }] }), { ok: false, error: mensajeObligacionSinMoneda("A") });
  });
  test("todas COP → ok; la primera positiva en USD detiene todo con su mensaje; sin obligaciones no hay nada que denominar", () => {
    assert.deepEqual(evaluarObligaciones({ monedaContrato: "COP", obligaciones: [{ origen: "A", moneda: "COP", valor: 10 }, { origen: "B", moneda: undefined, valor: 10 }] }), { ok: true });
    assert.deepEqual(evaluarObligaciones({ monedaContrato: "COP", obligaciones: [
      { origen: "A", moneda: "COP", valor: 10 }, { origen: "Z", moneda: "USD", valor: 0 }, { origen: "B", moneda: "USD", valor: 3 }, { origen: "C", moneda: "EUR", valor: 3 },
    ] }), { ok: false, error: mensajeObligacionUsd("B") });
    assert.deepEqual(evaluarObligaciones({ monedaContrato: "USD", obligaciones: [] }), { ok: true });
  });
});

describe("la revisión previa y pushCxP deciden igual (misma función, cuadrícula completa)", () => {
  test("para cada combinación de importe × moneda × contrato, evaluarObligaciones rechaza si y solo si decidirCxP rechaza; omitir ⇔ importe no positivo", () => {
    const valores = [0, -5, NaN, undefined, 0.01, 40_000];
    const monedas = ["COP", "USD", "usd", undefined, null, "", "EUR"];
    for (const valor of valores) for (const moneda of monedas) for (const monedaContrato of ["COP", "USD"]) {
      const d = decidirCxP({ origen: "X", moneda, valor, monedaContrato });
      const e = evaluarObligaciones({ monedaContrato, obligaciones: [{ origen: "X", moneda, valor: valor as number }] });
      assert.equal(e.ok, d.accion !== "rechazar", `valor=${valor} moneda=${moneda} contrato=${monedaContrato}`);
      assert.equal(d.accion === "omitir", !obligacionPositiva(valor), `omitir ⇔ no positivo: valor=${valor}`);
      if (d.accion === "crear") assert.equal(d.moneda, "COP", "lo único que se crea queda en COP explícita");
    }
  });
});

describe("costos compartidos (mismas fórmulas que antes, ahora en un solo lugar)", () => {
  test("hotel por persona: Σ neto × pax + niños 1/2 + infantes; filas sin neto no suman", () => {
    const comp = { lineasHab: [{ acom: "doble", pax: 2 }, { acom: "triple", pax: 3 }], netoPorAcom: { doble: 100, triple: null, nino: 50, nino2: 40, infante: 10 } as Record<string, number | null>, numNinos: 1, numNinos2: 2 };
    assert.equal(costoHotelPersona(comp, 3), 2 * 100 + 50 + 2 * 40 + 3 * 10);
    assert.equal(costoHotelPersona({ ...comp, netoPorAcom: { doble: 0 } }, 3), 0, "neto cero → costo cero");
    assert.equal(costoHotelPersona({ ...comp, numNinos: 0, numNinos2: 0 }, 0), 200);
  });
  test("vuelo de bloqueo y vuelo Bernalo", () => {
    assert.equal(costoAereoBloqueo({ tarifa_para_empaquetar: "500000", fee_infante: 80_500 }, 2, 1), 1_080_500);
    assert.equal(costoAereoBloqueo({ tarifa_para_empaquetar: null, fee_infante: undefined }, 2, 1), 0, "sin tarifa ni fee → cero");
    assert.equal(costoVueloBernalo({ costo_neto: 250, fee_infante: 20 }, 3, 2), 2 * 250 + 20);
  });
  test("costo de un tour: solo finito y positivo genera CxP", () => {
    assert.equal(costoTourParaCxP({ costoNeto: 200 }), 200);
    for (const liq of [null, { costoNeto: 0 }, { costoNeto: -5 }, { costoNeto: NaN }, { costoNeto: Infinity }]) assert.equal(costoTourParaCxP(liq), 0);
  });
});
