import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import {
  parsearFiltrosTarifario, buscarFilasTarifarioPagina, buscarPaginaTarifarioLiviana,
  PAGE_SIZE_PUBLICO, PAGE_SIZE_INTERNO, MAX_PAGE_SIZE,
} from "../lib/tarifario/consulta.ts";
import { cargarFilasTarifarioPaginado } from "../lib/tarifario/paginacion.ts";

// EJECUCIÓN REAL de lib/tarifario/consulta.ts — motor de la ronda "carga
// bajo demanda" (medición real de preview: la ronda anterior de caché
// compartida fue rechazada por Next — "items over 2MB can not be cached" —
// con 17.197 filas/~11,1 MB en una sola consulta de catálogo completo).
// `buscarFilasTarifarioPagina` reemplaza esa consulta por UNA sola página
// filtrada+acotada en la base de datos; `parsearFiltrosTarifario` es la
// frontera que valida `unknown` (searchParams de URL o el body de un Server
// Action invocable desde el navegador) antes de construir esa consulta.

describe("parsearFiltrosTarifario() — frontera: unknown nunca se confía tal cual", () => {
  test("input no-objeto (null/undefined/array/string/número) cae a los defaults, nunca revienta", () => {
    for (const raro of [null, undefined, [1, 2], "hola", 42, true]) {
      const f = parsearFiltrosTarifario(raro, PAGE_SIZE_PUBLICO);
      assert.equal(f.page, 1);
      assert.equal(f.pageSize, PAGE_SIZE_PUBLICO);
      assert.equal(f.texto, "");
      assert.equal(f.modulo, "");
      assert.equal(f.destino, "");
      assert.equal(f.categoria, "");
      assert.equal(f.regimen, "");
      assert.equal(f.bloqueoId, null);
    }
  });

  test("page: negativo/cero/decimal/NaN/string no numérica caen a 1; string numérica válida se respeta", () => {
    for (const v of [-5, 0, 1.7, NaN, "abc", "-3"]) {
      assert.equal(parsearFiltrosTarifario({ page: v }, PAGE_SIZE_PUBLICO).page, 1, `page=${v} debe caer a 1`);
    }
    assert.equal(parsearFiltrosTarifario({ page: "7" }, PAGE_SIZE_PUBLICO).page, 7);
    assert.equal(parsearFiltrosTarifario({ page: 3 }, PAGE_SIZE_PUBLICO).page, 3);
  });

  test("pageSize: se clampa a [1, MAX_PAGE_SIZE] — un cliente no puede pedir una página gigante", () => {
    assert.equal(parsearFiltrosTarifario({ pageSize: 999999 }, PAGE_SIZE_PUBLICO).pageSize, MAX_PAGE_SIZE);
    assert.equal(parsearFiltrosTarifario({ pageSize: -10 }, PAGE_SIZE_PUBLICO).pageSize, 1);
    assert.equal(parsearFiltrosTarifario({ pageSize: 0 }, PAGE_SIZE_PUBLICO).pageSize, 1);
    assert.equal(parsearFiltrosTarifario({ pageSize: 40 }, PAGE_SIZE_PUBLICO).pageSize, 40);
  });

  test("pageSizeMax explícito (ej. PAGE_SIZE_INTERNO=50) se respeta como tope", () => {
    assert.equal(parsearFiltrosTarifario({ pageSize: 500 }, PAGE_SIZE_INTERNO, PAGE_SIZE_INTERNO).pageSize, PAGE_SIZE_INTERNO);
  });

  test("texto/destino/categoria/regimen: se les quita `, . ( )` — caracteres significativos para el mini-lenguaje de filtros de PostgREST (.or()) — antes de construir cualquier consulta", () => {
    const f = parsearFiltrosTarifario({ texto: "Hotel, (Cartagena).top" }, PAGE_SIZE_PUBLICO);
    assert.ok(!f.texto.includes(","), "no debe quedar una coma");
    assert.ok(!f.texto.includes("("), "no debe quedar un paréntesis de apertura");
    assert.ok(!f.texto.includes(")"), "no debe quedar un paréntesis de cierre");
    assert.ok(!f.texto.includes("."), "no debe quedar un punto");
  });

  test("texto/destino/categoria/regimen se recortan a 80 caracteres (límite defensivo, nunca un string sin tope hacia la base)", () => {
    const largo = "a".repeat(500);
    const f = parsearFiltrosTarifario({ texto: largo, destino: largo, categoria: largo, regimen: largo }, PAGE_SIZE_PUBLICO);
    assert.equal(f.texto.length, 80);
    assert.equal(f.destino.length, 80);
    assert.equal(f.categoria.length, 80);
    assert.equal(f.regimen.length, 80);
  });

  test("modulo: solo acepta los 4 valores reales del catálogo — cualquier otro string (incluida una inyección de filtro) cae a '' (sin filtrar)", () => {
    for (const m of ["bloqueo", "dinamico", "porcion_terrestre", "servicios"]) {
      assert.equal(parsearFiltrosTarifario({ modulo: m }, PAGE_SIZE_PUBLICO).modulo, m);
    }
    for (const m of ["programas", "'; drop table x; --", "BLOQUEO", "", 42, null]) {
      assert.equal(parsearFiltrosTarifario({ modulo: m }, PAGE_SIZE_PUBLICO).modulo, "");
    }
  });

  test("bloqueoId: entero positivo (número o string numérica) se acepta, truncando decimales igual que page/pageSize; negativo/cero/texto cae a null", () => {
    assert.equal(parsearFiltrosTarifario({ bloqueoId: 12 }, PAGE_SIZE_PUBLICO).bloqueoId, 12);
    assert.equal(parsearFiltrosTarifario({ bloqueoId: "12" }, PAGE_SIZE_PUBLICO).bloqueoId, 12);
    assert.equal(parsearFiltrosTarifario({ bloqueoId: 1.9 }, PAGE_SIZE_PUBLICO).bloqueoId, 1, "decimal positivo se trunca, no se rechaza");
    for (const v of [-1, 0, "abc", "-4", null, undefined]) {
      assert.equal(parsearFiltrosTarifario({ bloqueoId: v }, PAGE_SIZE_PUBLICO).bloqueoId, null, `bloqueoId=${v} debe caer a null`);
    }
  });
});

// ── Fake de tarifario_resultado con soporte de FILTRO real (eq/or) + count
//    ("exact") — a diferencia del fake de tarifarioPaginacion.test.ts (que
//    solo pagina, sin filtrar, porque cargarFilasTarifarioPaginado no
//    filtra), este SÍ aplica los filtros al dataset antes de recortar por
//    rango, para poder probar "los filtros se aplican ANTES de paginar" a
//    nivel de DATOS, no solo de orden de llamadas. ──────────────────────────
type FilaFake = { id: number; paquete_activo?: boolean; modulo?: string; destino_nombre?: string; categoria?: string; regimen?: string; bloqueo_id?: number; hotel_nombre?: string };

function clienteFalso(dataset: FilaFake[]) {
  const secuencia: string[] = [];
  const eqAplicados: [string, unknown][] = [];
  let orAplicado: string | null = null;
  const llamadas = { columnas: "", opciones: undefined as unknown, orders: [] as string[], ranges: [] as [number, number][], eq: eqAplicados, or: null as string | null, secuencia };
  const builder = {
    select(columnas: string, opciones?: unknown) { llamadas.columnas = columnas; llamadas.opciones = opciones; secuencia.push("select"); return this; },
    eq(col: string, val: unknown) { eqAplicados.push([col, val]); secuencia.push(`eq:${col}`); return this; },
    or(expr: string) { orAplicado = expr; llamadas.or = expr; secuencia.push("or"); return this; },
    order(col: string) { llamadas.orders.push(col); secuencia.push(`order:${col}`); return this; },
    range(from: number, to: number) {
      llamadas.ranges.push([from, to]);
      secuencia.push(`range:${from}-${to}`);
      let filtrado = dataset.filter((f) => eqAplicados.every(([c, v]) => (f as unknown as Record<string, unknown>)[c] === v));
      if (orAplicado) {
        const m = /ilike\.%([^%]*)%/.exec(orAplicado);
        const term = (m?.[1] ?? "").toLowerCase();
        filtrado = filtrado.filter((f) => [f.hotel_nombre].some((v) => v && v.toLowerCase().includes(term)));
      }
      const total = filtrado.length;
      const pagina = filtrado.slice(from, to + 1);
      return Promise.resolve({ data: pagina, error: null, count: total });
    },
  };
  const sb = { from: () => builder };
  return { sb: sb as unknown as SupabaseClient<Database>, llamadas };
}

function datasetDe(n: number, extra: (i: number) => Partial<FilaFake> = () => ({})): FilaFake[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, paquete_activo: true, modulo: "bloqueo", ...extra(i) }));
}

const ERROR_FAKE = { code: "57014", message: "canceling statement due to statement timeout" };

describe("buscarFilasTarifarioPagina() — UNA sola consulta acotada, nunca el catálogo completo", () => {
  test("con 10.000 filas en la tabla, pageSize=24 (PAGE_SIZE_PUBLICO): la respuesta trae EXACTAMENTE 24 filas — 'la primera respuesta nunca contiene miles de filas'", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(10_000));
    const filtros = parsearFiltrosTarifario({ page: 1, pageSize: PAGE_SIZE_PUBLICO }, PAGE_SIZE_PUBLICO);
    const r = await buscarFilasTarifarioPagina<FilaFake>(sb, "id", filtros);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.filas.length, 24);
    assert.equal(r.total, 10_000);
    assert.equal(llamadas.ranges.length, 1, "un solo round-trip — nunca un bucle que trae todo");
  });

  test("CONTROL NEGATIVO: el patrón ANTERIOR (cargarFilasTarifarioPaginado, sin filtro/límite) hace 10 round-trips sobre 10.000 filas — la nueva consulta paginada hace 1 solo, sobre el MISMO dataset", async () => {
    const dataset = datasetDe(10_000);
    // Patrón viejo: bucle de a 1000 hasta agotar el catálogo — el que causaba
    // 17.197 filas/18 consultas/~11,1 MB en producción.
    const { sb: sbViejo, llamadas: llViejo } = clienteFalso(dataset);
    // El fake viejo (tarifarioPaginacion) no tiene .or()/count, pero
    // cargarFilasTarifarioPaginado tampoco los usa — se agrega un `.or` no-op
    // vía builder ya compatible arriba (or nunca se llama en este camino).
    const rViejo = await cargarFilasTarifarioPaginado<FilaFake>(sbViejo, "id");
    assert.equal(rViejo.ok, true);
    if (!rViejo.ok) return;
    assert.equal(rViejo.filas.length, 10_000, "el patrón viejo SÍ trae el catálogo completo");
    // 10.000 es múltiplo exacto de 1000: el bucle viejo hace un round-trip
    // EXTRA que vuelve vacío para confirmar que no hay más (comportamiento
    // documentado en lib/tarifario/paginacion.ts) — 11, no 10.
    assert.equal(llViejo.ranges.length, 11, "10 páginas llenas + 1 round-trip extra que confirma el fin — el patrón que se está eliminando");

    // Patrón nuevo: una sola página acotada.
    const { sb: sbNuevo, llamadas: llNuevo } = clienteFalso(dataset);
    const filtros = parsearFiltrosTarifario({ page: 1, pageSize: PAGE_SIZE_PUBLICO }, PAGE_SIZE_PUBLICO);
    const rNuevo = await buscarFilasTarifarioPagina<FilaFake>(sbNuevo, "id", filtros);
    assert.equal(rNuevo.ok, true);
    if (!rNuevo.ok) return;
    assert.equal(rNuevo.filas.length, 24, "el patrón nuevo trae SOLO la página pedida");
    assert.equal(llNuevo.ranges.length, 1, "1 solo round-trip — nunca vuelve a conectarse el cargador completo a una carga inicial");
  });

  test("filtros (modulo/destino/categoria/regimen) se aplican en el WHERE — .eq()/.or() se llaman ANTES de .range() en la secuencia real de invocaciones", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(50, (i) => ({ destino_nombre: i < 10 ? "Cartagena" : "San Andrés" })));
    const filtros = parsearFiltrosTarifario({ destino: "Cartagena", page: 1, pageSize: 5 }, PAGE_SIZE_PUBLICO);
    const r = await buscarFilasTarifarioPagina<FilaFake>(sb, "id", filtros);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.total, 10, "el total ya refleja el filtro — 10 filas de Cartagena, no las 50 de la tabla");
    const idxEq = llamadas.secuencia.indexOf("eq:destino_nombre");
    const idxRange = llamadas.secuencia.findIndex((s) => s.startsWith("range:"));
    assert.ok(idxEq > -1 && idxEq < idxRange, "el filtro debe aplicarse ANTES de paginar, nunca después");
  });

  test("texto de búsqueda: pasa por .or() con ilike, aplicado antes de .range() — nunca se filtra sobre una muestra ya paginada", async () => {
    const { sb, llamadas } = clienteFalso([
      { id: 1, paquete_activo: true, hotel_nombre: "Hotel Playa Dorada" },
      { id: 2, paquete_activo: true, hotel_nombre: "Hotel Cielo Azul" },
      { id: 3, paquete_activo: true, hotel_nombre: "Otro sin relación" },
    ]);
    const filtros = parsearFiltrosTarifario({ texto: "hotel", page: 1, pageSize: 10 }, PAGE_SIZE_PUBLICO);
    const r = await buscarFilasTarifarioPagina<FilaFake>(sb, "id", filtros);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.total, 2, "el conteo ya refleja el filtro de texto sobre el conjunto COMPLETO, no la página");
    const idxOr = llamadas.secuencia.indexOf("or");
    const idxRange = llamadas.secuencia.findIndex((s) => s.startsWith("range:"));
    assert.ok(idxOr > -1 && idxOr < idxRange);
  });

  test("página 2 no repite ni omite elementos de página 1 — orden estable, todos los elementos alcanzables paginando", async () => {
    const dataset = datasetDe(97);
    const pageSize = 24;
    const vistos = new Set<number>();
    let page = 1;
    for (;;) {
      const { sb } = clienteFalso(dataset);
      const filtros = parsearFiltrosTarifario({ page, pageSize }, PAGE_SIZE_PUBLICO);
      const r = await buscarFilasTarifarioPagina<FilaFake>(sb, "id", filtros);
      assert.equal(r.ok, true);
      if (!r.ok) return;
      for (const f of r.filas) {
        assert.ok(!vistos.has(f.id), `el id ${f.id} ya había aparecido en una página anterior — duplicado`);
        vistos.add(f.id);
      }
      if (page * pageSize >= r.total) break;
      page++;
    }
    assert.equal(vistos.size, 97, "los 97 elementos deben quedar alcanzados exactamente una vez, paginando");
  });

  test("cambiar de página con el MISMO filtro no altera el total ni el orden relativo — página 3 continúa exactamente donde terminó la 2", async () => {
    const dataset = datasetDe(60);
    const { sb: sb1 } = clienteFalso(dataset);
    const p1 = await buscarFilasTarifarioPagina<FilaFake>(sb1, "id", parsearFiltrosTarifario({ page: 1, pageSize: 20 }, PAGE_SIZE_PUBLICO));
    const { sb: sb2 } = clienteFalso(dataset);
    const p2 = await buscarFilasTarifarioPagina<FilaFake>(sb2, "id", parsearFiltrosTarifario({ page: 2, pageSize: 20 }, PAGE_SIZE_PUBLICO));
    const { sb: sb3 } = clienteFalso(dataset);
    const p3 = await buscarFilasTarifarioPagina<FilaFake>(sb3, "id", parsearFiltrosTarifario({ page: 3, pageSize: 20 }, PAGE_SIZE_PUBLICO));
    assert.ok(p1.ok && p2.ok && p3.ok);
    if (!p1.ok || !p2.ok || !p3.ok) return;
    assert.deepEqual(p1.filas.map((f) => f.id), Array.from({ length: 20 }, (_, i) => i));
    assert.deepEqual(p2.filas.map((f) => f.id), Array.from({ length: 20 }, (_, i) => 20 + i));
    assert.deepEqual(p3.filas.map((f) => f.id), Array.from({ length: 20 }, (_, i) => 40 + i));
  });

  test("error técnico en .range() NUNCA se confunde con 'sin resultados' — ok:false, distinto de una página vacía legítima (total:0)", async () => {
    const { sb } = clienteFalso([]);
    // Fuerza un error sustituyendo range() del builder devuelto por from().
    const sbError = {
      from: () => ({
        select() { return this; }, eq() { return this; }, or() { return this; }, order() { return this; },
        range: () => Promise.resolve({ data: null, error: ERROR_FAKE, count: null }),
      }),
    } as unknown as SupabaseClient<Database>;
    const rError = await buscarFilasTarifarioPagina<FilaFake>(sbError, "id", parsearFiltrosTarifario({}, PAGE_SIZE_PUBLICO));
    assert.equal(rError.ok, false);
    if (rError.ok) return;
    assert.equal(rError.error, ERROR_FAKE);

    const rVacia = await buscarFilasTarifarioPagina<FilaFake>(sb, "id", parsearFiltrosTarifario({}, PAGE_SIZE_PUBLICO));
    assert.equal(rVacia.ok, true, "0 resultados con error:null es un resultado VÁLIDO (de verdad no hay filas), no debe confundirse con el error de arriba");
  });

  test("nunca usa service_role/admin — recibe y usa el MISMO cliente `sb` (con RLS) que se le pasó, jamás crea uno propio", async () => {
    const { sb } = clienteFalso(datasetDe(5));
    let fromLlamado = 0;
    const sbEspiado = new Proxy(sb, {
      get(target, prop, receiver) {
        if (prop === "from") fromLlamado++;
        return Reflect.get(target, prop, receiver);
      },
    });
    await buscarFilasTarifarioPagina<FilaFake>(sbEspiado, "id", parsearFiltrosTarifario({}, PAGE_SIZE_PUBLICO));
    assert.ok(fromLlamado > 0, "debe usar el cliente inyectado, no uno paralelo invisible");
  });
});

describe("buscarPaginaTarifarioLiviana() — /dashboard/tarifario: valida unknown, pagina, nunca trae miles de filas", () => {
  test("filtrosRaw manipulado (page negativo, pageSize gigante, modulo inválido con sintaxis de inyección) no revienta y produce una consulta acotada y válida", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(5000));
    const r = await buscarPaginaTarifarioLiviana(sb, {
      page: -99, pageSize: 999999, modulo: "'; drop table tarifario_resultado; --", texto: "a,b(c).d",
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.page, 1, "page inválido cae a 1");
    assert.ok(r.pageSize <= PAGE_SIZE_INTERNO, "pageSize se clampa al tope de /dashboard/tarifario");
    assert.ok(r.filas.length <= PAGE_SIZE_INTERNO, "nunca miles de filas en la respuesta");
    assert.equal(llamadas.ranges.length, 1);
  });
});
