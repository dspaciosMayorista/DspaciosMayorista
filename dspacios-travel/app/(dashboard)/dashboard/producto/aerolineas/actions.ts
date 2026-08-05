"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

function rev() {
  revalidatePath("/dashboard/producto/aerolineas");
}

export async function crearAerolinea(nombre: string): Promise<Result> {
  if (!nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const sb = await createClient();
  const { error } = await sb.from("aerolineas").insert({ nombre: nombre.trim().toUpperCase() });
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

export async function eliminarAerolinea(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("aerolineas").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

export async function actualizarAerolinea(id: number, activo: boolean): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("aerolineas").update({ activo }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

export async function crearTarifaAerolinea(input: {
  aerolineaId: number;
  nombre: string;
  descripcion: string;
}): Promise<Result> {
  if (!input.nombre.trim() || !input.descripcion.trim()) {
    return { ok: false, error: "Nombre y descripción son obligatorios." };
  }
  const sb = await createClient();
  const { count } = await sb
    .from("aerolinea_tarifas")
    .select("id", { count: "exact", head: true })
    .eq("aerolinea_id", input.aerolineaId);
  const { error } = await sb.from("aerolinea_tarifas").insert({
    aerolinea_id: input.aerolineaId,
    nombre: input.nombre.trim(),
    descripcion: input.descripcion.trim(),
    orden: count ?? 0,
  });
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

export async function eliminarTarifaAerolinea(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("aerolinea_tarifas").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}
