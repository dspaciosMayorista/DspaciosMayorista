import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { ejecutarConsultaPaginada } from "../lib/tarifario/paginacion.ts";
import { cargarFilasResumenPaginado, type FilaResumen } from "../lib/tarifario/resumen.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// ── Hotfix: "RECEPTIVOS ADZ" — dos síntomas, dos causas distintas ──────────
//
// SÍNTOMA 1 (listado administrativo `/dashboard/paquetes`): un paquete
// ACTIVO con tarifas reales publicadas mostraba "Sin publicar". Causa:
// `app/(dashboard)/dashboard/paquetes/page.tsx` traía `tarifario_resultado`
// filtrado por `.in("paquete_id", ids)` en UN solo `.select()` sin
// `.range()` — con el catálogo real (~16.089 filas) el límite "Max Rows"
// del proyecto Supabase puede truncar la respuesta EN SILENCIO (sin
// `error`), y cualquier paquete cuyas filas cayeran fuera de la porción
// truncada quedaba con conteo 0.
//
// SÍNTOMA 2 (tarifario público, buscador de Receptivos/Hoteles y pestaña
// Servicios de Vista tabla): un paquete/servicio recién creado y generado
// no aparecía, aunque su configuración era correcta. Causa: `buscarHoteles`/
// `buscarReceptivos` (lib/reservar/cotizar.ts) y `obtenerDetalleServicios`
// (app/tarifario/detalle-actions.ts) hacían el MISMO tipo de `.select()`
// sin `.range()` sobre `tarifario_resultado`, filtrado solo por
// `modulo`/`paquete_activo`(/`destino_nombre`) — sin acotar a un
// paquete/hotel puntual, así que el volumen real también puede superar
// "Max Rows". Al no haber NINGÚN `.order()`, el orden físico de retorno de
// Postgres no está garantizado — un paquete recién insertado cae, en la
// práctica, fuera de la porción que el servidor decide devolver primero.
//
// Ambos comparten el mismo defecto DE FONDO (un solo `.select()` sin
// `.range()` sobre una tabla que puede exceder el límite de fila del
// proyecto) pero en DOS call sites separados y NINGUNA relación causal
// entre sí — de ahí que la corrección sea el mismo motor de paginación
// robusta (`ejecutarConsultaPaginada`, extraído en lib/tarifario/paginacion.ts,
// mismo algoritmo ya probado de `cargarFilasResumenPaginado`) reusado en
// los 3 call sites nuevos + `cargarFilasResumenPaginado` ya existente
// reusado en el listado administrativo — nunca una migración nueva.
//
// Este archivo prueba el motor compartido (`ejecutarConsultaPaginada`) con
// EJECUCIÓN REAL contra un backend simulado — sin Supabase real, sin red.

type Fila = { id: number; paquete_id: number; nombre: string };

// Servidor simulado: SIEMPRE recorta la respuesta a `maxFilasPorPagina`,
// sin importar cuántas se pidieron por `.range()` — reproduce el límite
// "Max Rows" de un proyecto Supabase real (Settings → API), que trunca la
// respuesta SIN error. `fallaEnPagina` (opcional, 0-based) simula un error
// técnico real de Supabase en esa página exacta.
function backendSimulado(
  dataset: Fila[],
  maxFilasPorPagina: number,
  opts?: { fallaEnPagina?: number; nuncaVacio?: boolean }
) {
  let llamadas = 0;
  const construirPagina = async (from: number, hasta: number) => {
    const paginaActual = llamadas;
    llamadas++;
    if (opts?.fallaEnPagina === paginaActual) {
      return { data: null, error: { message: "conexión perdida (simulada)", code: "08006" } };
    }
    const pedida = dataset.slice(from, hasta + 1);
    if (opts?.nuncaVacio) {
      // Backend patológico: nunca entrega página vacía, siempre inventa algo.
      return { data: pedida.length ? pedida.slice(0, maxFilasPorPagina) : [dataset[0]], error: null };
    }
    return { data: pedida.slice(0, maxFilasPorPagina), error: null };
  };
  return { construirPagina, llamadas: () => llamadas };
}

function dataset(n: number, opts?: { paqueteBase?: number }): Fila[] {
  const base = opts?.paqueteBase ?? 1;
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, paquete_id: base + i, nombre: `Fila ${i + 1}` }));
}

describe("ejecutarConsultaPaginada() — motor compartido del hotfix de publicación truncada", () => {
  test("backend simulado que devuelve MENOS filas que el range pedido (recorte tipo Max Rows), en una sola llamada: recupera igual todo el catálogo pequeño", async () => {
    const data = dataset(3);
    const srv = backendSimulado(data, 2); // pide 1000, el servidor solo entrega 2 por vuelta
    const r = await ejecutarConsultaPaginada<Fila>(srv.construirPagina);
    assert.equal(r.error, null);
    assert.deepEqual((r.data ?? []).map((f) => f.id).sort((a, b) => a - b), [1, 2, 3]);
    assert.ok(srv.llamadas() > 1, "un recorte por debajo de lo pedido debe forzar más de una llamada");
  });

  test("más de una página: dataset de 25 filas contra un servidor que recorta a 4 por pedido — se recuperan las 25, en 8 páginas (6 llenas + 1 parcial de 1 fila + 1 vacía de cierre)", async () => {
    const data = dataset(25);
    const srv = backendSimulado(data, 4);
    const r = await ejecutarConsultaPaginada<Fila>(srv.construirPagina);
    assert.equal(r.error, null);
    assert.equal((r.data ?? []).length, 25);
    assert.deepEqual((r.data ?? []).map((f) => f.id).sort((a, b) => a - b), data.map((f) => f.id));
    assert.equal(srv.llamadas(), 8, "6 páginas de 4 filas (24) + 1 página parcial de 1 fila (25ª) + 1 página vacía final de cierre");
  });

  test("⚠️ reproducción directa del incidente: el paquete recién creado (id más alto, últimas filas del dataset) queda DESPUÉS del primer límite de recorte — igual aparece en el resultado final", async () => {
    // 30 filas "viejas" (paquetes 1..30) + la fila del paquete NUEVO al
    // final del dataset (posición 31, fuera de cualquier primera página de
    // hasta 10 filas) — simula exactamente "RECEPTIVOS ADZ": sus filas caen
    // después de la porción que un `.select()` sin `.range()` habría
    // truncado en silencio.
    const viejas = dataset(30);
    const nuevoPaquete: Fila = { id: 999, paquete_id: 9001, nombre: "RECEPTIVOS ADZ (nuevo)" };
    const data = [...viejas, nuevoPaquete];
    const srv = backendSimulado(data, 10); // "Max Rows" simulado = 10
    const r = await ejecutarConsultaPaginada<Fila>(srv.construirPagina);
    assert.equal(r.error, null);
    const idsRecuperados = (r.data ?? []).map((f) => f.id);
    assert.ok(idsRecuperados.includes(999), "el paquete recién creado, situado después del primer límite, debe aparecer en el resultado paginado");
    assert.equal((r.data ?? []).length, data.length, "ninguna fila se pierde, ni siquiera las que están después del primer recorte");
  });

  test("un error TÉCNICO real en una página intermedia se devuelve como error — nunca como catálogo parcial disfrazado de resultado válido", async () => {
    const data = dataset(20);
    const srv = backendSimulado(data, 4, { fallaEnPagina: 2 }); // falla en la 3ª llamada (0-based: 2)
    const r = await ejecutarConsultaPaginada<Fila>(srv.construirPagina);
    assert.equal(r.data, null, "un error real nunca debe devolver `data` (ni completo ni parcial) como si fuera válido");
    assert.ok(r.error, "el error debe propagarse, no perderse");
    assert.equal(srv.llamadas(), 3, "se detiene exactamente en la página que falló, sin seguir pidiendo más");
  });

  test("un error en la PRIMERA página (catálogo completo inalcanzable desde el inicio) también se distingue de 'sin resultados'", async () => {
    const srv = backendSimulado(dataset(5), 2, { fallaEnPagina: 0 });
    const r = await ejecutarConsultaPaginada<Fila>(srv.construirPagina);
    assert.equal(r.data, null);
    assert.ok(r.error);
  });

  test("página vacía LEGÍTIMA (catálogo real vacío) sí se distingue de un error — devuelve data: [] con error: null", async () => {
    const srv = backendSimulado([], 1000);
    const r = await ejecutarConsultaPaginada<Fila>(srv.construirPagina);
    assert.equal(r.error, null);
    assert.deepEqual(r.data, []);
  });

  test("límite defensivo de páginas: un backend que NUNCA entrega página vacía falla cerrado (error), no entra en loop infinito", async () => {
    const srv = backendSimulado(dataset(3), 3, { nuncaVacio: true });
    const r = await ejecutarConsultaPaginada<Fila>(srv.construirPagina);
    assert.equal(r.data, null);
    assert.ok(r.error instanceof Error);
    assert.match((r.error as Error).message, /límite de \d+ páginas/);
  });

  test("avanza por la cantidad REAL de filas recibidas, nunca por un tamaño de página fijo — un recorte desigual entre llamadas no salta ni repite filas", async () => {
    // Servidor que recorta de forma DESIGUAL: 3 filas la 1ª vez, 7 la 2ª,
    // luego el resto — si el bucle avanzara por un PAGE fijo en vez de por
    // `page.length` real, saltaría o repetiría filas.
    const data = dataset(15);
    let llamada = 0;
    const construirPagina = async (from: number, hasta: number) => {
      llamada++;
      const limites = [3, 7, 1000];
      const max = limites[Math.min(llamada - 1, limites.length - 1)];
      const pedida = data.slice(from, hasta + 1);
      return { data: pedida.slice(0, max), error: null };
    };
    const r = await ejecutarConsultaPaginada<Fila>(construirPagina);
    assert.equal(r.error, null);
    const ids = (r.data ?? []).map((f) => f.id).sort((a, b) => a - b);
    assert.deepEqual(ids, data.map((f) => f.id), "sin huecos ni duplicados aunque el tamaño de recorte varíe entre llamadas");
  });
});

// ── Síntoma 1, reproducción directa: listado administrativo nunca muestra
// "Sin publicar" cuando existen filas reales ────────────────────────────────
//
// `app/(dashboard)/dashboard/paquetes/page.tsx` ahora agrega
// conteo/"desde" desde `tarifario_resumen` con `cargarFilasResumenPaginado()`
// (ya existente, reusada tal cual — ver comentario del archivo). Se prueba
// aquí el mismo escenario que el incidente real: muchos paquetes "viejos" +
// el paquete activo con tarifas reales cuyas filas de resumen caen DESPUÉS
// del primer recorte tipo "Max Rows".
describe("Síntoma 1 — cargarFilasResumenPaginado() recupera un paquete cuyas filas de resumen quedan después del primer límite", () => {
  function filaResumen(overrides: Partial<FilaResumen>): FilaResumen {
    return {
      modulo: "servicios", paquete_id: 1, paquete_nombre: "P", bloqueo_id: null, bloqueo_label: null,
      empaquetado_id: null, salida_id: null, hotel_id: null, hotel_nombre: null,
      servicio_id: 1, servicio_nombre: "Servicio", destino_id: null, destino_nombre: "Cartagena",
      categoria: null, regimen: null, fecha_ida: null, fecha_regreso: null, noches: null, moneda: "COP",
      precio_sencilla: null, precio_doble: null, precio_triple: null, precio_multiple: null,
      precio_nino: null, precio_nino2: null, precio_infante: null,
      desde_adulto: null, desde_general: 150000, descripcion: null, recargo_individual: null, tipo_tarifa: "persona",
      ...overrides,
    };
  }

  function servidorSimuladoMaxRows(dataset: FilaResumen[], maxFilasPorPagina: number) {
    function builder(tabla: string) {
      let rangeArgs: [number, number] = [0, 999];
      const b = {
        select() { return this; },
        order() { return this; },
        range(from: number, to: number) { rangeArgs = [from, to]; return this; },
        then(resolve: (v: { data: unknown; error: unknown }) => void) {
          if (tabla !== "tarifario_resumen") { resolve({ data: [], error: null }); return; }
          const [from, to] = rangeArgs;
          const pedida = dataset.slice(from, to + 1);
          resolve({ data: pedida.slice(0, maxFilasPorPagina), error: null });
        },
      };
      return b;
    }
    return { from: builder } as unknown as SupabaseClient<Database>;
  }

  test('"RECEPTIVOS ADZ": 40 combos de paquetes ya publicados + el paquete recién generado (paquete_id=9001) al final del catálogo — con Max Rows=10 simulado, su fila SÍ aparece en el resumen paginado', async () => {
    const viejos = Array.from({ length: 40 }, (_, i) => filaResumen({ paquete_id: i + 1, servicio_id: i + 1 }));
    const nuevo = filaResumen({ paquete_id: 9001, servicio_id: 9001, paquete_nombre: "RECEPTIVOS ADZ", desde_general: 89000 });
    const sb = servidorSimuladoMaxRows([...viejos, nuevo], 10);

    const pag = await cargarFilasResumenPaginado(sb);
    assert.equal(pag.ok, true);
    if (!pag.ok) return;

    // Reproduce exactamente el agregado que hace page.tsx: conteo + mínimo
    // "desde" por paquete_id.
    const conteo = new Map<number, number>();
    const desde = new Map<number, number>();
    for (const f of pag.filas) {
      conteo.set(f.paquete_id, (conteo.get(f.paquete_id) ?? 0) + 1);
      if (f.desde_general != null) {
        const prev = desde.get(f.paquete_id);
        if (prev == null || f.desde_general < prev) desde.set(f.paquete_id, f.desde_general);
      }
    }
    assert.equal(conteo.get(9001), 1, "el paquete recién publicado debe contar al menos 1 tarifa — nunca 'Sin publicar'");
    assert.equal(desde.get(9001), 89000);
  });
});

// ── Wiring: los 4 call sites del hotfix quedan realmente conectados al
// motor de paginación robusta (no solo "existe la función en algún lado") ──
describe("Wiring — los 4 call sites corregidos usan de verdad el paginador robusto", () => {
  test("app/(dashboard)/dashboard/paquetes/page.tsx (Síntoma 1): usa cargarFilasResumenPaginado, revisa su error y NUNCA vuelve a hacer un .select() crudo sobre tarifario_resultado", () => {
    const src = leer("app/(dashboard)/dashboard/paquetes/page.tsx");
    assert.match(src, /import \{ cargarFilasResumenPaginado \} from "@\/lib\/tarifario\/resumen"/);
    assert.match(src, /const pagResumen = await cargarFilasResumenPaginado\(sb\);/);
    assert.match(src, /if \(!pagResumen\.ok\)/);
    assert.doesNotMatch(src, /from\("tarifario_resultado"\)/, 'el listado administrativo ya no debe leer tarifario_resultado directamente');
  });

  test("lib/reservar/cotizar.ts — buscarHoteles y buscarReceptivos (Síntoma 2): ambos usan ejecutarConsultaPaginada con .order(\"id\").range(...)", () => {
    const src = leer("lib/reservar/cotizar.ts");
    assert.match(src, /import \{ ejecutarConsultaPaginada \} from "@\/lib\/tarifario\/paginacion"/);
    const usos = src.match(/await ejecutarConsultaPaginada</g) ?? [];
    assert.equal(usos.length, 2, "buscarHoteles y buscarReceptivos deben usar el paginador — se esperaban 2 usos");
    const rangos = src.match(/\.order\("id"\)\.range\(from, hasta\)/g) ?? [];
    assert.equal(rangos.length, 2);
  });

  test("app/tarifario/detalle-actions.ts — obtenerDetalleServicios (Síntoma 2, pestaña Servicios de Vista tabla): usa ejecutarConsultaPaginada, a diferencia de las otras 3 acciones acotadas por id estructural", () => {
    const src = leer("app/tarifario/detalle-actions.ts");
    assert.match(src, /import \{ ejecutarConsultaPaginada \} from "@\/lib\/tarifario\/paginacion"/);
    const cuerpoServicios = src.slice(src.indexOf("export async function obtenerDetalleServicios"));
    assert.match(cuerpoServicios, /await ejecutarConsultaPaginada<FilaTarifario>/);
    assert.match(cuerpoServicios, /\.order\("id"\)\.range\(from, hasta\)/);
  });
});
