import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatCOP, formatFechaLarga } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ContratosPage() {
  const sb = await createClient();
  const { data: ventas } = await sb
    .from("ventas")
    .select(
      "numero_contrato, cliente, destino, fecha_salida, precio_venta, estado, created_at"
    )
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Contratos</h1>
          <p className="mt-1 text-sm text-gray-500">
            Generador de contratos de servicios turísticos
          </p>
        </div>
        <Link href="/dashboard/contratos/nuevo">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>
            + Nuevo contrato
          </Button>
        </Link>
      </div>

      {!ventas?.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">Aún no hay contratos</p>
          <p className="mt-1 text-sm">
            Crea el primero con el botón “Nuevo contrato”.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Contrato</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Destino</th>
                <th className="px-4 py-3">Salida</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {ventas.map((v) => (
                <tr
                  key={v.numero_contrato}
                  className="border-b border-gray-50 hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-mono font-medium text-gray-800">
                    {v.numero_contrato}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{v.cliente}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {v.destino ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatFechaLarga(v.fecha_salida)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {formatCOP(v.precio_venta)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {v.estado}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/contratos/${encodeURIComponent(v.numero_contrato)}`}
                      className="text-xs font-medium text-[#1D7C9A] hover:underline"
                    >
                      Ver →
                    </Link>
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
