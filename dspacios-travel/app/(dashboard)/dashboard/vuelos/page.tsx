import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatCOP, formatFechaLarga } from "@/lib/utils";
import { EliminarBloqueoBtn } from "./EliminarBloqueoBtn";

export const dynamic = "force-dynamic";

export default async function VuelosPage() {
  const sb = await createClient();
  const [{ data: bloqueos }, { data: cupos }] = await Promise.all([
    sb.from("bloqueos_vuelo").select("*").order("fecha_ida", { ascending: true }),
    sb.from("cupos_por_bloqueo").select("*"),
  ]);

  const cuposPorId = new Map((cupos ?? []).map((c) => [c.id, c]));

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Inventario de vuelos</h1>
          <p className="mt-1 text-sm text-gray-500">Bloqueos de sillas negociadas con la aerolínea</p>
        </div>
        <Link href="/dashboard/vuelos/nuevo">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>+ Nuevo bloqueo</Button>
        </Link>
      </div>

      {!bloqueos?.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">No hay bloqueos cargados</p>
          <p className="mt-1 text-sm">Crea el primer record con el botón “Nuevo bloqueo”.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bloqueos.map((b) => {
            const c = cuposPorId.get(b.id);
            const disp = c?.cupos_disponibles ?? 0;
            const total = b.cupos_total ?? 0;
            const pct = total > 0 ? (Number(disp) / total) * 100 : 0;
            const color = pct > 50 ? "var(--brand-success)" : pct > 0 ? "#C99A2E" : "#C0392B";
            return (
              <div key={b.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/dashboard/vuelos/${b.id}`} className="font-mono text-sm font-semibold text-[#1D7C9A] hover:underline">{b.record}</Link>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{b.aerolinea ?? "—"}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{b.ruta ?? "—"}</p>
                    <p className="text-xs text-gray-400">
                      Ida {formatFechaLarga(b.fecha_ida)} · Regreso {formatFechaLarga(b.fecha_regreso)}
                      {b.tarifa_para_empaquetar > 0 && <> · Tarifa empaquetar {formatCOP(b.tarifa_para_empaquetar)}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-lg font-bold tabular-nums" style={{ color }}>
                        {String(disp)}<span className="text-sm font-normal text-gray-400">/{total}</span>
                      </div>
                      <div className="text-xs text-gray-400">cupos disponibles</div>
                    </div>
                    <EliminarBloqueoBtn id={b.id} record={b.record} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
