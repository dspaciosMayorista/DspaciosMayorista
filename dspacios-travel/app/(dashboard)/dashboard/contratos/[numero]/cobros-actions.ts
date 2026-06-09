"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { planDeCuotas } from "@/lib/calc/cuotas";

type Result = { ok: true; n?: number } | { ok: false; error: string };

// % de abono para confirmar según el tipo de contrato (default 30%).
export async function pctAbonoDe(tipoPaquete: string | null): Promise<number> {
  const sb = await createClient();
  const { data } = await sb.from("config_cobros").select("pct_abono").eq("tipo_paquete", tipoPaquete ?? "").maybeSingle();
  return data?.pct_abono ?? 0.3;
}

// Genera (o regenera) el plan de cuotas del contrato y lo guarda.
export async function generarPlanCobro(numero: string): Promise<Result> {
  const sb = await createClient();
  const { data: venta } = await sb.from("ventas").select("precio_venta, fecha_salida, tipo_paquete").eq("numero_contrato", numero).maybeSingle();
  if (!venta) return { ok: false, error: "Contrato no encontrado." };

  const pct = await pctAbonoDe(venta.tipo_paquete);
  const plan = planDeCuotas({ precio: venta.precio_venta ?? 0, checkIn: venta.fecha_salida, pctAbono: pct });
  if (!plan.length) return { ok: false, error: "No hay valor de venta para armar el plan." };

  await sb.from("cuotas").delete().eq("numero_contrato", numero);
  const filas = plan.map((c, i) => ({ numero_contrato: numero, orden: i, tipo: c.tipo, fecha_limite: c.fecha, monto: c.monto }));
  const { error } = await sb.from("cuotas").insert(filas);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true, n: filas.length };
}

// Configuración del % de abono por tipo (solo superadmin).
export async function actualizarConfigCobros(tipoPaquete: string, pct: number): Promise<Result> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (perfil?.rol !== "superadmin") return { ok: false, error: "Solo superadmin puede cambiar las reglas de cobro." };
  const p = Math.min(1, Math.max(0, pct));
  const { error } = await sb.from("config_cobros").upsert({ tipo_paquete: tipoPaquete, pct_abono: p, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}
