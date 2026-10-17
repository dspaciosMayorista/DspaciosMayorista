// Destino fijo de programas (migración 213) — reglas puras, sin acceso a base.
//
// La lista "Lista destino programas" es comercial y se administra a mano; es
// independiente del catálogo de ciudades/IATA (`destinos`) y de la ruta del
// circuito. Un programa sin destino fijo NO es visible en el tarifario público
// (ni su filtro, ni sus enlaces directos a ficha/PDF), pero sigue visible y
// editable en el panel interno.

export const DESTINO_FIJO_MAX = 80;

/** Texto del distintivo interno de un programa sin destino fijo. */
export const ETIQUETA_FALTA_DESTINO = "No visible: falta destino";

/**
 * Destino PROVISIONAL de despliegue: los programas existentes se asignan aquí para seguir visibles
 * mientras se crean los destinos reales. Se identifica por la marca `es_provisional` de la base
 * (migración 213), NUNCA por el nombre: este es solo el nombre sugerido al crearlo.
 */
export const NOMBRE_DESTINO_PROVISIONAL = "Por clasificar";
/** Distintivo interno de un programa asignado al provisional (visible, pendiente de clasificar). */
export const ETIQUETA_POR_CLASIFICAR = "Por clasificar: visible, falta su destino real";

export type DestinoRef = { id: number; nombre: string; es_provisional?: boolean | null };

/** ¿Es el destino provisional? Solo cuenta la marca; un nombre igual a «Por clasificar» NO basta. */
export function esDestinoProvisional(d: { es_provisional?: boolean | null } | null | undefined): boolean {
  return d?.es_provisional === true;
}

/** Normaliza el nombre escrito por el usuario: recorta y colapsa espacios internos. */
export function limpiarNombreDestinoFijo(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/**
 * Misma clave que public.clave_ciudad_ruta() (migración 212): sin mayúsculas,
 * tildes comunes ni espacios repetidos. Sirve para avisar de un duplicado antes
 * de ir a la base; la autoridad es el índice único.
 */
export function claveDestinoFijo(v: unknown): string {
  return limpiarNombreDestinoFijo(v)
    .replace(/[áéíóúüñÁÉÍÓÚÜÑ]/g, (c) => "aeiouunAEIOUUN"["áéíóúüñÁÉÍÓÚÜÑ".indexOf(c)])
    .toLowerCase();
}

export function validarNombreDestinoFijo(v: unknown): { ok: true; nombre: string } | { ok: false; error: string } {
  const nombre = limpiarNombreDestinoFijo(v);
  if (!nombre) return { ok: false, error: "Escribe el nombre del destino." };
  if (nombre.length > DESTINO_FIJO_MAX) return { ok: false, error: `Máximo ${DESTINO_FIJO_MAX} caracteres.` };
  return { ok: true, nombre };
}

export type ProgramaConDestino = {
  publicado?: boolean | null;
  activo?: boolean | null;
  destino_fijo_id?: number | null;
};

/** ¿Tiene destino fijo asignado? (0/NaN/undefined/null = no). */
export function tieneDestinoFijo(p: Pick<ProgramaConDestino, "destino_fijo_id">): boolean {
  const id = p.destino_fijo_id;
  return typeof id === "number" && Number.isFinite(id) && id > 0;
}

/**
 * ÚNICA regla de visibilidad pública de un programa: publicado Y con destino
 * fijo. (La condición `activo` la aplica por su lado el listado del tarifario.)
 * El panel interno no usa esta regla: ve todo.
 */
export function programaVisibleEnPublico(p: ProgramaConDestino): boolean {
  return p.publicado === true && tieneDestinoFijo(p);
}

/** Programas ACTIVOS sin destino fijo (lo que cuenta el aviso del panel). */
export function contarProgramasSinDestino(programas: Pick<ProgramaConDestino, "activo" | "destino_fijo_id">[]): number {
  return programas.filter((p) => p.activo !== false && !tieneDestinoFijo(p)).length;
}

export type ProgramaParaAviso = { activo?: boolean | null; destino_fijo_id?: number | null; destino_es_provisional?: boolean | null };

/** Activos con destino fijo asignado que es el PROVISIONAL: visibles en el tarifario, pendientes de clasificar. */
export function contarProgramasPorClasificar(programas: ProgramaParaAviso[]): number {
  return programas.filter((p) => p.activo !== false && tieneDestinoFijo(p) && p.destino_es_provisional === true).length;
}

/** Los dos conteos del aviso interno, SIEMPRE por separado (no se suman: uno oculta, el otro no). */
export function conteosAviso(programas: ProgramaParaAviso[]): { sinDestino: number; porClasificar: number } {
  return { sinDestino: contarProgramasSinDestino(programas), porClasificar: contarProgramasPorClasificar(programas) };
}

export function mensajePorClasificar(n: number): string {
  return n === 1
    ? "1 programa está en «Por clasificar»: es visible en el tarifario, pero falta asignarle su destino real."
    : `${n} programas están en «Por clasificar»: son visibles en el tarifario, pero falta asignarles su destino real.`;
}

export function mensajeFaltanDestinos(n: number): string {
  return n === 1
    ? "Falta 1 programa por asignar destino. No será visible en el tarifario hasta hacerlo."
    : `Faltan ${n} programas por asignar destino. No serán visibles en el tarifario hasta hacerlo.`;
}

/**
 * Destinos que ofrece el filtro público: solo los fijos asignados, sin repetidos, orden alfabético.
 * El PROVISIONAL no se ofrece (no es un destino comercial para el cliente); sus programas siguen
 * apareciendo en «Todos los destinos».
 */
export function destinosParaFiltro(programas: { destino: DestinoRef | null }[]): { id: number; nombre: string }[] {
  const porId = new Map<number, string>();
  for (const p of programas) if (p.destino && !esDestinoProvisional(p.destino)) porId.set(p.destino.id, p.destino.nombre);
  return [...porId.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}
