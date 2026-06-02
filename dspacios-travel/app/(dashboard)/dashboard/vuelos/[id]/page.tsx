import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCOP, formatFechaLarga } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ESTADO_COLOR: Record<string, string> = {
  disponible: "#E5E7EB",
  en_plazo: "#FCE7B5",
  confirmada: "#66B596",
  devuelta: "#F3C6C6",
  no_vendida: "#D1D5DB",
  cambio: "#C7B3E8",
  cambio_entrante: "#BFE3EE",
};

export default async function BloqueoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bloqueoId = Number(id);
  if (isNaN(bloqueoId)) notFound();

  const sb = await createClient();
  const [{ data: b }, { data: sillas }] = await Promise.all([
    sb.from("bloqueos_vuelo").select("*").eq("id", bloqueoId).single(),
    sb.from("sillas").select("id, numero_silla, estado, numero_contrato, pasajero_nombres, pasajero_apellidos, hotel, acomodacion").eq("bloqueo_id", bloqueoId).order("numero_silla"),
  ]);
  if (!b) notFound();

  const conteo = (sillas ?? []).reduce<Record<string, number>>((acc, s) => {
    acc[s.estado] = (acc[s.estado] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/vuelos" className="text-sm text-gray-400 hover:text-gray-600">← Vuelos</Link>

      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h1 className="font-mono text-2xl font-semibold text-gray-900">{b.record}</h1>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-sm text-gray-600">{b.aerolinea ?? "—"}</span>
      </div>
      <p className="mt-1 text-sm text-gray-500">{b.ruta ?? "—"}</p>
      <p className="text-xs text-gray-400">
        Ida {formatFechaLarga(b.fecha_ida)} ({b.vuelo_ida ?? "—"} · {b.hora_salida_ida ?? "—"}) ·
        Regreso {formatFechaLarga(b.fecha_regreso)} ({b.vuelo_regreso ?? "—"} · {b.hora_salida_reg ?? "—"})
      </p>
      <p className="mt-1 text-xs text-gray-400">
        Cupos {b.cupos_total} · Tarifa empaquetar {formatCOP(b.tarifa_para_empaquetar)} ·
        Devolución {formatFechaLarga(b.fecha_devolucion)}
      </p>

      {/* Conteo por estado */}
      <div className="mt-5 flex flex-wrap gap-2">
        {Object.entries(conteo).map(([estado, n]) => (
          <span key={estado} className="flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600">
            <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: ESTADO_COLOR[estado] ?? "#ccc" }} />
            {estado.replace("_", " ")}: <b>{n}</b>
          </span>
        ))}
      </div>

      {/* Malla de sillas */}
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {(sillas ?? []).map((s) => (
          <div key={s.id} className="rounded-lg border border-gray-200 p-3" style={{ backgroundColor: ESTADO_COLOR[s.estado] ?? "#fff" }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">Silla {s.numero_silla}</span>
              <span className="text-[10px] uppercase text-gray-500">{s.estado.replace("_", " ")}</span>
            </div>
            {s.numero_contrato && <div className="mt-1 font-mono text-xs text-gray-600">{s.numero_contrato}</div>}
            {(s.pasajero_nombres || s.pasajero_apellidos) && (
              <div className="text-xs text-gray-600">{s.pasajero_nombres} {s.pasajero_apellidos}</div>
            )}
          </div>
        ))}
      </div>
      {!sillas?.length && <p className="mt-6 text-sm text-gray-400">Este bloqueo no tiene sillas generadas.</p>}
    </div>
  );
}
