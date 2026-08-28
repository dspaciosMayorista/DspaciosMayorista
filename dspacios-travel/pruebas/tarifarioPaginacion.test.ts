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
// ejecución real:
//   - más de 1.000 filas siguen cargándose completas, sin duplicar ni
//     perder ninguna, sin importar en qué punto caiga el corte de 1000 en
//     1000 (exacto, +1, número no redondo);
//   - un ERROR técnico de Supabase en CUALQUIER página (primera, intermedia,
//     o dentro de una carga >1000 filas) se distingue explícitamente de una
//     página vacía LEGÍTIMA — revisión posterior, defecto "PAGINACIÓN
//     IGNORA ERRORES" confirmado (antes `{data:null,error:algo}` y
//     `{data:[],error:null}` eran indistinguibles y ambos terminaban el
//     bucle como si fuera un resultado válido).
//
// Fake cliente Supabase: reproduce SOLO la cadena de métodos que usa
// cargarFilasTarifarioPaginado — .from().select().eq().order()×5.range() —
// como thenable, respaldado por un dataset en memoria + un espía de las
// llamadas (`.range(from,to)` pedidos, columnas/eq/order recibidos) para
// poder verificar el WIRING además del resultado.
type FilaFake = { id: number };

// `resolverRonda` (opcional) permite forzar la respuesta de una ronda
// concreta (1-indexada) — usado para simular una falla de red/error de
// Supabase a mitad de la paginación sin tener que mutar el builder después
// de construido (lo que obligaría a castear el tipo real de Supabase, con
// métodos que no calzan exactamente con esta cadena reducida). Devolver
// `undefined` dentro de la callback usa el comportamiento por defecto
// (servir la página real del dataset, sin error).
type RespuestaForzada = { data: FilaFake[] | null; error: unknown };
function clienteFalso(dataset: FilaFake[], resolverRonda?: (ronda: number, from: number, to: number) => RespuestaForzada | undefined) {
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
      if (forzado) return Promise.resolve(forzado);
      return Promise.resolve({ data: dataset.slice(from, to + 1), error: null });
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

const ERROR_SUPABASE_FAKE = { code: "57014", message: "canceling statement due to statement timeout" };

describe("cargarFilasTarifarioPaginado() — más de 1.000 filas cargan completas, sin duplicar ni perder ninguna", () => {
  test("0 filas: un solo round-trip que vuelve vacío — página LEGÍTIMA (error: null), ok=true", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(0));
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.filas.length, 0);
    assert.equal(r.paginasConsultadas, 1);
    assert.deepEqual(llamadas.ranges, [[0, 999]]);
  });

  test("500 filas (menos de una página): un solo round-trip, corta porque page.length < PAGE", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(500));
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.filas.length, 500);
    assert.equal(r.paginasConsultadas, 1);
    assert.deepEqual(llamadas.ranges, [[0, 999]]);
  });

  test("exactamente 1000 filas (múltiplo exacto): hace un round-trip EXTRA que vuelve vacío para confirmar que no hay más (comportamiento heredado, documentado en paginacion.ts)", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(1000));
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.filas.length, 1000);
    assert.equal(r.paginasConsultadas, 2, "debe contar el round-trip extra que vuelve vacío");
    assert.deepEqual(llamadas.ranges, [[0, 999], [1000, 1999]]);
  });

  test("1001 filas (múltiplo + 1): dos round-trips, la segunda con 1 fila — ninguna se pierde ni se duplica", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(1001));
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.filas.length, 1001);
    assert.equal(r.paginasConsultadas, 2);
    assert.deepEqual(llamadas.ranges, [[0, 999], [1000, 1999]]);
    const ids = r.filas.map((f) => f.id).sort((a, b) => a - b);
    assert.deepEqual(ids, Array.from({ length: 1001 }, (_, i) => i), "todos los ids 0..1000, sin huecos ni duplicados");
  });

  test("2500 filas (varias páginas completas + una parcial): tres round-trips, ningún id duplicado ni perdido", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(2500));
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.filas.length, 2500);
    assert.equal(r.paginasConsultadas, 3, "1000+1000+500, la última < PAGE corta sin round-trip extra");
    assert.deepEqual(llamadas.ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
    const ids = new Set(r.filas.map((f) => f.id));
    assert.equal(ids.size, 2500, "ningún id duplicado");
    for (let i = 0; i < 2500; i++) assert.ok(ids.has(i), `falta el id ${i}`);
  });

  test("una página que vuelve data:null PERO SIN error (caso raro, no debería pasar con Supabase real): se trata igual que vacía y corta, ok=true", async () => {
    const dataset = datasetDe(1500);
    const { sb } = clienteFalso(dataset, (ronda) => (ronda === 2 ? { data: null, error: null } : undefined));
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.filas.length, 1000, "solo trae la primera página, corta al recibir data:null sin error en la segunda");
    assert.equal(r.paginasConsultadas, 2);
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

// ── Defecto "PAGINACIÓN IGNORA ERRORES" — casos explícitos pedidos en la
// revisión: error en primera página, error en página intermedia, 1.001
// filas con error en la segunda página, y confirmación de que un error
// técnico NUNCA se confunde con "cero filas"/"tarifario vacío" ────────────
describe("cargarFilasTarifarioPaginado() — distingue ERROR TÉCNICO de página vacía legítima", () => {
  test("error en la PRIMERA página: ok=false, error propagado tal cual (crudo, el caller lo sanea), CERO filas — nunca 'tarifario vacío' disfrazado de éxito", async () => {
    const { sb, llamadas } = clienteFalso(datasetDe(500), (ronda) => (ronda === 1 ? { data: null, error: ERROR_SUPABASE_FAKE } : undefined));
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error, ERROR_SUPABASE_FAKE, "el error debe llegar CRUDO al caller — el saneo es responsabilidad de quien tiene flujo/flujoId");
    assert.equal(r.paginasConsultadas, 1);
    assert.deepEqual(llamadas.ranges, [[0, 999]], "no debe seguir pidiendo páginas después de un error");
  });

  test("error en una página INTERMEDIA (después de traer datos válidos): ok=false — las filas ya traídas NO se devuelven como si fueran el resultado completo", async () => {
    const dataset = datasetDe(2500);
    const { sb, llamadas } = clienteFalso(dataset, (ronda) => (ronda === 2 ? { data: null, error: ERROR_SUPABASE_FAKE } : undefined));
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error, ERROR_SUPABASE_FAKE);
    assert.equal(r.paginasConsultadas, 2, "debe contar la página 1 (ok) + la 2 (falló), sin intentar la 3");
    assert.deepEqual(llamadas.ranges, [[0, 999], [1000, 1999]]);
  });

  test("1.001 filas con error en la SEGUNDA página (el caso exacto pedido en la revisión — el corte de 1000 coincide con la falla): ok=false, nunca 1000 filas 'parciales' presentadas como resultado bueno", async () => {
    const dataset = datasetDe(1001);
    const { sb, llamadas } = clienteFalso(dataset, (ronda) => (ronda === 2 ? { data: null, error: ERROR_SUPABASE_FAKE } : undefined));
    const r = await cargarFilasTarifarioPaginado<FilaFake>(sb, "id");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error, ERROR_SUPABASE_FAKE);
    assert.equal(r.paginasConsultadas, 2);
    assert.deepEqual(llamadas.ranges, [[0, 999], [1000, 1999]]);
  });

  test("página vacía LEGÍTIMA (data:[], error:null) vs. error técnico (data:null, error:algo) nunca se confunden — mismo `data` nulo/vacío, resultado opuesto según `error`", async () => {
    // Vacía legítima: la fuente de verdad es `error === null`.
    const { sb: sbVacia } = clienteFalso([]);
    const rVacia = await cargarFilasTarifarioPaginado<FilaFake>(sbVacia, "id");
    assert.equal(rVacia.ok, true, "data:[] con error:null es un resultado VÁLIDO (tarifario realmente vacío)");

    // Error técnico con data:null: debe rechazarse, NUNCA leerse como "vacío".
    const { sb: sbError } = clienteFalso([], (ronda) => (ronda === 1 ? { data: null, error: ERROR_SUPABASE_FAKE } : undefined));
    const rError = await cargarFilasTarifarioPaginado<FilaFake>(sbError, "id");
    assert.equal(rError.ok, false, "data:null con error presente NUNCA debe leerse como 'tarifario vacío'");
  });

  test("después de un error, ninguna fila de páginas ANTERIORES exitosas se pierde de vista silenciosamente ni se duplica si el caller reintenta con el mismo dataset", async () => {
    // Confirma que el corte es limpio: reintentar desde cero (nuevo cliente,
    // sin el error forzado) sobre el MISMO dataset trae todo sin huecos ni
    // duplicados — la función no deja estado a medias entre llamadas.
    const dataset = datasetDe(2500);
    const { sb: sbConError } = clienteFalso(dataset, (ronda) => (ronda === 2 ? { data: null, error: ERROR_SUPABASE_FAKE } : undefined));
    const primero = await cargarFilasTarifarioPaginado<FilaFake>(sbConError, "id");
    assert.equal(primero.ok, false);

    const { sb: sbReintento } = clienteFalso(dataset);
    const segundo = await cargarFilasTarifarioPaginado<FilaFake>(sbReintento, "id");
    assert.equal(segundo.ok, true);
    if (!segundo.ok) return;
    assert.equal(segundo.filas.length, 2500);
    const ids = new Set(segundo.filas.map((f) => f.id));
    assert.equal(ids.size, 2500, "ningún id duplicado en el reintento limpio");
  });
});
