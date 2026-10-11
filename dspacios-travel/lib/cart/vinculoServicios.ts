// ─────────────────────────────────────────────────────────────────────────
// Vínculo hotel ↔ servicios adicionales dentro del carrito.
//
// Un servicio elegido desde la tarjeta de un hotel es una SUBELECCIÓN de ese
// hotel: entra al carrito junto con él, en una sola actualización, y lleva
// `hotelItemId` = id del ítem de hotel. Reglas:
//   · agregar = hotel + sus servicios a la vez (nunca un servicio sin su
//     hotel, nunca dos veces el mismo servicio en el mismo conjunto);
//   · quitar un servicio deja el hotel; quitar el hotel se lleva sus
//     servicios (no quedan sueltos);
//   · al hidratar desde localStorage se descarta cualquier servicio cuyo
//     hotel ya no existe (carrito editado a mano, versión anterior, etc.).
// Los tours sin `hotelItemId` (pestaña Receptivos) siguen siendo ítems
// independientes, como siempre.
//
// Módulo PURO (sin React): se prueba directo con `node --test`.
// ─────────────────────────────────────────────────────────────────────────

type ItemBase = { id: string; tipo: string; hotelItemId?: string | null; servicioId?: number | null };

const esServicioVinculado = (i: ItemBase): boolean => i.tipo === "tour" && typeof i.hotelItemId === "string" && i.hotelItemId !== "";

/** Ids ya decididos para un conjunto: el del hotel y uno por servicio (en
 * el orden de `servicios`). Se fijan ANTES de actualizar el estado, para que
 * el actualizador sea una función pura de sus entradas. */
export type IdsConjunto = { hotel: string; servicios: readonly string[] };

/** Agrega el hotel y sus servicios en UNA sola operación. Los servicios se
 * deduplican por `servicioId` y quedan vinculados al id del hotel. PURA: con
 * las mismas entradas devuelve exactamente los mismos ítems, ids y vínculos. */
export function agregarConjunto<I extends ItemBase>(
  items: readonly I[],
  hotel: Omit<I, "id">,
  servicios: readonly Omit<I, "id" | "hotelItemId">[],
  ids: IdsConjunto,
): I[] {
  const vistos = new Set<number>();
  const vinculados: I[] = [];
  servicios.forEach((s, k) => {
    const sid = s.servicioId;
    if (typeof sid !== "number" || vistos.has(sid)) return;
    vistos.add(sid);
    vinculados.push({ ...s, id: ids.servicios[k] ?? `${ids.hotel}-s${k}`, hotelItemId: ids.hotel } as unknown as I);
  });
  return [...items, { ...hotel, id: ids.hotel } as unknown as I, ...vinculados];
}

/** Actualizador de estado para `setItems` (React puede ejecutarlo más de una
 * vez, p. ej. en modo estricto): no genera ids ni lee nada externo, así que
 * cada ejecución con el mismo `prev` produce el mismo resultado. */
export function crearActualizadorConjunto<I extends ItemBase>(
  hotel: Omit<I, "id">,
  servicios: readonly Omit<I, "id" | "hotelItemId">[],
  ids: IdsConjunto,
): (prev: readonly I[]) => I[] {
  return (prev) => agregarConjunto(prev, hotel, servicios, ids);
}

/** Quita un ítem; si es un hotel, también sus servicios vinculados. */
export function quitarConVinculos<I extends ItemBase>(items: readonly I[], id: string): I[] {
  const objetivo = items.find((i) => i.id === id);
  if (!objetivo) return [...items];
  if (objetivo.tipo === "hotel") return items.filter((i) => i.id !== id && !(esServicioVinculado(i) && i.hotelItemId === id));
  return items.filter((i) => i.id !== id);
}

/** Descarta servicios vinculados a un hotel que ya no está en el carrito. */
export function normalizarVinculos<I extends ItemBase>(items: readonly I[]): I[] {
  const hoteles = new Set(items.filter((i) => i.tipo === "hotel").map((i) => i.id));
  return items.filter((i) => !esServicioVinculado(i) || hoteles.has(i.hotelItemId as string));
}

/** Servicios vinculados a un hotel del carrito, en el orden del carrito. */
export function serviciosDeHotel<I extends ItemBase>(items: readonly I[], hotelItemId: string): I[] {
  return items.filter((i) => esServicioVinculado(i) && i.hotelItemId === hotelItemId);
}

/** Lista para pintar: cada hotel con sus servicios debajo; los tours
 * independientes (o huérfanos por cualquier motivo) quedan como filas propias. */
export function agruparCarrito<I extends ItemBase>(items: readonly I[]): { item: I; servicios: I[] }[] {
  const hoteles = new Set(items.filter((i) => i.tipo === "hotel").map((i) => i.id));
  const grupos: { item: I; servicios: I[] }[] = [];
  for (const it of items) {
    if (esServicioVinculado(it) && hoteles.has(it.hotelItemId as string)) continue;
    grupos.push({ item: it, servicios: it.tipo === "hotel" ? serviciosDeHotel(items, it.id) : [] });
  }
  return grupos;
}
