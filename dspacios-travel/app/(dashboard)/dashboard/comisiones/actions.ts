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

// Edita la base comisionable, el % de comisión y el recobro de una comisión B2B.
//   - base_comision: por defecto PVP − impuesto/BNC (a veces hay que ajustarla a mano).
//   - pct_comision: se puede definir por % directo, o (en la UI) calculado hacia
//     atrás desde un valor de comisión en pesos que se tipeó a mano — a este
//     action siempre le llega ya como fracción (0-1), sin importar cuál de los
//     dos campos se haya editado en la UI.
//   - recobro_total: el mayor valor cobrado sobre la tarifa neta (nunca visible al
//     cliente); pct_recobro_aliado = qué % de ese recobro le corresponde al aliado
//     (el resto queda para la empresa). El aliado del recobro (recobroAliado =
//     recobro_total × pct_recobro_aliado) SE SUMA a la comisión total — ya lo hace
//     calcComisionB2B() — y por eso también entra como gasto en Rentabilidad
//     (calcularRentabilidad usa el mismo cálculo para com_b2b).
export async function actualizarComisionB2B(
  id: number,
  input: { baseComision: number; pctComision: number; recobroTotal: number; pctRecobroAliado: number }
): Promise<Result> {
  if (!(input.baseComision >= 0)) return { ok: false, error: "La base comisionable debe ser un número ≥ 0." };
  if (input.pctComision < 0 || input.pctComision > 1) return { ok: false, error: "El % de comisión debe estar entre 0 y 100." };
  if (!(input.recobroTotal >= 0)) return { ok: false, error: "El recobro total debe ser un número ≥ 0." };
  if (input.pctRecobroAliado < 0 || input.pctRecobroAliado > 1) return { ok: false, error: "El % del recobro para el aliado debe estar entre 0 y 100." };
  const sb = await createClient();
  const { error } = await sb.from("aliados_b2b").update({
    base_comision: input.baseComision,
    pct_comision: input.pctComision,
    recobro_total: input.recobroTotal,
    pct_recobro_aliado: input.pctRecobroAliado,
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/comisiones");
  revalidatePath("/dashboard/rentabilidad");
  return { ok: true };
}
