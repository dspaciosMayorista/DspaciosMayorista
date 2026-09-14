// ─────────────────────────────────────────────────────────────────────────
// Resuelve la CAPACIDAD autoritativa (`minPax`/`maxPax`) y las reglas de
// edad de la tarifa unidad PUBLICADA aplicable a una combinación
// hotel×categoría×alimentación×fechas — la misma fuente que usa
// `computarReservaBernalo` para cotizar, nunca `hotel_acomodaciones` ni un
// valor derivado del nombre de la acomodación (Doble/Triple/…).
//
// Reutiliza TAL CUAL los resolvers PUROS de Fase 3B/3C
// (`resolverTemporadaEstadia`, `seleccionarTarifaAlojamientoPublicada`) —
// las MISMAS funciones que `orquestarCotizacionAlojamientoBernalo` llama
// dentro de `computarReservaBernalo`. No se reimplementa ninguna regla de
// selección de temporada/tarifa: si esas reglas cambian, cambian en un solo
// lugar y este módulo las hereda automáticamente. El propósito de volver a
// resolverlas ACÁ (antes de llamar a `computarReservaBernalo`) es exponer la
// `capacidad`/`reglaMenores` de la tarifa aplicable para que
// `lib/tarifario/distribucionOcupacionUnidad.ts` pueda repartir la ocupación
// entre habitaciones físicas SIN inventar una capacidad — nunca para
// duplicar el cálculo de precio ni para tomar una decisión de negocio
// distinta a la que tomará el motor real.
//
// Módulo PURO (sin "use client"/"use server", sin I/O propio): las filas de
// `hotel_temporadas`/`hotel_tarifas_unidad` llegan YA LEÍDAS — mismo
// contrato que `orquestarCotizacionAlojamientoBernalo`. Imports relativos
// con extensión `.ts` para poder correr bajo `node --test` sin bundler.
// ─────────────────────────────────────────────────────────────────────────

import { toTemporadaRango } from "../calc/paquetes.ts";
import { resolverTemporadaEstadia } from "../calc/resolverTemporadaEstadia.ts";
import { seleccionarTarifaAlojamientoPublicada, type CriterioResolucionTarifa } from "../calc/resolverTarifaAlojamiento.ts";
import type { CapacidadUnidad, ReglaMenores } from "../calc/unidadAlojamiento.ts";

export type ResolucionCapacidadTarifaUnidad =
  | { ok: true; capacidad: CapacidadUnidad; reglaMenores: ReglaMenores }
  | { ok: false; motivo: string };

/**
 * Resuelve la temporada de la estadía y, sobre ella, la ÚNICA tarifa unidad
 * publicada para `categoria`/`alimentacion` — devuelve su `capacidad`
 * (`minPax`/`maxPax`/`paxIncluidos`) y `reglaMenores`. `ok:false` cubre
 * cualquier motivo por el que no hay una tarifa aplicable con fundamento
 * (temporada no resuelta, blackout, tarifa no encontrada/ambigua/inválida) —
 * el llamador NO debe tratar esto como "sin disponibilidad": simplemente no
 * hay capacidad conocida de antemano, y la decisión final la toma
 * `computarReservaBernalo` con su propio código de bloqueo.
 */
export function resolverCapacidadTarifaUnidad(input: {
  hotelId: number;
  temporadasRaw: unknown[];
  filasTarifas: unknown[];
  categoria: string;
  alimentacion: string;
  fechaIda: string;
  fechaRegreso: string;
  hoy: string;
}): ResolucionCapacidadTarifaUnidad {
  const temporadas = input.temporadasRaw.map((t) => toTemporadaRango(t as Parameters<typeof toTemporadaRango>[0]));
  const resolucionTemporada = resolverTemporadaEstadia(temporadas, input.fechaIda, input.fechaRegreso, input.hoy);
  if (!resolucionTemporada.ok) {
    return { ok: false, motivo: `temporada_${resolucionTemporada.codigo}` };
  }

  const criterio: CriterioResolucionTarifa = {
    hotelId: input.hotelId,
    temporada: resolucionTemporada.temporada,
    categoria: input.categoria,
    alimentacion: input.alimentacion,
  };
  const resolucionTarifa = seleccionarTarifaAlojamientoPublicada(input.filasTarifas, criterio);
  if (!resolucionTarifa.ok) {
    return { ok: false, motivo: `tarifa_${resolucionTarifa.codigo}` };
  }

  return { ok: true, capacidad: resolucionTarifa.tarifa.capacidad, reglaMenores: resolucionTarifa.tarifa.reglaMenores };
}
