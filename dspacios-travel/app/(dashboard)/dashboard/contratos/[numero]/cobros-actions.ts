"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { planDeCuotas, type FrecuenciaCuota } from "@/lib/calc/cuotas";
import { cobroDeVenta } from "@/lib/finanzas/cobro";

type Result = { ok: true; n?: number } | { ok: false; error: string };

// % de abono para confirmar según el tipo de contrato (default 30%).
export async function pctAbonoDe(tipoPaquete: string | null): Promise<number> {
  const sb = await createClient();
  const { data } = await sb.from("config_cobros").select("pct_abono").eq("tipo_paquete", tipoPaquete ?? "").maybeSingle();
  return data?.pct_abono ?? 0.3;
}

// Genera (o regenera) el plan de cuotas del contrato y lo guarda.
export async function generarPlanCobro(numero: string, frecuencia: FrecuenciaCuota = "mensual"): Promise<Result> {
  const sb = await createClient();
  const { data: venta } = await sb.from("ventas").select("precio_venta, moneda, moneda_cobro, trm_cobro, total_cobro, fecha_salida, tipo_paquete").eq("numero_contrato", numero).maybeSingle();
  if (!venta) return { ok: false, error: "Contrato no encontrado." };

  const pct = await pctAbonoDe(venta.tipo_paquete);
  // 235 (#90 F): las cuotas suman el total de COBRO (el convertido y congelado si se cobra en otra moneda), la misma base de abonos y saldo.
  const plan = planDeCuotas({ precio: cobroDeVenta(venta).total, checkIn: venta.fecha_salida, pctAbono: pct, frecuencia });
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
