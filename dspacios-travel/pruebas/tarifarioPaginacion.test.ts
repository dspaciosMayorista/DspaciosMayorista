import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import {
  cargarFilasTarifarioPaginado,
  PAGINAS_CONCURRENTES,
} from "../lib/tarifario/paginacion.ts";

type FilaFake = { id: number };
type RespuestaForzada = { data: FilaFake[] | null; error: unknown };

function clienteFalso(
  dataset: FilaFake[],
  resolver?: (from: number, to: number) => RespuestaForzada | undefined
) {
  const llamadas: {
    columnas: string;
    eq: [string, unknown][];
    orders: string[];
    ranges: [number, number][];
    activas: number;
    maxActivas: number;
  } = { columnas: "", eq: [], orders: [], ranges: [], activas: 0, maxActivas: 0 };
  const sb = {
    from() {
      return {
        select(columnas: string) { llamadas.columnas = columnas; return this; },
        eq(col: string, valor: unknown) { llamadas.eq.push([col, valor]); return this; },
        order(col: string) { llamadas.orders.push(col); return this; },
        async range(from: number, to: number) {
          llamadas.ranges.push([from, to]);
          llamadas.activas++;
          llamadas.maxActivas = Math.max(llamadas.maxActivas, llamadas.activas);
          await new Promise((resolve) => setTimeout(resolve, from === 1000 ? 4 : 1));
          llamadas.activas--;
          return resolver?.(from, to) ?? { data: dataset.slice(from, to + 1), error: null };
        },
      };
    },
  };
  return { sb: sb as unknown as SupabaseClient<Database>, llamadas };
}

const datasetDe = (n: number) => Array.from({ length: n }, (_, id) => ({ id }));
const ERROR = { code: "57014", message: "detalle interno de prueba" };

describe("cargarFilasTarifarioPaginado - concurrencia acotada", () => {
  test("catalogo vacio o pequeno conserva un solo request", async () => {
    for (const cantidad of [0, 500]) {
      const { sb, llamadas } = clienteFalso(datasetDe(cantidad));
      const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
      assert.equal(r.ok, true);
      assert.equal(r.ok && r.filas.length, cantidad);
      assert.deepEqual(llamadas.ranges, [[0, 999]]);
    }
  });

  test("17.197 filas se cargan completas, sin duplicados y con concurrencia limitada", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(17197));
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.filas.length, 17197);
    assert.equal(new Set(r.filas.map((f) => f.id)).size, 17197);
    assert.ok(llamadas.maxActivas > 1, "las paginas restantes deben solaparse");
    assert.ok(llamadas.maxActivas <= PAGINAS_CONCURRENTES, "nunca supera el limite");
  });

  test("exactamente 1.000 filas conserva cada id una sola vez", async () => {
    const { sb } = clienteFalso(datasetDe(1000));
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.filas.length, 1000);
    assert.equal(new Set(r.filas.map((f) => f.id)).size, 1000);
  });

  test("1.001 filas conserva la fila que cruza la primera frontera", async () => {
    const { sb } = clienteFalso(datasetDe(1001));
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.filas.length, 1001);
    assert.equal(r.filas.at(-1)?.id, 1000);
  });

  test("2.500 filas conserva completas las dos paginas y la parcial", async () => {
    const { sb } = clienteFalso(datasetDe(2500));
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.filas.length, 2500);
    assert.deepEqual(r.filas.map((f) => f.id), datasetDe(2500).map((f) => f.id));
  });

  test("data null sin error se interpreta como fin valido, no como fallo tecnico", async () => {
    const { sb } = clienteFalso(
      datasetDe(1500),
      (from) => from === 1000 ? { data: null, error: null } : undefined
    );
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.filas.length, 1000);
  });

  test("mantiene el orden aunque las respuestas terminen fuera de orden", async () => {
    const dataset = datasetDe(7500);
    const { sb } = clienteFalso(dataset);
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.filas.map((f) => f.id), dataset.map((f) => f.id));
  });

  test("un error de cualquier pagina aborta sin devolver datos parciales", async () => {
    const { sb } = clienteFalso(
      datasetDe(8000),
      (from) => from === 3000 ? { data: null, error: ERROR } : undefined
    );
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error, ERROR);
  });

  test("un reintento limpio despues de un error no conserva estado parcial", async () => {
    const dataset = datasetDe(2500);
    const primero = clienteFalso(
      dataset,
      (from) => from === 1000 ? { data: null, error: ERROR } : undefined
    );
    assert.equal((await cargarFilasTarifarioPaginado<FilaFake>(primero.sb, "id")).ok, false);

    const segundo = clienteFalso(dataset);
    const r = await cargarFilasTarifarioPaginado<FilaFake>(segundo.sb, "id");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.filas.length, 2500);
    assert.equal(new Set(r.filas.map((f) => f.id)).size, 2500);
  });

  test("un error de la primera pagina no dispara ningun lote", async () => {
    const { sb, llamadas } = clienteFalso(
      datasetDe(8000),
      (from) => from === 0 ? { data: null, error: ERROR } : undefined
    );
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, false);
    assert.deepEqual(llamadas.ranges, [[0, 999]]);
  });

  test("conserva columnas, filtro y prefijo de orden original con desempates estables", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(10));
    await cargarFilasTarifarioPaginado<FilaFake>(sb, "id, precio_pvp");
    assert.equal(llamadas.columnas, "id, precio_pvp");
    assert.deepEqual(llamadas.eq, [["paquete_activo", true]]);
    assert.deepEqual(llamadas.orders.slice(0, 5), [
      "destino_nombre", "bloqueo_label", "hotel_nombre", "categoria", "regimen",
    ]);
    assert.ok(llamadas.orders.includes("paquete_id"));
    assert.ok(llamadas.orders.includes("precio_pvp"));
  });
});

