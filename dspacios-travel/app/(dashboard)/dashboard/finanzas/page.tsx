import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { formatCOP } from "@/lib/utils";
import { calcComisionB2B, calcComisionAsesor, calcRentabilidad, fiscalFromParams } from "@/lib/calc/finanzas";

export const dynamic = "force-dynamic";

export default async function FinanzasPage() {
  const sb = await createClient();

  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  const interno = ["superadmin", "gerencia", "administracion", "operaciones"].includes(perfil?.rol ?? "");

  if (!interno) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Finanzas</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Este módulo es de uso interno (operación / administración / gerencia).
        </p>
      </div>
    );
  }

  const [{ data: ventas }, { data: b2b }, { data: facturas }, { data: asesores }] = await Promise.all([
    sb.from("ventas").select("numero_contrato, cliente, asesor, asesor_firma_nombre, destino, fecha_venta, precio_venta, costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos").order("fecha_venta", { ascending: false }),
    sb.from("aliados_b2b").select("numero_contrato, precio_venta, pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion"),
    sb.from("facturacion").select("numero_contrato, base_gravable, iva_descontable"),
    sb.from("asesores").select("nombre, email, pct_comision_base"),
  ]);

  const { data: paramsRows } = await sb.from("parametros_tributarios").select("parametro, valor");
  const fiscal = fiscalFromParams(paramsRows ?? []);

  const b2bPorContrato = new Map<string, number>();
  for (const r of b2b ?? []) {
    const c = calcComisionB2B({ precioVenta: r.precio_venta, pctComision: r.pct_comision, recobroTotal: r.recobro_total, pctRecobroAliado: r.pct_recobro_aliado, aplicaRetencion: r.aplica_retencion, pctRetencion: r.pct_retencion }).totalPagar;
    b2bPorContrato.set(r.numero_contrato, (b2bPorContrato.get(r.numero_contrato) ?? 0) + c);
  }
  const ivaGenPorContrato = new Map<string, number>();
  const ivaDescPorContrato = new Map<string, number>();
  for (const f of facturas ?? []) {
    ivaGenPorContrato.set(f.numero_contrato, (ivaGenPorContrato.get(f.numero_contrato) ?? 0) + f.base_gravable * fiscal.IVA);
    ivaDescPorContrato.set(f.numero_contrato, (ivaDescPorContrato.get(f.numero_contrato) ?? 0) + (f.iva_descontable ?? 0));
  }

  const filas = (ventas ?? []).map((v) => {
    const costoDirecto = v.costo_hotel + v.costo_aereo + v.costo_receptivo + v.costo_asistencia + v.otros_costos;
    const comB2B = b2bPorContrato.get(v.numero_contrato) ?? 0;
    const asesorRow = (asesores ?? []).find((a) => a.email === v.asesor || a.nombre === (v.asesor_firma_nombre ?? v.asesor));
    const comAsesor = calcComisionAsesor({ precioVenta: v.precio_venta, costoTotal: costoDirecto, comB2BPagada: comB2B, pctBase: asesorRow?.pct_comision_base ?? 0.08, retHonorarios: fiscal.RETENCION_HONORARIOS }).comisionNeta;
    const rent = calcRentabilidad({
      precioVenta: v.precio_venta, costoDirecto, comB2B, comAsesor,
      ivaGenerado: ivaGenPorContrato.get(v.numero_contrato) ?? 0,
      ivaDescontable: ivaDescPorContrato.get(v.numero_contrato) ?? 0,
      fiscal,
    });
    return { v, rent };
  });

  const totVenta = filas.reduce((s, f) => s + f.rent.precioVenta, 0);
  const totUtil = filas.reduce((s, f) => s + f.rent.utilNeta, 0);
  const margenProm = totVenta > 0 ? totUtil / totVenta : 0;

  const colorClase = (c: string) => (c === "Alta" ? "var(--brand-success)" : c === "Media" ? "#C99A2E" : "#C0392B");

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Finanzas — Relación de utilidades</h1>
      <p className="mt-1 text-sm text-gray-500">Rentabilidad por contrato, calculada con las provisiones colombianas.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-400">Ventas ({filas.length} contratos)</div>
          <div className="text-xl font-bold tabular-nums">{formatCOP(totVenta)}</div>
        </div>
        <div className="rounded-xl p-4 text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
          <div className="text-xs opacity-80">Utilidad neta total</div>
          <div className="text-xl font-bold tabular-nums">{formatCOP(totUtil)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-400">Margen promedio</div>
          <div className="text-xl font-bold tabular-nums">{(margenProm * 100).toFixed(1)}%</div>
        </div>
      </div>

      {filas.length === 0 ? (
        <p className="mt-8 text-sm text-gray-400">Aún no hay ventas para analizar.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Contrato</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3 text-right">Venta</th>
                <th className="px-4 py-3 text-right">Costo</th>
                <th className="px-4 py-3 text-right">Util. neta</th>
                <th className="px-4 py-3 text-right">Margen</th>
                <th className="px-4 py-3">Clase</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(({ v, rent }) => (
                <tr key={v.numero_contrato} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <Link href={`/dashboard/contratos/${encodeURIComponent(v.numero_contrato)}`} className="font-mono text-[#1D7C9A] hover:underline">
                      {v.numero_contrato}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-gray-700">{v.cliente}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCOP(rent.precioVenta)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-500">{formatCOP(rent.costoDirecto)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">{formatCOP(rent.utilNeta)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{(rent.margenNeto * 100).toFixed(1)}%</td>
                  <td className="px-4 py-2">
                    <span className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: colorClase(rent.clasificacion) }}>
                      {rent.clasificacion}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
