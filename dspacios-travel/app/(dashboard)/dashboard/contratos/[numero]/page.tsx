import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatCOP, formatFechaLarga } from "@/lib/utils";
import { AbonoForm } from "./AbonoForm";
import { ShareButtons } from "./ShareButtons";

export const dynamic = "force-dynamic";

export default async function ContratoDetallePage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero: raw } = await params;
  const numero = decodeURIComponent(raw);
  const sb = await createClient();

  const [{ data: venta }, { data: items }, { data: abonos }, { data: pasajeros }] =
    await Promise.all([
      sb.from("ventas").select("*").eq("numero_contrato", numero).single(),
      sb.from("contrato_items").select("*").eq("numero_contrato", numero),
      sb
        .from("abonos")
        .select("id, valor_abono, forma_pago, referencia, fecha_abono")
        .eq("numero_contrato", numero)
        .order("fecha_abono", { ascending: false }),
      sb.from("contrato_pasajeros").select("id").eq("numero_contrato", numero),
    ]);

  if (!venta) notFound();

  const total = (items ?? []).reduce(
    (s, it) => s + it.adultos * it.tarifa_adulto + it.ninos * it.tarifa_nino,
    0
  );
  const pagado = (abonos ?? []).reduce((s, a) => s + (a.valor_abono ?? 0), 0);
  const saldo = Math.max(total - pagado, 0);

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link
        href="/dashboard/contratos"
        className="text-sm text-gray-400 hover:text-gray-600"
      >
        ← Contratos
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold text-gray-900">
            {venta.numero_contrato}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {venta.cliente} · {venta.destino ?? "—"} · Viaje{" "}
            {formatFechaLarga(venta.fecha_salida)}
          </p>
        </div>
        <Link href={`/contrato/${encodeURIComponent(numero)}`} target="_blank">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>
            Ver / Imprimir contrato →
          </Button>
        </Link>
      </div>

      {/* Compartir con el cliente */}
      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-gray-700">
          Compartir con el cliente
        </p>
        <p className="mb-3 text-xs text-gray-500">
          Enlace público para que el cliente vea su contrato sin necesidad de
          iniciar sesión.
        </p>
        <ShareButtons
          token={venta.share_token}
          numero={venta.numero_contrato}
          cliente={venta.cliente}
        />
      </div>

      {/* Totales */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl p-4 text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
          <div className="text-xs opacity-80">Total del contrato</div>
          <div className="text-xl font-bold">{formatCOP(total)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-400">Total pagado</div>
          <div className="text-xl font-bold" style={{ color: "var(--brand-success)" }}>
            {formatCOP(pagado)}
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-400">Saldo pendiente</div>
          <div className="text-xl font-bold text-gray-800">
            {formatCOP(saldo)}
          </div>
        </div>
      </div>

      {/* Datos */}
      <div className="mt-6 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <Dato label="Documento" value={venta.cliente_documento ?? "—"} />
        <Dato label="Teléfono" value={venta.cliente_telefono ?? "—"} />
        <Dato label="Pax" value={String(venta.pax)} />
        <Dato label="Pasajeros" value={String(pasajeros?.length ?? 0)} />
        <Dato label="Plan" value={venta.plan_nombre ?? "—"} />
        <Dato
          label="Asistencia médica"
          value={venta.asistencia_medica ? "Sí" : "No"}
        />
        <Dato label="Emisión" value={formatFechaLarga(venta.fecha_emision)} />
        <Dato label="Estado" value={venta.estado} />
      </div>

      {/* Abonos */}
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Abonos</h2>
        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <AbonoForm numeroContrato={numero} />
        </div>
        {abonos?.length ? (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase text-gray-400">
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2 text-right">Valor</th>
                  <th className="px-4 py-2">Forma</th>
                  <th className="px-4 py-2">Referencia</th>
                </tr>
              </thead>
              <tbody>
                {abonos.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50">
                    <td className="px-4 py-2 text-gray-500">
                      {formatFechaLarga(a.fecha_abono)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                      {formatCOP(a.valor_abono)}
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {a.forma_pago ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {a.referencia ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-400">Sin abonos registrados.</p>
        )}
      </div>
    </div>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-white p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div className="text-gray-800">{value}</div>
    </div>
  );
}
