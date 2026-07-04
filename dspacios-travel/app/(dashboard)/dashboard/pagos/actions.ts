"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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

type CxPUpdate = {
  abono1?: number | null;
  fecha_abono1?: string | null;
  trm1?: number | null;
  abono2?: number | null;
  fecha_abono2?: string | null;
  trm2?: number | null;
  abono3?: number | null;
  fecha_abono3?: string | null;
  trm3?: number | null;
};

// Registra un PAGO a proveedor sobre una cuenta por pagar. El modelo guarda
// hasta 3 pagos (abono1/2/3 + su fecha); se llena el primer cupo libre.
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
    .select("abono1, abono2, abono3, valor_total, moneda, numero_contrato")
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
  const libre = (v: number | null | undefined) => v == null || v === 0;
  let upd: CxPUpdate;
  if (libre(cxp.abono1)) upd = { abono1: abono, fecha_abono1: f, trm1: trm };
  else if (libre(cxp.abono2)) upd = { abono2: abono, fecha_abono2: f, trm2: trm };
  else if (libre(cxp.abono3)) upd = { abono3: abono, fecha_abono3: f, trm3: trm };
  else
    return {
      ok: false,
      error: "Esta cuenta ya tiene 3 pagos registrados (máximo del modelo).",
    };

  const { error: e2 } = await sb.from("cuentas_por_pagar").update(upd).eq("id", id);
  if (e2) return { ok: false, error: e2.message };
  revalidatePath("/dashboard/pagos");
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

// Deshace el último pago registrado (limpia el cupo más alto ocupado).
export async function deshacerUltimoPago(id: number): Promise<Result> {
  const sb = await createClient();
  const { data: cxp, error: e1 } = await sb
    .from("cuentas_por_pagar")
    .select("abono1, abono2, abono3, numero_contrato")
    .eq("id", id)
    .maybeSingle();
  if (e1) return { ok: false, error: e1.message };
  if (!cxp) return { ok: false, error: "Cuenta por pagar no encontrada" };

  const ocupado = (v: number | null | undefined) => v != null && v !== 0;
  let upd: CxPUpdate | null = null;
  if (ocupado(cxp.abono3)) upd = { abono3: null, fecha_abono3: null, trm3: null };
  else if (ocupado(cxp.abono2)) upd = { abono2: null, fecha_abono2: null, trm2: null };
  else if (ocupado(cxp.abono1)) upd = { abono1: null, fecha_abono1: null, trm1: null };
  if (!upd) return { ok: false, error: "No hay pagos para deshacer" };

  const { error: e2 } = await sb.from("cuentas_por_pagar").update(upd).eq("id", id);
  if (e2) return { ok: false, error: e2.message };
  revalidatePath("/dashboard/pagos");
  if (cxp.numero_contrato) revalidatePath(`/dashboard/contratos/${cxp.numero_contrato}`);
  return { ok: true };
}
