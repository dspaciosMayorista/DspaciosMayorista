import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { valorVisibleContratoItem, totalVisibleContratoItems } from "../lib/contrato/valorContratoItem.ts";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3F-4B — helper puro compartido para el valor visible de una fila de
// `contrato_items` (migración 176: `modo_precio`/`valor_total`). Prueba
// "Línea total se renderiza una vez y no se multiplica por pax" del encargo.
// ─────────────────────────────────────────────────────────────────────────

describe("valorVisibleContratoItem", () => {
  test('modo_precio "total": devuelve valor_total tal cual, IGNORANDO adultos/ninos/tarifa_adulto/tarifa_nino', () => {
    const it = { modo_precio: "total", valor_total: 4_500_000, adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0 };
    assert.equal(valorVisibleContratoItem(it), 4_500_000);
  });

  test('modo_precio "total" con adultos/tarifa_adulto residuales (legado/manipulado): sigue devolviendo valor_total, nunca los multiplica', () => {
    const it = { modo_precio: "total", valor_total: 4_500_000, adultos: 6, ninos: 2, tarifa_adulto: 999_999, tarifa_nino: 999_999 };
    assert.equal(valorVisibleContratoItem(it), 4_500_000, "una línea 'total' nunca se multiplica por pax — regla de la prueba obligatoria");
  });

  test('modo_precio "total" con valor_total null: cae a 0, nunca NaN ni undefined', () => {
    const it = { modo_precio: "total", valor_total: null, adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0 };
    assert.equal(valorVisibleContratoItem(it), 0);
  });

  test('modo_precio "por_persona" (default histórico): fórmula de siempre, adultos × tarifa_adulto + ninos × tarifa_nino', () => {
    const it = { modo_precio: "por_persona", valor_total: null, adultos: 2, ninos: 1, tarifa_adulto: 500_000, tarifa_nino: 200_000 };
    assert.equal(valorVisibleContratoItem(it), 2 * 500_000 + 1 * 200_000);
  });

  test("una fila legada sin modo_precio reconocible cae a la fórmula per-cápita (cero cambio de comportamiento para datos existentes)", () => {
    const it = { modo_precio: "", valor_total: null, adultos: 3, ninos: 0, tarifa_adulto: 100_000, tarifa_nino: 0 };
    assert.equal(valorVisibleContratoItem(it), 300_000);
  });
});

describe("totalVisibleContratoItems", () => {
  test("suma líneas mixtas por_persona + total (cotización/contrato mixto persona+Bernalo)", () => {
    const items = [
      { modo_precio: "por_persona", valor_total: null, adultos: 2, ninos: 0, tarifa_adulto: 300_000, tarifa_nino: 0 },
      { modo_precio: "total", valor_total: 4_500_000, adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0 },
    ];
    assert.equal(totalVisibleContratoItems(items), 600_000 + 4_500_000);
  });

  test("arreglo vacío suma 0", () => {
    assert.equal(totalVisibleContratoItems([]), 0);
  });
});
