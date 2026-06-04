import { createClient } from "@/lib/supabase/server";
import { calcComisionB2B, calcComisionAsesor, calcRentabilidad, fiscalFromParams } from "@/lib/calc/finanzas";
import { RentabilidadList, type RentRow } from "./RentabilidadList";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function RentabilidadPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Rentabilidad</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Este módulo es de uso interno (administración / gerencia).
        </p>
      </div>
    );
  }

  const [{ data: ventas }, { data: b2b }, { data: facturas }, { data: cxp }, { data: asesores }] = await Promise.all([
    sb.from("ventas").select("numero_contrato, cliente, asesor, asesor_firma_nombre, destino, canal, fecha_venta, precio_venta, costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos").order("fecha_venta", { ascending: false }),
    sb.from("aliados_b2b").select("numero_contrato, precio_venta, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion"),
    sb.from("facturacion").select("numero_contrato, base_gravable, iva_descontable"),
    sb.from("cuentas_por_pagar").select("numero_contrato, iva_proveedor"),
    sb.from("asesores").select("nombre, email, pct_comision_base"),
  ]);

  const { data: paramsRows } = await sb.from("parametros_tributarios").select("parametro, valor");
  const fiscal = fiscalFromParams(paramsRows ?? []);

  // Comisión B2B total a pagar por contrato.
  const b2bPorContrato = new Map<string, number>();
  for (const r of b2b ?? []) {
    const c = calcComisionB2B({ precioVenta: r.precio_venta, pctComision: r.pct_comision, recobroTotal: r.recobro_total, pctRecobroAliado: r.pct_recobro_aliado, aplicaRetencion: r.aplica_retencion, pctRetencion: r.pct_retencion }).totalPagar;
    b2bPorContrato.set(r.numero_contrato, (b2bPorContrato.get(r.numero_contrato) ?? 0) + c);
  }
  // IVA generado (de las facturas al cliente) y descontable (de proveedores).
  const ivaGenPorContrato = new Map<string, number>();
  const ivaDescPorContrato = new Map<string, number>();
  for (const f of facturas ?? []) {
    ivaGenPorContrato.set(f.numero_contrato, (ivaGenPorContrato.get(f.numero_contrato) ?? 0) + (f.base_gravable ?? 0) * fiscal.IVA);
    ivaDescPorContrato.set(f.numero_contrato, (ivaDescPorContrato.get(f.numero_contrato) ?? 0) + (f.iva_descontable ?? 0));
  }
  for (const c of cxp ?? []) {
    ivaDescPorContrato.set(c.numero_contrato, (ivaDescPorContrato.get(c.numero_contrato) ?? 0) + (c.iva_proveedor ?? 0));
  }

  const rows: RentRow[] = (ventas ?? []).map((v) => {
    const costoDirecto = (v.costo_hotel ?? 0) + (v.costo_aereo ?? 0) + (v.costo_receptivo ?? 0) + (v.costo_asistencia ?? 0) + (v.otros_costos ?? 0);
    const comB2B = b2bPorContrato.get(v.numero_contrato) ?? 0;
    const asesorRow = (asesores ?? []).find((a) => a.email === v.asesor || a.nombre === (v.asesor_firma_nombre ?? v.asesor));
    const comAsesor = calcComisionAsesor({ precioVenta: v.precio_venta, costoTotal: costoDirecto, comB2BPagada: comB2B, pctBase: asesorRow?.pct_comision_base ?? 0.08, retHonorarios: fiscal.RETENCION_HONORARIOS }).comisionNeta;
    const rent = calcRentabilidad({
      precioVenta: v.precio_venta, costoDirecto, comB2B, comAsesor,
      ivaGenerado: ivaGenPorContrato.get(v.numero_contrato) ?? 0,
      ivaDescontable: ivaDescPorContrato.get(v.numero_contrato) ?? 0,
      fiscal,
    });
    return {
      numero_contrato: v.numero_contrato,
      cliente: v.cliente ?? null,
      asesor: (asesorRow?.nombre ?? v.asesor_firma_nombre ?? v.asesor) || null,
      destino: v.destino ?? null,
      canal: v.canal ?? null,
      mes: v.fecha_venta ? String(v.fecha_venta).slice(0, 7) : "",
      precioVenta: rent.precioVenta,
      ivaGenerado: rent.ivaGenerado,
      ingreso: rent.ingreso,
      costoDirecto: rent.costoDirecto,
      ivaDescontable: rent.ivaDescontable,
      costoNeto: rent.costoNeto,
      utilBruta: rent.utilBruta,
      comB2B: rent.comB2B,
      comAsesor: rent.comAsesor,
      provIca: rent.provIca,
      provBomberil: rent.provBomberil,
      provFontur: rent.provFontur,
      provRenta: rent.provRenta,
      totalProvisiones: rent.totalProvisiones,
      ivaPorPagar: rent.ivaPorPagar,
      utilNeta: rent.utilNeta,
      margenNeto: rent.margenNeto,
      clasificacion: rent.clasificacion,
    };
  });

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Rentabilidad</h1>
        <p className="mt-1 text-sm text-gray-500">
          Utilidad neta por contrato con las provisiones colombianas (ICA, Bomberil, Fontur, Renta),
          comisiones e IVA. Filtra por asesor, destino, mes o clasificación; abre cada fila para ver el desglose.
        </p>
      </div>
      <RentabilidadList rows={rows} />
    </div>
  );
}
