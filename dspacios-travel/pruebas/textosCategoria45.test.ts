// #45 (303): textos por categoría DENTRO de cada hotel — agrupación pura que alimenta la ficha del tarifario.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { agruparTextosCategoria } from "../lib/tarifario/textosCategoria.ts";

const fila = (hotel_id: number, nombre: string | null, descripcion: string | null, incluye: string | null) =>
  ({ hotel_id, descripcion, incluye, categorias_habitacion: nombre ? { nombre } : null });

describe("agruparTextosCategoria", () => {
  test("misma categoría global con textos distintos en dos hoteles (Q-A: por hotel)", () => {
    const t = agruparTextosCategoria([
      fila(1, "Superior", "Con balcón", "Minibar\nCaja fuerte"),
      fila(2, "Superior", "Sin balcón", null),
    ]);
    assert.deepEqual(t, {
      1: { Superior: { descripcion: "Con balcón", incluye: "Minibar\nCaja fuerte" } },
      2: { Superior: { descripcion: "Sin balcón", incluye: null } },
    });
  });
  test("textos vacíos o solo espacios no se publican; sin nombre de categoría se descarta", () => {
    assert.deepEqual(agruparTextosCategoria([fila(1, "Estándar", "  ", "\n"), fila(1, null, "x", "y")]), {});
  });
  test("recorta espacios sin tocar el contenido", () => {
    assert.deepEqual(agruparTextosCategoria([fila(3, "Suite", "  Jacuzzi  ", null)]), { 3: { Suite: { descripcion: "Jacuzzi", incluye: null } } });
  });
});
