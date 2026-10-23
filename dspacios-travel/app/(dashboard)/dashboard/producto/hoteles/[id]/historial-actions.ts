"use server";

import { createClient } from "@/lib/supabase/server";
import { normalizarBusqueda, POR_PAGINA_HISTORIAL, type CursorHistorial, type PaginaHistorial } from "@/lib/calc/historialTarifas";

// Historial interno de tarifas (migración 203): paginación por cursor y
// búsqueda EN EL SERVIDOR (`consultar_historial_tarifas`, SECURITY INVOKER), así
// que la RLS de `tarifa_hotel_historial` decide quién ve: solo roles internos.
// Solo lectura — no cotiza, no publica, no restaura.
export async function consultarHistorialTarifas(
  hotelId: number,
  busqueda: string,
  cursor: CursorHistorial | null,
): Promise<{ ok: true; pagina: PaginaHistorial } | { ok: false; error: string; noDisponible: boolean }> {
  if (!Number.isInteger(hotelId) || hotelId <= 0) return { ok: false, error: "Hotel inválido.", noDisponible: false };
  const sb = await createClient();
  const { data, error } = await sb.rpc("consultar_historial_tarifas", {
    p_hotel_id: hotelId,
    p_busqueda: normalizarBusqueda(busqueda) || null,
    p_cursor_registrado: cursor?.registrado_en ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limite: POR_PAGINA_HISTORIAL,
  });
  if (error) {
    // Migración 203 sin aplicar: la función no existe todavía (PostgREST
    // PGRST202 / Postgres 42883). Por código, no por texto: un error propio
    // de la función también menciona su nombre y no es "no disponible".
    const noDisponible = error.code === "PGRST202" || error.code === "42883";
    return { ok: false, error: noDisponible ? "El historial todavía no está disponible (falta aplicar la migración 203)." : error.message, noDisponible };
  }
  const pagina = data as unknown as PaginaHistorial;
  return { ok: true, pagina: { total: Number(pagina?.total) || 0, filas: pagina?.filas ?? [], siguiente: pagina?.siguiente ?? null } };
}
