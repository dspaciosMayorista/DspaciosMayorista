// #14-A — Lectura pura del formulario del recobro: formatos, vacíos, errores y la regla de qué se envía.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parsearImporteFormulario, recobroDesdeFormulario } from "../lib/cotizacion/recobroEntradaUI.ts";

describe("parsearImporteFormulario", () => {
  test("formatos colombianos y simples", () => {
    for (const [txt, n] of [["100000", 100000], ["100.000", 100000], ["1.234.567", 1234567], ["100.000,50", 100000.5], ["1,5", 1.5], ["2.5", 2.5], ["$ 3.000", 3000], ["0", 0]] as const) assert.equal(parsearImporteFormulario(txt), n, txt);
  });
  test("vacío ⇒ null; ilegible ⇒ NaN", () => {
    assert.equal(parsearImporteFormulario("   "), null);
    for (const malo of ["abc", "1..2", "1,2,3", "-5", "1e3", "1.2.3"]) assert.ok(Number.isNaN(parsearImporteFormulario(malo) as number), malo);
  });
});

describe("recobroDesdeFormulario", () => {
  const base = { partModo: "valor" as const, partTxt: "", pideDistribucion: false };
  test("vacío o 0 ⇒ sin recobro (no se envía nada)", () => {
    assert.deepEqual(recobroDesdeFormulario({ ...base, recobroTxt: "" }), { ok: true, recobro: null });
    assert.deepEqual(recobroDesdeFormulario({ ...base, recobroTxt: "0" }), { ok: true, recobro: null });
  });
  test("sin distribución (aliado directo / cliente final): solo el total, aunque haya texto de distribución", () => {
    assert.deepEqual(recobroDesdeFormulario({ ...base, recobroTxt: "100.000", partTxt: "50.000" }), { ok: true, recobro: { total: 100000 } });
  });
  test("venta asistida: valor, % y vacío", () => {
    const a = { ...base, pideDistribucion: true, recobroTxt: "100000" };
    assert.deepEqual(recobroDesdeFormulario({ ...a, partTxt: "50.000" }), { ok: true, recobro: { total: 100000, participacion: { modo: "valor", valor: 50000 } } });
    assert.deepEqual(recobroDesdeFormulario({ ...a, partModo: "pct", partTxt: "40" }), { ok: true, recobro: { total: 100000, participacion: { modo: "pct", pct: 0.4 } } });
    assert.deepEqual(recobroDesdeFormulario({ ...a, partTxt: "" }), { ok: true, recobro: { total: 100000 } });
  });
  test("errores explícitos: ilegible, negativo, más de 2 decimales, % fuera de 0–100, distribución ilegible", () => {
    const a = { ...base, pideDistribucion: true };
    for (const e of [{ ...a, recobroTxt: "abc" }, { ...a, recobroTxt: "1,234" }, { ...a, recobroTxt: "100", partTxt: "x" }, { ...a, recobroTxt: "100", partModo: "pct" as const, partTxt: "101" }]) {
      const r = recobroDesdeFormulario(e);
      assert.equal(r.ok, false, JSON.stringify(e));
    }
  });
});
