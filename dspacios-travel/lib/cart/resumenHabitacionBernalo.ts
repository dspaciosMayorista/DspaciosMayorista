// ─────────────────────────────────────────────────────────────────────────
// Resumen de habitaciones para el carrito, hoteles `modelo_tarifario =
// "unidad"` — antes `resumenHabitacionesBernalo` (`CartDrawer.tsx`) solo
// mostraba "Doble (2 adt)": nunca los menores, porque el ítem del carrito
// nunca transportó su clasificación. Ahora, cuando el ítem trae
// `composicionHabitaciones` (saneada, AUTORITATIVA — ver
// `lib/reservar/composicionHabitacionBernalo.ts`), el resumen muestra
// "Doble (2 adt + 1 chd)"/"Doble (2 adt + 1 inf)".
//
// La clasificación CHD/INF viene ÍNTEGRA de esa composición — nunca se
// deriva acá de una edad fija: este módulo NO conoce edades, solo cuenta lo
// que la composición ya trae.
//
// Compatibilidad: ítems agregados al carrito ANTES de esta ronda (ya en
// `localStorage`) no traen `composicionHabitaciones` — para esa habitación
// (o para el ítem completo, si falta del todo) se sigue mostrando
// "(N adt)" exactamente como antes, sin romper.
//
// Módulo PURO (sin "use client"/"use react"): se importa directo desde
// `node --test` y desde `app/tarifario/CartDrawer.tsx`.
// ─────────────────────────────────────────────────────────────────────────

import { ACOM_ROOM_LABEL, type AcomRoom } from "../acomodaciones.ts";

export type HabitacionResumenBernalo = { id: string; acom: string; adultos: number };
export type ComposicionResumenBernalo = { habitacionId: string; adultos: number; ninos: number; infantes: number };

/** "2 adt", "2 adt + 1 chd", "2 adt + 1 chd + 1 inf" — según lo que la
 * composición saneada de ESTA habitación traiga. Sin composición (`undefined`,
 * ítem legacy o habitación sin match), cae al conteo de adultos plano — el
 * comportamiento de siempre. */
export function formatearComposicionHabitacionBernalo(
  composicion: ComposicionResumenBernalo | undefined,
  adultosFallback: number
): string {
  if (!composicion) return `${adultosFallback} adt`;
  const partes = [`${composicion.adultos} adt`];
  if (composicion.ninos > 0) partes.push(`${composicion.ninos} chd`);
  if (composicion.infantes > 0) partes.push(`${composicion.infantes} inf`);
  return partes.join(" + ");
}

/** Resumen completo, una entrada por habitación: "Doble (2 adt + 1 chd) ·
 * Triple (3 adt)". El emparejamiento con la composición es por
 * `habitacionId === id` — nunca posicional (una habitación sin match en la
 * composición usa su propio fallback, no la de otra). */
export function resumenHabitacionesBernalo(
  habitaciones: readonly HabitacionResumenBernalo[],
  composicionHabitaciones?: readonly ComposicionResumenBernalo[]
): string {
  const composicionPorId = new Map((composicionHabitaciones ?? []).map((c) => [c.habitacionId, c]));
  return habitaciones
    .map((h) => `${ACOM_ROOM_LABEL[h.acom as AcomRoom] ?? h.acom} (${formatearComposicionHabitacionBernalo(composicionPorId.get(h.id), h.adultos)})`)
    .join(" · ");
}
