import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { cargarFilasTarifarioPaginado } from "../lib/tarifario/paginacion.ts";

// EJECUCIÓN REAL (no grep) de lib/tarifario/paginacion.ts — diagnóstico del
// incidente de ~13s en /dashboard/reservar, /dashboard/tarifario y
// /tarifario. Esta es la única copia del bucle de paginación de
// `tarifario_resultado` (antes duplicado entre lib/tarifario/datos.ts y
// app/(dashboard)/dashboard/tarifario/page.tsx). Lo crítico a probar con
// ejecución real: más de 1.000 filas siguen cargándose completas, sin
// duplicar ni perder ninguna, sin importar en qué punto caiga el corte de
// 1000 en 1000 (exacto, +1, número no redondo).
//
// Fake cliente Supabase: reproduce SOLO la cadena de métodos que usa
// cargarFilasTarifarioPaginado — .from().select().eq().order()×5.range() —
// como thenable, respaldado por un dataset en memoria + un espía de las
// llamadas (`.range(from,to)` pedidos, columnas/eq/order recibidos) para
// poder verificar el WIRING además del resultado.
type FilaFake = { id: number };

// `resolverRonda` (opcional) permite forzar la respuesta de una ronda
// concreta (1-indexada) — usado para simular una falla de red a mitad de la
// paginación sin tener que mutar el builder después de construido (lo que
// obligaría a castear el tipo real de Supabase, con métodos que no calzan
// exactamente con esta cadena reducida).
function clienteFalso(dataset: FilaFake[], resolverRonda?: (ronda: number, from: number, to: number) => { data: FilaFake[] | null } | undefined) {
  const llamadas: { columnas: string; eq: [string, unknown][]; orders: string[]; ranges: [number, number][] } = {
    columnas: "",
    eq: [],
    orders: [],
    ranges: [],
  };
  let ronda = 0;
  const builder = {
    _tabla: "",
    select(columnas: string) {
      llamadas.columnas = columnas;
      return this;
    },
    eq(col: string, val: unknown) {
      llamadas.eq.push([col, val]);
      return this;
    },
    order(col: string) {
      llamadas.orders.push(col);
      return this;
    },
    range(from: number, to: number) {
      llamadas.ranges.push([from, to]);
      ronda++;
      const forzado = resolverRonda?.(ronda, from, to);
      const page = forzado ? forzado.data : dataset.slice(from, to + 1);
      return Promise.resolve({ data: page, error: null });
    },
  };
  const sb = {
    from(tabla: string) {
      builder._tabla = tabla;
      return builder;
    },
  };
  return { sb: sb as unknown as SupabaseClient<Database>, llamadas };
}

function datasetDe(n: number): FilaFake[] {
  return Array.from({ length: n }, (_, i) => ({ id: i }));
}

describe("cargarFilasTarifarioPaginado() — más de 1.000 filas cargan completas, sin duplicar ni perder ninguna", () => {
  test("0 filas: un solo round-trip que vuelve vacío", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(0));
    const { filas, paginasConsultadas } = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(filas.length, 0);
    assert.equal(paginasConsultadas, 1);
    assert.deepEqual(llamadas.ranges, [[0, 999]]);
  });

  test("500 filas (menos de una página): un solo round-trip, corta porque page.length < PAGE", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(500));
    const { filas, paginasConsultadas } = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(filas.length, 500);
    assert.equal(paginasConsultadas, 1);
    assert.deepEqual(llamadas.ranges, [[0, 999]]);
  });

  test("exactamente 1000 filas (múltiplo exacto): hace un round-trip EXTRA que vuelve vacío para confirmar que no hay más (comportamiento heredado, documentado en paginacion.ts)", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(1000));
    const { filas, paginasConsultadas } = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(filas.length, 1000);
    assert.equal(paginasConsultadas, 2, "debe contar el round-trip extra que vuelve vacío");
    assert.deepEqual(llamadas.ranges, [[0, 999], [1000, 1999]]);
  });

  test("1001 filas (múltiplo + 1): dos round-trips, la segunda con 1 fila — ninguna se pierde ni se duplica", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(1001));
    const { filas, paginasConsultadas } = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(filas.length, 1001);
    assert.equal(paginasConsultadas, 2);
    assert.deepEqual(llamadas.ranges, [[0, 999], [1000, 1999]]);
    const ids = filas.map((f) => f.id).sort((a, b) => a - b);
    assert.deepEqual(ids, Array.from({ length: 1001 }, (_, i) => i), "todos los ids 0..1000, sin huecos ni duplicados");
  });

  test("2500 filas (varias páginas completas + una parcial): tres round-trips, ningún id duplicado ni perdido", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(2500));
    const { filas, paginasConsultadas } = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(filas.length, 2500);
    assert.equal(paginasConsultadas, 3, "1000+1000+500, la última < PAGE corta sin round-trip extra");
    assert.deepEqual(llamadas.ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
    const ids = new Set(filas.map((f) => f.id));
    assert.equal(ids.size, 2500, "ningún id duplicado");
    for (let i = 0; i < 2500; i++) assert.ok(ids.has(i), `falta el id ${i}`);
  });

  test("una página que vuelve null (falla de red simulada en una ronda) no revienta — se trata igual que vacía y corta", async () => {
    const dataset = datasetDe(1500);
    const { sb } = clienteFalso(dataset, (ronda) => (ronda === 2 ? { data: null } : undefined));
    const { filas, paginasConsultadas } = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(filas.length, 1000, "solo trae la primera página, corta al recibir null en la segunda");
    assert.equal(paginasConsultadas, 2);
  });

  test("reenvía exactamente las columnas pedidas a .select() — mismo comportamiento que antes de extraer el bucle", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(10));
    const columnasEsperadas = "modulo, hotel_nombre, precio_pvp";
    await cargarFilasTarifarioPaginado(sb, columnasEsperadas);
    assert.equal(llamadas.columnas, columnasEsperadas);
  });

  test("filtra siempre por paquete_activo = true", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(10));
    await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.deepEqual(llamadas.eq, [["paquete_activo", true]]);
  });

  test("ordena por destino_nombre, bloqueo_label, hotel_nombre, categoria, regimen — en ese orden, sin cambios de comportamiento", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(10));
    await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.deepEqual(llamadas.orders, ["destino_nombre", "bloqueo_label", "hotel_nombre", "categoria", "regimen"]);
  });
});
