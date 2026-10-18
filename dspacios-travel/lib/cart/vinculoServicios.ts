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

type ItemBase = {
  id: string; tipo: string; hotelItemId?: string | null; servicioId?: number | null;
  // Solo para las guardas de `reemplazarConjunto` (#54): un conjunto editado
  // nunca cambia de hotel, de paquete ni de modelo tarifario.
  paqueteId?: number; hotelId?: number; modeloTarifario?: string;
};

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

// ── #54: editar los servicios de un hotel que YA está en el carrito ──────
//
// La tarjeta prepara un borrador sobre el conjunto guardado y, al confirmar,
// lo sustituye en UNA sola actualización: el hotel conserva su `id` (y con él
// el `hotelItemId` de sus servicios), un servicio que se queda conserva el
// suyo, y nada más del carrito se toca (otra reserva del mismo hotel, otros
// hoteles, tours independientes). Es un compare-and-swap: la edición lleva la
// huella del conjunto sobre el que se preparó; si el carrito cambió entretanto
// (hotel quitado, un servicio quitado desde el carrito, otra edición), no se
// aplica nada y el conjunto anterior queda intacto. Nunca recrea un hotel.

/** Huella del conjunto confirmado (el ítem de hotel tal cual + sus servicios
 * vinculados, en orden). Cualquier cambio en él cambia la huella. `null` si
 * no hay un hotel con ese id en el carrito. */
export function firmaConjunto<I extends ItemBase>(items: readonly I[], hotelItemId: string): string | null {
  const hotel = items.find((i) => i.id === hotelItemId && i.tipo === "hotel");
  if (!hotel) return null;
  return JSON.stringify([hotel, ...serviciosDeHotel(items, hotelItemId)]);
}

export type MotivoRechazoConjunto =
  /** El hotel ya no está en el carrito (se quitó mientras se revalidaba). */
  | "hotel_no_encontrado"
  /** El conjunto guardado cambió desde que se preparó la edición. */
  | "conjunto_cambio"
  /** El hotel nuevo no es la misma reserva (hotel, paquete, modelo o identidad). */
  | "reserva_distinta"
  /** Un servicio sin `servicioId`, de otro paquete o que no es un tour. */
  | "servicio_invalido";

export type ResultadoReemplazoConjunto<I> =
  | { ok: true; items: I[] }
  | { ok: false; motivo: MotivoRechazoConjunto };

export type ReemplazoConjunto<I extends ItemBase> = {
  /** `id` del hotel a editar — nunca se busca por hotelId/nombre/índice. */
  hotelItemId: string;
  /** `firmaConjunto` del conjunto sobre el que se preparó la edición. */
  firmaEsperada: string;
  /** Versión nueva del hotel (sin `id`: conserva el actual). */
  hotel: Omit<I, "id">;
  /** Servicios definitivos del conjunto (vacío = retirarlos todos). */
  servicios: readonly Omit<I, "id" | "hotelItemId">[];
  /** Ids ya decididos para los servicios que no estaban, en el orden de `servicios`. */
  idsNuevos: readonly string[];
  /** Identidad completa de la reserva; si se da, la del hotel nuevo debe ser
   * igual a la del guardado (la edición nunca convierte una reserva en otra). */
  claveReserva?: (hotel: I) => string;
};

/** Sustituye hotel + servicios de UN conjunto del carrito. PURA: con el mismo
 * `items` y el mismo `cambio` devuelve exactamente lo mismo (React puede
 * ejecutar el actualizador dos veces en modo estricto). */
export function reemplazarConjunto<I extends ItemBase>(items: readonly I[], cambio: ReemplazoConjunto<I>): ResultadoReemplazoConjunto<I> {
  const actual = items.find((i) => i.id === cambio.hotelItemId && i.tipo === "hotel");
  if (!actual) return { ok: false, motivo: "hotel_no_encontrado" };
  if (firmaConjunto(items, actual.id) !== cambio.firmaEsperada) return { ok: false, motivo: "conjunto_cambio" };

  const hotel = { ...cambio.hotel, id: actual.id } as unknown as I;
  const mismaReserva = hotel.tipo === "hotel" && hotel.hotelId === actual.hotelId && hotel.paqueteId === actual.paqueteId
    && (hotel.modeloTarifario ?? null) === (actual.modeloTarifario ?? null)
    && (!cambio.claveReserva || cambio.claveReserva(hotel) === cambio.claveReserva(actual));
  if (!mismaReserva) return { ok: false, motivo: "reserva_distinta" };

  const idPrevio = new Map<number, string>();
  for (const s of serviciosDeHotel(items, actual.id)) {
    if (typeof s.servicioId === "number" && !idPrevio.has(s.servicioId)) idPrevio.set(s.servicioId, s.id);
  }
  const vistos = new Set<number>();
  const vinculados: I[] = [];
  for (const [k, s] of cambio.servicios.entries()) {
    const sid = s.servicioId;
    // Un servicio que no se puede identificar o que no es de este paquete
    // rechaza TODO el cambio — nunca se descarta en silencio.
    if (s.tipo !== "tour" || typeof sid !== "number" || s.paqueteId !== actual.paqueteId) return { ok: false, motivo: "servicio_invalido" };
    if (vistos.has(sid)) continue;
    vistos.add(sid);
    const id = idPrevio.get(sid) ?? cambio.idsNuevos[k] ?? `${actual.id}-s${sid}`;
    vinculados.push({ ...s, id, hotelItemId: actual.id } as unknown as I);
  }

  // El hotel queda en su lugar y sus servicios justo detrás; el resto, igual.
  const resultado: I[] = [];
  for (const it of items) {
    if (it.id === actual.id) resultado.push(hotel, ...vinculados);
    else if (!(esServicioVinculado(it) && it.hotelItemId === actual.id)) resultado.push(it);
  }
  return { ok: true, items: resultado };
}

/** Datos de un hotel por persona que identifican la reserva (no el precio). */
export type IdentidadReservaPersona = {
  hotelId: number; paqueteId: number; modulo: string; bloqueoId: number | null;
  categoria: string; regimen: string; fechaIda: string | null; fechaRegreso: string | null;
  habitaciones: Record<string, number>; pax: number; ninos: number; ninos2: number; infantes: number;
  edadesMenores?: readonly number[];
};

/** Clave canónica COMPLETA de una reserva por persona: misma clave ⇔ misma
 * reserva. Además de hotel/paquete/fechas/categoría/régimen distingue la
 * ocupación (habitaciones por tipo, pax, menores por clase y sus edades), así
 * que dos reservas del mismo hotel con otras habitaciones o pasajeros nunca
 * comparten la edición. Habitaciones en 0 no cuentan y el orden de las claves
 * y de las edades no importa (el modelo por persona no asocia edades a
 * habitaciones). Un ítem de una versión anterior sin `edadesMenores` y con
 * menores no coincide con ninguna búsqueda: su edad real es desconocida. */
export function claveReservaPersona(h: IdentidadReservaPersona): string {
  const habitaciones = Object.entries(h.habitaciones ?? {})
    .filter(([, n]) => Number(n) > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const menores = h.ninos + h.ninos2 + h.infantes;
  const edades = Array.isArray(h.edadesMenores) ? [...h.edadesMenores].sort((a, b) => a - b) : menores === 0 ? [] : null;
  return JSON.stringify([
    h.hotelId, h.paqueteId, h.modulo, h.bloqueoId ?? null, h.categoria, h.regimen, h.fechaIda, h.fechaRegreso,
    habitaciones, h.pax, h.ninos, h.ninos2, h.infantes, edades,
  ]);
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
