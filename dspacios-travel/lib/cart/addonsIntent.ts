// ─────────────────────────────────────────────────────────────────────────
// Construcción del "AddonsIntent" (destino/fechas/pax) que precarga
// Receptivos al pulsar "+ Agregar servicios / tours" desde el carrito
// (`app/tarifario/CartDrawer.tsx`).
//
// Causa del defecto que este módulo corrige: el carrito filtraba
// EXCLUSIVAMENTE hoteles persona (`i.modeloTarifario !== "unidad"`) para
// elegir la referencia — si el carrito solo tenía un hotel por unidad
// (`modelo_tarifario = "unidad"`, ver Fase 3F-1), `ref` quedaba `undefined`,
// se llamaba `setAddonsIntent(null)` como si no hubiera nada que hacer, y el
// drawer se cerraba sin ninguna navegación. Este módulo construye el intent
// desde AMBOS modelos:
//   · persona → usa tal cual `destino/fechaIda/fechaRegreso/pax` (ya
//     validados al construir el ítem — nunca precio ni datos financieros).
//   · unidad con `salida.tipo === "sin_vuelo"` → destino del ítem, fechas de
//     `salida.fechaIda/fechaRegreso`, y `pax` = suma de `adultos +
//     edadesMenores.length` de TODAS las habitaciones (nunca solo adultos,
//     nunca un conteo que ignore a los menores con silla).
//   · unidad con `salida.tipo === "bloqueo"/"empaquetado"` → el ítem del
//     carrito SOLO trae el `id` de esa salida, no sus fechas reales (las
//     fechas autoritativas viven en `bloqueos_vuelo`/`empaquetados`, en el
//     servidor) — construir una fecha acá sería INVENTAR un dato. Se
//     descarta este ítem como referencia (fail-closed), nunca se inventa.
//
// Identidad del paquete (fix "add-ons propios reemplazados por el catálogo
// general del destino"): el intent TAMBIÉN transporta `paqueteId` — el mismo
// paquete cuyos 14 add-ons ya se veían bien en el modal del hotel. Sin esto,
// Receptivos solo tenía destino/fechas/pax y ejecutaba una búsqueda GENERAL
// por destino (todos los paquetes), mezclando servicios de otros paquetes del
// mismo destino con los del paquete de origen. `paqueteId` llega `unknown`
// desde el ítem (persistido en `localStorage`, nunca se confía en su forma) y
// se valida como entero positivo — un ítem con `paqueteId` inválido/ausente
// se descarta COMPLETO como referencia (fail-closed, igual criterio que
// destino/fechas/pax): nunca se construye un intent sin paquete de origen
// como si fuera uno con paquete, ni se cae en silencio a alcance general.
//
// Recorre el carrito del más reciente al más antiguo y usa el PRIMER hotel
// (persona o unidad, sin preferencia por modelo) del que pueda construirse un
// intent válido — un tour existente en el carrito nunca participa como
// referencia. Si NINGÚN hotel produce un intent válido, devuelve `null`: el
// llamador (`CartDrawer`) debe mostrarlo como un error visible, nunca cerrar
// el panel ni limpiar el intent como si hubiera funcionado.
//
// Módulo PURO (sin "use client"/"use server", sin React): se importa directo
// desde `node --test` (`pruebas/addonsIntent.test.ts`) para probar la
// construcción con comportamiento REAL, no solo inspección de fuente.
// ─────────────────────────────────────────────────────────────────────────

/** Salida de un ítem unidad tal como vive en el carrito — mismo shape que
 * `SalidaSeleccionadaBernaloEntrada` (`lib/reservar/solicitudAlojamientoBernalo.ts`),
 * duplicado ESTRUCTURALMENTE (no importado) para que este módulo no dependa
 * de la cadena de imports de ese archivo. */
export type SalidaItemUnidad =
  | { tipo: "bloqueo"; id: number }
  | { tipo: "empaquetado"; id: number }
  | { tipo: "sin_vuelo"; fechaIda: string; fechaRegreso: string };

/** Una habitación tal como viaja en `HotelCartItemBernalo.habitaciones`
 * (`HabitacionOcupacionEntrada`) — `edadesMenores` llega `unknown` desde el
 * carrito (persistido en `localStorage`, nunca se confía en su forma). */
export type HabitacionItemUnidad = {
  adultos: unknown;
  edadesMenores: unknown;
};

/** Lo mínimo que necesita este módulo de un ítem de hotel PERSONA del
 * carrito — mismo subconjunto de `HotelCartItemPersona`. */
export type ItemHotelPersonaAddons = {
  tipo: "hotel";
  modeloTarifario?: undefined;
  paqueteId: unknown;
  destino: string | null;
  fechaIda: string | null;
  fechaRegreso: string | null;
  pax: unknown;
};

/** Lo mínimo que necesita este módulo de un ítem de hotel UNIDAD del
 * carrito — mismo subconjunto de `HotelCartItemBernalo`. Nunca lee
 * `precio`/`moneda` (regla: no confiar en datos financieros). */
export type ItemHotelUnidadAddons = {
  tipo: "hotel";
  modeloTarifario: "unidad";
  paqueteId: unknown;
  destino: string | null;
  salida: SalidaItemUnidad;
  habitaciones: readonly HabitacionItemUnidad[];
};

/** Cualquier otro ítem del carrito (tours) — nunca participa como referencia. */
export type ItemNoHotelAddons = { tipo: "tour" };

export type ItemCarritoAddons = ItemHotelPersonaAddons | ItemHotelUnidadAddons | ItemNoHotelAddons;

/** Intent construido — SIN `nonce` (esa identidad la agrega el llamador,
 * `CartDrawer`, una por cada clic; ver `AddonsIntent` en `CartContext.tsx`). */
export type AddonsIntentBase = {
  paqueteId: number;
  destino: string;
  fechaIda: string;
  fechaRegreso: string;
  pax: number;
};

function esEnteroPositivo(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v > 0;
}

function esTextoNoVacio(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** Suma adultos + menores CON SILLA (edadesMenores) de todas las
 * habitaciones — nunca solo adultos: un menor sí ocupa un cupo del servicio.
 * `edadesMenores` no-array o con valores no numéricos se trata como 0
 * menores en esa habitación (fail-closed, nunca lanza). */
function paxTotalHabitacionesUnidad(habitaciones: readonly HabitacionItemUnidad[]): number {
  let pax = 0;
  for (const h of habitaciones) {
    const adultos = typeof h.adultos === "number" && Number.isFinite(h.adultos) ? Math.max(0, Math.trunc(h.adultos)) : 0;
    const menores = Array.isArray(h.edadesMenores)
      ? h.edadesMenores.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).length
      : 0;
    pax += adultos + menores;
  }
  return pax;
}

/**
 * Construye el intent desde UN solo ítem del carrito, o `null` si el ítem no
 * es un hotel utilizable como referencia (no es hotel, es unidad sin fechas
 * autoritativas, o le falta destino/fechas/pax). Nunca lanza.
 */
export function construirAddonsIntentDesdeItem(item: ItemCarritoAddons): AddonsIntentBase | null {
  if (item.tipo !== "hotel") return null; // tours nunca participan como referencia

  if (item.modeloTarifario === "unidad") {
    if (!esEnteroPositivo(item.paqueteId)) return null;
    // Solo "sin_vuelo" trae fechas propias en el ítem del carrito — bloqueo/
    // empaquetado solo traen `id` (las fechas reales viven en el servidor).
    // Inventar una fecha acá sería fabricar un dato: se descarta el ítem,
    // nunca se afirma una fecha sin fuente autoritativa.
    if (item.salida.tipo !== "sin_vuelo") return null;
    const { fechaIda, fechaRegreso } = item.salida;
    if (!esTextoNoVacio(fechaIda) || !esTextoNoVacio(fechaRegreso)) return null;
    if (!esTextoNoVacio(item.destino)) return null;
    const pax = paxTotalHabitacionesUnidad(item.habitaciones);
    if (pax <= 0) return null;
    return { paqueteId: item.paqueteId, destino: item.destino, fechaIda, fechaRegreso, pax };
  }

  // Persona: los campos ya se validaron al construir el ítem (Vista Booking/
  // BuscadorBooking) — se revalida su FORMA igual, nunca se confía a ciegas
  // en lo que haya quedado persistido en `localStorage`.
  if (!esEnteroPositivo(item.paqueteId)) return null;
  if (!esTextoNoVacio(item.destino)) return null;
  if (!esTextoNoVacio(item.fechaIda) || !esTextoNoVacio(item.fechaRegreso)) return null;
  if (!esEnteroPositivo(item.pax)) return null;
  return { paqueteId: item.paqueteId, destino: item.destino, fechaIda: item.fechaIda, fechaRegreso: item.fechaRegreso, pax: item.pax };
}

/**
 * Recorre el carrito del hotel MÁS RECIENTE al más antiguo y devuelve el
 * intent del primero (persona o unidad, sin priorizar ningún modelo) del que
 * pueda construirse uno válido. `null` si ninguno lo produce — el llamador
 * debe fallar de forma visible (nunca cerrar el carrito ni limpiar el intent
 * como si hubiera funcionado).
 */
export function construirAddonsIntentDesdeCarrito(items: readonly ItemCarritoAddons[]): AddonsIntentBase | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const intent = construirAddonsIntentDesdeItem(items[i]);
    if (intent) return intent;
  }
  return null;
}
