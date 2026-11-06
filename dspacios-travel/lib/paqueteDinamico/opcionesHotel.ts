// Paquete dinámico (#82): la categoría de habitación y el plan de alimentación de un hotel del paquete son TEXTO PROPIO del paquete.
// Se elige uno conocido (catálogo general o ficha del hotel) o se escribe uno nuevo; un valor nuevo vive solo en `paquete_din_hoteles` y nunca toca
// el catálogo global ni la ficha. Funciones puras (las usan el formulario y el servidor).

export const MAX_OPCION_HOTEL = 80;

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Quita espacios sobrantes y, si coincide (sin mayúsculas ni tildes) con una opción conocida, devuelve la escritura de ésa para no duplicar variantes. */
export function normalizarOpcionHotel(valor: string | null | undefined, conocidas: readonly string[]): string {
  const v = (valor ?? "").replace(/\s+/g, " ").trim();
  if (!v) return "";
  const k = sinTildes(v);
  return conocidas.find((c) => sinTildes(c) === k) ?? v;
}

/** Opciones a ofrecer: primero las de la ficha, luego las del catálogo y las ya usadas en este paquete, sin repetir. */
export function opcionesOfrecidas(...listas: readonly (readonly string[])[]): string[] {
  const vistos = new Set<string>(); const out: string[] = [];
  for (const l of listas) for (const o of l) { const k = sinTildes(o.trim()); if (o.trim() && !vistos.has(k)) { vistos.add(k); out.push(o.trim()); } }
  return out;
}

/** Filtra por lo escrito (sin mayúsculas ni tildes). */
export function filtrarOpciones(opciones: readonly string[], q: string): string[] {
  const t = sinTildes(q.trim());
  return t ? opciones.filter((o) => sinTildes(o).includes(t)) : [...opciones];
}
