"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

// Marca una comisión B2B como PAGADA (con su fecha).
export async function marcarComisionB2BPagada(id: number, fecha: string): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("aliados_b2b")
    .update({ estado: "pagada", fecha_pago: fecha || new Date().toISOString().slice(0, 10) })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/comisiones");
  return { ok: true };
}

// Revierte una comisión B2B a PENDIENTE (limpia la fecha de pago).
export async function marcarComisionB2BPendiente(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("aliados_b2b")
    .update({ estado: "pendiente", fecha_pago: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/comisiones");
  return { ok: true };
}

// Edita manualmente la base comisionable de una comisión B2B (por defecto es
// PVP − impuesto/BNC, pero a veces hay que ajustarla a mano). La comisión se
// recalcula sola en pantalla con la nueva base.
export async function actualizarBaseComisionB2B(id: number, nuevaBase: number): Promise<Result> {
  if (!(nuevaBase >= 0)) return { ok: false, error: "La base comisionable debe ser un número ≥ 0." };
  const sb = await createClient();
  const { error } = await sb.from("aliados_b2b").update({ base_comision: nuevaBase }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/comisiones");
  return { ok: true };
}
