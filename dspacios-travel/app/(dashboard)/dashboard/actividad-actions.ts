"use server";

// B3-01 — Una PÁGINA de presencia para el modal del tablero (solo superadmin: la función de base lo exige con la sesión de quien llama; cualquier otro recibe un error, nunca una lista vacía).
import { createClient } from "@/lib/supabase/server";
import { normalizarConsultaActividad, paramsRpcActividad } from "@/lib/actividad/consulta";
import type { FilaActividad } from "@/lib/actividad/actividadReciente";

export type PaginaActividad = { ok: true; filas: FilaActividad[]; total: number } | { ok: false };

export async function cargarPaginaActividad(entrada: { grupo?: unknown; busqueda?: unknown; pagina?: unknown }): Promise<PaginaActividad> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_actividad_pagina" as never, paramsRpcActividad(normalizarConsultaActividad(entrada)) as never);
  if (error) return { ok: false };
  const filas = (data ?? []) as unknown as FilaActividad[];
  return { ok: true, filas, total: filas[0]?.total ?? 0 };
}
