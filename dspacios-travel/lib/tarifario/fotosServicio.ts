import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// O1 (2026-11-17) · Foto de portada de los Receptivos del catálogo PÚBLICO.
// La foto de un receptivo publicado en el tarifario la debe ver quien ve el catálogo: visitantes, aliados y personal interno. `servicios_adicionales` solo es legible por roles internos
// (lleva costos netos y otros datos internos), así que leerla con la sesión del visitante devolvía «Sin foto» a todos los externos y a `venta`.
// Solución mínima: se lee ÚNICAMENTE `id` y `foto_url` de los servicios que YA están publicados en el tarifario que esa persona ve (los `ids` salen de sus filas visibles),
// con el cliente de servicio del servidor. No se abre ninguna política ni se expone ninguna otra columna; sin cliente de servicio se conserva la lectura con la sesión.
export type FotoServicioFila = { id: number; foto_url: string | null };
export type ResultadoFotosServicio = { data: FotoServicioFila[] | null; error: { message: string } | null };

export async function leerFotosServicios(
  sesion: SupabaseClient<Database>,
  admin: SupabaseClient<Database> | null,
  ids: readonly number[],
): Promise<ResultadoFotosServicio> {
  if (!ids.length) return { data: [], error: null };
  const cliente = admin ?? sesion;
  const r = await cliente.from("servicios_adicionales").select("id, foto_url").in("id", [...ids]);
  return { data: (r.data ?? null) as FotoServicioFila[] | null, error: r.error ? { message: r.error.message } : null };
}
