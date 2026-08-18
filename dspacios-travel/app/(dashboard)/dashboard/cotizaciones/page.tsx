import { createClient } from "@/lib/supabase/server";
import { contextoCotizacion } from "@/lib/cotizacion/acceso";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ESTADO_BADGE: Record<string, string> = {
  abierta: "bg-amber-50 text-amber-700",
  convertida: "bg-green-50 text-green-700",
  descartada: "bg-gray-100 text-gray-500",
};

export default async function CotizacionesPage() {
  const sb = await createClient();
  const ctx = await contextoCotizacion();
  // Listado interno: solo la agencia activa (superadmin conserva alcance
  // global — puede alternar de agencia, pero no ve las dos mezcladas de una).
  let q = sb
    .from("cotizaciones")
    .select("id, codigo, tipo, moneda, cliente, destino, hotel, fecha_salida, precio_venta, estado, numero_contrato, vigencia_hasta, created_at")
    .order("created_at", { ascending: false });
  if (ctx.ok && !ctx.superadmin) q = q.eq("tenant", ctx.tenant);
  const { data: cots } = ctx.ok ? await q : { data: [] };

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Cotizaciones</h1>
          <p className="mt-1 text-sm text-gray-500">
            Presupuestos sin número de contrato. Al confirmar se convierten en contrato.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/cotizaciones/nueva">
            <Button variant="outline">+ Cotización dinámica</Button>
          </Link>
          <Link href="/dashboard/reservar">
            <Button style={{ backgroundColor: "var(--brand-primary)" }}>
              + Desde tarifario
            </Button>
          </Link>
        </div>
      </div>

      {!cots?.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">Aún no hay cotizaciones</p>
          <p className="mt-1 text-sm">Crea la primera desde el tarifario (Reservar).</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Cotización</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Destino</th>
                <th className="px-4 py-3">Salida</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {cots.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono font-medium text-gray-800">
                    {c.codigo}
                    {c.tipo === "manual" && (
                      <span className="ml-1.5 rounded bg-[color:var(--brand-accent)]/15 px-1.5 py-0.5 align-middle font-sans text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--brand-primary)" }}>Dinámica</span>
                    )}
                    {c.tipo === "carrito" && (
                      <span className="ml-1.5 rounded bg-[color:var(--brand-success)]/15 px-1.5 py-0.5 align-middle font-sans text-[9px] font-semibold uppercase tracking-wide" style={{ color: "var(--brand-success)" }}>Carrito</span>
                    )}
                    {c.numero_contrato && (
                      <span className="ml-1 text-[10px] font-normal text-gray-400">→ {c.numero_contrato}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{c.cliente ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{c.destino ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{formatFechaLarga(c.fecha_salida)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatMoneda(c.precio_venta ?? 0, c.moneda)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${ESTADO_BADGE[c.estado] ?? "bg-gray-100 text-gray-600"}`}>
                      {c.estado}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/cotizaciones/${c.id}`} className="text-xs font-medium text-[#1D7C9A] hover:underline">
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
