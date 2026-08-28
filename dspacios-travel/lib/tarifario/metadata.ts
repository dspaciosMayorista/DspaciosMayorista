import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Metadatos GLOBALES pequeños (catálogo `destinos`: nombre/código IATA, sin
 * tenant, lectura pública) usados para poblar el filtro de destino de
 * `/dashboard/tarifario` — nunca depende de usuario/sesión/rol/tenant, y es
 * chico por naturaleza (decenas de destinos, no miles de filas), así que se
 * consulta directo en cada carga sin necesidad de una caché aparte.
 */
export async function obtenerNombresDestinos(sb: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await sb.from("destinos").select("nombre").order("nombre");
  if (error || !data) return [];
  return data.map((d) => d.nombre).filter((n): n is string => !!n);
}
