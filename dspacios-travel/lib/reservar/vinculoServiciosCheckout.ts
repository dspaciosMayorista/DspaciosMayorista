// ─────────────────────────────────────────────────────────────────────────
// Checkout: vínculo hotel ↔ servicios adicionales elegidos en su tarjeta.
//
// El carrito marca cada servicio elegido desde la tarjeta de un hotel con el
// `id` del ítem de ese hotel (`hotelItemId`, ver lib/cart/vinculoServicios.ts).
// En el servidor ese vínculo es una DECLARACIÓN del navegador, así que:
//   · `validarVinculosCarrito` (frontera) solo lo acepta si apunta a un hotel
//     que viene en la MISMA solicitud, del MISMO paquete que el servicio, sin
//     servicios repetidos para ese hotel e ids bien formados;
//   · durante la cotización, el servicio se compara contra lo que el SERVIDOR
//     resolvió para su hotel (fechas y pasajeros autoritativos —
//     `validarServicioContraHotel`), nunca contra lo que dijo el carrito;
//   · un conjunto se cotiza COMPLETO o no se cotiza: si el hotel o cualquiera
//     de sus servicios no puede incluirse (disponibilidad, moneda u otro
//     motivo), la solicitud falla con un mensaje claro para corregir el
//     carrito — nunca una cotización parcial del conjunto.
// Los tours SIN vínculo (pestaña Receptivos) siguen el comportamiento de
// siempre (se excluyen y se avisan, la cotización sigue).
//
// Módulo PURO (sin "use server", sin Supabase): se prueba con `node --test`.
// ─────────────────────────────────────────────────────────────────────────

/** Ids de ítem del carrito: los genera el propio carrito (`${Date.now()}-xxxx`). */
const ID_ITEM = /^[A-Za-z0-9_.:-]{1,100}$/;

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Para cada tour, el índice (en `items`) del hotel al que pertenece, o
 * `null` si es un tour independiente. */
export type VinculosCarrito = { hotelDeTour: (number | null)[] };

export function validarVinculosCarrito(input: {
  itemsRaw: readonly unknown[];
  toursRaw: readonly unknown[];
  items: readonly { paqueteId: number; hotelNombre: string }[];
  tours: readonly { servicioId: number; paqueteId: number }[];
}): { ok: true; vinculos: VinculosCarrito } | { ok: false; error: string } {
  const idPorItem: (string | null)[] = [];
  const vistos = new Set<string>();
  for (let i = 0; i < input.itemsRaw.length; i++) {
    const raw = esObjeto(input.itemsRaw[i]) ? (input.itemsRaw[i] as Record<string, unknown>).itemId : undefined;
    if (raw === undefined || raw === null) { idPorItem.push(null); continue; }
    if (typeof raw !== "string" || !ID_ITEM.test(raw)) return { ok: false, error: `El hotel ${i + 1} del carrito tiene un identificador inválido.` };
    if (vistos.has(raw)) return { ok: false, error: "El carrito tiene dos hoteles con el mismo identificador. Vacía el carrito y vuelve a agregarlos." };
    vistos.add(raw);
    idPorItem.push(raw);
  }

  const hotelDeTour: (number | null)[] = [];
  const serviciosPorHotel = new Map<number, Set<number>>();
  for (let j = 0; j < input.toursRaw.length; j++) {
    const ctx = `El servicio ${j + 1} del carrito`;
    const raw = esObjeto(input.toursRaw[j]) ? (input.toursRaw[j] as Record<string, unknown>).hotelItemId : undefined;
    if (raw === undefined || raw === null) { hotelDeTour.push(null); continue; }
    if (typeof raw !== "string" || !ID_ITEM.test(raw)) return { ok: false, error: `${ctx} tiene un vínculo de hotel inválido.` };
    const i = idPorItem.indexOf(raw);
    if (i === -1) {
      return { ok: false, error: `${ctx} pertenece a un hotel que ya no está en la solicitud. Quítalo del carrito o vuelve a agregarlo desde la tarjeta del hotel.` };
    }
    const tour = input.tours[j];
    const hotel = input.items[i];
    if (tour.paqueteId !== hotel.paqueteId) {
      return { ok: false, error: `${ctx} no pertenece al paquete de «${hotel.hotelNombre}». Quítalo y vuelve a elegirlo desde la tarjeta del hotel.` };
    }
    const ya = serviciosPorHotel.get(i) ?? new Set<number>();
    if (ya.has(tour.servicioId)) return { ok: false, error: `${ctx} está repetido para «${hotel.hotelNombre}». Quita el duplicado del carrito.` };
    ya.add(tour.servicioId);
    serviciosPorHotel.set(i, ya);
    hotelDeTour.push(i);
  }
  return { ok: true, vinculos: { hotelDeTour } };
}

/** Lo que el SERVIDOR resolvió para un hotel con servicios vinculados. */
export type HotelResueltoCheckout = {
  nombre: string;
  fechaIda: string | null;
  fechaRegreso: string | null;
  /** TODOS los viajeros del hotel según la re-liquidación del servidor,
   * infantes incluidos (`computarReserva.totalPax` / `computarReservaBernalo.paxTotal`)
   * — misma base con la que el motor de reservas liquida los servicios del
   * paquete (`precioServicio(..., totalPax)` en lib/reservar/computo.ts). */
  pax: number;
  moneda: string;
};

/** Un servicio vinculado vale EXACTAMENTE para las fechas confirmadas de su
 * hotel y para TODOS sus viajeros (ni más ni menos: un servicio cotizado para
 * 1 pax no puede acompañar a un hotel de 4). `null` = compatible. */
export function validarServicioContraHotel(
  tour: { fechaIda: string; fechaRegreso: string; pax: number },
  hotel: HotelResueltoCheckout,
): string | null {
  if (!hotel.fechaIda || !hotel.fechaRegreso || tour.fechaIda !== hotel.fechaIda || tour.fechaRegreso !== hotel.fechaRegreso) {
    return "sus fechas no coinciden con las confirmadas para el hotel";
  }
  if (tour.pax !== hotel.pax) {
    return `debe cotizarse para los ${hotel.pax} viajeros del hotel (infantes incluidos) y la solicitud trae ${tour.pax}`;
  }
  return null;
}

const CORREGIR = "Quita ese servicio (o el hotel con sus servicios) del carrito y vuelve a intentarlo.";

/** El hotel no puede incluirse y tiene servicios vinculados. */
export function errorHotelConServicios(hotelNombre: string, motivo: string): string {
  return `No se pudo cotizar «${hotelNombre}» con sus servicios adicionales: ${motivo}. `
    + "Quita el hotel (sus servicios se quitan con él) o corrige el carrito y vuelve a intentarlo.";
}

/** Un servicio vinculado no puede incluirse: el conjunto completo falla. */
export function errorServicioVinculado(hotelNombre: string, servicio: string, motivo: string): string {
  return `No se pudo cotizar «${hotelNombre}» con sus servicios adicionales: el servicio ${servicio} ${motivo}. ${CORREGIR}`;
}

/** Vínculo de un tour GUARDADO en `cotizaciones.payload` con su hotel.
 * `hotelRef` es el `ref` que el servidor asignó al hotel al crear la
 * cotización (`item-<posición>`, también en `payload.items[].ref`) — nunca el
 * id de localStorage. Las cotizaciones anteriores a este cambio no traen
 * `hotelRef`: sus tours se leen como independientes, igual que siempre. */
export function vinculoTourCotizacion(
  tour: { hotelRef?: unknown },
  items: readonly { ref?: unknown }[],
): { tipo: "independiente" } | { tipo: "hotel"; indice: number } | { tipo: "invalido" } {
  if (tour.hotelRef === undefined || tour.hotelRef === null) return { tipo: "independiente" };
  if (typeof tour.hotelRef !== "string") return { tipo: "invalido" };
  const coincidencias = items.reduce<number[]>((acc, it, i) => (it.ref === tour.hotelRef ? [...acc, i] : acc), []);
  return coincidencias.length === 1 ? { tipo: "hotel", indice: coincidencias[0] } : { tipo: "invalido" };
}

// ── Conversión a contrato (`convertirCotizacionCarrito`) y su vista previa
// (`ConvertirCarritoBtn`): una sola regla para ambos ─────────────────────

/** Vínculo de CADA tour de una cotización guardada con su hotel (índice en
 * `payload.items`), validado: el `hotelRef` debe apuntar a un único ítem y,
 * si ambos traen paquete, ser del mismo paquete. Sin `hotelRef` (cotización
 * anterior o tour de Receptivos) → `null`, independiente como siempre. Un
 * vínculo inválido NUNCA se adivina: la conversión se rechaza. */
export function resolverVinculosCotizacion(
  tours: readonly { nombre?: string | null; paqueteId?: unknown; hotelRef?: unknown }[],
  items: readonly { ref?: unknown; paqueteId?: unknown; hotelNombre?: string | null }[],
): { ok: true; hotelDeTour: (number | null)[] } | { ok: false; error: string } {
  const hotelDeTour: (number | null)[] = [];
  for (const t of tours) {
    const v = vinculoTourCotizacion(t, items);
    const nombre = t.nombre?.trim() || "Servicio";
    if (v.tipo === "independiente") { hotelDeTour.push(null); continue; }
    if (v.tipo === "invalido") {
      return { ok: false, error: `«${nombre}» está vinculado a un hotel que no se encuentra en esta cotización. No se puede convertir con un vínculo inválido: genera una cotización nueva desde el carrito.` };
    }
    const hotel = items[v.indice];
    if (typeof t.paqueteId === "number" && typeof hotel.paqueteId === "number" && t.paqueteId !== hotel.paqueteId) {
      return { ok: false, error: `«${nombre}» no pertenece al paquete de «${hotel.hotelNombre ?? "su hotel"}». No se puede convertir con un vínculo inválido: genera una cotización nueva desde el carrito.` };
    }
    hotelDeTour.push(v.indice);
  }
  return { ok: true, hotelDeTour };
}

/** Grupos (= contratos) de unidades de la conversión: índices de ítems
 * primero (`0..nItems-1`) y luego de tours (`nItems + j`).
 *   · "todo": un solo grupo con todo.
 *   · "por_destino": hoteles y tours independientes por su texto de destino
 *     (igual que siempre); un tour VINCULADO va SIEMPRE al grupo de su hotel,
 *     aunque su texto de destino sea distinto o falte — nunca a otro contrato.
 * Sin vínculos, el resultado es idéntico a la agrupación anterior. */
export function agruparUnidadesCarrito(input: {
  modo: "todo" | "por_destino";
  destinosItems: readonly (string | null)[];
  destinosTours: readonly (string | null)[];
  hotelDeTour: readonly (number | null)[];
}): { destino: string | null; unidades: number[] }[] {
  const nItems = input.destinosItems.length;
  const total = nItems + input.destinosTours.length;
  if (input.modo === "todo") return [{ destino: null, unidades: Array.from({ length: total }, (_, i) => i) }];
  const grupos = new Map<string, number[]>();
  const claveItem: string[] = [];
  const agregar = (k: string, u: number) => grupos.set(k, [...(grupos.get(k) ?? []), u]);
  input.destinosItems.forEach((d, i) => { const k = d ?? "—"; claveItem.push(k); agregar(k, i); });
  input.destinosTours.forEach((d, j) => {
    const h = input.hotelDeTour[j];
    agregar(h != null && h >= 0 && h < nItems ? claveItem[h] : (d ?? "—"), nItems + j);
  });
  return [...grupos.entries()].map(([k, unidades]) => ({ destino: k === "—" ? null : k, unidades }));
}

/** Arma los grupos con los objetos reales (lo que usa la conversión). */
export function armarGruposConversion<I, T>(input: {
  modo: "todo" | "por_destino";
  items: readonly (I & { destino?: string | null })[];
  tours: readonly (T & { destino?: string | null })[];
  hotelDeTour: readonly (number | null)[];
}): { destino: string | null; items: I[]; tours: T[] }[] {
  const nItems = input.items.length;
  return agruparUnidadesCarrito({
    modo: input.modo,
    destinosItems: input.items.map((it) => it.destino ?? null),
    destinosTours: input.tours.map((t) => t.destino ?? null),
    hotelDeTour: input.hotelDeTour,
  }).map((g) => ({
    destino: g.destino,
    items: g.unidades.filter((u) => u < nItems).map((u) => input.items[u]),
    tours: g.unidades.filter((u) => u >= nItems).map((u) => input.tours[u - nItems]),
  }));
}

/** Los pasajeros asignados a un servicio vinculado deben viajar en SU hotel
 * (subconjunto de las posiciones asignadas al hotel), no solo coincidir en
 * cantidad. `null` = válido. */
export function validarPasajerosServiciosVinculados(input: {
  asignacionesItems: readonly (readonly number[])[];
  asignacionesTours: readonly (readonly number[])[];
  hotelDeTour: readonly (number | null)[];
  nombresItems: readonly string[];
  nombresTours: readonly string[];
}): string | null {
  for (let j = 0; j < input.asignacionesTours.length; j++) {
    const h = input.hotelDeTour[j];
    if (h == null) continue;
    const delHotel = new Set(input.asignacionesItems[h] ?? []);
    const ajeno = (input.asignacionesTours[j] ?? []).find((p) => !delHotel.has(p));
    if (ajeno !== undefined) {
      return `${input.nombresTours[j] || "Servicio"}: el pasajero ${ajeno} no viaja en «${input.nombresItems[h] || "su hotel"}». Un servicio del hotel solo puede asignarse a pasajeros de ese hotel.`;
    }
  }
  return null;
}
