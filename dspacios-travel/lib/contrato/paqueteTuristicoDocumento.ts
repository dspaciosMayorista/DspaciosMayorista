// Ítem único «Paquete Turístico …» de una cotización normal con servicio manual (Valores y Pagos).
// Módulo PURO: solo presentación. Nunca cambia importes; la edición del texto no toca ningún valor.

const MAX_TITULO = 200;
const MIN_TITULO = 3;
/** Marca de una línea de servicio manual (vuelo u otro): descripcionCotizacionManual termina siempre así. */
export const MARCA_SERVICIO_MANUAL = "sujeto a confirmación de disponibilidad y tarifa";

const DIA_MS = 86_400_000;
const esFecha = (f: string | null | undefined): f is string => typeof f === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(f);

/** «Paquete Turístico CARTAGENA 4 días/3 noches». Sin fechas válidas (o regreso anterior a la ida) se omite la duración; nunca se inventa. */
export function tituloPaqueteTuristico(destino: string | null | undefined, ida: string | null | undefined, regreso: string | null | undefined): string {
  const d = (destino ?? "").replace(/\s+/g, " ").trim();
  const base = `Paquete Turístico${d ? ` ${d}` : ""}`;
  if (!esFecha(ida) || !esFecha(regreso)) return base;
  const noches = Math.round((Date.parse(`${regreso}T00:00:00Z`) - Date.parse(`${ida}T00:00:00Z`)) / DIA_MS);
  if (!Number.isFinite(noches) || noches < 1) return base;
  return `${base} ${noches + 1} días/${noches} ${noches === 1 ? "noche" : "noches"}`;
}

/** Texto editado por el asesor: entre 3 y 200 caracteres, sin caracteres de control. null = no hay edición válida (se usa la propuesta). */
export function tituloPaqueteEditado(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < MIN_TITULO || t.length > MAX_TITULO) return null;
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(t) ? null : t;
}

/** ¿Algún ítem es un servicio manual (vuelo o de otra clase)? Activa el ítem único del paquete. */
export function hayServicioManual(items: readonly { descripcion: string | null }[]): boolean {
  return items.some((i) => typeof i.descripcion === "string" && i.descripcion.includes(MARCA_SERVICIO_MANUAL));
}
