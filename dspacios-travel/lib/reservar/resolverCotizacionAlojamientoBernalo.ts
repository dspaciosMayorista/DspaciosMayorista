// ─────────────────────────────────────────────────────────────────────────
// Fase 3C Bernalo — frontera server-side, pequeña a propósito: hace las
// TRES consultas que la orquestación necesita (nunca una por habitación ni
// por clasificación) con el cliente de SESIÓN — jamás `createAdminClient`
// — y delega TODA la decisión al orquestador puro
// (`lib/calc/orquestarCotizacionAlojamientoBernalo.ts`). Este archivo no
// decide nada por sí mismo: calendario, selección de tarifa y cotización
// viven en módulos puros aparte.
//
// Fuera de alcance (ver el informe de la tarea): no toca `contrato_items`/
// CxP/UI, no levanta ninguna guardia existente de
// `computo.ts`/`generarTarifario`.
// ─────────────────────────────────────────────────────────────────────────

import type { createClient } from "@/lib/supabase/server";
import { hoyISO } from "@/lib/calc/paquetes";
import {
  orquestarCotizacionAlojamientoBernalo,
  type ResultadoOrquestacionBernalo,
} from "@/lib/calc/orquestarCotizacionAlojamientoBernalo";
import type { HabitacionOcupacion } from "@/lib/calc/ocupacionHabitacion";

const COLUMNAS_HOTEL_TEMPORADAS =
  "nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts, min_noches, regimen_restringido";

const COLUMNAS_HOTEL_TARIFAS_UNIDAD =
  "id, hotel_id, tarifa_id, version_tarifario, temporada, categoria, alimentacion, estado, fuente_documento, fuente_pagina, comision_pct, payload";

export type EntradaCotizacionAlojamientoBernalo = {
  hotelId: number;
  fechaIda: string;
  fechaRegreso: string;
  habitaciones: HabitacionOcupacion[];
  /** Fecha de "hoy" (yyyy-mm-dd, Bogotá) para la vigencia de compra. Por defecto `hoyISO()`. */
  hoy?: string;
};

export type ResultadoResolverCotizacionBernalo =
  | ResultadoOrquestacionBernalo
  | { ok: false; codigo: "error_consulta"; mensaje: string; contexto: Record<string, unknown> };

/**
 * Consulta `hoteles` (modelo tarifario), `hotel_temporadas` (calendario) y
 * `hotel_tarifas_unidad` (tarifas publicadas) del hotel — TRES consultas en
 * total, siempre, sin importar cuántas habitaciones o clasificaciones
 * distintas traiga `input.habitaciones` — y delega la resolución completa
 * al orquestador puro.
 */
export async function resolverYCotizarAlojamientoBernalo(
  sb: Awaited<ReturnType<typeof createClient>>,
  input: EntradaCotizacionAlojamientoBernalo
): Promise<ResultadoResolverCotizacionBernalo> {
  const [modeloRes, temporadasRes, tarifasRes] = await Promise.all([
    sb.from("hoteles").select("modelo_tarifario").eq("id", input.hotelId).maybeSingle(),
    sb.from("hotel_temporadas").select(COLUMNAS_HOTEL_TEMPORADAS).eq("hotel_id", input.hotelId),
    sb.from("hotel_tarifas_unidad").select(COLUMNAS_HOTEL_TARIFAS_UNIDAD).eq("hotel_id", input.hotelId).eq("estado", "publicada"),
  ]);

  if (modeloRes.error) {
    return {
      ok: false,
      codigo: "error_consulta",
      mensaje: `No se pudo validar el modelo tarifario del hotel: ${modeloRes.error.message}`,
      contexto: { hotelId: input.hotelId },
    };
  }
  if (temporadasRes.error) {
    return {
      ok: false,
      codigo: "error_consulta",
      mensaje: `No se pudo consultar el calendario de temporadas: ${temporadasRes.error.message}`,
      contexto: { hotelId: input.hotelId },
    };
  }
  if (tarifasRes.error) {
    return {
      ok: false,
      codigo: "error_consulta",
      mensaje: `No se pudo consultar las tarifas Bernalo del hotel: ${tarifasRes.error.message}`,
      contexto: { hotelId: input.hotelId },
    };
  }

  return orquestarCotizacionAlojamientoBernalo({
    hotelId: input.hotelId,
    modeloTarifario: modeloRes.data?.modelo_tarifario ?? null,
    temporadasRaw: temporadasRes.data ?? [],
    filasTarifas: tarifasRes.data ?? [],
    fechaIda: input.fechaIda,
    fechaRegreso: input.fechaRegreso,
    hoy: input.hoy ?? hoyISO(),
    habitaciones: input.habitaciones,
  });
}
