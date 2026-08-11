import { notFound } from "next/navigation";
import Link from "next/link";
import { PrintButton } from "@/components/contrato/PrintButton";
import { DocHeader, PRINT_DOC_STYLE } from "@/components/contrato/DocHeader";
import { POWERED_BY } from "@/lib/contrato/plantilla";
import { cargarPlanCobro } from "@/lib/cuenta/estado";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { tituloDocumento } from "@/lib/utils/tituloDocumento";

export const dynamic = "force-dynamic";

const TIPO_LABEL: Record<string, string> = { abono: "Abono inicial", cuota: "Cuota", total: "Pago total" };

export async function generateMetadata({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  const plan = await cargarPlanCobro(decodeURIComponent(numero));
  return { title: { absolute: tituloDocumento("Plan de pagos", plan?.numero_contrato ?? decodeURIComponent(numero), plan?.cliente) } };
}

export default async function PlanCobroPage({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  const plan = await cargarPlanCobro(decodeURIComponent(numero));
  if (!plan) notFound();
  if (plan.cuotas.length === 0) notFound();

  const hoy = new Date().toISOString().slice(0, 10);
  const total = plan.cuotas.reduce((s, c) => s + c.monto, 0);
  const saldo = Math.max(plan.precio_venta - plan.pagado, 0);

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link href={`/dashboard/contratos/${encodeURIComponent(plan.numero_contrato)}`} className="text-sm text-gray-500 hover:text-gray-800">← Volver</Link>
        <PrintButton />
      </div>
      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="doc-print rounded-xl bg-white p-8 shadow-sm print:rounded-none print:shadow-none">
          <DocHeader tenant={plan.tenant} />

          <div className="mt-5 flex items-end justify-between">
            <div>
              <h1 className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>PLAN DE COBRO</h1>
              <p className="mt-0.5 text-sm text-gray-500">Generado el {formatFechaLarga(hoy)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-gray-400">Contrato</p>
              <p className="font-mono text-lg font-semibold text-gray-800">{plan.numero_contrato}</p>
            </div>
          </div>

          <table className="mt-5 w-full border-collapse text-sm">
            <tbody>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Cliente</td><td className="py-2 text-right">{plan.cliente ?? "—"}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Destino</td><td className="py-2 text-right">{plan.destino ?? "—"}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Fecha de viaje</td><td className="py-2 text-right">{formatFechaLarga(plan.fecha_salida)}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Valor del contrato</td><td className="py-2 text-right tabular-nums font-semibold">{formatMoneda(plan.precio_venta, plan.moneda)}</td></tr>
            </tbody>
          </table>

          <h2 className="mt-6 mb-2 text-sm font-semibold text-gray-700">Cuotas</h2>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-3 py-2">Concepto</th>
                  <th className="px-3 py-2">Fecha límite</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2 text-right">Estado</th>
                </tr>
              </thead>
              <tbody>
                {plan.cuotas.map((c) => (
                  <tr key={c.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-700">{TIPO_LABEL[c.tipo] ?? c.tipo}</td>
                    <td className="px-3 py-2 text-gray-600">{formatFechaLarga(c.fecha_limite)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatMoneda(c.monto, plan.moneda)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${c.cubierta ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                        {c.cubierta ? "Cubierta" : "Pendiente"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-3 py-2 text-gray-600" colSpan={2}>Total del plan</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-800">{formatMoneda(total, plan.moneda)}</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-5 flex items-center justify-between rounded-lg px-4 py-3"
            style={{ backgroundColor: saldo > 0 ? "rgba(192,57,43,0.06)" : "rgba(102,181,150,0.12)" }}>
            <span className="text-sm font-semibold text-gray-700">{saldo > 0 ? "Saldo pendiente" : "Pagado en su totalidad"}</span>
            <span className="text-xl font-bold" style={{ color: saldo > 0 ? "#C0392B" : "var(--brand-success)" }}>
              {formatMoneda(saldo, plan.moneda)}
            </span>
          </div>

          <footer className="mt-8 border-t border-gray-200 pt-3 text-center text-[10px] text-gray-400">
            Documento informativo generado por D&apos;spacios Travel. Las fechas son límites sugeridos de pago.
            <span className="mt-0.5 block text-[9px] text-gray-300">{POWERED_BY}</span>
          </footer>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: PRINT_DOC_STYLE }} />
    </div>
  );
}
