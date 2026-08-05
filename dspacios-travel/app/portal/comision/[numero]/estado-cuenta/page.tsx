import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { PrintButton } from "@/components/contrato/PrintButton";
import { DocHeader, PRINT_DOC_STYLE } from "@/components/contrato/DocHeader";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { resolverComisionB2B } from "@/lib/finanzas/comisionResolver";

export const dynamic = "force-dynamic";

export default async function EstadoCuentaComisionPage({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  const r = await resolverComisionB2B(numero);
  if (!r) notFound();
  // El log de abonos (comision_b2b_pagos) solo existe para comisiones
  // agregadas a mano (aliados_b2b) — el flujo tarifario B2B de mayorista
  // (ventas.comision_b2b) no tiene abonos parciales, solo un total.
  if (r.aliadoB2bId == null) notFound();

  const admin = createAdminClient();
  const { data: pagosRaw } = await admin
    .from("comision_b2b_pagos")
    .select("id, fecha, valor")
    .eq("aliado_b2b_id", r.aliadoB2bId)
    .order("fecha", { ascending: true })
    .order("id", { ascending: true });

  const total = r.detalle.totalPagar;
  let acum = 0;
  const pagos = (pagosRaw ?? []).map((p) => {
    acum += Number(p.valor ?? 0);
    return { id: p.id, fecha: p.fecha as string, valor: Number(p.valor ?? 0), saldoTras: Math.max(total - acum, 0) };
  });
  const pagado = acum;
  const saldo = Math.max(total - pagado, 0);
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link href={`/portal/comision/${encodeURIComponent(r.numeroContrato)}`} className="text-sm text-gray-500 hover:text-gray-800">← Cuenta de cobro</Link>
        <PrintButton />
      </div>
      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="doc-print rounded-xl bg-white p-8 shadow-sm print:rounded-none print:shadow-none">
          <DocHeader tenant={r.tenant} />

          <div className="mt-5 flex items-end justify-between">
            <div>
              <h1 className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>ESTADO DE CUENTA — COMISIÓN</h1>
              <p className="mt-0.5 text-sm text-gray-500">Generado el {formatFechaLarga(hoy)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-gray-400">Contrato</p>
              <p className="font-mono text-lg font-semibold text-gray-800">{r.numeroContrato}</p>
            </div>
          </div>

          <table className="mt-5 w-full border-collapse text-sm">
            <tbody>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Aliado</td><td className="py-2 text-right">{r.aliado}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Cliente</td><td className="py-2 text-right">{r.cliente ?? "—"}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Destino</td><td className="py-2 text-right">{r.destino ?? "—"}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Total comisión</td><td className="py-2 text-right tabular-nums font-semibold">{formatMoneda(total, r.moneda)}</td></tr>
            </tbody>
          </table>

          {/* Movimientos */}
          <h2 className="mt-6 mb-2 text-sm font-semibold text-gray-700">Abonos</h2>
          {pagos.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
              Aún no hay abonos registrados.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2 text-right">Abono</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {pagos.map((p, i) => (
                    <tr key={p.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 text-gray-600">{formatFechaLarga(p.fecha)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatMoneda(p.valor, r.moneda)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatMoneda(p.saldoTras, r.moneda)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                    <td className="px-3 py-2 text-gray-600" colSpan={2}>Total abonado</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-800">{formatMoneda(pagado, r.moneda)}</td>
                    <td className="px-3 py-2"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Saldo actual */}
          <div className="mt-5 flex items-center justify-between rounded-lg px-4 py-3"
            style={{ backgroundColor: saldo > 0 ? "rgba(192,57,43,0.06)" : "rgba(102,181,150,0.12)" }}>
            <span className="text-sm font-semibold text-gray-700">{saldo > 0 ? "Saldo pendiente" : "Pagado en su totalidad"}</span>
            <span className="text-xl font-bold" style={{ color: saldo > 0 ? "#C0392B" : "var(--brand-success)" }}>
              {formatMoneda(saldo, r.moneda)}
            </span>
          </div>

          <footer className="mt-8 border-t border-gray-200 pt-3 text-center text-[10px] text-gray-400">
            Documento informativo generado por D&apos;spacios Travel. El saldo se actualiza con cada abono registrado.
          </footer>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: PRINT_DOC_STYLE }} />
    </div>
  );
}
