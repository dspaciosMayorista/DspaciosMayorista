"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getTenant } from "@/lib/tenant.server";
import { sumarRetencionesPorCuenta } from "@/lib/finanzas/retenciones";

type Result = { ok: true } | { ok: false; error: string };

export type CuentaContrato = {
  id: number;
  proveedor: string | null;
  tipo_proveedor: string | null;
  servicio: string | null;
  valor_total: number;
  moneda: string;
  pagado: number;
  retenido: number;
  saldo: number;
  pctRetencionSugerido: number; // % de retención configurado para este proveedor/CxP, si lo hay (editable igual)
};

export type RetencionRow = {
  id: number;
  valor: number;
  fecha_practica: string;
  mes_declaracion: string;
  observaciones: string | null;
};

// Busca las cuentas por pagar de un contrato — para elegir por TIPO de
// proveedor (hotel/aéreo/receptivo/...) en vez del proveedor puntual.
export async function buscarCuentasPorContrato(
  numeroContrato: string
): Promise<{ ok: true; cuentas: CuentaContrato[] } | { ok: false; error: string }> {
  const numero = numeroContrato.trim();
  if (!numero) return { ok: false, error: "Escribe un número de contrato." };
  const sb = await createClient();
  const tenant = await getTenant();
  const { data: cxp, error } = await sb
    .from("cuentas_por_pagar")
    .select("id, proveedor, tipo_proveedor, servicio, valor_total, moneda, abono1, abono2, abono3, aplica_retencion, pct_retencion")
    .eq("numero_contrato", numero)
    .eq("tenant", tenant)
    .order("id");
  if (error) return { ok: false, error: error.message };
  if (!cxp || !cxp.length) return { ok: false, error: "Ese contrato no tiene cuentas por pagar registradas." };

  const ids = cxp.map((c) => c.id);
  const { data: ret } = await sb.from("retenciones_cxp").select("cuenta_por_pagar_id, valor").in("cuenta_por_pagar_id", ids);
  const retenidoPorCuenta = sumarRetencionesPorCuenta(
    (ret ?? []).map((r) => ({ cuenta_por_pagar_id: r.cuenta_por_pagar_id as number, valor: Number(r.valor) || 0 }))
  );

  const cuentas: CuentaContrato[] = cxp.map((c) => {
    const pagado = (Number(c.abono1) || 0) + (Number(c.abono2) || 0) + (Number(c.abono3) || 0);
    const retenido = retenidoPorCuenta[c.id] ?? 0;
    const valorTotal = Number(c.valor_total) || 0;
    return {
      id: c.id,
      proveedor: c.proveedor,
      tipo_proveedor: c.tipo_proveedor,
      servicio: c.servicio,
      valor_total: valorTotal,
      moneda: c.moneda ?? "COP",
      pagado,
      retenido,
      saldo: Math.max(valorTotal - pagado - retenido, 0),
      pctRetencionSugerido: c.aplica_retencion ? Number(c.pct_retencion) || 0 : 0,
    };
  });
  return { ok: true, cuentas };
}

export async function listarRetenciones(
  cuentaId: number
): Promise<{ ok: true; retenciones: RetencionRow[] } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("retenciones_cxp")
    .select("id, valor, fecha_practica, mes_declaracion, observaciones")
    .eq("cuenta_por_pagar_id", cuentaId)
    .order("fecha_practica", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, retenciones: (data ?? []) as RetencionRow[] };
}

// Registra una retención practicada: se descuenta del saldo del proveedor
// (igual que un abono), y queda la fecha en que se practicó + el mes en que
// se va a declarar/pagar a la DIAN.
export async function registrarRetencion(input: {
  cuentaId: number;
  valor: number;
  fechaPractica: string;
  mesDeclaracion: string;
  observaciones?: string;
}): Promise<Result> {
  if (!(input.valor > 0)) return { ok: false, error: "El valor debe ser mayor a 0." };
  if (!input.fechaPractica) return { ok: false, error: "Indica la fecha en que se practicó la retención." };
  if (!/^\d{4}-\d{2}$/.test(input.mesDeclaracion || "")) return { ok: false, error: "Indica el mes en que se declara a la DIAN." };

  const sb = await createClient();
  const { data: cxp, error: e1 } = await sb
    .from("cuentas_por_pagar")
    .select("id, numero_contrato, valor_total, abono1, abono2, abono3")
    .eq("id", input.cuentaId)
    .maybeSingle();
  if (e1) return { ok: false, error: e1.message };
  if (!cxp) return { ok: false, error: "Cuenta por pagar no encontrada." };

  const { data: ret } = await sb.from("retenciones_cxp").select("valor").eq("cuenta_por_pagar_id", input.cuentaId);
  const yaRetenido = (ret ?? []).reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const pagado = (Number(cxp.abono1) || 0) + (Number(cxp.abono2) || 0) + (Number(cxp.abono3) || 0);
  const saldoActual = Math.max((Number(cxp.valor_total) || 0) - pagado - yaRetenido, 0);
  if (input.valor > saldoActual + 1) {
    return { ok: false, error: `El valor supera el saldo pendiente (${saldoActual.toLocaleString("es-CO")}).` };
  }

  const { error } = await sb.from("retenciones_cxp").insert({
    cuenta_por_pagar_id: input.cuentaId,
    valor: input.valor,
    fecha_practica: input.fechaPractica,
    mes_declaracion: input.mesDeclaracion,
    observaciones: input.observaciones?.trim() || null,
    tenant: await getTenant(),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/retenciones");
  revalidatePath("/dashboard/pagos");
  if (cxp.numero_contrato) revalidatePath(`/dashboard/contratos/${cxp.numero_contrato}`);
  return { ok: true };
}

export async function eliminarRetencion(id: number): Promise<Result> {
  const sb = await createClient();
  const { data: r } = await sb.from("retenciones_cxp").select("cuenta_por_pagar_id").eq("id", id).maybeSingle();
  const { error } = await sb.from("retenciones_cxp").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (r?.cuenta_por_pagar_id) {
    const { data: cxp } = await sb.from("cuentas_por_pagar").select("numero_contrato").eq("id", r.cuenta_por_pagar_id).maybeSingle();
    if (cxp?.numero_contrato) revalidatePath(`/dashboard/contratos/${cxp.numero_contrato}`);
  }
  revalidatePath("/dashboard/contabilidad/retenciones");
  revalidatePath("/dashboard/pagos");
  return { ok: true };
}
