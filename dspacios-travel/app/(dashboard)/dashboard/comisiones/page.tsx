import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { sumarPagosPorAliado } from "@/lib/finanzas/pagosComisionB2B";
import { calcularComisionFila, esComisionDescontada, esComisionEnContratoNeto, estadoComisionFila, type FilaComisionB2B } from "@/lib/finanzas/comisionB2B";
import { ComisionesList, type ComB2BRow } from "./ComisionesList";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function ComisionesPage() {
  const sb = await createClient();
  const tenant = await getTenant();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Comisiones</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Este módulo es de uso interno (administración / gerencia).
        </p>
      </div>
    );
  }

  const [{ data: b2b }, { data: ventas }, { data: pagosB2B }] = await Promise.all([
    sb.from("aliados_b2b").select("*").eq("tenant", tenant).order("id", { ascending: false }),
    sb.from("ventas").select("numero_contrato, cliente, canal, tipo_asesor, agencia_nombre, freelance_nombre, comision_estado, comision_b2b").eq("tenant", tenant),
    sb.from("comision_b2b_pagos").select("id, aliado_b2b_id, fecha, valor").eq("tenant", tenant).order("fecha", { ascending: true }).order("id", { ascending: true }),
  ]);
  const clientePorContrato = new Map<string, string>();
  const comisionEstadoPorContrato = new Map<string, string | null>();
  for (const v of ventas ?? []) {
    clientePorContrato.set(v.numero_contrato, v.cliente ?? "");
    comisionEstadoPorContrato.set(v.numero_contrato, v.comision_estado ?? null);
  }

  const pagosPorAliado = new Map<number, { id: number; fecha: string; valor: number }[]>();
  for (const p of pagosB2B ?? []) {
    const arr = pagosPorAliado.get(p.aliado_b2b_id) ?? [];
    arr.push({ id: p.id, fecha: p.fecha, valor: p.valor });
    pagosPorAliado.set(p.aliado_b2b_id, arr);
  }
  const totalPagadoPorAliado = sumarPagosPorAliado(pagosB2B ?? []);

  const rowsRegistradas: ComB2BRow[] = (b2b ?? []).map((b) => {
    const fila = b as FilaComisionB2B;
    const c = calcularComisionFila(fila);
    const pagos = pagosPorAliado.get(b.id) ?? [];
    const pagado = totalPagadoPorAliado[b.id] ?? 0;
    const descontada = esComisionDescontada(fila, comisionEstadoPorContrato.get(b.numero_contrato));
    // Segunda fila B2B de un contrato NETO: sin abonos nuevos, revisión manual.
    const enNeto = esComisionEnContratoNeto(fila, comisionEstadoPorContrato.get(b.numero_contrato));
    return {
      id: b.id,
      numero_contrato: b.numero_contrato,
      cliente: clientePorContrato.get(b.numero_contrato) ?? null,
      aliado: b.aliado,
      nit: b.nit,
      tipoAliado: b.tipo_aliado,
      precioVenta: b.precio_venta,
      pct_comision: b.pct_comision,
      aplicaRetencion: b.aplica_retencion,
      fila,
      descontada,
      enNeto,
      comisionBase: c.comisionBase,
      recobroAliado: c.recobroAliado,
      totalComision: c.totalComision,
      retencion: c.retencion,
      totalPagar: c.totalPagar,
      estado: estadoComisionFila(c.totalPagar, pagado, descontada, enNeto),
      fecha_pago: pagos.length ? pagos[pagos.length - 1].fecha : null,
      pagos,
    };
  });

  // Ventas B2B (agencia/freelance) que aún NO tienen comisión registrada → "por definir".
  // Excepción: una venta NETO (comision_estado = 'descontada') sin fila — p. ej.
  // la reservó la propia agencia y la RLS no le deja crear aliados_b2b — ya
  // tiene la comisión descontada del precio: se muestra así, sin nada que pagar.
  const conRegistro = new Set((b2b ?? []).map((b) => b.numero_contrato));
  const ventasB2B = (ventas ?? []).filter(
    (v) => v.canal === "B2B" || v.tipo_asesor === "agencia" || v.tipo_asesor === "freelance"
  );
  const rowsPorDefinir: ComB2BRow[] = ventasB2B
    .filter((v) => !conRegistro.has(v.numero_contrato))
    .map((v, i) => ({
      id: -(i + 1), // sintético (no editable)
      numero_contrato: v.numero_contrato,
      cliente: v.cliente ?? null,
      aliado: v.agencia_nombre || v.freelance_nombre || null,
      nit: null,
      pct_comision: null,
      totalComision: 0,
      retencion: 0,
      totalPagar: v.comision_estado === "descontada" ? Number(v.comision_b2b) || 0 : null,
      estado: v.comision_estado === "descontada" ? "descontada" : "sin_definir",
      descontada: v.comision_estado === "descontada",
      fecha_pago: null,
      pagos: [],
      tipoAliado: null,
      sinComision: true,
    }));

  const rows: ComB2BRow[] = [...rowsRegistradas, ...rowsPorDefinir];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Comisiones B2B</h1>
        <p className="mt-1 text-sm text-gray-500">
          Comisiones de aliados B2B por contrato y su estado de pago. Marca cada una como pagada o pendiente.
        </p>
      </div>
      <ComisionesList rows={rows} />
    </div>
  );
}
