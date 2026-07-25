"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { postearAsientoPago, eliminarAsientoPago } from "@/lib/contabilidad/asientos";

type Result = { ok: true } | { ok: false; error: string };

// Configura la factura del proveedor sobre una CxP: si es Costo (ingreso propio)
// se indica la base gravable y se autoliquida el IVA descontable (base × IVA);
// si es IRT (ingreso para tercero) no hay base ni IVA. El total ya está (valor_total).
export async function configurarFacturaProveedor(input: {
  id: number;
  clasificacion: "costo" | "irt";
  baseGravable: number;
}): Promise<Result> {
  const sb = await createClient();
  const { data: param } = await sb.from("parametros_tributarios").select("valor").eq("parametro", "IVA").maybeSingle();
  const ivaPct = Number(param?.valor) || 0.19;
  const esCosto = input.clasificacion !== "irt";
  const base = esCosto ? Math.max(0, Number(input.baseGravable) || 0) : 0;
  const { error } = await sb.from("cuentas_por_pagar").update({
    clasificacion: esCosto ? "costo" : "irt",
    base_gravable: esCosto ? base : null,
    iva_proveedor: esCosto ? Math.round(base * ivaPct) : null,
  }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/pagos");
  revalidatePath("/dashboard/rentabilidad");
  return { ok: true };
}

// Registra un PAGO a proveedor sobre una cuenta por pagar. Log ilimitado en
// `cxp_pagos` (migración 130) -- ya no hay máximo de 3 pagos por cuenta.
export async function registrarPagoProveedor(
  id: number,
  valor: number,        // monto pagado en COP (en CxP USD se convierte con la TRM)
  fecha: string,
  trmInput?: number,    // TRM del día de pago (obligatoria en CxP USD)
): Promise<Result> {
  if (!(valor > 0)) return { ok: false, error: "El valor debe ser mayor a 0" };
  const sb = await createClient();
  const { data: cxp, error: e1 } = await sb
    .from("cuentas_por_pagar")
    .select("valor_total, moneda, numero_contrato, tipo_proveedor, proveedor")
    .eq("id", id)
    .maybeSingle();
  if (e1) return { ok: false, error: e1.message };
  if (!cxp) return { ok: false, error: "Cuenta por pagar no encontrada" };

  // En CxP USD se paga en pesos a la TRM del día: el abono se guarda en USD
  // (= COP/TRM, reduce la obligación) y se registra la TRM del pago.
  const esUSD = ((cxp as { moneda?: string | null }).moneda ?? "COP") === "USD";
  const trm = esUSD ? (Number(trmInput) || 0) : 1;
  if (esUSD && trm <= 0) return { ok: false, error: "Indica la TRM del día (cuenta en USD)." };
  const abono = esUSD ? valor / trm : valor;
  const f = fecha || new Date().toISOString().slice(0, 10);

  const { data: pago, error: e2 } = await sb
    .from("cxp_pagos")
    .insert({ cuenta_por_pagar_id: id, fecha: f, valor: abono, trm })
    .select("id")
    .single();
  if (e2) return { ok: false, error: e2.message };

  // Pre-asiento del pago, siempre en COP (es lo que realmente salió de caja o
  // banco, incluso si la CxP es en USD).
  await postearAsientoPago({
    cuentaId: id, pagoId: pago.id, numeroContrato: cxp.numero_contrato, tipoProveedor: cxp.tipo_proveedor, proveedor: cxp.proveedor,
    valor, formaPago: null, moneda: "COP", fecha: f,
  });
  revalidatePath("/dashboard/pagos");
  revalidatePath("/dashboard/contabilidad/libro-diario");
  if (cxp.numero_contrato) revalidatePath(`/dashboard/contratos/${cxp.numero_contrato}`);
  return { ok: true };
}

// Asigna (o cambia) el proveedor de una cuenta por pagar, tomando la retención
// del catálogo. Útil para las CxP creadas automáticamente al confirmar, que
// nacen sin proveedor.
export async function asignarProveedorCuentaPorPagar(
  id: number,
  proveedorNombre: string
): Promise<Result> {
  const sb = await createClient();
  if (!proveedorNombre.trim()) return { ok: false, error: "Elige un proveedor." };

  const { data: prov } = await sb
    .from("proveedores")
    .select("nombre, tipo, aplica_retencion, pct_retencion")
    .eq("nombre", proveedorNombre)
    .maybeSingle();

  const { error } = await sb
    .from("cuentas_por_pagar")
    .update({
      proveedor: prov?.nombre ?? proveedorNombre,
      ...(prov?.tipo ? { tipo_proveedor: prov.tipo } : {}),
      ...(prov?.aplica_retencion != null ? { aplica_retencion: prov.aplica_retencion } : {}),
      ...(prov?.pct_retencion != null ? { pct_retencion: prov.pct_retencion } : {}),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/pagos");
  return { ok: true };
}

// Deshace el último pago registrado (el más reciente de cxp_pagos por fecha,
// y por id si hay empate).
export async function deshacerUltimoPago(id: number): Promise<Result> {
  const sb = await createClient();
  const { data: cxp, error: e1 } = await sb
    .from("cuentas_por_pagar")
    .select("numero_contrato")
    .eq("id", id)
    .maybeSingle();
  if (e1) return { ok: false, error: e1.message };
  if (!cxp) return { ok: false, error: "Cuenta por pagar no encontrada" };

  const { data: ultimo, error: e2 } = await sb
    .from("cxp_pagos")
    .select("id")
    .eq("cuenta_por_pagar_id", id)
    .order("fecha", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e2) return { ok: false, error: e2.message };
  if (!ultimo) return { ok: false, error: "No hay pagos para deshacer" };

  const { error: e3 } = await sb.from("cxp_pagos").delete().eq("id", ultimo.id);
  if (e3) return { ok: false, error: e3.message };
  await eliminarAsientoPago(id, ultimo.id);
  revalidatePath("/dashboard/pagos");
  revalidatePath("/dashboard/contabilidad/libro-diario");
  if (cxp.numero_contrato) revalidatePath(`/dashboard/contratos/${cxp.numero_contrato}`);
  return { ok: true };
}
