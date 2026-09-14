import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  construirSetParesPublicados,
  todosLosParesConfiguradosPublicados,
  primerParConfiguradoSinPublicar,
} from "../lib/calc/paresPublicadosUnidad.ts";

// ─────────────────────────────────────────────────────────────────────────
// Pruebas EJECUTABLES (función pura, sin Supabase/Next) del helper
// compartido que decide si un producto cartesiano categorías×alimentaciones
// CONFIGURADO está realmente cubierto por tarifas PUBLICADAS
// (`hotel_tarifas_unidad`, `estado = "publicada"`). Usado por
// `setHotelFiltros`, `cargarHotelesBernaloDescubiertos` y `generarTarifario`
// — una sola función, probada una sola vez con ejecución real.
// ─────────────────────────────────────────────────────────────────────────

describe("construirSetParesPublicados", () => {
  test("construye un par por fila con categoría Y alimentación no vacías", () => {
    const set = construirSetParesPublicados([
      { categoria: "Estándar", alimentacion: "FULL" },
      { categoria: "Suite", alimentacion: "PC" },
    ]);
    assert.equal(set.size, 2);
    assert.ok(set.has(JSON.stringify(["Estándar", "FULL"])));
    assert.ok(set.has(JSON.stringify(["Suite", "PC"])));
  });

  test("descarta filas con categoría o alimentación null/vacía — un par publicado sin clasificación completa no identifica ninguna combinación", () => {
    const set = construirSetParesPublicados([
      { categoria: null, alimentacion: "FULL" },
      { categoria: "Estándar", alimentacion: null },
      { categoria: "", alimentacion: "FULL" },
    ]);
    assert.equal(set.size, 0);
  });

  test("filas duplicadas (misma categoría+alimentación, ej. dos temporadas) colapsan a UN solo par — el Set no cuenta duplicados", () => {
    const set = construirSetParesPublicados([
      { categoria: "Estándar", alimentacion: "FULL" },
      { categoria: "Estándar", alimentacion: "FULL" },
    ]);
    assert.equal(set.size, 1);
  });
});

describe("todosLosParesConfiguradosPublicados", () => {
  test("2 adultos/1 categoría/1 alimentación con tarifa publicada → true", () => {
    const publicados = construirSetParesPublicados([{ categoria: "Estándar", alimentacion: "FULL" }]);
    assert.equal(todosLosParesConfiguradosPublicados(["Estándar"], ["FULL"], publicados), true);
  });

  test("categorías o regímenes vacíos → false, NUNCA 'todas' (a diferencia de persona, el arreglo vacío no es sentinela para unidad)", () => {
    const publicados = construirSetParesPublicados([{ categoria: "Estándar", alimentacion: "FULL" }]);
    assert.equal(todosLosParesConfiguradosPublicados([], ["FULL"], publicados), false);
    assert.equal(todosLosParesConfiguradosPublicados(["Estándar"], [], publicados), false);
    assert.equal(todosLosParesConfiguradosPublicados([], [], publicados), false);
  });

  test('Estándar/FULL + Suite/PC publicadas — configurar "Estándar" + "PC" (combinación cruzada nunca publicada) → false', () => {
    const publicados = construirSetParesPublicados([
      { categoria: "Estándar", alimentacion: "FULL" },
      { categoria: "Suite", alimentacion: "PC" },
    ]);
    assert.equal(todosLosParesConfiguradosPublicados(["Estándar"], ["PC"], publicados), false);
    assert.equal(todosLosParesConfiguradosPublicados(["Suite"], ["FULL"], publicados), false);
  });

  test("producto cartesiano COMPLETO (2 categorías × 2 alimentaciones = 4 pares) requiere las 4 combinaciones publicadas — 3 de 4 sigue siendo false", () => {
    const publicados = construirSetParesPublicados([
      { categoria: "Estándar", alimentacion: "FULL" },
      { categoria: "Estándar", alimentacion: "PC" },
      { categoria: "Suite", alimentacion: "FULL" },
      // falta Suite/PC
    ]);
    assert.equal(todosLosParesConfiguradosPublicados(["Estándar", "Suite"], ["FULL", "PC"], publicados), false);
  });

  test("con las 4 combinaciones publicadas, el cartesiano completo → true", () => {
    const publicados = construirSetParesPublicados([
      { categoria: "Estándar", alimentacion: "FULL" },
      { categoria: "Estándar", alimentacion: "PC" },
      { categoria: "Suite", alimentacion: "FULL" },
      { categoria: "Suite", alimentacion: "PC" },
    ]);
    assert.equal(todosLosParesConfiguradosPublicados(["Estándar", "Suite"], ["FULL", "PC"], publicados), true);
  });

  test("un Set vacío de pares publicados (cero tarifas publicadas, o solo borrador/inactiva ya filtradas antes de construir el Set) → siempre false para cualquier configuración no vacía", () => {
    const publicados = construirSetParesPublicados([]);
    assert.equal(todosLosParesConfiguradosPublicados(["Estándar"], ["FULL"], publicados), false);
  });
});

describe("primerParConfiguradoSinPublicar", () => {
  test("devuelve la primera combinación configurada sin tarifa publicada, en orden categorías×regímenes", () => {
    const publicados = construirSetParesPublicados([{ categoria: "Estándar", alimentacion: "FULL" }]);
    const faltante = primerParConfiguradoSinPublicar(["Estándar", "Suite"], ["FULL", "PC"], publicados);
    assert.deepEqual(faltante, { categoria: "Estándar", alimentacion: "PC" });
  });

  test("null cuando todo el cartesiano configurado está publicado", () => {
    const publicados = construirSetParesPublicados([{ categoria: "Estándar", alimentacion: "FULL" }]);
    assert.equal(primerParConfiguradoSinPublicar(["Estándar"], ["FULL"], publicados), null);
  });
});
