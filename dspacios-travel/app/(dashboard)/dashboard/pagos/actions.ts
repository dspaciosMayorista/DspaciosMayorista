"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

type CxPUpdate = {
  abono1?: number | null;
  fecha_abono1?: string | null;
  abono2?: number | null;
  fecha_abono2?: string | null;
  abono3?: number | null;
  fecha_abono3?: string | null;
};

// Registra un PAGO a proveedor sobre una cuenta por pagar. El modelo guarda
// hasta 3 pagos (abono1/2/3 + su fecha); se llena el primer cupo libre.
export async function registrarPagoProveedor(
  id: number,
  valor: number,
  fecha: string
): Promise<Result> {
  if (!(valor > 0)) return { ok: false, error: "El valor debe ser mayor a 0" };
  const sb = await createClient();
  const { data: cxp, error: e1 } = await sb
    .from("cuentas_por_pagar")
    .select("abono1, abono2, abono3, valor_total")
    .eq("id", id)
    .maybeSingle();
  if (e1) return { ok: false, error: e1.message };
  if (!cxp) return { ok: false, error: "Cuenta por pagar no encontrada" };

  const f = fecha || new Date().toISOString().slice(0, 10);
  const libre = (v: number | null | undefined) => v == null || v === 0;
  let upd: CxPUpdate;
  if (libre(cxp.abono1)) upd = { abono1: valor, fecha_abono1: f };
  else if (libre(cxp.abono2)) upd = { abono2: valor, fecha_abono2: f };
  else if (libre(cxp.abono3)) upd = { abono3: valor, fecha_abono3: f };
  else
    return {
      ok: false,
      error: "Esta cuenta ya tiene 3 pagos registrados (máximo del modelo).",
    };

  const { error: e2 } = await sb.from("cuentas_por_pagar").update(upd).eq("id", id);
  if (e2) return { ok: false, error: e2.message };
  revalidatePath("/dashboard/pagos");
  return { ok: true };
}

// Deshace el último pago registrado (limpia el cupo más alto ocupado).
export async function deshacerUltimoPago(id: number): Promise<Result> {
  const sb = await createClient();
  const { data: cxp, error: e1 } = await sb
    .from("cuentas_por_pagar")
    .select("abono1, abono2, abono3")
    .eq("id", id)
    .maybeSingle();
  if (e1) return { ok: false, error: e1.message };
  if (!cxp) return { ok: false, error: "Cuenta por pagar no encontrada" };

  const ocupado = (v: number | null | undefined) => v != null && v !== 0;
  let upd: CxPUpdate | null = null;
  if (ocupado(cxp.abono3)) upd = { abono3: null, fecha_abono3: null };
  else if (ocupado(cxp.abono2)) upd = { abono2: null, fecha_abono2: null };
  else if (ocupado(cxp.abono1)) upd = { abono1: null, fecha_abono1: null };
  if (!upd) return { ok: false, error: "No hay pagos para deshacer" };

  const { error: e2 } = await sb.from("cuentas_por_pagar").update(upd).eq("id", id);
  if (e2) return { ok: false, error: e2.message };
  revalidatePath("/dashboard/pagos");
  return { ok: true };
}
