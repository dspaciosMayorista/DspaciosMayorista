"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getTenant } from "@/lib/tenant.server";

type Result = { ok: true } | { ok: false; error: string };

// Compras/pagos/ingresos fuera de contrato.
export async function guardarMovimiento(input: {
  id?: number;
  fecha: string;
  tipo: "ingreso" | "egreso";
  concepto: string;
  tercero: string;
  categoria: string;
  medioPago: string;
  valor: number;
  comprobante: string;
  observacion: string;
}): Promise<Result> {
  const sb = await createClient();
  if (!input.concepto.trim()) return { ok: false, error: "El concepto es obligatorio." };
  if (!(input.valor > 0)) return { ok: false, error: "El valor debe ser mayor a 0." };
  const row = {
    fecha: input.fecha || new Date().toISOString().slice(0, 10),
    tipo: input.tipo === "ingreso" ? "ingreso" : "egreso",
    concepto: input.concepto.trim(),
    tercero: input.tercero.trim() || null,
    categoria: input.categoria.trim() || null,
    medio_pago: input.medioPago.trim() || null,
    valor: Math.max(0, Number(input.valor) || 0),
    comprobante: input.comprobante.trim() || null,
    observacion: input.observacion.trim() || null,
  };
  const { error } = input.id
    ? await sb.from("contabilidad_movimientos").update(row).eq("id", input.id)
    : await sb.from("contabilidad_movimientos").insert({ ...row, tenant: await getTenant() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/movimientos");
  return { ok: true };
}

export async function eliminarMovimiento(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("contabilidad_movimientos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/movimientos");
  return { ok: true };
}
