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
// LOS AGUJEROS QUE ESTO CIERRA
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
//   3. La ruta a borrar venía DEL CLIENTE. Aunque las policies de Storage la
//      filtren, aceptar del navegador el `path` que se va a borrar es pedir
//      que el día que una policy cambie el error sea de los graves. Ahora la
//      ruta se LEE de la base con el cliente autenticado (o sea, pasando por
//      RLS) y se usa exclusivamente esa.
//
// No hay transacción posible entre Storage y Postgres, así que la regla es:
// dejar el sistema en un estado del que se pueda salir, y DECIR lo que pasó.
// Un huérfano callado es peor que un error.

export type ResultadoOp = { ok: true } | { ok: false; error: string };
export type ResultadoEliminar = { ok: true; numeroContrato: string } | { ok: false; error: string };

type ErrorSb = { message: string } | null;

/** Lo que devuelve `supabase.storage.from(b).remove(paths)`. */
export type RespuestaRemove = { data: { name: string }[] | null; error: ErrorSb };

/** La fila de `contrato_adjuntos` tal como la ve el usuario que pregunta. */
export type FilaAdjunto = { path: string; numero_contrato: string };

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

const texto = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type DepsEliminar = {
  /**
   * Lee la fila con el cliente AUTENTICADO, para que la RLS decida si existe.
   * Devuelve null si no es visible.
   */
  buscarFila(id: number): Promise<{ data: FilaAdjunto | null; error: ErrorSb }>;
  /** `sb.storage.from(BUCKET).remove([path])` */
  eliminarArchivo(paths: string[]): Promise<RespuestaRemove>;
  /**
   * `delete().eq("id", id).select("id")` — con `select`, no a ciegas.
   * PostgREST responde `error: null` aunque la RLS filtre la fila y no borre
   * NADA; sin `select` no hay forma de distinguir "borrado" de "no tocado".
   */
  eliminarFila(id: number): Promise<{ data: { id: number }[] | null; error: ErrorSb }>;
};

/**
 * Borra el archivo y, SOLO si eso funcionó, la fila que lo indexa.
 *
 * Recibe únicamente el `id`. La ruta y el número de contrato se leen de la
 * base con el cliente autenticado: son los valores reales, no los que mandó el
 * navegador. Si la fila no es visible, se para ANTES de tocar Storage.
 *
 * El orden importa y es deliberado. Si se borrara primero la fila y fallara el
 * archivo, quedaría un huérfano invisible con datos personales dentro. Al
 * revés —archivo primero— lo peor que puede quedar es una fila que apunta a un
 * archivo que ya no está: se ve en la pantalla, molesta, y se puede reintentar.
 * De los dos estados intermedios posibles, se elige a propósito el que se nota.
 */
export async function eliminarArchivoYFila(
  deps: DepsEliminar,
  args: { id: number }
): Promise<ResultadoEliminar> {
  // ── 1. Qué archivo es, según la base y según la RLS ──────────────────────
  let fila: FilaAdjunto | null;
  try {
    const r = await deps.buscarFila(args.id);
    if (r.error) return { ok: false, error: `No se pudo leer el adjunto: ${r.error.message}` };
    fila = r.data;
  } catch (e) {
    return { ok: false, error: `No se pudo leer el adjunto: ${texto(e)}` };
  }
  if (!fila) {
    return { ok: false, error: "El adjunto no existe o no tienes permiso para verlo. No se tocó ningún archivo." };
  }

  // ── 2. El archivo ────────────────────────────────────────────────────────
  let respuesta: RespuestaRemove;
  try {
    respuesta = await deps.eliminarArchivo([fila.path]);
  } catch (e) {
    return { ok: false, error: `No se pudo eliminar el archivo (${texto(e)}). El registro no se eliminó.` };
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
  if (!listaIncluye(respuesta.data, fila.path)) {
    return {
      ok: false,
      error: `El almacenamiento no eliminó el archivo (no está en la lista de eliminados). `
        + `Suele ser falta de permisos sobre ese contrato. El registro NO se eliminó.`,
    };
  }

  // ── 3. La fila ───────────────────────────────────────────────────────────
  let borradas: { id: number }[] | null;
  try {
    const r = await deps.eliminarFila(args.id);
    if (r.error) {
      return {
        ok: false,
        error: `El archivo se eliminó, pero no se pudo borrar su registro: ${r.error.message}. `
          + `Vuelve a intentarlo: el adjunto seguirá listado hasta que se elimine el registro.`,
      };
    }
    borradas = r.data;
  } catch (e) {
    return {
      ok: false,
      error: `El archivo se eliminó, pero no se pudo borrar su registro (${texto(e)}). `
        + `Vuelve a intentarlo: el adjunto seguirá listado hasta que se elimine el registro.`,
    };
  }

  // Mismo patrón que en Storage: sin error pero sin filas afectadas. Con
  // PostgREST eso significa que la RLS filtró el DELETE.
  if ((borradas ?? []).length !== 1) {
    return {
      ok: false,
      error: `El archivo se eliminó, pero el registro no se borró (la base no reportó ninguna fila afectada). `
        + `El adjunto seguirá listado apuntando a un archivo que ya no existe; avísale a un administrador.`,
    };
  }

  return { ok: true, numeroContrato: fila.numero_contrato };
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
 * Sube el archivo y registra su fila. Si el registro falla —devolviendo error o
 * LANZANDO—, deshace la subida.
 *
 * Una Server Action puede lanzar (red caída, error de Next) además de devolver
 * `{ok:false}`. Si solo se contemplara el retorno, una excepción se llevaría
 * por delante el deshacer y dejaría el huérfano: justo el caso que esto
 * pretende evitar.
 *
 * Si además falla el deshacer, no se disimula: el mensaje dice qué archivo
 * quedó colgado y a quién pedirle que lo borre. Callarlo convierte un problema
 * visible en uno que solo aparece auditando el bucket a mano.
 */
export async function subirYRegistrar(
  deps: DepsSubir,
  args: { path: string; archivo: unknown }
): Promise<ResultadoOp> {
  let subida: { error: ErrorSb };
  try {
    subida = await deps.subirArchivo(args.path, args.archivo);
  } catch (e) {
    return { ok: false, error: `No se pudo subir el archivo: ${texto(e)}` };
  }
  if (subida.error) return { ok: false, error: subida.error.message };

  let motivo: string;
  try {
    const registro = await deps.registrarFila(args.path);
    if (registro.ok) return { ok: true };
    motivo = registro.error;
  } catch (e) {
    motivo = `No se pudo registrar el adjunto: ${texto(e)}`;
  }

  // El archivo ya está arriba y su fila no existe: hay que deshacer.
  let limpieza: RespuestaRemove;
  try {
    limpieza = await deps.eliminarArchivo([args.path]);
  } catch (e) {
    return { ok: false, error: avisoHuerfano(motivo, args.path, texto(e)) };
  }

  if (!limpieza.error && listaIncluye(limpieza.data, args.path)) {
    return { ok: false, error: motivo };
  }
  return { ok: false, error: avisoHuerfano(motivo, args.path, limpieza.error?.message) };
}

function avisoHuerfano(motivo: string, path: string, causa?: string): string {
  return `${motivo} · AVISO: el archivo quedó subido en «${path}» y no se pudo deshacer`
    + `${causa ? ` (${causa})` : ""}. Pídele a un administrador que lo elimine.`;
}
