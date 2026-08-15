/**
 * Fixtures y limpieza de la carpeta `pe-empleados/` para `storage-adjuntos.mjs`,
 * separados en funciones con las dependencias por parámetro (mismo patrón que
 * `lib/adjuntos/operaciones.ts` y `lib/finanzas/fichaAliado.ts`) para poder
 * probar la SECUENCIA sin tocar Supabase real.
 *
 * EL BUG QUE ESTO CORRIGE
 *   La versión anterior calculaba `idsEmpleados = [empPropio.id, empOtro.id]`
 *   en una sola asignación, DESPUÉS de crear los dos empleados. Si la creación
 *   del segundo fallaba —o cualquier paso intermedio—, el primero JAMÁS
 *   quedaba registrado en ningún sitio que `limpiar()` pudiera ver: quedaba
 *   huérfano en la base real, sin que el reporte final dijera nada, porque la
 *   comprobación de "sin rastro" solo mira lo que está en `idsEmpleados`.
 *
 *   Aquí cada creación EMPUJA su id/ruta al contenedor compartido (`ctx`)
 *   INMEDIATAMENTE, antes de intentar el siguiente paso. Si algo revienta
 *   después, lo ya creado queda registrado igual — porque `ctx` es el mismo
 *   objeto que sigue vivo en el `finally` de quien llama.
 *
 * LA LIMPIEZA NO DEPENDE DE `list()`
 *   Un bucket real puede tener cientos de objetos en `pe-empleados/`. Un
 *   `list("pe-empleados")` sin más trae como mucho una página (100 por
 *   defecto) y en el orden que decida el servidor: si el objeto de esta
 *   corrida no cae en esa página, "no aparece en el listado" se puede
 *   confundir con "ya no existe" — un falso positivo de limpieza exitosa.
 *
 *   Por eso `eliminarRutasConocidas` borra por RUTA EXACTA (nunca listando
 *   antes) y `verificarRutasEliminadas` comprueba cada ruta POR SEPARADO con
 *   una búsqueda acotada a su propio nombre (`list(carpeta, {search:
 *   nombre})`, igual patrón que `existeArchivo` en `adjuntos-actions.ts`), no
 *   con un único listado de toda la carpeta filtrado después.
 */

/**
 * Crea los dos empleados de nómina y el contrato laboral del propio, marcando
 * cada pieza en `ctx` EN CUANTO EXISTE.
 *
 * @param deps
 *   crearEmpleado(nombre, tenant) → { id }            — lanza si falla
 *   subirArchivo(ruta, texto)     → void               — lanza si falla
 *   actualizarContratoPath(id, ruta) → { error }        — NO lanza: se
 *     comprueba el error explícitamente, porque un update que "no lanza pero
 *     tampoco escribió nada" es el mismo patrón de fallo silencioso que el
 *     resto de esta sesión viene cerrando en otros archivos.
 *
 * @param ctx
 *   idsEmpleados    — array MUTADO por `push`, del ámbito del llamador.
 *   rutasConocidas  — Set MUTADO por `add`, del ámbito del llamador.
 *   tenant, otroTenant, sello, textoContrato — datos de la corrida.
 */
export async function crearFixturesNomina(deps, ctx) {
  const empPropio = await deps.crearEmpleado(`${ctx.marca} Empleado ${ctx.sello}`, ctx.tenant);
  ctx.idsEmpleados.push(empPropio.id); // ← inmediatamente: si el 2º falla, este ya quedó

  const empOtro = await deps.crearEmpleado(`${ctx.marca} Empleado Otro ${ctx.sello}`, ctx.otroTenant);
  ctx.idsEmpleados.push(empOtro.id); // ← inmediatamente

  const rutaContratoPropio = `pe-empleados/${empPropio.id}-contrato.txt`;
  ctx.rutasConocidas.add(rutaContratoPropio); // ← ANTES de subir, no después

  await deps.subirArchivo(rutaContratoPropio, ctx.textoContrato);

  const { error } = await deps.actualizarContratoPath(empPropio.id, rutaContratoPropio);
  if (error) {
    throw new Error(
      `No se pudo actualizar contrato_path del empleado propio (#${empPropio.id}): ${error.message}`
    );
  }

  return { empPropio, empOtro, rutaContratoPropio };
}

/**
 * Marca una ruta como "de esta corrida" ANTES de intentar tocarla. Se llama
 * para cada intento —permitido, rechazado o de superadmin—, incluidos los que
 * DEBEN fallar (intrusos): si alguna vez la policy tuviera un agujero y el
 * intento colado sí escribiera algo, la limpieza tiene que alcanzarlo también.
 */
export function registrarRuta(ctx, ruta) {
  ctx.rutasConocidas.add(ruta);
  return ruta;
}

/**
 * Borra por RUTA EXACTA. Nunca lista la carpeta antes: en una carpeta con
 * muchos objetos un listado previo no garantiza traer las rutas de esta
 * corrida, y el borrado por ruta no necesita saber qué más hay ahí.
 */
export async function eliminarRutasConocidas(deps, rutas) {
  const lista = [...rutas];
  if (!lista.length) return { ok: true, borrados: 0 };
  const { error } = await deps.eliminarArchivos(lista);
  return error ? { ok: false, error } : { ok: true, borrados: lista.length };
}

/**
 * Comprueba, ruta por ruta, que ya no exista. Cada comprobación es una
 * búsqueda ACOTADA a ese nombre exacto (`list(carpeta, {search: nombre})`),
 * nunca un único listado de la carpeta completa filtrado en memoria — eso es
 * lo que la hace correcta aunque la carpeta tenga más de 100 objetos y el
 * nuestro no caiga en la primera página.
 */
export async function verificarRutasEliminadas(deps, rutas) {
  const resultados = [];
  for (const ruta of rutas) {
    const existe = await deps.existeRuta(ruta);
    resultados.push({ ruta, eliminada: !existe });
  }
  return resultados;
}
