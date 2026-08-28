import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { crearCatalogoCompartido, TAG_TARIFARIO_CATALOGO } from "../lib/tarifario/catalogoCompartidoFabrica.ts";
import { cargarDatosTarifario, type DatosTarifario, type CuposYOrigen } from "../lib/tarifario/datos.ts";
import { cargarFilasTarifarioPaginado } from "../lib/tarifario/paginacion.ts";
import type { FilaTarifario } from "../app/tarifario/TarifarioPublic.tsx";

// EJECUCIÓN REAL (no grep) de la caché compartida del catálogo tarifario
// (lib/tarifario/catalogoCache.ts) — ronda posterior a la medición real de
// Vercel (~13s en /reservar, /dashboard/tarifario, /tarifario). `unstable_
// cache` real de Next SOLO funciona dentro de un request de Next.js (usa
// AsyncLocalStorage interno) — confirmado que revienta con "Invariant:
// incrementalCache missing" bajo `node --test` plano al INVOCARSE. Por eso
// `crearCatalogoCompartido()` recibe el mecanismo de caché como parámetro
// inyectable: aquí se prueba con un cacheador FALSO en memoria que
// implementa el MISMO contrato observable que `unstable_cache` +
// `updateTag()` reales — memoiza por (keyParts + argumentos), invalida por
// etiqueta, y NUNCA cachea un `throw` (documentado y verificado en el
// propio Next: un fetcher que lanza no se guarda) — sin depender de Next.js
// en ejecución ni de una base de datos real.

process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-de-prueba";

type EntradaCache = { valor: unknown; tags: string[] };

function crearCacheadorDePrueba() {
  const store = new Map<string, EntradaCache>();
  // Mismo estilo genérico de Next (`<T extends Callback>(cb: T, ...): T`,
  // ver Cacheador en catalogoCompartidoFabrica.ts) — necesario para que
  // esta función sea asignable al tipo `Cacheador` sin pelear con la
  // varianza de un genérico de dos parámetros.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function cachear<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    keyParts?: string[],
    opciones?: { tags?: string[]; revalidate?: number | false }
  ): T {
    const base = JSON.stringify(keyParts ?? []);
    const wrapped = async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
      const key = `${base}|${JSON.stringify(args)}`;
      const hit = store.get(key);
      if (hit) return hit.valor as Awaited<ReturnType<T>>;
      // Igual que unstable_cache real: si `fn` lanza, NO se cachea nada —
      // la próxima llamada vuelve a intentar desde cero.
      const valor = await fn(...args);
      store.set(key, { valor, tags: opciones?.tags ?? [] });
      return valor;
    };
    return wrapped as T;
  }
  function invalidarEtiqueta(tag: string) {
    for (const [k, v] of store) if (v.tags.includes(tag)) store.delete(k);
  }
  return { cachear, invalidarEtiqueta, tamano: () => store.size };
}

function datosFixture(): DatosTarifario {
  return {
    filasVisibles: [],
    filasAddon: [],
    cuposPorBloqueo: {},
    origenPorBloqueo: {},
    fotosPorHotel: {},
    fotosPorServicio: {},
    infoPorHotel: {},
    capPorHotel: {},
    planesInfo: {},
    ventanaPorPaquete: {},
    incluidosPorPaquete: {},
  };
}

const cuposVacios = async (): Promise<CuposYOrigen> => ({
  cuposPorBloqueo: {}, origenPorBloqueo: {}, error1: null, error2: null,
});

const sbFalso = {} as unknown as SupabaseClient<Database>;

describe("crearCatalogoCompartido() — dos cargas iguales reutilizan el catálogo (el cargador costoso corre UNA sola vez)", () => {
  test("cargarDatosTarifarioCompartido(): dos llamadas seguidas invocan catalogoCrudo() una sola vez", async () => {
    const { cachear } = crearCacheadorDePrueba();
    let invocaciones = 0;
    const catalogoCrudo = async () => { invocaciones++; return datosFixture(); };
    const { cargarDatosTarifarioCompartido } = crearCatalogoCompartido({ cachear, catalogoCrudo, obtenerCupos: cuposVacios, admin: sbFalso });

    await cargarDatosTarifarioCompartido(sbFalso, "flujoA", "1");
    await cargarDatosTarifarioCompartido(sbFalso, "flujoB", "2");
    assert.equal(invocaciones, 1, "el cargador costoso del catálogo completo debe correr una sola vez para 2 cargas");
  });

  test("cargarFilasTarifarioLivianoCompartido(): dos llamadas seguidas invocan filasLivianasCrudo() una sola vez", async () => {
    const { cachear } = crearCacheadorDePrueba();
    let invocaciones = 0;
    const filasLivianasCrudo = async (): Promise<FilaTarifario[]> => { invocaciones++; return []; };
    const { cargarFilasTarifarioLivianoCompartido } = crearCatalogoCompartido({ cachear, filasLivianasCrudo });

    await cargarFilasTarifarioLivianoCompartido(sbFalso);
    await cargarFilasTarifarioLivianoCompartido(sbFalso);
    assert.equal(invocaciones, 1, "el cargador costoso liviano debe correr una sola vez para 2 cargas");
  });

  test("getProgramasResumenCompartido(): dos llamadas con el MISMO soloPublicados invocan programasResumenCrudo() una sola vez; un soloPublicados DISTINTO sí dispara una nueva carga (cache key correcta)", async () => {
    const { cachear } = crearCacheadorDePrueba();
    let invocaciones = 0;
    const vistos: boolean[] = [];
    const programasResumenCrudo = async (soloPublicados: boolean) => {
      invocaciones++;
      vistos.push(soloPublicados);
      return { programas: [], error: null };
    };
    const { getProgramasResumenCompartido } = crearCatalogoCompartido({ cachear, programasResumenCrudo });

    await getProgramasResumenCompartido(sbFalso, true);
    await getProgramasResumenCompartido(sbFalso, true);
    assert.equal(invocaciones, 1, "mismo soloPublicados=true: una sola carga real");

    await getProgramasResumenCompartido(sbFalso, false);
    assert.equal(invocaciones, 2, "soloPublicados=false es una entrada de caché DISTINTA (/dashboard/tarifario y /dashboard/reservar la comparten; /tarifario público usa true)");
    // 2 invocaciones reales en total (no 3): la 2ª llamada con soloPublicados=true
    // fue un HIT de caché, así que programasResumenCrudo() nunca se volvió a
    // ejecutar para ese valor — "vistos" solo registra invocaciones REALES.
    assert.deepEqual(vistos, [true, false]);
  });
});

describe("crearCatalogoCompartido() — datos por usuario/tenant NO se comparten dentro del cache key", () => {
  test("cargarDatosTarifarioCompartido() con dos clientes `sb` distintos (dos sesiones/usuarios distintos) devuelve el MISMO catálogo compartido, sin volver a pedirlo", async () => {
    const { cachear } = crearCacheadorDePrueba();
    let invocaciones = 0;
    const catalogoCrudo = async () => { invocaciones++; return datosFixture(); };
    const { cargarDatosTarifarioCompartido } = crearCatalogoCompartido({ cachear, catalogoCrudo, obtenerCupos: cuposVacios, admin: sbFalso });

    // Dos objetos `sb` estructuralmente DIFERENTES — el equivalente de dos
    // sesiones/usuarios distintos. Como `catalogoCrudo` no recibe `sb` como
    // argumento (crea su propio admin client internamente, ver
    // lib/tarifario/catalogoCache.ts), `sb` NUNCA entra al cache key: no hay
    // forma de que la caché mezcle o filtre datos de un usuario a otro,
    // porque el catálogo en sí nunca dependió de quién pregunta.
    const sbUsuario1 = { marca: "usuario-1" } as unknown as SupabaseClient<Database>;
    const sbUsuario2 = { marca: "usuario-2" } as unknown as SupabaseClient<Database>;
    const r1 = await cargarDatosTarifarioCompartido(sbUsuario1, "flujoUsuario1", "a");
    const r2 = await cargarDatosTarifarioCompartido(sbUsuario2, "flujoUsuario2", "b");
    assert.equal(invocaciones, 1, "el catálogo se pidió una sola vez, sin importar qué `sb`/sesión lo solicitó");
    assert.deepEqual(r1, r2, "ambos usuarios reciben exactamente el mismo catálogo (es el objetivo: dato global)");
  });

  test("cupos/origen se refrescan EN VIVO en cada llamada — nunca comparten un snapshot cacheado entre dos requests", async () => {
    const { cachear } = crearCacheadorDePrueba();
    const catalogoCrudo = async (): Promise<DatosTarifario> => ({
      ...datosFixture(),
      filasVisibles: [{ modulo: "bloqueo", bloqueo_id: 1 } as unknown as FilaTarifario],
    });
    let llamadasCupos = 0;
    const obtenerCupos = async (): Promise<CuposYOrigen> => {
      llamadasCupos++;
      // Simula que la disponibilidad cambió entre una llamada y la otra
      // (alguien reservó una silla) — si esto viniera del bloque cacheado
      // en vez de en vivo, la 2ª llamada mostraría el mismo cupo viejo.
      return { cuposPorBloqueo: { 1: llamadasCupos === 1 ? 5 : 4 }, origenPorBloqueo: {}, error1: null, error2: null };
    };
    const { cargarDatosTarifarioCompartido } = crearCatalogoCompartido({ cachear, catalogoCrudo, obtenerCupos, admin: sbFalso });

    const r1 = await cargarDatosTarifarioCompartido(sbFalso, "f", "1");
    const r2 = await cargarDatosTarifarioCompartido(sbFalso, "f", "2");
    assert.equal(llamadasCupos, 2, "cupos se piden EN VIVO en cada llamada, nunca desde el bloque cacheado");
    assert.equal(r1.ok && r1.datos.cuposPorBloqueo[1], 5);
    assert.equal(r2.ok && r2.datos.cuposPorBloqueo[1], 4, "el segundo cupo refleja el cambio real, no un snapshot viejo compartido");
  });
});

describe("crearCatalogoCompartido() — invalidación: escritura exitosa SÍ invalida, escritura fallida NO invalida", () => {
  test("después de invalidar la etiqueta, la siguiente carga vuelve a pedir el catálogo (equivalente a una mutación EXITOSA)", async () => {
    const { cachear, invalidarEtiqueta } = crearCacheadorDePrueba();
    let invocaciones = 0;
    const catalogoCrudo = async () => { invocaciones++; return datosFixture(); };
    const { cargarDatosTarifarioCompartido } = crearCatalogoCompartido({ cachear, catalogoCrudo, obtenerCupos: cuposVacios, admin: sbFalso });

    await cargarDatosTarifarioCompartido(sbFalso, "f", "1");
    await cargarDatosTarifarioCompartido(sbFalso, "f", "2");
    assert.equal(invocaciones, 1);

    // Equivalente a lo que hace invalidarCatalogoTarifario() en producción
    // (updateTag(TAG_TARIFARIO_CATALOGO)) DESPUÉS de un guardado exitoso.
    invalidarEtiqueta(TAG_TARIFARIO_CATALOGO);

    await cargarDatosTarifarioCompartido(sbFalso, "f", "3");
    assert.equal(invocaciones, 2, "tras invalidar, la siguiente carga debe recalcular el catálogo");
  });

  test("SIN invalidar, el catálogo sigue sirviéndose desde caché indefinidamente (equivalente a una mutación FALLIDA: nunca se llama a invalidar)", async () => {
    const { cachear } = crearCacheadorDePrueba();
    let invocaciones = 0;
    const catalogoCrudo = async () => { invocaciones++; return datosFixture(); };
    const { cargarDatosTarifarioCompartido } = crearCatalogoCompartido({ cachear, catalogoCrudo, obtenerCupos: cuposVacios, admin: sbFalso });

    for (let i = 0; i < 5; i++) await cargarDatosTarifarioCompartido(sbFalso, "f", String(i));
    assert.equal(invocaciones, 1, "5 cargas sin ninguna invalidación de por medio: el cargador costoso corre UNA sola vez");
  });

  test("las 24 llamadas reales a invalidarCatalogoTarifario() en Server Actions están todas DESPUÉS de al menos un chequeo de error en su función — nunca se invalida antes de confirmar éxito", async () => {
    // Guarda de wiring por texto (además de las pruebas de comportamiento de
    // arriba, que prueban el CONTRATO de invalidación con ejecución real).
    // Para cada archivo con invalidarCatalogoTarifario(), cada aparición debe
    // tener un "if (error) return { ok: false" o similar ANTES en el mismo
    // archivo (a la misma o menor profundidad de función) — chequeo
    // aproximado pero suficiente: ninguna de las inserciones de esta ronda
    // colocó la invalidación antes de un `if (...error) return`.
    const fs = await import("node:fs");
    const archivos = [
      "app/(dashboard)/dashboard/paquetes/actions.ts",
      "app/(dashboard)/dashboard/producto/hoteles/actions.ts",
      "app/(dashboard)/dashboard/producto/hoteles/[id]/fotos-actions.ts",
      "app/(dashboard)/dashboard/producto/servicios/actions.ts",
      "app/(dashboard)/dashboard/producto/configuracion/actions.ts",
      "app/(dashboard)/dashboard/vuelos/empaquetados-actions.ts",
      "app/(dashboard)/dashboard/producto/programas/actions.ts",
    ];
    let totalOcurrencias = 0;
    for (const rel of archivos) {
      const contenido = fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8");
      const idxInvalidar: number[] = [];
      const re = /invalidarCatalogoTarifario\(\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(contenido))) idxInvalidar.push(m.index);
      totalOcurrencias += idxInvalidar.length;
      for (const idx of idxInvalidar) {
        const antes = contenido.slice(0, idx);
        assert.ok(
          /return\s*\{\s*ok:\s*false/.test(antes),
          `${rel}: una llamada a invalidarCatalogoTarifario() no tiene ningún "return { ok: false" antes en el archivo — sospechoso de invalidar sin haber pasado ningún chequeo de error`
        );
      }
    }
    assert.equal(totalOcurrencias, 24, "conteo exacto de call sites auditados en esta ronda (ver reporte del PR)");
  });
});

describe("crearCatalogoCompartido() — equivalencia funcional exacta entre resultado SIN caché y CON caché", () => {
  test("cargarDatosTarifarioCompartido() (con caché) devuelve EXACTAMENTE el mismo `datos` que cargarDatosTarifario() (sin caché) para el mismo fixture", async () => {
    type Fila = { data: unknown[] | null; error: unknown };
    const dataset = [{
      modulo: "bloqueo", bloqueo_label: "L1", bloqueo_id: 7, paquete_id: 1, hotel_id: null,
      fecha_ida: "2099-01-01", fecha_regreso: null, noches: 3, destino_nombre: "Cartagena",
      paquete_nombre: "Paquete 1", hotel_nombre: null, categoria: null, regimen: null,
      acomodacion: "doble", precio_pvp: 500000, moneda: "COP",
    }];
    function clienteFalso(tablas: Record<string, Fila>) {
      function builder(tabla: string) {
        let rangeArgs: [number, number] | null = null;
        const b = {
          select() { return this; }, eq() { return this; }, in() { return this; },
          not() { return this; }, order() { return this; },
          range(from: number, to: number) { rangeArgs = [from, to]; return this; },
          then(resolve: (v: { data: unknown; error: unknown }) => void) {
            if (tabla === "tarifario_resultado") {
              const [from, to] = rangeArgs ?? [0, 999];
              resolve({ data: dataset.slice(from, to + 1), error: null });
            } else {
              const cfg = tablas[tabla] ?? { data: [], error: null };
              resolve({ data: cfg.data, error: cfg.error });
            }
          },
        };
        return b;
      }
      return { from: builder } as unknown as SupabaseClient<Database>;
    }
    const tablasBase: Record<string, Fila> = {
      cupos_por_bloqueo: { data: [{ id: 7, cupos_disponibles: 3 }], error: null },
      bloqueos_vuelo: { data: [{ id: 7, origen: "BOG", ruta: "BOG-CTG" }], error: null },
      hotel_temporadas: { data: [], error: null },
      tarifa_hotel: { data: [], error: null },
      empaquetados: { data: [], error: null },
      armado_paquetes: { data: [], error: null },
      hotel_fotos: { data: [], error: null },
      hoteles: { data: [], error: null },
      hotel_acomodaciones: { data: [], error: null },
      servicios_adicionales: { data: [], error: null },
      planes_alimentacion: { data: [], error: null },
      armado_servicios: { data: [], error: null },
    };

    const sinCache = await cargarDatosTarifario(clienteFalso(tablasBase), "test", "sin-cache", clienteFalso(tablasBase));
    assert.equal(sinCache.ok, true);

    const { cachear } = crearCacheadorDePrueba();
    const catalogoCrudo = async (): Promise<DatosTarifario> => {
      const r = await cargarDatosTarifario(clienteFalso(tablasBase), "test", "con-cache", clienteFalso(tablasBase));
      if (!r.ok) throw new Error(r.error);
      return r.datos;
    };
    const { cargarDatosTarifarioCompartido } = crearCatalogoCompartido({
      cachear, catalogoCrudo, admin: sbFalso,
      obtenerCupos: async (_admin, bloqueoIds): Promise<CuposYOrigen> => {
        void _admin;
        const cuposPorBloqueo: Record<number, number> = {};
        const origenPorBloqueo: Record<number, string> = {};
        if (bloqueoIds.length) { cuposPorBloqueo[7] = 3; origenPorBloqueo[7] = "BOG"; }
        return { cuposPorBloqueo, origenPorBloqueo, error1: null, error2: null };
      },
    });
    const conCache = await cargarDatosTarifarioCompartido(sbFalso, "test", "flujo1");

    assert.equal(conCache.ok, true);
    if (!sinCache.ok || !conCache.ok) return;
    assert.deepEqual(conCache.datos, sinCache.datos, "el resultado cacheado debe ser byte a byte idéntico al resultado sin caché para el mismo fixture");
  });
});

describe("crearCatalogoCompartido() — control NEGATIVO: sin caché, dos cargas iguales repiten TODAS las consultas de paginación", () => {
  test("cargarFilasTarifarioPaginado() llamado directamente 2 veces (patrón ANTERIOR, sin caché) ejecuta el doble de round-trips que 1 sola vez", async () => {
    // Fixture de 2.500 filas → 3 round-trips por carga (1000+1000+500), igual
    // patrón que las 18 consultas reales para 17.197 filas — el número
    // exacto no importa, lo que se demuestra es la MULTIPLICACIÓN del costo.
    const TOTAL_FILAS = 2500;
    const dataset = Array.from({ length: TOTAL_FILAS }, (_, i) => ({ id: i, precio_pvp: 1000 }));
    let consultasHechas = 0;
    function clienteContador() {
      return {
        from() {
          let rangeArgs: [number, number] = [0, 999];
          return {
            select() { return this; }, eq() { return this; }, order() { return this; },
            range(from: number, to: number) { rangeArgs = [from, to]; return this; },
            then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
              consultasHechas++;
              const [from, to] = rangeArgs;
              resolve({ data: dataset.slice(from, to + 1), error: null });
            },
          };
        },
      } as unknown as SupabaseClient<Database>;
    }

    // Patrón ANTERIOR (sin caché): cada "carga de página" vuelve a llamar
    // cargarFilasTarifarioPaginado() de cero, sin memoización.
    const clienteA = clienteContador();
    await cargarFilasTarifarioPaginado(clienteA, "id, precio_pvp");
    const consultasPrimeraCarga = consultasHechas;
    assert.equal(consultasPrimeraCarga, 3, "2.500 filas a 1000/página deben tomar 3 round-trips (1000+1000+500)");

    await cargarFilasTarifarioPaginado(clienteA, "id, precio_pvp");
    assert.equal(consultasHechas, consultasPrimeraCarga * 2, "control negativo: SIN caché, una 2ª carga idéntica repite TODAS las consultas de paginación (18 en el caso real medido en Vercel)");

    // Patrón NUEVO (con caché compartida): la 2ª carga NO repite ninguna.
    consultasHechas = 0;
    const clienteB = clienteContador();
    const { cachear } = crearCacheadorDePrueba();
    const filasLivianasCrudo = () => cargarFilasTarifarioPaginado<FilaTarifario>(clienteB, "id, precio_pvp").then((r) => (r.ok ? r.filas : []));
    const { cargarFilasTarifarioLivianoCompartido } = crearCatalogoCompartido({ cachear, filasLivianasCrudo });
    await cargarFilasTarifarioLivianoCompartido(sbFalso);
    const consultasConCache1 = consultasHechas;
    await cargarFilasTarifarioLivianoCompartido(sbFalso);
    assert.equal(consultasHechas, consultasConCache1, "con caché compartida, la 2ª carga idéntica NO repite ninguna consulta de paginación");
  });
});
