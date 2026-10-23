// Pruebas de los normalizadores. Son la base de la idempotencia del staging:
// si un NIT o un total se normalizan de dos formas distintas según de dónde
// vengan, la comparación de duplicados miente y el mismo documento entra dos
// veces. Por eso aquí se fijan los casos límite, no solo los fáciles.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  claveTexto,
  normalizarCufe,
  normalizarDv,
  normalizarFecha,
  normalizarMoneda,
  normalizarMonto,
  normalizarNit,
  pareceCufe,
  periodoDe,
  soloDigitos,
} from "../lib/contabilidad/dian/normalizar.ts";

// ── NIT y DV ─────────────────────────────────────────────────────────────────

test("NIT: acepta las tres formas en que llega", () => {
  for (const entrada of ["900123456-7", "900.123.456-7", "NIT 900123456-7", " 900123456-7 "]) {
    const r = normalizarNit(entrada);
    assert.ok(r, entrada);
    assert.equal(r.nit, "900123456", entrada);
    assert.equal(r.dv, "7", entrada);
  }
});

test("NIT: sin DV explícito lo deja en null, no lo inventa", () => {
  const r = normalizarNit("900123456");
  assert.ok(r);
  assert.equal(r.nit, "900123456");
  assert.equal(r.dv, null);
});

test("NIT: diez dígitos se parten en 9 + DV", () => {
  const r = normalizarNit("9001234567");
  assert.ok(r);
  assert.equal(r.nit, "900123456");
  assert.equal(r.dv, "7");
});

test("NIT: texto sin dígitos no es un NIT", () => {
  for (const malo of ["SIN NIT", "", "   ", "12345", null, undefined]) {
    assert.equal(normalizarNit(malo), null, String(malo));
  }
});

test("DV: solo un dígito o nada", () => {
  assert.equal(normalizarDv("7"), "7");
  assert.equal(normalizarDv(0), "0");
  assert.equal(normalizarDv("07"), null, "dos dígitos no son un DV");
  assert.equal(normalizarDv("abc"), null);
  assert.equal(normalizarDv(null), null);
});

// ── CUFE / CUDE ─────────────────────────────────────────────────────────────

const CUFE_VALIDO = "CUFE" + "0123456789ABCDEF".repeat(3) + "GHIJK";

test("CUFE: se normaliza a mayúsculas sin nada más", () => {
  assert.equal(normalizarCufe("cufe-abc_123"), "CUFEABC123");
  assert.equal(normalizarCufe(null), null);
});

test("CUFE: el largo mínimo descarta un número de documento colado", () => {
  assert.ok(pareceCufe(CUFE_VALIDO));
  assert.equal(normalizarCufe(CUFE_VALIDO), CUFE_VALIDO);
  assert.equal(pareceCufe("FE-001"), false, "un número de documento no es un CUFE");
  assert.equal(pareceCufe("123"), false);
  assert.equal(pareceCufe(""), false);
  assert.equal(pareceCufe(null), false);
});

// ── Fechas ───────────────────────────────────────────────────────────────────

test("fecha: ISO, con hora y con año pegado dan el mismo día", () => {
  for (const entrada of ["2026-03-02", "2026/03/02", "20260302", "2026-03-02T10:00:00-05:00", "2026-03-02T15:00:00Z"]) {
    assert.equal(normalizarFecha(entrada), "2026-03-02", entrada);
  }
});

test("fecha: día/mes sin año NO se adivina (el año es una decisión de negocio)", () => {
  assert.equal(normalizarFecha("02/03/2026"), "2026-03-02");
  assert.equal(normalizarFecha("2/3/26"), null, "año de 2 cifras: no se inventa el siglo");
  assert.equal(normalizarFecha(""), null);
  assert.equal(normalizarFecha("no hay fecha"), null);
});

test("fecha: mes o día imposibles se rechazan", () => {
  assert.equal(normalizarFecha("2026-13-01"), null);
  assert.equal(normalizarFecha("2026-00-10"), null);
});

test("periodo: YYYY-MM derivado del día", () => {
  assert.equal(periodoDe("2026-03-02T10:00:00-05:00"), "2026-03");
  assert.equal(periodoDe(null), null);
});

// ── Montos ───────────────────────────────────────────────────────────────────

test("monto: formato colombiano y formato US dan el mismo número", () => {
  for (const entrada of ["1.234.567,89", "1,234,567.89", "1234567.89", "$ 1.234.567,89", "COP 1.234.567,89"]) {
    assert.equal(normalizarMonto(entrada), 1234567.89, entrada);
  }
});

test("monto:millones sin decimales no se parten", () => {
  assert.equal(normalizarMonto("1190000"), 1190000);
  assert.equal(normalizarMonto("1.190.000"), 1190000, "punto de miles");
  assert.equal(normalizarMonto("1,190,000"), 1190000, "coma de miles");
  assert.equal(normalizarMonto("0.19"), 0.19, "un decimal de verdad, no miles");
});

test("monto: lo que no es número devuelve null, nunca 0", () => {
  // Un total que no se pudo leer NO es un total en cero: confundirlos es
  // exactamente el defecto que hace cuadrar una compra que no cuadra.
  for (const malo of ["", "   ", "N/A", "-", "abc", null, undefined]) {
    assert.equal(normalizarMonto(malo), null, JSON.stringify(malo));
  }
  assert.equal(normalizarMonto(0), 0, "cero explícito sí es cero");
});

test("monto: negativo explícito y negativo por paréntesis", () => {
  assert.equal(normalizarMonto("-1500.50"), -1500.5);
  assert.equal(normalizarMonto("(1.500,50)"), -1500.5);
});

// ── Moneda ───────────────────────────────────────────────────────────────────

test("moneda: ISO y los alias que trae el Excel", () => {
  assert.equal(normalizarMoneda("COP"), "COP");
  assert.equal(normalizarMoneda("usd"), "USD");
  assert.equal(normalizarMoneda("$"), "COP");
  assert.equal(normalizarMoneda("COL"), "COP");
  assert.equal(normalizarMoneda("Dólares"), "USD");
  assert.equal(normalizarMoneda(""), null);
  assert.equal(normalizarMoneda("XX"), null);
  assert.equal(normalizarMoneda("AB"), null, "dos letras no son una moneda");
});

// ── Utilidades ───────────────────────────────────────────────────────────────

test("soloDigitos: deja solo números", () => {
  assert.equal(soloDigitos("900.123.456-7"), "9001234567");
  assert.equal(soloDigitos(null), "");
});

test("claveTexto: sin acentos, en mayúsculas y sin signos, para comparar encabezados", () => {
  assert.equal(claveTexto("Razón Social"), "RAZON SOCIAL");
  assert.equal(claveTexto("N° de Identificación"), "N DE IDENTIFICACION");
  assert.equal(claveTexto("VALOR TOTAL ($)"), "VALOR TOTAL");
  assert.equal(claveTexto(null), "");
});
