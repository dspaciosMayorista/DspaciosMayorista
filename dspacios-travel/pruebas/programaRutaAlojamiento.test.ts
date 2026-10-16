import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALOJAMIENTO_PREVISTO_MAX,
  limpiarAlojamientoPrevisto,
} from "../lib/programas.ts";

// #51 / migración 212: alojamiento previsto por ciudad de la ruta (texto libre).
// La conservación por nombre/orden y el reemplazo atómico viven en la RPC SQL y
// se prueban en PostgreSQL real (supabase/scripts/test_212_*).

test("limpiarAlojamientoPrevisto: recorta, vacío -> null, respeta el máximo", () => {
  assert.equal(limpiarAlojamientoPrevisto("  Hotel X o similar  "), "Hotel X o similar");
  assert.equal(limpiarAlojamientoPrevisto("   "), null);
  assert.equal(limpiarAlojamientoPrevisto(""), null);
  assert.equal(limpiarAlojamientoPrevisto(null), null);
  assert.equal(limpiarAlojamientoPrevisto(undefined), null);
  assert.equal(limpiarAlojamientoPrevisto(42), null);
  assert.equal(limpiarAlojamientoPrevisto("a".repeat(ALOJAMIENTO_PREVISTO_MAX + 50))?.length, ALOJAMIENTO_PREVISTO_MAX);
});
