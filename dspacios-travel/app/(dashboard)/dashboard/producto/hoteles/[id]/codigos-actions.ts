"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// #103 (C) — código de promoción que un hotel exige en la solicitud, POR VIGENCIA. Es solo configuración del correo al proveedor: NO toca tarifas, vigencias ni el tarifario publicado, por eso no
// regenera nada. La autorización la da la RLS (roles de producto + agencia Mayorista); la coherencia hotel↔vigencia la impone la base (trigger de la migración 328).
type Result = { ok: true } | { ok: false; error: string };

export async function guardarCodigoPromocion(input: { hotelId: number; vigenciaId: number; requerido: boolean; codigo: string; nota: string }): Promise<Result> {
  const codigo = input.codigo.trim();
  if (codigo.length > 60) return { ok: false, error: "El código no puede pasar de 60 caracteres." };
  if (/[\r\n]/.test(codigo)) return { ok: false, error: "El código no puede tener saltos de línea." };
  if (input.nota.length > 300) return { ok: false, error: "La nota no puede pasar de 300 caracteres." };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Inicia sesión de nuevo." };
  const { error } = await sb.from("hotel_codigos_promocion").upsert(
    { hotel_id: input.hotelId, vigencia_id: input.vigenciaId, requerido: input.requerido, codigo: codigo || null, nota: input.nota.trim() || null, creado_por: user.id },
    { onConflict: "vigencia_id" },
  );
  if (error) return { ok: false, error: error.message.includes("CODIGO_PROMOCION") ? "Esa vigencia no pertenece a este hotel." : "No se pudo guardar el código (¿tienes permiso para editar hoteles?)." };
  revalidatePath(`/dashboard/producto/hoteles/${input.hotelId}`);
  return { ok: true };
}

export async function quitarCodigoPromocion(vigenciaId: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  const { data, error } = await sb.from("hotel_codigos_promocion").delete().eq("vigencia_id", vigenciaId).eq("hotel_id", hotelId).select("id");
  if (error) return { ok: false, error: "No se pudo quitar el código." };
  if (!(data ?? []).length) return { ok: false, error: "No se encontró esa configuración o no tienes permiso para borrarla." };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}
