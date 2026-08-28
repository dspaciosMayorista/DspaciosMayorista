"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };
const BUCKET = "hotel-fotos";

// El cliente sube la imagen al bucket público y aquí se registra la fila. La
// primera foto del hotel queda como portada automáticamente.
export async function registrarFotoHotel(input: {
  hotelId: number; path: string; url: string;
}): Promise<Result> {
  const sb = await createClient();
  const { count } = await sb
    .from("hotel_fotos")
    .select("id", { count: "exact", head: true })
    .eq("hotel_id", input.hotelId);
  const esPrimera = (count ?? 0) === 0;

  const { error } = await sb.from("hotel_fotos").insert({
    hotel_id: input.hotelId,
    path: input.path,
    url: input.url,
    orden: count ?? 0,
    es_portada: esPrimera,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${input.hotelId}`);
  return { ok: true };
}

// Marca una foto como portada (y desmarca las demás del hotel).
export async function marcarPortadaFotoHotel(id: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  await sb.from("hotel_fotos").update({ es_portada: false }).eq("hotel_id", hotelId);
  const { error } = await sb.from("hotel_fotos").update({ es_portada: true }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

export async function eliminarFotoHotel(id: number, path: string, hotelId: number): Promise<Result> {
  const sb = await createClient();
  // ¿Era la portada? Para reasignar otra al final.
  const { data: foto } = await sb.from("hotel_fotos").select("es_portada").eq("id", id).maybeSingle();
  await sb.storage.from(BUCKET).remove([path]);
  const { error } = await sb.from("hotel_fotos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (foto?.es_portada) {
    const { data: otra } = await sb.from("hotel_fotos").select("id").eq("hotel_id", hotelId).order("orden").limit(1).maybeSingle();
    if (otra) await sb.from("hotel_fotos").update({ es_portada: true }).eq("id", otra.id);
  }
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}
