// ─────────────────────────────────────────────────────────────────────────
// Fase 3B Bernalo — frontera server-side, pequeña a propósito: consulta las
// filas de `hotel_tarifas_unidad` de UN hotel (solo las columnas que la
// selección necesita, cliente de SESIÓN — nunca `createAdminClient`) y
// delega TODA la decisión de "cuál aplica" al resolver puro
// (`lib/calc/resolverTarifaAlojamiento.ts`). Este archivo no decide nada por
// sí mismo: si mañana cambia cómo se elige la tarifa, cambia en el resolver
// puro, no aquí.
//
// Fuera de alcance (ver el informe de la tarea): no resuelve temporada, no
// cotiza, no toca `contrato_items`/CxP/UI, no levanta ninguna guardia
// existente de `computo.ts`/`generarTarifario`.
// ─────────────────────────────────────────────────────────────────────────

import type { createClient } from "@/lib/supabase/server";
import {
  seleccionarTarifaAlojamientoPublicada,
  type CriterioResolucionTarifa,
  type ResultadoResolucionTarifa,
} from "@/lib/calc/resolverTarifaAlojamiento";

// Únicamente las columnas que `seleccionarTarifaAlojamientoPublicada` y
// `adaptarTarifaAlojamientoPersistida` necesitan — nada de `created_at`/
// `updated_at`, que esta selección no usa.
const COLUMNAS_HOTEL_TARIFAS_UNIDAD =
  "id, hotel_id, tarifa_id, version_tarifario, temporada, categoria, alimentacion, estado, fuente_documento, fuente_pagina, comision_pct, payload";

export type ResultadoResolverTarifaBernalo =
  | ResultadoResolucionTarifa
  | { ok: false; codigo: "error_consulta"; mensaje: string; contexto: Record<string, unknown> };

/**
 * Consulta `hotel_tarifas_unidad` del hotel de `criterio` con el cliente de
 * SESIÓN (respeta RLS — nunca admin/service-role) y delega la selección al
 * resolver puro. El filtro `estado = "publicada"` va también en la consulta
 * SQL (menos filas viajan de la base), pero la decisión de ambigüedad/
 * coincidencia exacta la hace el resolver puro sobre los datos recibidos —
 * nunca se decide aquí a partir de la cantidad de filas que trajo Supabase.
 */
export async function resolverTarifaAlojamientoBernalo(
  sb: Awaited<ReturnType<typeof createClient>>,
  criterio: CriterioResolucionTarifa
): Promise<ResultadoResolverTarifaBernalo> {
  const { data, error } = await sb
    .from("hotel_tarifas_unidad")
    .select(COLUMNAS_HOTEL_TARIFAS_UNIDAD)
    .eq("hotel_id", criterio.hotelId)
    .eq("estado", "publicada");

  if (error) {
    return {
      ok: false,
      codigo: "error_consulta",
      mensaje: `No se pudo consultar la tarifa Bernalo del hotel: ${error.message}`,
      contexto: { hotelId: criterio.hotelId },
    };
  }

  return seleccionarTarifaAlojamientoPublicada(data ?? [], criterio);
}
