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
  pedirPagina: PedirPaginaReceptivos,
  // Predicado de fila: por defecto `{ destino_id }` entero (conteo). La lista
  // de nombres de un destino pasa el suyo (`filaNombreReceptivoDe`) — misma
  // validación de página, mismo fallo cerrado.
  filaEsValida: (f: unknown) => boolean = filaValida
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
    if (!resp.data.every(filaEsValida)) return { data: null, error: new Error(`página ${desde}-${hasta}: fila con forma inesperada`) };
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
  /** Predicado de fila (ver `cargarFilasReceptivos`); por defecto `{ destino_id }` entero. */
  filaValida?: (f: unknown) => boolean;
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
  const f = await cargarFilasReceptivos(opts.pedirPagina, opts.filaValida);
  return f.ok ? { estado: "ok", filas: f.filas } : { estado: "error_consulta", error: f.error };
}

/** Un receptivo tal como lo muestra la lista de un destino (sin datos de costo). */
export type ReceptivoDeDestino = { id: number; nombre: string };

/**
 * Predicado de fila para la LISTA de receptivos de UN destino: `id` entero,
 * `nombre` texto y `destino_id` EXACTAMENTE ese destino — una fila de otro
 * destino (o sin destino, p. ej. un servicio general) invalida la carga en
 * vez de colarse en la lista.
 */
export function filaNombreReceptivoDe(destinoId: number): (f: unknown) => boolean {
  return (f) => {
    const r = f as { id?: unknown; nombre?: unknown; destino_id?: unknown } | null;
    return !!r && typeof r.id === "number" && Number.isInteger(r.id) && typeof r.nombre === "string" && r.destino_id === destinoId;
  };
}

// ── Precarga limitada de nombres (apertura inmediata de listas pequeñas) ──
// La página YA recorre todas las filas de receptivos para contarlos; pidiendo
// además `id`/`nombre` en esa MISMA consulta (mismas páginas, cero viajes
// extra) las listas pequeñas se entregan ya armadas y el diálogo abre sin
// ninguna petición. Topes para no trasladar un costo desmedido a la carga
// inicial: solo destinos con hasta LIMITE_PRECARGA_POR_DESTINO receptivos, y
// como máximo LIMITE_PRECARGA_TOTAL nombres en toda la página (se priorizan
// los destinos más chicos). Lo que no entra se sigue pidiendo al abrir.
export const LIMITE_PRECARGA_POR_DESTINO = 50;
export const LIMITE_PRECARGA_TOTAL = 1000;

/** Fila de la consulta de la página: `id` y `destino_id` enteros, `nombre` texto. */
export function filaReceptivoConNombre(f: unknown): boolean {
  const r = f as { id?: unknown; nombre?: unknown; destino_id?: unknown } | null;
  return !!r && typeof r.id === "number" && Number.isInteger(r.id) && typeof r.nombre === "string" && filaValida(f);
}

export type ReceptivosAgrupados = {
  /** Conteo por destino (todos los de `destinoIds`; 0 verificado si no tiene). */
  conteos: Record<number, number>;
  /** Listas completas ya armadas, SOLO de los destinos que entraron en la precarga. */
  precargados: Record<number, ReceptivoDeDestino[]>;
};

/**
 * Agrupa las filas `{ id, nombre, destino_id }` (el conjunto COMPLETO, ya
 * paginado) por destino: conteo de todos y lista precargada de los chicos.
 * Conserva el orden de llegada (la consulta ordena por nombre, id — el mismo
 * orden que la carga bajo demanda). Cualquier fila con forma inesperada →
 * `null` (conteo y listas desconocidos, nunca 0). Filas de un destino que no
 * está en `destinoIds` se ignoran. Un destino precargado trae su lista
 * COMPLETA (nunca recortada): si no cabe, no se precarga.
 */
export function agruparReceptivosPorDestino(
  filas: unknown,
  destinoIds: readonly number[],
  limites: { porDestino: number; total: number } = { porDestino: LIMITE_PRECARGA_POR_DESTINO, total: LIMITE_PRECARGA_TOTAL }
): ReceptivosAgrupados | null {
  if (!Array.isArray(filas)) return null;
  const listas = new Map<number, ReceptivoDeDestino[]>();
  for (const id of destinoIds) listas.set(id, []);
  for (const f of filas) {
    if (!filaReceptivoConNombre(f)) return null;
    const r = f as { id: number; nombre: string; destino_id: number };
    listas.get(r.destino_id)?.push({ id: r.id, nombre: r.nombre });
  }
  const conteos: Record<number, number> = {};
  for (const [id, lista] of listas) conteos[id] = lista.length;

  const precargados: Record<number, ReceptivoDeDestino[]> = {};
  let usados = 0;
  const candidatos = [...listas]
    .filter(([, l]) => l.length > 0 && l.length <= limites.porDestino)
    .sort((a, b) => a[1].length - b[1].length || a[0] - b[0]);
  for (const [id, lista] of candidatos) {
    if (usados + lista.length > limites.total) break;
    precargados[id] = lista;
    usados += lista.length;
  }
  return { conteos, precargados };
}
