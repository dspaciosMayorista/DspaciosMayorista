import { notFound } from "next/navigation";
import Link from "next/link";
import { PrintButton } from "@/components/contrato/PrintButton";
import { DocHeader, PRINT_DOC_STYLE } from "@/components/contrato/DocHeader";
import { cargarEstadoCuenta, numeroRecibo } from "@/lib/cuenta/estado";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { tituloDocumento } from "@/lib/utils/tituloDocumento";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  const ec = await cargarEstadoCuenta(decodeURIComponent(numero));
  return { title: { absolute: tituloDocumento("Estado de cuenta", ec?.numero_contrato ?? decodeURIComponent(numero), ec?.cliente) } };
}

export default async function EstadoCuentaPage({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  const ec = await cargarEstadoCuenta(decodeURIComponent(numero));
  if (!ec) notFound();

  const hoy = new Date().toISOString().slice(0, 10);
  const volver = ec.esInterno
    ? `/dashboard/contratos/${encodeURIComponent(ec.numero_contrato)}`
    : "/portal/b2b";

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link href={volver} className="text-sm text-gray-500 hover:text-gray-800">← Volver</Link>
        <PrintButton />
      </div>
      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="doc-print rounded-xl bg-white p-8 shadow-sm print:rounded-none print:shadow-none">
          <DocHeader tenant={ec.tenant} />

          <div className="mt-5 flex items-end justify-between">
            <div>
              <h1 className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>ESTADO DE CUENTA</h1>
              <p className="mt-0.5 text-sm text-gray-500">Generado el {formatFechaLarga(hoy)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-gray-400">Contrato</p>
              <p className="font-mono text-lg font-semibold text-gray-800">{ec.numero_contrato}</p>
            </div>
          </div>

          {/* Datos del contrato */}
          <table className="mt-5 w-full border-collapse text-sm">
            <tbody>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Cliente</td><td className="py-2 text-right">{ec.cliente ?? "—"}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Destino</td><td className="py-2 text-right">{ec.destino ?? "—"}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Fecha de viaje</td><td className="py-2 text-right">{formatFechaLarga(ec.fecha_salida)}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Valor del contrato</td><td className="py-2 text-right tabular-nums font-semibold">{formatMoneda(ec.precio_venta, ec.moneda)}</td></tr>
            </tbody>
          </table>

          {/* Movimientos */}
          <h2 className="mt-6 mb-2 text-sm font-semibold text-gray-700">Movimientos</h2>
          {ec.abonos.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
              Aún no hay pagos registrados.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Recibo</th>
                    <th className="px-3 py-2">Forma</th>
                    <th className="px-3 py-2">Referencia</th>
                    <th className="px-3 py-2 text-right">Abono</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {ec.abonos.map((a) => (
                    <tr key={a.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-600">{formatFechaLarga(a.fecha_abono)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500">{numeroRecibo(a.id)}</td>
                      <td className="px-3 py-2 text-gray-600">{a.forma_pago ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{a.referencia ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatMoneda(a.valor_abono, ec.moneda)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatMoneda(a.saldoTras, ec.moneda)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                    <td className="px-3 py-2 text-gray-600" colSpan={4}>Total abonado</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-800">{formatMoneda(ec.pagado, ec.moneda)}</td>
                    <td className="px-3 py-2"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Saldo actual */}
          <div className="mt-5 flex items-center justify-between rounded-lg px-4 py-3"
            style={{ backgroundColor: ec.saldo > 0 ? "rgba(192,57,43,0.06)" : "rgba(102,181,150,0.12)" }}>
            <span className="text-sm font-semibold text-gray-700">{ec.saldo > 0 ? "Saldo pendiente" : "Pagado en su totalidad"}</span>
            <span className="text-xl font-bold" style={{ color: ec.saldo > 0 ? "#C0392B" : "var(--brand-success)" }}>
              {formatMoneda(ec.saldo, ec.moneda)}
            </span>
          </div>

          <footer className="mt-8 border-t border-gray-200 pt-3 text-center text-[10px] text-gray-400">
            Documento informativo generado por D&apos;spacios Travel. El saldo se actualiza con cada pago registrado.
          </footer>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: PRINT_DOC_STYLE }} />
    </div>
  );
}
