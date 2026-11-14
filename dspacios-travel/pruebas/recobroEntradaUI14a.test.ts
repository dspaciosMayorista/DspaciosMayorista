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

// ── Total con recobro a cliente final (antes de generar): confirmado ≠ pendiente ≠ error ──────────────────────────────────────────────────────────────────────────────
import { totalConRecobro } from "../lib/cotizacion/recobroEntradaUI.ts";
describe("total con recobro (cliente final)", () => {
  const partes = [{ etiqueta: "Hotel", monto: 1_840_000 }, { etiqueta: "Servicio", monto: 400_000 }];
  const base = { moneda: "COP", monto: 2_240_000 };
  const form = (txt: string) => recobroDesdeFormulario({ recobroTxt: txt, partModo: "valor", partTxt: "", pideDistribucion: false });
  test("hotel $1.840.000 + servicio $400.000 + recobro $400.000 = $2.640.000 (confirmado)", () => {
    const t = totalConRecobro({ form: form("400.000"), base, partes });
    assert.equal(t.estado, "confirmado");
    if (t.estado === "confirmado") { assert.equal(t.total, 2_640_000); assert.equal(t.recobro, 400_000); assert.deepEqual(t.partes.map((p) => p.monto), [1_840_000, 400_000]); }
  });
  test("sin recobro (vacío o 0): nada que mostrar", () => {
    assert.equal(totalConRecobro({ form: form(""), base, partes }).estado, "sin_recobro");
    assert.equal(totalConRecobro({ form: form("0"), base, partes }).estado, "sin_recobro");
  });
  test("recobro ilegible o negativo: ERROR, sin cifra de total", () => {
    for (const txt of ["abc", "-5", "1,2,3"]) { const t = totalConRecobro({ form: form(txt), base, partes }); assert.equal(t.estado, "error", txt); assert.equal("total" in t, false); }
  });
  test("moneda mezclada o desglose que no cuadra: PENDIENTE, sin cifra (no se muestra un total sin poder confirmarlo)", () => {
    const mezcla = totalConRecobro({ form: form("400000"), base: null, partes });
    assert.equal(mezcla.estado, "pendiente"); assert.equal("total" in mezcla, false);
    const incoherente = totalConRecobro({ form: form("400000"), base, partes: [{ etiqueta: "Hotel", monto: 1_000_000 }] });
    assert.equal(incoherente.estado, "pendiente");
  });
  test("centavos: la suma es exacta (sin errores de coma flotante)", () => {
    const t = totalConRecobro({ form: form("0,10"), base: { moneda: "USD", monto: 100.2 }, partes: [{ etiqueta: "Hotel", monto: 100.2 }] });
    assert.equal(t.estado, "confirmado");
    if (t.estado === "confirmado") assert.equal(t.total, 100.3);
  });
});
