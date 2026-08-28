import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { buscarPaginaTarifarioCompleta } from "../lib/tarifario/datos.ts";
import { hoyISO } from "../lib/calc/paquetes.ts";
import type { FilaTarifario } from "../app/tarifario/TarifarioPublic.tsx";

// EJECUCIÓN REAL de buscarPaginaTarifarioCompleta() — la función que
// reemplaza, en /tarifario y /dashboard/reservar, la carga del catálogo
// COMPLETO (cargarDatosTarifario(), hasta 17.197 filas medidas en el
// incidente real) por UNA página filtrada. Lo crítico a probar: que
// DELEGA correctamente en buscarFilasTarifarioPagina() (ya probada aparte
// en tarifarioConsulta.test.ts) y que el enriquecimiento (procesarFilasTarifario,
// ya probado exhaustivamente en tarifarioDatos.test.ts) se calcula SOLO
// sobre las filas de ESA página — nunca sobre el catálogo entero.

type Fila = { data: unknown[] | null; error: unknown; count?: number };

function clienteFalso(tablas: Record<string, Fila>, datasetTarifario: FilaTarifario[]) {
  function builder(tabla: string) {
    let rangeArgs: [number, number] | null = null;
    const eqAplicados: [string, unknown][] = [];
    const b = {
      select() { return this; },
      eq(col: string, val: unknown) { eqAplicados.push([col, val]); return this; },
      in() { return this; },
      not() { return this; },
      or() { return this; },
      order() { return this; },
      range(from: number, to: number) { rangeArgs = [from, to]; return this; },
      then(resolve: (v: { data: unknown; error: unknown; count?: number | null }) => void) {
        if (tabla === "tarifario_resultado") {
          const [from, to] = rangeArgs ?? [0, datasetTarifario.length - 1];
          const pagina = datasetTarifario.slice(from, to + 1);
          resolve({ data: pagina, error: null, count: datasetTarifario.length });
        } else {
          const cfg = tablas[tabla] ?? { data: [], error: null };
          resolve({ data: cfg.data, error: cfg.error, count: cfg.count });
        }
      },
    };
    return b;
  }
  const sb = { from: builder };
  return sb as unknown as SupabaseClient<Database>;
}

const HOY = hoyISO();
function fechaEnBogota(offsetDias: number): string {
  const ms = Date.now() + offsetDias * 86400000;
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}
const MANIANA = fechaEnBogota(1);
void HOY;

function filaBase(id: number, overrides: Partial<FilaTarifario> = {}): FilaTarifario {
  return {
    modulo: "bloqueo", bloqueo_label: `L${id}`, bloqueo_id: id, paquete_id: id, hotel_id: 100 + id,
    fecha_ida: MANIANA, fecha_regreso: null, noches: 3, destino_nombre: "Cartagena",
    paquete_nombre: `Paquete ${id}`, hotel_nombre: `Hotel ${id}`, categoria: "Estandar", regimen: "PC",
    acomodacion: "doble", precio_pvp: 500000, moneda: "COP", ...overrides,
  };
}

function tablasBase(overrides: Record<string, Fila> = {}): Record<string, Fila> {
  return {
    planes_alimentacion: { data: [], error: null },
    hotel_fotos: { data: [], error: null },
    hoteles: { data: [], error: null },
    servicios_adicionales: { data: [], error: null },
    ...overrides,
  };
}

describe("buscarPaginaTarifarioCompleta() — página acotada + enriquecimiento SOLO de esa página", () => {
  test("con 500 filas en la tabla y pageSize=24: la respuesta trae 24 filas, total=500 — nunca las 500 completas", async () => {
    const filas = Array.from({ length: 500 }, (_, i) => filaBase(i + 1));
    const sb = clienteFalso(tablasBase(), filas);
    const r = await buscarPaginaTarifarioCompleta(sb, { page: 1, pageSize: 24 }, "test", "flujo1", 24, null);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.datos.filasVisibles.length, 24);
    assert.equal(r.total, 500);
    assert.equal(r.page, 1);
    assert.equal(r.pageSize, 24);
  });

  test("página 2 trae las filas 25-48, distintas de la página 1 — sin admin (enriquecimiento limitado, pero la paginación es la misma pieza)", async () => {
    const filas = Array.from({ length: 100 }, (_, i) => filaBase(i + 1));
    const sb1 = clienteFalso(tablasBase(), filas);
    const p1 = await buscarPaginaTarifarioCompleta(sb1, { page: 1, pageSize: 24 }, "test", "flujo1", 24, null);
    const sb2 = clienteFalso(tablasBase(), filas);
    const p2 = await buscarPaginaTarifarioCompleta(sb2, { page: 2, pageSize: 24 }, "test", "flujo1", 24, null);
    assert.ok(p1.ok && p2.ok);
    if (!p1.ok || !p2.ok) return;
    const idsP1 = new Set(p1.datos.filasVisibles.map((f) => f.bloqueo_id));
    const idsP2 = new Set(p2.datos.filasVisibles.map((f) => f.bloqueo_id));
    for (const id of idsP2) assert.ok(!idsP1.has(id), `el id ${id} de la página 2 no debe repetirse en la página 1`);
  });

  test("filtro de destino se aplica en la propia página — filasVisibles nunca trae destinos que no pidió el filtro", async () => {
    const filas = [
      ...Array.from({ length: 5 }, (_, i) => filaBase(i + 1, { destino_nombre: "Cartagena" })),
      ...Array.from({ length: 5 }, (_, i) => filaBase(100 + i + 1, { destino_nombre: "San Andrés" })),
    ];
    // El fake NO filtra por eq (solo pagina) — esta prueba confirma que
    // buscarFilasTarifarioPagina (ya probada con filtrado real en
    // tarifarioConsulta.test.ts) es la que efectivamente aplica el filtro;
    // acá se confirma que buscarPaginaTarifarioCompleta reenvía `destino`
    // sin perderlo camino a la consulta.
    const sb = clienteFalso(tablasBase(), filas);
    let destinoRecibido: unknown;
    const sbEspiado = new Proxy(sb, {
      get(target, prop, receiver) {
        if (prop === "from") {
          return (tabla: string) => {
            const b = (target as unknown as { from: (t: string) => Record<string, unknown> }).from(tabla);
            if (tabla === "tarifario_resultado") {
              const origEq = b.eq as (c: string, v: unknown) => unknown;
              b.eq = (c: string, v: unknown) => { if (c === "destino_nombre") destinoRecibido = v; return origEq.call(b, c, v); };
            }
            return b;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await buscarPaginaTarifarioCompleta(sbEspiado, { destino: "Cartagena", page: 1, pageSize: 24 }, "test", "flujo1", 24, null);
    assert.equal(destinoRecibido, "Cartagena", "el filtro de destino debe llegar intacto a la consulta de tarifario_resultado");
  });

  test("un error técnico en la consulta paginada aborta con el mensaje público fijo — nunca 'sin tarifas'", async () => {
    const sbError = {
      from: () => ({
        select() { return this; }, eq() { return this; }, or() { return this; }, order() { return this; },
        range: () => Promise.resolve({ data: null, error: { message: "timeout" }, count: null }),
      }),
    } as unknown as SupabaseClient<Database>;
    const r = await buscarPaginaTarifarioCompleta(sbError, {}, "test", "flujo1", 24, null);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /No fue posible cargar el tarifario/);
  });

  test("filtrosRaw manipulado (unknown, del navegador) no revienta y produce una página válida", async () => {
    const filas = Array.from({ length: 30 }, (_, i) => filaBase(i + 1));
    const sb = clienteFalso(tablasBase(), filas);
    const r = await buscarPaginaTarifarioCompleta(sb, { page: "no-numero", pageSize: -1, modulo: 12345 }, "test", "flujo1", 24, null);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.page, 1);
    assert.ok(r.pageSize >= 1);
  });
});
