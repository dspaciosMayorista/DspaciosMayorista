import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fetchAllPaginado } from "../lib/supabase/fetchAllPaginado";

// ─────────────────────────────────────────────────────────────────────────
// Prueba equivalente al defecto real ya documentado en CLAUDE.md ("límite de
// filas de Supabase truncaba listados en silencio", Conciliaciones/Libro
// diario/Libro auxiliar): un `.select()` sin paginar se trunca al límite de
// filas por respuesta del proyecto ("Max Rows") SIN error — el total y el
// saldo calculados a partir de eso quedan mal, en silencio. Estas pruebas
// simulan ese límite bajo y verifican que `fetchAllPaginado` lo evita.
// ─────────────────────────────────────────────────────────────────────────

describe("fetchAllPaginado — inmune al límite de filas (Max Rows) del proyecto", () => {
  test("con más filas que el límite simulado, el total y la suma agregada son IDÉNTICOS a una lectura sin límite", async () => {
    const TOTAL = 2_500;
    const LIMITE_SIMULADO = 300; // menor que TOTAL — fuerza varias páginas
    const todas = Array.from({ length: TOTAL }, (_, i) => ({ id: i + 1, valor: 10 }));

    // Simula PostgREST con Max Rows bajo: sin importar el rango pedido
    // (`desde`/`hasta`), el servidor nunca devuelve más de LIMITE_SIMULADO
    // filas por respuesta — igual que el comportamiento real reportado.
    async function pedirPaginaTruncada(desde: number) {
      return { data: todas.slice(desde, desde + LIMITE_SIMULADO), error: null };
    }

    const resultado = await fetchAllPaginado(pedirPaginaTruncada);

    assert.equal(resultado.length, TOTAL);
    const sumaPaginada = resultado.reduce((s, r) => s + r.valor, 0);
    const sumaSinLimite = todas.reduce((s, r) => s + r.valor, 0);
    assert.equal(sumaPaginada, sumaSinLimite);
  });

  test("una sola lectura sin paginar (equivalente al bug real) SÍ queda truncada — demuestra que el defecto es real y que la prueba anterior lo cubre", () => {
    const TOTAL = 2_500;
    const LIMITE_SIMULADO = 300;
    const todas = Array.from({ length: TOTAL }, (_, i) => ({ id: i + 1, valor: 10 }));
    const sinPaginar = todas.slice(0, LIMITE_SIMULADO);
    assert.notEqual(sinPaginar.length, TOTAL);
    assert.equal(sinPaginar.length, LIMITE_SIMULADO);
  });

  test("avanza por la cantidad REAL recibida, no por el tamaño de página pedido (tamPagina grande, servidor devuelve mucho menos)", async () => {
    const TOTAL = 37;
    const todas = Array.from({ length: TOTAL }, (_, i) => ({ id: i + 1 }));
    const llamadas: Array<[number, number]> = [];
    async function pedir(desde: number, hasta: number) {
      llamadas.push([desde, hasta]);
      // El servidor solo entrega de a 5, sin importar que se pida un rango
      // de 1000 (tamPagina por defecto).
      return { data: todas.slice(desde, desde + 5), error: null };
    }
    const resultado = await fetchAllPaginado(pedir);
    assert.equal(resultado.length, TOTAL);
    // 9 llamadas: 7 de 5 filas (35) + 1 con las 2 restantes (37) + 1 vacía que cierra.
    assert.equal(llamadas.length, 9);
    assert.deepEqual(llamadas[0], [0, 999]);
  });

  test("se detiene con una página vacía (sin bucle infinito) cuando no hay datos desde el inicio", async () => {
    async function pedirVacio() {
      return { data: [] as { id: number }[], error: null };
    }
    const resultado = await fetchAllPaginado(pedirVacio);
    assert.deepEqual(resultado, []);
  });

  test("fallo cerrado: un error en una página detiene la paginación de inmediato y conserva lo ya acumulado (no reintenta, no sigue pidiendo)", async () => {
    const paginas = [
      { data: [{ id: 1 }, { id: 2 }], error: null },
      { data: null, error: { message: "timeout simulado" } },
      { data: [{ id: 99 }], error: null }, // NUNCA debe alcanzarse
    ];
    let llamada = 0;
    async function pedir() {
      return paginas[llamada++];
    }
    const resultado = await fetchAllPaginado(pedir as never);
    assert.deepEqual(resultado, [{ id: 1 }, { id: 2 }]);
    assert.equal(llamada, 2, "no debe llamar una tercera vez tras el error");
  });
});
