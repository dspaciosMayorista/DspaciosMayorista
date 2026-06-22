import { notFound } from "next/navigation";
import Link from "next/link";
import { PrintButton } from "@/components/contrato/PrintButton";
import { DocHeader, PRINT_DOC_STYLE } from "@/components/contrato/DocHeader";
import { cargarRecibo, numeroRecibo } from "@/lib/cuenta/estado";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { enLetras } from "@/lib/numeroLetras";

export const dynamic = "force-dynamic";

export default async function ReciboCajaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idAbono = Number(id);
  if (!Number.isFinite(idAbono)) notFound();
  const data = await cargarRecibo(idAbono);
  if (!data) notFound();
  const { estado: ec, abono } = data;

  const volver = ec.esInterno
    ? `/dashboard/contratos/${encodeURIComponent(ec.numero_contrato)}`
    : `/estado-cuenta/${encodeURIComponent(ec.numero_contrato)}`;

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 flex max-w-2xl items-center justify-between px-4 print:hidden">
        <Link href={volver} className="text-sm text-gray-500 hover:text-gray-800">← Volver</Link>
        <PrintButton />
      </div>
      <div className="mx-auto max-w-2xl px-4 print:max-w-none print:px-0">
        <div className="doc-print rounded-xl bg-white p-8 shadow-sm print:rounded-none print:shadow-none">
          <DocHeader />

          <div className="mt-5 flex items-end justify-between">
            <div>
              <h1 className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>RECIBO DE CAJA</h1>
              <p className="mt-0.5 text-sm text-gray-500">Fecha: {formatFechaLarga(abono.fecha_abono)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-gray-400">N.º recibo</p>
              <p className="font-mono text-lg font-semibold text-gray-800">{numeroRecibo(abono.id)}</p>
            </div>
          </div>

          {/* Valor destacado */}
          <div className="mt-5 rounded-lg bg-[rgba(29,124,154,0.06)] px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Recibimos la suma de</p>
            <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>
              {formatMoneda(abono.valor_abono, ec.moneda)}
            </p>
            <p className="mt-0.5 text-xs capitalize text-gray-500">{enLetras(abono.valor_abono, ec.moneda)}</p>
          </div>

          {/* Detalle */}
          <table className="mt-5 w-full border-collapse text-sm">
            <tbody>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Recibido de</td><td className="py-2 text-right">{ec.cliente ?? "—"}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Por concepto de</td><td className="py-2 text-right">Abono al contrato {ec.numero_contrato}{ec.destino ? ` · ${ec.destino}` : ""}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Forma de pago</td><td className="py-2 text-right">{abono.forma_pago ?? "—"}</td></tr>
              {abono.referencia && (
                <tr className="border-b border-gray-100"><td className="py-2 text-gray-500">Referencia</td><td className="py-2 text-right">{abono.referencia}</td></tr>
              )}
            </tbody>
          </table>

          {/* Resumen del contrato tras el pago */}
          <div className="mt-5 grid grid-cols-3 gap-3 text-center">
            <Resumen label="Valor contrato" valor={formatMoneda(ec.precio_venta, ec.moneda)} />
            <Resumen label="Pagado a la fecha" valor={formatMoneda(ec.pagado, ec.moneda)} />
            <Resumen label="Saldo" valor={formatMoneda(abono.saldoTras, ec.moneda)} resaltar={abono.saldoTras > 0} />
          </div>

          <div className="mt-10 flex items-end justify-between text-sm text-gray-600">
            <div className="border-t border-gray-300 pt-2" style={{ width: 220 }}>
              Recibido por
              {abono.recibido_por ? <p className="mt-1 text-gray-700">{abono.recibido_por}</p> : null}
            </div>
            <p className="text-[11px] text-gray-400">{numeroRecibo(abono.id)}</p>
          </div>

          <footer className="mt-8 border-t border-gray-200 pt-3 text-center text-[10px] text-gray-400">
            Comprobante de pago generado por D&apos;spacios Travel.
          </footer>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: PRINT_DOC_STYLE }} />
    </div>
  );
}

function Resumen({ label, valor, resaltar }: { label: string; valor: string; resaltar?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums" style={{ color: resaltar ? "#C0392B" : "#1f2937" }}>{valor}</div>
    </div>
  );
}
