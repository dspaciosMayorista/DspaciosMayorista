import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchAllPaginado } from "../supabase/fetchAllPaginado.ts";

// Galería por hotel para el carrusel de las HotelCards: portada primero (la
// última marcada, igual que `fotosPorHotel`), luego el resto por `orden` y, a
// igualdad, por `id`; sin URLs repetidas. Lo comparten los tres lectores de
// `hotel_fotos` (datos, resumen y datosBernalo).
export type FilaFotoHotel = { hotel_id: number; url: string; es_portada: boolean; orden: number; id?: number };

export function galeriaPorHotel(filas: readonly FilaFotoHotel[]): Record<number, string[]> {
  const porHotel = new Map<number, FilaFotoHotel[]>();
  for (const f of filas) porHotel.set(f.hotel_id, [...(porHotel.get(f.hotel_id) ?? []), f]);
  const out: Record<number, string[]> = {};
  for (const [hotelId, fs] of porHotel) {
    const orden = [...fs].sort((a, b) => a.orden - b.orden || (a.id ?? 0) - (b.id ?? 0));
    const portada = [...orden].reverse().find((f) => f.es_portada) ?? orden[0];
    out[hotelId] = [...new Set([portada.url, ...orden.map((f) => f.url)])];
  }
  return out;
}

// Lee TODAS las fotos de los hoteles: 18 fotos × muchos hoteles supera el límite
// de filas por respuesta de Supabase y lo recortaría en silencio. Conserva la
// forma `{ data, error }` de la consulta simple que reemplaza.
export async function leerFotosHotel(
  sb: SupabaseClient<Database>,
  hotelIds: readonly number[],
): Promise<{ data: FilaFotoHotel[]; error: { message: string } | null }> {
  let error: { message: string } | null = null;
  const data = await fetchAllPaginado<FilaFotoHotel>(async (d, h) => {
    const r = await sb.from("hotel_fotos").select("id, hotel_id, url, es_portada, orden").in("hotel_id", [...hotelIds]).order("orden").order("id").range(d, h);
    if (r.error) error = r.error;
    return r;
  });
  return { data: error ? [] : data, error };
}
