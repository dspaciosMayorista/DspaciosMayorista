// Qué es un "receptivo" en el catálogo de servicios, y cuántos tiene cada
// destino.
//
// `servicios_adicionales.categoria` es texto libre (migración 029: valores
// sugeridos tour_traslado | asistencia | otro). La clasificación autoritativa
// ya existe en `tipoProveedorCxpServicio` (lib/reservar/serviciosPaquete.ts):
// es la que decide que la CxP de un servicio sea de tipo "receptivo". Aquí se
// DERIVA de esa función en vez de repetir el literal, para que el conteo de
// receptivos por destino no pueda divergir de cómo se clasifica al reservar.
import { tipoProveedorCxpServicio, type CategoriaServicio } from "../reservar/serviciosPaquete.ts";
import { ejecutarConsultaPaginada } from "../tarifario/paginacion.ts";

const CATEGORIAS_SERVICIO: readonly CategoriaServicio[] = ["asistencia", "tour_traslado", "otro"];

/** Valores de `servicios_adicionales.categoria` que cuentan como receptivo. */
export const CATEGORIAS_RECEPTIVO: readonly CategoriaServicio[] = CATEGORIAS_SERVICIO.filter(
  (c) => tipoProveedorCxpServicio(c) === "receptivo"
);

const filaValida = (f: unknown): boolean => {
  const d = (f as { destino_id?: unknown } | null)?.destino_id;
  return typeof d === "number" && Number.isInteger(d);
};

/**
 * Cuenta receptivos por destino a partir de las filas `{ destino_id }` de
 * TODOS los receptivos con destino. Cada destino de `destinoIds` arranca en 0
 * — un 0 aquí es un dato verificado, porque se recibió el conjunto completo.
 * Cualquier forma inesperada (no es arreglo, fila sin `destino_id` entero)
 * devuelve `null` (conteo desconocido): nunca se convierte en 0.
 * Filas de un destino que no está en `destinoIds` se ignoran.
 */
export function contarReceptivosPorDestino(filas: unknown, destinoIds: readonly number[]): Record<number, number> | null {
  if (!Array.isArray(filas)) return null;
  const conteo: Record<number, number> = {};
  for (const id of destinoIds) conteo[id] = 0;
  for (const f of filas) {
    if (!filaValida(f)) return null;
    const d = (f as { destino_id: number }).destino_id;
    if (d in conteo) conteo[d] += 1;
  }
  return conteo;
}

export type PedirPaginaReceptivos = (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>;

/**
 * Carga las filas `{ destino_id }` de TODOS los receptivos con destino. Sin
 * funciones de agregado de PostgREST (deshabilitadas por defecto —
 * `db-aggregates-enabled` — y este repo no las habilita): se piden SOLO los
 * `destino_id`, paginados con `ejecutarConsultaPaginada` (inmune al "Max
 * rows" del proyecto, que truncaría en silencio).
 *
 * Falla CERRADO en este uso. El paginador compartido trata `data: null` sin
 * error como "página final válida" (correcto para sus otros llamadores, que
 * no se tocan); aquí eso convertiría una respuesta rota en un falso "0
 * receptivos". Por eso cada página se valida ANTES de entregarla al
 * paginador y cualquier anomalía se le entrega como error: respuesta
 * ausente, `data` que no es arreglo (incluido `null`), más filas de las
 * pedidas, una fila sin `destino_id` entero, o una excepción al pedirla —
 * también después de páginas válidas. Solo una página vacía `[]` sin error
 * cierra la carga. Nunca lanza: devuelve `ok: false` con el error real.
 */
export async function cargarFilasReceptivos(
  pedirPagina: PedirPaginaReceptivos
): Promise<{ ok: true; filas: unknown[] } | { ok: false; error: unknown }> {
  const paginaValidada = async (desde: number, hasta: number): Promise<{ data: unknown[] | null; error: unknown }> => {
    const resp = (await pedirPagina(desde, hasta)) as { data?: unknown; error?: unknown } | null | undefined;
    if (!resp || typeof resp !== "object") return { data: null, error: new Error(`página ${desde}-${hasta}: respuesta ausente`) };
    if (resp.error) return { data: null, error: resp.error };
    if (!Array.isArray(resp.data)) {
      return { data: null, error: new Error(`página ${desde}-${hasta}: data no es un arreglo (${resp.data === null ? "null" : typeof resp.data})`) };
    }
    if (resp.data.length > hasta - desde + 1) {
      return { data: null, error: new Error(`página ${desde}-${hasta}: ${resp.data.length} filas, más de las pedidas`) };
    }
    if (!resp.data.every(filaValida)) return { data: null, error: new Error(`página ${desde}-${hasta}: fila sin destino_id entero`) };
    return { data: resp.data, error: null };
  };
  try {
    const r = await ejecutarConsultaPaginada<unknown>(paginaValidada);
    if (r.error) return { ok: false, error: r.error };
    if (!Array.isArray(r.data)) return { ok: false, error: new Error("resultado paginado sin filas") };
    return { ok: true, filas: r.data };
  } catch (error) {
    return { ok: false, error };
  }
}

export type EstadoReceptivos =
  | { estado: "ok"; filas: unknown[] }
  /** El rol no lee `servicios_adicionales` (RLS devolvería vacío SIN error): no se consulta. */
  | { estado: "sin_permiso" }
  | { estado: "error_rol"; error: unknown }
  | { estado: "error_consulta"; error: unknown };

/**
 * Resuelve PRIMERO el rol y solo si puede leer `servicios_adicionales`
 * inicia la carga paginada. `puedeLeer` lo inyecta el llamador (la página usa
 * `puedeEscribir("producto", rol)`, el mismo set que la policy
 * "servicios_adicionales: interno" — verificado contra las migraciones en
 * pruebas/usoDestino.test.ts). Rol nulo (sin rol o usuario inactivo) =
 * sin permiso. Error o excepción al obtener el rol = `error_rol`, sin
 * consultar. Nunca lanza.
 */
export async function cargarReceptivosSegunRol(opts: {
  obtenerRol: () => PromiseLike<{ data: unknown; error: unknown }>;
  puedeLeer: (rol: string | null) => boolean;
  pedirPagina: PedirPaginaReceptivos;
}): Promise<EstadoReceptivos> {
  let rol: string | null;
  try {
    const r = await opts.obtenerRol();
    if (!r || r.error) return { estado: "error_rol", error: r?.error ?? new Error("respuesta de rol ausente") };
    rol = typeof r.data === "string" ? r.data : null;
  } catch (error) {
    return { estado: "error_rol", error };
  }
  if (!opts.puedeLeer(rol)) return { estado: "sin_permiso" };
  const f = await cargarFilasReceptivos(opts.pedirPagina);
  return f.ok ? { estado: "ok", filas: f.filas } : { estado: "error_consulta", error: f.error };
}
