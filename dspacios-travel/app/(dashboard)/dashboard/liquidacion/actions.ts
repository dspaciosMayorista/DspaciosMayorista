"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

const ROLES = ["superadmin", "gerencia", "administracion"];

async function puedeEditar(): Promise<boolean> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return false;
  const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
  return ROLES.includes(perfil?.rol ?? "");
}

// Agrega un descuento a la liquidación de un asesor interno en un mes
// puntual (ej. un descuento que el asesor le dio al cliente y que sale de
// su propia comisión) — se resta de la comisión neta calculada del mes.
export async function agregarDescuentoLiquidacion(input: {
  usuarioId: string;
  mes: string; // 'YYYY-MM'
  valor: number;
  descripcion: string;
  numeroContrato?: string;
}): Promise<Result> {
  if (!(await puedeEditar())) return { ok: false, error: "No tienes permiso para esta acción." };
  if (!(input.valor > 0)) return { ok: false, error: "El valor del descuento debe ser mayor a 0." };
  if (!/^\d{4}-\d{2}$/.test(input.mes)) return { ok: false, error: "Mes inválido." };
  const sb = await createClient();
  const { error } = await sb.from("liquidacion_descuentos").insert({
    usuario_id: input.usuarioId,
    mes: input.mes,
    valor: input.valor,
    descripcion: input.descripcion.trim() || null,
    numero_contrato: input.numeroContrato?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/liquidacion");
  return { ok: true };
}

export async function eliminarDescuentoLiquidacion(id: number): Promise<Result> {
  if (!(await puedeEditar())) return { ok: false, error: "No tienes permiso para esta acción." };
  const sb = await createClient();
  const { error } = await sb.from("liquidacion_descuentos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/liquidacion");
  return { ok: true };
}
