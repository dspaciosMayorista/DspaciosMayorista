import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { FilaTarifario } from "@/app/tarifario/TarifarioPublic";

// Motor de CONSULTA PAGINADA de `tarifario_resultado` — reemplaza, para las
// 3 rutas de tarifario, el patrón anterior de "traer TODO el catálogo y
// filtrar/paginar en el navegador" (medido en preview: 17.197 filas, 18
// consultas, ~11,1 MB — Next rechazó cachearlo por superar el límite de 2 MB
// del Data Cache, así que además de lento cada navegación repetía el
// trabajo completo). Ahora cada página se filtra y recorta EN LA BASE DE
// DATOS antes de salir — nunca se descarga el catálogo completo para
// esconder filas en el cliente.
//
// `parsearFiltrosTarifario` es la FRONTERA: recibe `unknown` (searchParams
// de URL como strings, o el body de un Server Action) y nunca confía en la
// forma/tipo de lo que llega. Todo límite (page/pageSize/longitud de texto)
// se aplica ACÁ, una sola vez, para los 3 callers.

export const PAGE_SIZE_INTERNO = 50; // /dashboard/tarifario — filas por página, tabla plana.
export const PAGE_SIZE_PUBLICO = 24; // /tarifario — primera respuesta del listado (pestaña Servicios/Programas/tabla).
export const PAGE_SIZE_BLOQUEO = 300; // /tarifario y /dashboard/reservar, pestaña "Paquetes" (bloqueo): más grande a
// propósito — el selector Origen/Destino/Salida de Vista Booking necesita ver, dentro de la página cargada, el
// universo de salidas activas para poder elegir una (si no, el selector queda vacío hasta cargar más). 300 filas
// sigue siendo ~57× más chico que las 17.197 filas del catálogo completo medidas en el incidente; si el catálogo de
// salidas activas alguna vez lo supera, "Cargar más" trae el resto — nunca se vuelve a cargar todo de una vez.
export const MAX_PAGE_SIZE = 500;
const MAX_PAGE = 100_000; // tope defensivo de "page" (nunca se espera llegar ahí; evita un range() absurdo)
const MAX_TEXTO = 80;
const MAX_FILTRO = 80;

export const MODULOS_TARIFARIO = ["bloqueo", "dinamico", "porcion_terrestre", "servicios"] as const;
export type ModuloTarifario = (typeof MODULOS_TARIFARIO)[number];
const MODULOS_VALIDOS = new Set<string>(MODULOS_TARIFARIO);

export type FiltrosTarifario = {
  page: number;
  pageSize: number;
  texto: string;
  modulo: "" | ModuloTarifario;
  destino: string;
  categoria: string;
  regimen: string;
  bloqueoId: number | null;
};

// PostgREST interpreta `,` `.` `(` `)` como sintaxis de su mini-lenguaje de
// filtros (`.or(...)`) — un texto de búsqueda que los contenga podría
// deformar el filtro armado más abajo (no es SQL injection: PostgREST
// parametriza el valor igual, pero SÍ puede cambiar QUÉ condiciones arma el
// `.or()`). Se limpian antes de usarse en cualquier filtro, nunca se pasan
// crudos.
function sanearTexto(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[,.()]/g, " ").trim().slice(0, max);
}

function enteroPositivo(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function enteroIdOpcional(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/**
 * Frontera de validación: `input` es SIEMPRE `unknown` (searchParams de URL,
 * o el body de un Server Action invocable desde el navegador con cualquier
 * payload) — nunca se confía en su forma. `pageSizeDefault`/`pageSizeMax`
 * los define cada caller según su vista (ver constantes de arriba).
 */
export function parsearFiltrosTarifario(
  input: unknown,
  pageSizeDefault: number,
  pageSizeMax: number = MAX_PAGE_SIZE
): FiltrosTarifario {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const moduloRaw = typeof o.modulo === "string" ? o.modulo : "";
  const modulo = MODULOS_VALIDOS.has(moduloRaw) ? (moduloRaw as ModuloTarifario) : "";
  return {
    page: enteroPositivo(o.page, 1, 1, MAX_PAGE),
    pageSize: enteroPositivo(o.pageSize, pageSizeDefault, 1, pageSizeMax),
    texto: sanearTexto(o.texto, MAX_TEXTO),
    modulo,
    destino: sanearTexto(o.destino, MAX_FILTRO),
    categoria: sanearTexto(o.categoria, MAX_FILTRO),
    regimen: sanearTexto(o.regimen, MAX_FILTRO),
    bloqueoId: enteroIdOpcional(o.bloqueoId),
  };
}

export type ResultadoPaginaTarifario<T> =
  | { ok: true; filas: T[]; total: number }
  | { ok: false; error: unknown };

/**
 * UNA sola consulta acotada (`.range()` + `count: "exact"`) a
 * `tarifario_resultado` — reemplaza el bucle "traer TODO paginando de a
 * 1000" de `cargarFilasTarifarioPaginado()` (lib/tarifario/paginacion.ts,
 * que se conserva tal cual para quien de verdad necesite el catálogo
 * completo — hoy nadie en producción). Todos los filtros se aplican en el
 * WHERE de la consulta, ANTES de `.range()` — nunca se pagina primero y se
 * filtra después en memoria. Usa el cliente `sb` normal (con RLS), igual
 * que el bucle original — nunca `service_role` para esto: los filtros del
 * cliente nunca ganan autorización extra, solo acotan filas que la RLS ya
 * deja ver.
 */
export async function buscarFilasTarifarioPagina<T>(
  sb: SupabaseClient<Database>,
  columnas: string,
  filtros: FiltrosTarifario
): Promise<ResultadoPaginaTarifario<T>> {
  let q = sb
    .from("tarifario_resultado")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select(columnas as any, { count: "exact" })
    .eq("paquete_activo", true);
  if (filtros.texto) {
    const t = filtros.texto.replace(/[%_]/g, "");
    if (t) q = q.or(`hotel_nombre.ilike.%${t}%,paquete_nombre.ilike.%${t}%,servicio_nombre.ilike.%${t}%`);
  }
  if (filtros.modulo) q = q.eq("modulo", filtros.modulo);
  if (filtros.destino) q = q.eq("destino_nombre", filtros.destino);
  if (filtros.categoria) q = q.eq("categoria", filtros.categoria);
  if (filtros.regimen) q = q.eq("regimen", filtros.regimen);
  if (filtros.bloqueoId != null) q = q.eq("bloqueo_id", filtros.bloqueoId);
  q = q.order("destino_nombre").order("bloqueo_label").order("hotel_nombre").order("categoria").order("regimen");
  const from = (filtros.page - 1) * filtros.pageSize;
  const { data, error, count } = await q.range(from, from + filtros.pageSize - 1);
  if (error) return { ok: false, error };
  return { ok: true, filas: (data ?? []) as unknown as T[], total: count ?? 0 };
}

// Columnas livianas para `/dashboard/tarifario` (tabla de referencia interna,
// solo lectura) — sin las columnas que Vista Booking necesita para
// reservar/cotizar (equipaje, descripción, recargo individual, etc.).
export const COLUMNAS_LIVIANAS =
  "modulo, bloqueo_label, bloqueo_id, paquete_id, hotel_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, fecha_ida, fecha_regreso, noches, destino_nombre, paquete_nombre, hotel_nombre, categoria, regimen, acomodacion, precio_pvp, moneda";

export type ResultadoPaginaLiviana =
  | { ok: true; filas: FilaTarifario[]; total: number; page: number; pageSize: number }
  | { ok: false; error: unknown };

/**
 * `/dashboard/tarifario`: página plana de `tarifario_resultado`, sin
 * enriquecimiento de Vista Booking (fotos/cupos/capacidades) — esa vista es
 * de solo lectura para revisar lo publicado, no para reservar.
 */
export async function buscarPaginaTarifarioLiviana(
  sb: SupabaseClient<Database>, filtrosRaw: unknown
): Promise<ResultadoPaginaLiviana> {
  // Tope explícito de pageSize = PAGE_SIZE_INTERNO (50): sin el 3er
  // argumento, `parsearFiltrosTarifario` cae al tope general
  // (`MAX_PAGE_SIZE`=500) — un cliente podría pedir hasta 500 filas en esta
  // vista de solo lectura, muy por encima de las "50 filas por página"
  // documentadas para /dashboard/tarifario.
  const filtros = parsearFiltrosTarifario(filtrosRaw, PAGE_SIZE_INTERNO, PAGE_SIZE_INTERNO);
  const res = await buscarFilasTarifarioPagina<FilaTarifario>(sb, COLUMNAS_LIVIANAS, filtros);
  if (!res.ok) return res;
  return { ok: true, filas: res.filas, total: res.total, page: filtros.page, pageSize: filtros.pageSize };
}
