"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

function rev(numero: string) {
  revalidatePath(`/dashboard/contratos/${numero}`);
}

// ── Costos de la venta ───────────────────────────────────────────────────
export async function guardarCostos(
  numeroContrato: string,
  costos: {
    costo_hotel: number;
    costo_aereo: number;
    costo_receptivo: number;
    costo_asistencia: number;
    otros_costos: number;
  }
): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("ventas")
    .update({ ...costos, updated_at: new Date().toISOString() })
    .eq("numero_contrato", numeroContrato);
  if (error) return { ok: false, error: error.message };
  rev(numeroContrato);
  return { ok: true };
}

// ── Cuentas por pagar (proveedores) ──────────────────────────────────────
export async function crearCuentaPorPagar(input: {
  numeroContrato: string;
  proveedor: string;
  tipoProveedor: string;
  servicio: string;
  valorTotal: number;
  fechaVencimiento: string;
  aplicaRetencion: boolean;
  pctRetencion: number;
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("cuentas_por_pagar").insert({
    numero_contrato: input.numeroContrato,
    proveedor: input.proveedor || null,
    tipo_proveedor: input.tipoProveedor || null,
    servicio: input.servicio || null,
    valor_total: input.valorTotal,
    fecha_vencimiento: input.fechaVencimiento || null,
    aplica_retencion: input.aplicaRetencion,
    pct_retencion: input.pctRetencion,
  });
  if (error) return { ok: false, error: error.message };
  rev(input.numeroContrato);
  return { ok: true };
}

export async function eliminarCuentaPorPagar(
  id: number,
  numeroContrato: string
): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("cuentas_por_pagar").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev(numeroContrato);
  return { ok: true };
}

// ── Comisiones B2B (aliados) ─────────────────────────────────────────────
export async function crearComisionB2B(input: {
  numeroContrato: string;
  aliado: string;
  nit: string;
  precioVenta: number;
  pctComision: number;
  recobroTotal: number;
  pctRecobroAliado: number;
  aplicaRetencion: boolean;
  pctRetencion: number;
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("aliados_b2b").insert({
    numero_contrato: input.numeroContrato,
    aliado: input.aliado || null,
    nit: input.nit || null,
    precio_venta: input.precioVenta,
    base_comision: input.precioVenta,
    pct_comision: input.pctComision,
    recobro_total: input.recobroTotal,
    pct_recobro_aliado: input.pctRecobroAliado,
    aplica_retencion: input.aplicaRetencion,
    pct_retencion: input.pctRetencion,
    estado: "pendiente",
  });
  if (error) return { ok: false, error: error.message };
  rev(input.numeroContrato);
  return { ok: true };
}

export async function eliminarComisionB2B(
  id: number,
  numeroContrato: string
): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("aliados_b2b").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev(numeroContrato);
  return { ok: true };
}

// ── Facturación ──────────────────────────────────────────────────────────
export async function crearFactura(input: {
  numeroContrato: string;
  numeroFactura: string;
  fechaFactura: string;
  cliente: string;
  nitCliente: string;
  descripcion: string;
  baseGravable: number;
  ivaDescontable: number;
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("facturacion").insert({
    numero_contrato: input.numeroContrato,
    numero_factura: input.numeroFactura || null,
    fecha_factura: input.fechaFactura || null,
    cliente: input.cliente || null,
    nit_cliente: input.nitCliente || null,
    descripcion: input.descripcion || null,
    base_gravable: input.baseGravable,
    iva_descontable: input.ivaDescontable,
    estado_dian: "borrador",
  });
  if (error) return { ok: false, error: error.message };
  rev(input.numeroContrato);
  return { ok: true };
}

export async function eliminarFactura(
  id: number,
  numeroContrato: string
): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("facturacion").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev(numeroContrato);
  return { ok: true };
}
