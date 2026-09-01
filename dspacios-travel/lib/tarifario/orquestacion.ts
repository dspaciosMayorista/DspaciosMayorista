// Orquestación de la carga de /dashboard/reservar, /dashboard/tarifario y
// /tarifario — revisión posterior, defecto "PRUEBA REAL DE CONCURRENCIA"
// confirmado: `pruebas/tarifarioCargaWiring.test.ts` solo inspeccionaba TEXTO
// (que el código contenga la palabra `Promise.all`) — eso prueba que el
// código TIENE la forma correcta, nunca que efectivamente ejecuta en
// paralelo. Este módulo es deliberadamente PURO (cero imports, cero
// Supabase, cero `next/headers`) para poder importarse directo bajo
// `node --test` y probarse con PROMESAS DIFERIDAS reales — la única forma
// de demostrar concurrencia de verdad: que una tarea arranca ANTES de que
// otra termine, no solo que el código las declara juntas.
//
// Cada page.tsx (Server Component, no testeable directo) le pasa a estas
// funciones cierres (`() => Promise<T>`) que ENVUELVEN las llamadas reales
// (Supabase, medición, etc.) — la orquestación misma no sabe nada de eso,
// solo decide CUÁNDO invocar cada cierre.

/**
 * Ejecuta un mapa de tareas (`{clave: () => Promise<T>}`) CONCURRENTEMENTE:
 * TODAS las funciones se invocan de forma SÍNCRONA, una tras otra, ANTES de
 * esperar cualquier resultado — esa es la garantía real de concurrencia
 * (no depende de que el motor de JS decida "paralelizar" nada; simplemente
 * ninguna tarea puede esperar a que otra empiece, porque todas ya arrancaron
 * antes del primer `await`). Devuelve un objeto con las mismas claves,
 * cada una resuelta a su resultado.
 */
export async function ejecutarConcurrentes<T extends Record<string, () => Promise<unknown>>>(
  tareas: T
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const claves = Object.keys(tareas) as (keyof T)[];
  // Invocación SÍNCRONA de cada tarea — antes de este bucle terminar, las
  // `claves.length` promesas YA están "en vuelo". Ninguna `await` ocurre
  // aquí todavía.
  const promesas = claves.map((k) => tareas[k]());
  const resueltas = await Promise.all(promesas);
  const resultado = {} as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
  claves.forEach((k, i) => {
    resultado[k] = resueltas[i] as Awaited<ReturnType<T[typeof k]>>;
  });
  return resultado;
}

/**
 * /dashboard/reservar: `liberarVencidas()` debe terminar POR COMPLETO
 * (liberar sillas vencidas en la base) ANTES de que arranquen
 * `cargarTarifario`/`cargarProgramas` — `cargarTarifario` lee cupos
 * derivados de esas mismas sillas, así que invertir el orden (o
 * paralelizarlo) arriesga leer cupos ANTES de liberar, mostrando menos
 * disponibilidad de la real. Esta función asegura la secuencia con el
 * `await` mismo (no con un comentario): `deps.cargarTarifario`/
 * `deps.cargarProgramas` NUNCA se invocan (ni siquiera se llama la función,
 * no solo "no se espera") hasta que la promesa de `liberarVencidas` haya
 * resuelto.
 */
export async function orquestarCargaReservar<TLiberado, TDatos, TProgramas>(deps: {
  liberarVencidas: () => Promise<TLiberado>;
  cargarTarifario: () => Promise<TDatos>;
  cargarProgramas: () => Promise<TProgramas>;
}): Promise<{ liberado: TLiberado; datos: TDatos; programas: TProgramas }> {
  const liberado = await deps.liberarVencidas();
  const { datos, programas } = await ejecutarConcurrentes({
    datos: deps.cargarTarifario,
    programas: deps.cargarProgramas,
  });
  return { liberado, datos, programas };
}

/**
 * /tarifario (público): la sesión (`auth.getUser()` + consulta de perfil,
 * de donde salen `esAgencia`/`puedeReservar`) se resuelve PRIMERO — el
 * page.tsx la usa para AUTORIZAR el render, pero ninguno de los datos
 * (tarifario/programas/config_sitio) depende de quién esté logueado, así
 * que una vez resuelta la sesión, las 3 cargas de datos arrancan
 * CONCURRENTES entre sí. `deps.cargarTarifario`/`cargarProgramas`/
 * `cargarConfigSitio` nunca se invocan hasta que `resolverSesion` resuelve.
 */
export async function orquestarCargaPublica<TSesion, TDatos, TProgramas, TConfig>(deps: {
  resolverSesion: () => Promise<TSesion>;
  cargarTarifario: () => Promise<TDatos>;
  cargarProgramas: () => Promise<TProgramas>;
  cargarConfigSitio: () => Promise<TConfig>;
}): Promise<{ sesion: TSesion; datos: TDatos; programas: TProgramas; configSitio: TConfig }> {
  const sesion = await deps.resolverSesion();
  const { datos, programas, configSitio } = await ejecutarConcurrentes({
    datos: deps.cargarTarifario,
    programas: deps.cargarProgramas,
    configSitio: deps.cargarConfigSitio,
  });
  return { sesion, datos, programas, configSitio };
}

/**
 * /dashboard/tarifario: la carga del tarifario (paginación + filtro de
 * vigencia, ya compuesta dentro de `deps.cargarTarifario`) y
 * `getProgramasResumen()` no dependen una de la otra — arrancan
 * CONCURRENTES. Envoltorio delgado sobre `ejecutarConcurrentes` (mismo
 * criterio que las otras dos rutas) para que las 3 páginas usen el mismo
 * patrón nombrado.
 */
export async function orquestarCargaInterna<TFilas, TProgramas>(deps: {
  cargarTarifario: () => Promise<TFilas>;
  cargarProgramas: () => Promise<TProgramas>;
}): Promise<{ tarifario: TFilas; programas: TProgramas }> {
  return ejecutarConcurrentes({ tarifario: deps.cargarTarifario, programas: deps.cargarProgramas });
}
