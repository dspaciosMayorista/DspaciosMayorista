"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

export async function crearBlackout(input: {
  hotelId: number; fechaInicio: string; fechaFin: string; total: boolean; acomodaciones: string[]; motivo: string;
}): Promise<Result> {
  const sb = await createClient();
  if (!input.fechaInicio || !input.fechaFin) return { ok: false, error: "Indica las fechas de cierre." };
  if (input.fechaFin < input.fechaInicio) return { ok: false, error: "La fecha fin no puede ser anterior a la de inicio." };
  if (!input.total && !input.acomodaciones.length) return { ok: false, error: "Elige las acomodaciones a cerrar (o marca cierre total)." };
  const { error } = await sb.from("hotel_blackouts").insert({
    hotel_id: input.hotelId,
    fecha_inicio: input.fechaInicio,
    fecha_fin: input.fechaFin,
    total: input.total,
    acomodaciones: input.total ? null : input.acomodaciones,
    motivo: input.motivo.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${input.hotelId}`);
  return { ok: true };
}

export async function eliminarBlackout(id: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("hotel_blackouts").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}
