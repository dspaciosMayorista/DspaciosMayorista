import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { getProgramasResumen, pvpPrograma } from "../lib/programas.ts";

// EJECUCIÓN REAL (no grep) de getProgramasResumen() — revisión posterior,
// dos defectos confirmados sobre esta función específicamente:
//   - "OPTIMIZACIÓN INTERNA INCOMPLETA": categorías/ciudades/salidas NO
//     dependen entre sí (solo de `ids`, el id de programa) — antes corrían
//     en secuencia. Se prueba con PROMESAS DIFERIDAS (no solo texto): las
//     tres deben estar "en vuelo" al mismo tiempo.
//   - "RESULTADOS OK FALSOS": la consulta de `programas` es CRÍTICA (si
//     falla, no hay de dónde sacar `ids`) — antes `!programas?.length`
//     confundía "sin programas" con "la consulta reventó". Las 4 consultas
//     de enriquecimiento (categorías/ciudades/precios/salidas) degradan
//     best-effort pero deben reportar el error, nunca "ok" silencioso.
// También se prueba EQUIVALENCIA FUNCIONAL con datos representativos:
// fórmula de PVP, "Desde" manual, ciudades, tipo de transporte, orden final
// — sin depender de una base real (fixtures en memoria).

type Fila = Record<string, unknown>;

// Thenable configurable: cada tabla resuelve con su propio { data, error } y
// puede DIFERIR la resolución (para probar concurrencia real con promesas
// pendientes) — `pendientes` guarda los resolve() de las tablas marcadas
// `diferir: true`, así el test decide CUÁNDO cada una se resuelve.
function clienteFalso(
  tablas: Record<string, { data: Fila[] | null; error: unknown; diferir?: boolean }>,
  onConsulta?: (tabla: string) => void
) {
  const pendientes = new Map<string, (v: { data: Fila[] | null; error: unknown }) => void>();
  const enVuelo = new Set<string>();
  const filtrosEq: [string, string, unknown][] = []; // [tabla, columna, valor]

  const sb = {
    from(tabla: string) {
      const cfg = tablas[tabla] ?? { data: [], error: null };
      const builder = {
        select() { return this; },
        eq(col: string, val: unknown) { filtrosEq.push([tabla, col, val]); return this; },
        in() { return this; },
        not() { return this; },
        order() { return this; },
        then(resolve: (v: { data: Fila[] | null; error: unknown }) => void) {
          onConsulta?.(tabla);
          enVuelo.add(tabla);
          if (cfg.diferir) {
            pendientes.set(tabla, (v) => { enVuelo.delete(tabla); resolve(v); });
          } else {
            enVuelo.delete(tabla);
            resolve({ data: cfg.data, error: cfg.error });
          }
        },
      };
      return builder;
    },
  };
  return {
    sb: sb as unknown as SupabaseClient<Database>,
    resolver: (tabla: string) => {
      const r = pendientes.get(tabla);
      if (!r) throw new Error(`${tabla} no está diferida o ya se resolvió`);
      r({ data: tablas[tabla].data, error: tablas[tabla].error });
      pendientes.delete(tabla);
    },
    enVuelo,
    filtrosEq,
  };
}

// Deja correr la cola de microtareas N veces — un `await` sobre un
// "thenable" (no una Promise nativa) puede tomar varios saltos de
// microtarea antes de que el código que sigue al `await` real se ejecute
// (el algoritmo de resolución de promesas hace más saltos para un thenable
// que para una Promise nativa). Se usa un número generoso y fijo en vez de
// contar manualmente cuántos `await Promise.resolve()` hacen falta en cada
// punto — más robusto ante cambios internos de la implementación.
async function agotarMicrotareas(n = 8) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

const PROGRAMA_BASE: Fila = {
  id: 1, nombre: "Cancún Todo Incluido", subtitulo: "5 días", dias: 5, noches: 4, moneda: "USD",
  pct_mk: 0.25, pct_fee_tarjeta: 0.03, asistencia_medica_dia: 2, publicado: true, desde_precio: null,
  incluye_aereo: false, tipo_transporte: "aereo", portada_url: "https://x/portada.jpg",
};

describe("getProgramasResumen() — la consulta CRÍTICA de `programas` distingue 'sin programas' de 'error técnico'", () => {
  test("programas devuelve [] SIN error: {programas:[], error:null} — caso de negocio legítimo", async () => {
    const { sb } = clienteFalso({ programas: { data: [], error: null } });
    const r = await getProgramasResumen(sb, true);
    assert.deepEqual(r, { programas: [], error: null });
  });

  test("programas falla técnicamente: {programas:[], error: <crudo>} — NUNCA se confunde con 'sin programas'", async () => {
    const ERROR = { code: "57014", message: "timeout" };
    const { sb } = clienteFalso({ programas: { data: null, error: ERROR } });
    const r = await getProgramasResumen(sb, true);
    assert.equal(r.programas.length, 0);
    assert.equal(r.error, ERROR, "el error crudo debe llegar al caller para que lo sanee con registrarErrorTecnico()");
  });

  test("cuando programas falla, NO se consultan las tablas de enriquecimiento (no tiene sentido pedir ids de un array vacío)", async () => {
    const consultadas: string[] = [];
    const { sb } = clienteFalso(
      { programas: { data: null, error: { code: "500" } } },
      (t) => consultadas.push(t)
    );
    await getProgramasResumen(sb, true);
    assert.deepEqual(consultadas, ["programas"]);
  });
});

describe("getProgramasResumen() — categorías/ciudades/salidas arrancan CONCURRENTEMENTE (ejecución real con promesas diferidas)", () => {
  test("las tres siguen 'en vuelo' a la vez — ninguna espera a que otra termine antes de arrancar", async () => {
    const { sb, resolver, enVuelo } = clienteFalso({
      programas: { data: [PROGRAMA_BASE], error: null },
      programa_categorias: { data: [], error: null, diferir: true },
      programa_ciudades: { data: [], error: null, diferir: true },
      programa_salidas: { data: [], error: null, diferir: true },
    });
    const promesa = getProgramasResumen(sb, true);
    // Deja que las 3 microtareas de arranque se enfilen.
    await agotarMicrotareas();
    assert.ok(enVuelo.has("programa_categorias"), "categorías debe estar en vuelo");
    assert.ok(enVuelo.has("programa_ciudades"), "ciudades debe estar en vuelo AL MISMO TIEMPO que categorías");
    assert.ok(enVuelo.has("programa_salidas"), "salidas debe estar en vuelo AL MISMO TIEMPO que categorías/ciudades");
    resolver("programa_categorias"); resolver("programa_ciudades"); resolver("programa_salidas");
    await promesa;
  });

  test("`programa_precios` arranca DESPUÉS de categorías (depende de catIds) — nunca antes de que catIds exista", async () => {
    const consultadas: string[] = [];
    const { sb, resolver } = clienteFalso(
      {
        programas: { data: [PROGRAMA_BASE], error: null },
        programa_categorias: { data: [{ id: 100, programa_id: 1 }], error: null, diferir: true },
        programa_ciudades: { data: [], error: null },
        programa_salidas: { data: [], error: null },
        programa_precios: { data: [], error: null },
      },
      (t) => consultadas.push(t)
    );
    const promesa = getProgramasResumen(sb, true);
    await agotarMicrotareas();
    assert.ok(!consultadas.includes("programa_precios"), "precios NO debe consultarse antes de que categorías resuelva");
    resolver("programa_categorias");
    await promesa;
    assert.ok(consultadas.includes("programa_precios"), "precios sí debe consultarse una vez hay catIds");
  });
});

describe("getProgramasResumen() — errores de ENRIQUECIMIENTO degradan best-effort, nunca resultado=ok silencioso", () => {
  test("error en programa_ciudades: el programa igual aparece (con ciudades=[]), pero `error` queda seteado", async () => {
    const ERROR_CIUDADES = { code: "42501" };
    const { sb } = clienteFalso({
      programas: { data: [PROGRAMA_BASE], error: null },
      programa_categorias: { data: [], error: null },
      programa_ciudades: { data: null, error: ERROR_CIUDADES },
      programa_salidas: { data: [], error: null },
    });
    const r = await getProgramasResumen(sb, true);
    assert.equal(r.programas.length, 1, "el programa debe seguir apareciendo — el fallo es cosmético (ciudades), no de precio");
    assert.deepEqual(r.programas[0].ciudades, []);
    assert.equal(r.error, ERROR_CIUDADES);
  });

  test("error en programa_precios: 'Desde' calculado queda ausente (null), nunca un precio inventado; `error` queda seteado", async () => {
    const ERROR_PRECIOS = { code: "42501" };
    const { sb } = clienteFalso({
      programas: { data: [PROGRAMA_BASE], error: null },
      programa_categorias: { data: [{ id: 100, programa_id: 1 }], error: null },
      programa_ciudades: { data: [], error: null },
      programa_salidas: { data: [], error: null },
      programa_precios: { data: null, error: ERROR_PRECIOS },
    });
    const r = await getProgramasResumen(sb, true);
    assert.equal(r.programas[0].desde_pvp, null, "sin precio verificable, desde_pvp debe ser null — nunca inventado");
    assert.equal(r.error, ERROR_PRECIOS);
  });

  test("sin ningún error: {error: null}", async () => {
    const { sb } = clienteFalso({
      programas: { data: [PROGRAMA_BASE], error: null },
      programa_categorias: { data: [], error: null },
      programa_ciudades: { data: [], error: null },
      programa_salidas: { data: [], error: null },
    });
    const r = await getProgramasResumen(sb, true);
    assert.equal(r.error, null);
  });
});

describe("getProgramasResumen() — equivalencia funcional (fórmula PVP, 'Desde' manual, ciudades, transporte, orden)", () => {
  test("soloPublicados=true agrega el filtro publicado=true", async () => {
    const { sb, filtrosEq } = clienteFalso({ programas: { data: [], error: null } });
    await getProgramasResumen(sb, true);
    assert.ok(filtrosEq.some(([t, c, v]) => t === "programas" && c === "activo" && v === true));
    assert.ok(filtrosEq.some(([t, c, v]) => t === "programas" && c === "publicado" && v === true), "soloPublicados=true debe filtrar publicado=true");
  });

  test("soloPublicados=false NO agrega el filtro publicado (activos aunque no publicados — interno)", async () => {
    const { sb, filtrosEq } = clienteFalso({ programas: { data: [], error: null } });
    await getProgramasResumen(sb, false);
    assert.ok(!filtrosEq.some(([t, c]) => t === "programas" && c === "publicado"), "soloPublicados=false NUNCA debe filtrar por publicado");
  });

  test("'Desde' manual (desde_precio) manda sobre el mínimo calculado de la matriz", async () => {
    const conManual: Fila = { ...PROGRAMA_BASE, id: 2, desde_precio: 999 };
    const { sb } = clienteFalso({
      programas: { data: [conManual], error: null },
      programa_categorias: { data: [{ id: 200, programa_id: 2 }], error: null },
      programa_ciudades: { data: [], error: null },
      programa_salidas: { data: [], error: null },
      programa_precios: { data: [{ categoria_id: 200, neto: 100 }], error: null },
    });
    const r = await getProgramasResumen(sb, true);
    assert.equal(r.programas[0].desde_pvp, 999, "el manual debe ganar aunque haya un neto calculable en la matriz");
  });

  test("fórmula PVP: modo categorías (programa_precios) reproduce EXACTAMENTE pvpPrograma()", async () => {
    const { sb } = clienteFalso({
      programas: { data: [PROGRAMA_BASE], error: null },
      programa_categorias: { data: [{ id: 100, programa_id: 1 }, { id: 101, programa_id: 1 }], error: null },
      programa_ciudades: { data: [], error: null },
      programa_salidas: { data: [], error: null },
      programa_precios: { data: [{ categoria_id: 100, neto: 500 }, { categoria_id: 101, neto: 300 }], error: null },
    });
    const r = await getProgramasResumen(sb, true);
    const esperado = pvpPrograma(300, { pctMk: 0.25, asistenciaDia: 2, dias: 5, pctFee: 0.03, moneda: "USD" });
    assert.equal(r.programas[0].desde_pvp, esperado, "debe tomar el MÍNIMO neto (300, no 500) y aplicar la misma fórmula que pvpPrograma()");
  });

  test("fórmula PVP: modo salidas (programa_salidas) también usa el mínimo neto entre acomodaciones, ignora bajo_solicitud", async () => {
    const { sb } = clienteFalso({
      programas: { data: [PROGRAMA_BASE], error: null },
      programa_categorias: { data: [], error: null },
      programa_ciudades: { data: [], error: null },
      programa_salidas: {
        data: [
          { programa_id: 1, neto_sencilla: 800, neto_doble: 400, neto_triple: null, neto_multiple: null, neto_nino: null, bajo_solicitud: false },
          { programa_id: 1, neto_sencilla: 100, neto_doble: null, neto_triple: null, neto_multiple: null, neto_nino: null, bajo_solicitud: true }, // debe ignorarse
        ],
        error: null,
      },
    });
    const r = await getProgramasResumen(sb, true);
    const esperado = pvpPrograma(400, { pctMk: 0.25, asistenciaDia: 2, dias: 5, pctFee: 0.03, moneda: "USD" });
    assert.equal(r.programas[0].desde_pvp, esperado, "400 (doble) es menor que 800 (sencilla); la fila bajo_solicitud=true (100) debe ignorarse por completo");
  });

  test("ciudades por programa se agrupan y ordenan por `orden`, tipo_transporte y portada se preservan", async () => {
    const { sb } = clienteFalso({
      programas: { data: [PROGRAMA_BASE], error: null },
      programa_categorias: { data: [], error: null },
      programa_ciudades: { data: [{ programa_id: 1, nombre: "Cancún", orden: 1 }, { programa_id: 1, nombre: "Playa del Carmen", orden: 2 }], error: null },
      programa_salidas: { data: [], error: null },
    });
    const r = await getProgramasResumen(sb, true);
    assert.deepEqual(r.programas[0].ciudades, ["Cancún", "Playa del Carmen"]);
    assert.equal(r.programas[0].tipo_transporte, "aereo");
    assert.equal(r.programas[0].portada_url, "https://x/portada.jpg");
  });

  test("tipo_transporte cae a 'aereo'/'ninguno' desde incluye_aereo SOLO cuando tipo_transporte es undefined (compatibilidad)", async () => {
    const legacy: Fila = { ...PROGRAMA_BASE, id: 3, tipo_transporte: undefined, incluye_aereo: true };
    const { sb } = clienteFalso({
      programas: { data: [legacy], error: null },
      programa_categorias: { data: [], error: null },
      programa_ciudades: { data: [], error: null },
      programa_salidas: { data: [], error: null },
    });
    const r = await getProgramasResumen(sb, true);
    assert.equal(r.programas[0].tipo_transporte, "aereo");
  });
});
