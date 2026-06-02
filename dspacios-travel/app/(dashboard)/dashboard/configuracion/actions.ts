"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

// ── Rangos de edad (catálogo) ──────────────────────────────────────────────
export async function crearRangoEdad(input: {
  denominacion: string;
  edadMin: number;
  edadMax: number;
}): Promise<Result> {
  if (!input.denominacion.trim()) return { ok: false, error: "La denominación es obligatoria." };
  if (input.edadMax < input.edadMin) return { ok: false, error: "La edad máxima no puede ser menor que la mínima." };
  const sb = await createClient();
  const { error } = await sb.from("rangos_edad").insert({
    denominacion: input.denominacion.trim(),
    edad_min: input.edadMin,
    edad_max: input.edadMax,
    activo: true,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function eliminarRangoEdad(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("rangos_edad").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function crearAsesor(input: {
  nombre: string;
  email: string;
  pctComisionBase: number;
  metaMensual: number;
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("asesores").insert({
    nombre: input.nombre.trim(),
    email: input.email.trim() || null,
    pct_comision_base: input.pctComisionBase,
    meta_mensual: input.metaMensual,
    activo: true,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function actualizarAsesor(
  id: number,
  pctComisionBase: number
): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("asesores").update({ pct_comision_base: pctComisionBase }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function eliminarAsesor(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("asesores").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function actualizarParametro(parametro: string, valor: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("parametros_tributarios")
    .update({ valor, updated_at: new Date().toISOString() })
    .eq("parametro", parametro);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}
