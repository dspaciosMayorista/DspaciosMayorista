"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getTenant } from "@/lib/tenant.server";
import { sumarRetencionesPorCuenta } from "@/lib/finanzas/retenciones";
import { postearAsientoRetencion, reemplazarAsiento } from "@/lib/contabilidad/asientos";

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
  base_gravable: number | null;
  fecha_practica: string;
  mes_declaracion: string;
  observaciones: string | null;
};

// Una fila del informe mensual (para declarar a la DIAN): la retención +
// el contrato/proveedor de donde vino, vía su cuenta por pagar.
export type InformeRetencionRow = {
  id: number;
  numero_contrato: string | null;
  proveedor: string | null;
  tipo_proveedor: string | null;
  moneda: string;
  fecha_practica: string;
  base_gravable: number | null;
  valor: number;
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
    .select("id, valor, base_gravable, fecha_practica, mes_declaracion, observaciones")
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
  baseGravable?: number;
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
    .select("id, numero_contrato, valor_total, abono1, abono2, abono3, tipo_proveedor, proveedor")
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

  const { data: nueva, error } = await sb.from("retenciones_cxp").insert({
    cuenta_por_pagar_id: input.cuentaId,
    valor: input.valor,
    base_gravable: input.baseGravable != null ? input.baseGravable : null,
    fecha_practica: input.fechaPractica,
    mes_declaracion: input.mesDeclaracion,
    observaciones: input.observaciones?.trim() || null,
    tenant: await getTenant(),
  }).select("id").single();
  if (error || !nueva) return { ok: false, error: error?.message ?? "No se pudo registrar la retención." };
  await postearAsientoRetencion({
    retencionId: nueva.id, tipoProveedor: cxp.tipo_proveedor, proveedor: cxp.proveedor, valor: input.valor, fecha: input.fechaPractica,
  });
  revalidatePath("/dashboard/contabilidad/retenciones");
  revalidatePath("/dashboard/pagos");
  revalidatePath("/dashboard/contabilidad/libro-diario");
  if (cxp.numero_contrato) revalidatePath(`/dashboard/contratos/${cxp.numero_contrato}`);
  return { ok: true };
}

export async function eliminarRetencion(id: number): Promise<Result> {
  const sb = await createClient();
  const { data: r } = await sb.from("retenciones_cxp").select("cuenta_por_pagar_id").eq("id", id).maybeSingle();
  const { error } = await sb.from("retenciones_cxp").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await reemplazarAsiento("retencion", `retencion:${id}`, null);
  if (r?.cuenta_por_pagar_id) {
    const { data: cxp } = await sb.from("cuentas_por_pagar").select("numero_contrato").eq("id", r.cuenta_por_pagar_id).maybeSingle();
    if (cxp?.numero_contrato) revalidatePath(`/dashboard/contratos/${cxp.numero_contrato}`);
  }
  revalidatePath("/dashboard/contabilidad/retenciones");
  revalidatePath("/dashboard/pagos");
  revalidatePath("/dashboard/contabilidad/libro-diario");
  return { ok: true };
}

// Deriva la base gravable de una retención registrada ANTES de que existiera
// esa columna (migración 128), sin pedirle nada nuevo al usuario: la
// calculadora siempre dejó la base gravable EXACTA (y el % de retención)
// como texto dentro de `observaciones` (ej. "... Base gravable $182.595 ·
// Retención 3.5%") — se parsea de ahí primero (dato exacto del momento en
// que se practicó). Si el texto no trae esa base (ej. se guardó con una nota
// manual sin el detalle, o el % ahí no sirve), se cae a derivarla dividiendo
// el valor retenido entre el % de retención configurado HOY en la cuenta —
// una aproximación, ya que ese % pudo cambiar desde entonces.
function derivarBaseGravable(observaciones: string | null, valor: number, pctRetencionCuenta: number): number | null {
  const obs = observaciones ?? "";
  const mBase = /Base gravable\s+([^·]+?)(?:\s*·|$)/i.exec(obs);
  if (mBase) {
    const soloDigitos = mBase[1].replace(/[^\d]/g, "");
    if (soloDigitos) return Number(soloDigitos);
  }
  const mPct = /Retenci[oó]n\s+(\d+(?:\.\d+)?)\s*%/i.exec(obs);
  const pct = mPct ? Number(mPct[1]) : pctRetencionCuenta;
  if (pct > 0) return Math.round((valor / (pct / 100)) * 100) / 100;
  return null;
}

// Recalcula la base gravable de las retenciones ya registradas que quedaron
// en blanco (de antes de la migración 128) — no pide nada nuevo, usa lo que
// ya está guardado (ver `derivarBaseGravable`). Deja en blanco las que de
// verdad no se puedan derivar (sin % de retención en ningún lado).
export async function recalcularBasesFaltantes(): Promise<
  { ok: true; actualizadas: number; sinDato: number } | { ok: false; error: string }
> {
  const sb = await createClient();
  const tenant = await getTenant();
  const { data: pendientes, error: e1 } = await sb
    .from("retenciones_cxp")
    .select("id, valor, observaciones, cuenta_por_pagar_id")
    .eq("tenant", tenant)
    .is("base_gravable", null);
  if (e1) return { ok: false, error: e1.message };
  if (!pendientes || !pendientes.length) return { ok: true, actualizadas: 0, sinDato: 0 };

  const cuentaIds = Array.from(new Set(pendientes.map((r) => r.cuenta_por_pagar_id)));
  const { data: cuentas } = await sb.from("cuentas_por_pagar").select("id, pct_retencion").in("id", cuentaIds);
  const pctPorCuenta = new Map((cuentas ?? []).map((c) => [c.id, Number(c.pct_retencion) || 0]));

  let actualizadas = 0, sinDato = 0;
  for (const r of pendientes) {
    const base = derivarBaseGravable(r.observaciones, Number(r.valor) || 0, pctPorCuenta.get(r.cuenta_por_pagar_id) ?? 0);
    if (base == null) { sinDato++; continue; }
    const { error } = await sb.from("retenciones_cxp").update({ base_gravable: base }).eq("id", r.id);
    if (!error) actualizadas++; else sinDato++;
  }
  revalidatePath("/dashboard/contabilidad/retenciones");
  return { ok: true, actualizadas, sinDato };
}

// Meses de declaración con retenciones registradas — para el selector del
// informe (más reciente primero).
export async function listarMesesDeclaracion(): Promise<{ ok: true; meses: string[] } | { ok: false; error: string }> {
  const sb = await createClient();
  const tenant = await getTenant();
  const { data, error } = await sb.from("retenciones_cxp").select("mes_declaracion").eq("tenant", tenant);
  if (error) return { ok: false, error: error.message };
  const meses = Array.from(new Set((data ?? []).map((r) => r.mes_declaracion as string))).sort().reverse();
  return { ok: true, meses };
}

// Informe mensual (para presentar a la DIAN): todas las retenciones
// practicadas cuyo mes de declaración es el indicado, con el contrato y
// proveedor de origen (vía su cuenta por pagar) — reúne base gravable y
// valor retenido, que es lo que se llena en el formulario 350.
export async function informeMensualRetenciones(
  mes: string
): Promise<{ ok: true; filas: InformeRetencionRow[] } | { ok: false; error: string }> {
  if (!/^\d{4}-\d{2}$/.test(mes || "")) return { ok: false, error: "Indica un mes válido (YYYY-MM)." };
  const sb = await createClient();
  const tenant = await getTenant();
  const { data, error } = await sb
    .from("retenciones_cxp")
    .select("id, valor, base_gravable, fecha_practica, cuentas_por_pagar(numero_contrato, proveedor, tipo_proveedor, moneda)")
    .eq("tenant", tenant)
    .eq("mes_declaracion", mes)
    .order("fecha_practica");
  if (error) return { ok: false, error: error.message };

  type Fila = {
    id: number; valor: number; base_gravable: number | null; fecha_practica: string;
    cuentas_por_pagar: { numero_contrato: string | null; proveedor: string | null; tipo_proveedor: string | null; moneda: string } | null;
  };
  const filas: InformeRetencionRow[] = ((data ?? []) as unknown as Fila[]).map((r) => ({
    id: r.id,
    numero_contrato: r.cuentas_por_pagar?.numero_contrato ?? null,
    proveedor: r.cuentas_por_pagar?.proveedor ?? null,
    tipo_proveedor: r.cuentas_por_pagar?.tipo_proveedor ?? null,
    moneda: r.cuentas_por_pagar?.moneda ?? "COP",
    fecha_practica: r.fecha_practica,
    base_gravable: r.base_gravable != null ? Number(r.base_gravable) : null,
    valor: Number(r.valor) || 0,
  }));
  return { ok: true, filas };
}
