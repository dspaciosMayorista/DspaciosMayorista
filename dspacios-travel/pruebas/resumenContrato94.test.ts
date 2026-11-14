// #94 — el contrato conserva el resumen de precios del CLIENTE de las unidades de su grupo, solo si cuadra con lo exigible. Datos sintéticos.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resumenUnidad, resumenCotizacion, resumenParaContrato, type UnidadResumen } from "../lib/cotizacion/resumenPrecios.ts";

const meta = (ref: string) => ({ ref, paquete: { id: 1, nombre: "Paquete Sintético" }, hotel: `Hotel ${ref}`, categoria: "Estándar", regimen: "PC" });
const unidad = (ref: string, tarifaCentavos: number): UnidadResumen => {
  const r = resumenUnidad({ ...meta(ref), cupos: [{ id: `${ref}-a`, tipo: "adulto", baseCentavos: tarifaCentavos }, { id: `${ref}-b`, tipo: "adulto", baseCentavos: tarifaCentavos }], servicios: [] });
  assert.ok(r.ok);
  return (r as Extract<typeof r, { ok: true }>).valor;
};
const guardado = (m: "pvp" | "neto" = "pvp") => JSON.parse(JSON.stringify(resumenCotizacion({ modalidad: m, moneda: "COP", unidades: [unidad("item-0", 50_000_000), unidad("item-1", 70_000_000)] })));

describe("resumenParaContrato", () => {
  test("un contrato por hotel: recibe SOLO su unidad con el total recalculado", () => {
    const r = resumenParaContrato(guardado(), ["item-1"], { modalidad: "pvp", moneda: "COP", totalCentavos: 140_000_000 });
    assert.ok(r);
    assert.deepEqual(r.unidades.map((u) => u.ref), ["item-1"]);
    assert.equal(r.totalCentavos, 140_000_000);
  });
  test("un contrato con los dos hoteles recibe las dos unidades", () => {
    const r = resumenParaContrato(guardado(), ["item-0", "item-1"], { modalidad: "pvp", moneda: "COP", totalCentavos: 240_000_000 });
    assert.equal(r?.unidades.length, 2);
  });
  test("no cuadra con lo exigible ⇒ null (no se inventa un reparto)", () => {
    assert.equal(resumenParaContrato(guardado(), ["item-1"], { modalidad: "pvp", moneda: "COP", totalCentavos: 140_000_001 }), null);
  });
  test("modalidad o moneda distintas del acuerdo ⇒ null", () => {
    assert.equal(resumenParaContrato(guardado("neto"), ["item-1"], { modalidad: "pvp", moneda: "COP", totalCentavos: 140_000_000 }), null);
    assert.equal(resumenParaContrato(guardado(), ["item-1"], { modalidad: "pvp", moneda: "USD", totalCentavos: 140_000_000 }), null);
  });
  test("unidad desconocida, sin refs o sin resumen ⇒ null", () => {
    const a = { modalidad: "pvp" as const, moneda: "COP", totalCentavos: 140_000_000 };
    assert.equal(resumenParaContrato(guardado(), ["item-9"], a), null);
    assert.equal(resumenParaContrato(guardado(), [], a), null);
    assert.equal(resumenParaContrato(null, ["item-1"], a), null);
    assert.equal(resumenParaContrato({ version: 2 }, ["item-1"], a), null);
  });
  test("refs repetidas no duplican la unidad", () => {
    const r = resumenParaContrato(guardado(), ["item-1", "item-1"], { modalidad: "pvp", moneda: "COP", totalCentavos: 140_000_000 });
    assert.equal(r?.unidades.length, 1);
  });
  test("no muta el resumen guardado", () => {
    const g = guardado(); const copia = JSON.stringify(g);
    resumenParaContrato(g, ["item-0"], { modalidad: "pvp", moneda: "COP", totalCentavos: 100_000_000 });
    assert.equal(JSON.stringify(g), copia);
  });
});
