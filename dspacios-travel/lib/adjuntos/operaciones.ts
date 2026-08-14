// Orquestación de los adjuntos del contrato: subir y eliminar.
//
// Vive aparte de las Server Actions y del componente a propósito. Las dos
// operaciones tocan DOS sistemas —el bucket de Storage y la tabla
// `contrato_adjuntos`— y lo que importa es qué pasa cuando el primero funciona
// y el segundo no. Eso no se puede probar si la lógica está enredada con
// `next/headers` y con el cliente real de Supabase, así que aquí las
// dependencias entran por parámetro y las pruebas de `pruebas/adjuntos.test.ts`
// las sustituyen.
//
// LOS DOS AGUJEROS QUE ESTO CIERRA
//
//   1. `eliminarAdjunto` llamaba `remove()` y TIRABA EL RESULTADO, y después
//      borraba la fila igual. Si Storage rechazaba el borrado (RLS) la fila
//      desaparecía de la pantalla y el archivo —una cédula, un soporte de
//      pago— se quedaba en el bucket para siempre, ya sin nada que lo
//      referenciara. Invisible, imborrable desde la interfaz.
//
//   2. Al subir, primero se sube el archivo y después se registra la fila. Si
//      el registro fallaba, el archivo ya estaba arriba y nadie lo limpiaba:
//      el mismo huérfano, por el otro extremo.
//
// No hay transacción posible entre Storage y Postgres, así que la regla es:
// dejar el sistema en un estado del que se pueda salir, y DECIR lo que pasó.
// Un huérfano callado es peor que un error.

export type ResultadoOp = { ok: true } | { ok: false; error: string };

/**
 * ¿La lista que devolvió `remove()` incluye este path?
 *
 * Se aceptan las DOS formas —la ruta completa dentro del bucket y solo el
 * nombre del objeto— porque no está garantizado cuál devuelve cada versión del
 * cliente de Storage. Ser estricto de más aquí sería peor que el problema que
 * se quiere resolver: bloquearía eliminaciones legítimas. Lo que importa
 * detectar es la lista VACÍA (o con otros objetos), que es lo que devuelve la
 * API cuando una policy filtró el archivo.
 */
function listaIncluye(data: { name: string }[] | null, path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return (data ?? []).some((o) => o.name === path || o.name === base || path.endsWith(`/${o.name}`));
}

type ErrorSb = { message: string } | null;

/** Lo que devuelve `supabase.storage.from(b).remove(paths)`. */
export type RespuestaRemove = { data: { name: string }[] | null; error: ErrorSb };

export type DepsEliminar = {
  /** `sb.storage.from(BUCKET).remove([path])` */
  eliminarArchivo(paths: string[]): Promise<RespuestaRemove>;
  /** Borra la fila de `contrato_adjuntos`. */
  eliminarFila(id: number): Promise<{ error: ErrorSb }>;
};

/**
 * Borra el archivo y, SOLO si eso funcionó, la fila que lo indexa.
 *
 * El orden importa y es deliberado. Si se borrara primero la fila y fallara el
 * archivo, quedaría un huérfano invisible con datos personales dentro. Al
 * revés —archivo primero— lo peor que puede quedar es una fila que apunta a un
 * archivo que ya no está: se ve en la pantalla, molesta, y se puede reintentar.
 * De los dos estados intermedios posibles, se elige a propósito el que se nota.
 */
export async function eliminarArchivoYFila(
  deps: DepsEliminar,
  args: { id: number; path: string }
): Promise<ResultadoOp> {
  let respuesta: RespuestaRemove;
  try {
    respuesta = await deps.eliminarArchivo([args.path]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `No se pudo eliminar el archivo (${msg}). El registro no se eliminó.` };
  }

  if (respuesta.error) {
    return {
      ok: false,
      error: `No se pudo eliminar el archivo del almacenamiento: ${respuesta.error.message}. `
        + `El registro NO se eliminó, para que el archivo no quede huérfano.`,
    };
  }

  // Storage puede responder SIN error y aun así no haber borrado nada: cuando
  // una policy no deja tocar el objeto, la API devuelve la lista de lo que sí
  // borró, y ese path simplemente no aparece. Mirar solo `error` daba por
  // buena una eliminación que no ocurrió.
  if (!listaIncluye(respuesta.data, args.path)) {
    return {
      ok: false,
      error: `El almacenamiento no eliminó el archivo (no está en la lista de eliminados). `
        + `Suele ser falta de permisos sobre ese contrato. El registro NO se eliminó.`,
    };
  }

  const { error } = await deps.eliminarFila(args.id);
  if (error) {
    return {
      ok: false,
      error: `El archivo se eliminó, pero no se pudo borrar su registro: ${error.message}. `
        + `Vuelve a intentarlo: el adjunto seguirá listado hasta que se elimine el registro.`,
    };
  }
  return { ok: true };
}

export type DepsSubir = {
  /** `sb.storage.from(BUCKET).upload(path, archivo, ...)` */
  subirArchivo(path: string, archivo: unknown): Promise<{ error: ErrorSb }>;
  /** Server Action que inserta en `contrato_adjuntos`. */
  registrarFila(path: string): Promise<ResultadoOp>;
  /** `sb.storage.from(BUCKET).remove([path])`, para deshacer. */
  eliminarArchivo(paths: string[]): Promise<RespuestaRemove>;
};

/**
 * Sube el archivo y registra su fila. Si el registro falla, DESHACE la subida.
 *
 * Si además falla el deshacer, no se disimula: el mensaje dice qué archivo
 * quedó colgado y a quién pedirle que lo borre. Es información que alguien
 * necesita para limpiar; callarla convierte un problema visible en uno que solo
 * aparece auditando el bucket a mano.
 */
export async function subirYRegistrar(
  deps: DepsSubir,
  args: { path: string; archivo: unknown }
): Promise<ResultadoOp> {
  const subida = await deps.subirArchivo(args.path, args.archivo);
  if (subida.error) return { ok: false, error: subida.error.message };

  const registro = await deps.registrarFila(args.path);
  if (registro.ok) return { ok: true };

  // El archivo ya está arriba y su fila no existe: hay que deshacer.
  let limpieza: RespuestaRemove;
  try {
    limpieza = await deps.eliminarArchivo([args.path]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `${registro.error} · AVISO: el archivo quedó subido en «${args.path}» y no se pudo `
        + `deshacer (${msg}). Pídele a un administrador que lo elimine.`,
    };
  }

  const seBorro = !limpieza.error && listaIncluye(limpieza.data, args.path);
  if (seBorro) return { ok: false, error: registro.error };

  return {
    ok: false,
    error: `${registro.error} · AVISO: el archivo quedó subido en «${args.path}» y no se pudo `
      + `deshacer${limpieza.error ? ` (${limpieza.error.message})` : ""}. `
      + `Pídele a un administrador que lo elimine.`,
  };
}
