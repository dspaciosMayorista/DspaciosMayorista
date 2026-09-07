// ─────────────────────────────────────────────────────────────────────────
// lib/reservar/pasajeros.ts — fuente de verdad única de "¿este pasajero es
// infante?" / "¿este pasajero ocupa silla?" (retoma el pendiente CHD/INF).
// Pruebas de comportamiento REAL, funciones puras, mismo criterio que
// pruebas/reservarOrigen.test.ts.
// ─────────────────────────────────────────────────────────────────────────
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  esInfantePorEdad,
  pasajeroConsumeSilla,
  contarConsumenSilla,
  EDAD_INFANTE_MAX_VUELO,
} from "../lib/reservar/pasajeros.ts";

describe("esInfantePorEdad — recalcula SIEMPRE desde la fecha real, nunca confía en un flag", () => {
  test("recién nacido a la fecha de salida → infante", () => {
    assert.equal(esInfantePorEdad("2026-08-01", "2026-09-01"), true);
  });

  test("1 año 11 meses a la fecha de salida → infante (todavía no cumple 2)", () => {
    assert.equal(esInfantePorEdad("2024-10-01", "2026-09-01"), true);
  });

  test("exactamente 2 años cumplidos a la fecha de salida → YA NO es infante (umbral estrictamente < 2)", () => {
    assert.equal(esInfantePorEdad("2024-09-01", "2026-09-01"), false);
  });

  test("2 años y 1 día → no es infante", () => {
    assert.equal(esInfantePorEdad("2024-08-31", "2026-09-01"), false);
  });

  test("adulto (30 años) → no es infante", () => {
    assert.equal(esInfantePorEdad("1996-01-15", "2026-09-01"), false);
  });

  test("niño de 5 años → no es infante (es CHD, consume silla)", () => {
    assert.equal(esInfantePorEdad("2021-01-01", "2026-09-01"), false);
  });

  test("fecha de nacimiento null/vacía → false, fail-safe hacia CONSUMIR silla", () => {
    assert.equal(esInfantePorEdad(null, "2026-09-01"), false);
    assert.equal(esInfantePorEdad(undefined, "2026-09-01"), false);
    assert.equal(esInfantePorEdad("", "2026-09-01"), false);
  });

  test("fecha de nacimiento inválida → false, fail-safe (calcularEdad ya retorna null)", () => {
    assert.equal(esInfantePorEdad("no-es-una-fecha", "2026-09-01"), false);
  });

  test("sin fecha de referencia → usa hoy (delegado a calcularEdad, no se inventa una fecha nueva)", () => {
    const hace1Anio = new Date();
    hace1Anio.setFullYear(hace1Anio.getFullYear() - 1);
    const iso = hace1Anio.toISOString().slice(0, 10);
    assert.equal(esInfantePorEdad(iso, null), true);
  });

  test("umbral EDAD_INFANTE_MAX_VUELO expuesto es 2 (documenta la regla de negocio confirmada)", () => {
    assert.equal(EDAD_INFANTE_MAX_VUELO, 2);
  });
});

describe("pasajeroConsumeSilla — ADT y CHD consumen, INF no", () => {
  test("adulto/niño (esInfante=false) → consume silla", () => {
    assert.equal(pasajeroConsumeSilla(false), true);
  });

  test("infante (esInfante=true) → NO consume silla", () => {
    assert.equal(pasajeroConsumeSilla(true), false);
  });
});

describe("contarConsumenSilla — cuenta ADT+CHD, excluye INF, sin depender de posición/orden", () => {
  test("todos adultos → todos consumen", () => {
    assert.equal(contarConsumenSilla([false, false, false]), 3);
  });

  test("mezcla ADT/CHD/INF → solo cuenta los que no son infante", () => {
    // 2 adultos + 1 niño (no infante) + 1 infante ⇒ 3 sillas
    assert.equal(contarConsumenSilla([false, false, false, true]), 3);
  });

  test("todos infantes → 0 sillas", () => {
    assert.equal(contarConsumenSilla([true, true]), 0);
  });

  test("lista vacía → 0", () => {
    assert.equal(contarConsumenSilla([]), 0);
  });

  test("infante intercalado (no depende de que estén al final del arreglo)", () => {
    // el criterio antiguo (posicional: idx >= cortePax) fallaría si el
    // infante no está al final — esta prueba fija que el nuevo criterio
    // es por EDAD real, sin importar la posición.
    assert.equal(contarConsumenSilla([true, false, true, false]), 2);
  });
});

describe("Integración esInfantePorEdad + contarConsumenSilla — escenario de un contrato típico", () => {
  test("2 adultos + 1 niño de 5 años + 1 infante de 1 año → 3 sillas, 1 infante visible aparte", () => {
    const fechaSalida = "2026-09-01";
    const nacimientos = ["1990-01-01", "1988-05-05", "2021-01-01", "2025-01-01"];
    const esInfante = nacimientos.map((n) => esInfantePorEdad(n, fechaSalida));
    assert.deepEqual(esInfante, [false, false, false, true]);
    assert.equal(contarConsumenSilla(esInfante), 3);
  });
});
