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
