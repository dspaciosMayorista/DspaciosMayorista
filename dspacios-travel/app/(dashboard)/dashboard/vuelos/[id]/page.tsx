import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCOP, formatFechaLarga } from "@/lib/utils";
import { CambiarSillasForm } from "./CambiarSillasForm";
import { SillaEstado } from "./SillaEstado";
import { EditarBloqueoForm } from "./EditarBloqueoForm";

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
  const [{ data: b }, { data: sillas }, { data: otros }, { data: destinos }, { data: proveedores }, { data: rangos }] = await Promise.all([
    sb.from("bloqueos_vuelo").select("*").eq("id", bloqueoId).single(),
    sb.from("sillas").select("id, numero_silla, estado, numero_contrato, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, hotel, acomodacion, plazo").eq("bloqueo_id", bloqueoId).order("numero_silla"),
    sb.from("bloqueos_vuelo").select("id, record, fecha_ida").neq("id", bloqueoId).order("fecha_ida"),
    sb.from("destinos").select("id, nombre").order("nombre"),
    sb.from("proveedores").select("id, nombre").eq("tipo", "aereo").order("nombre"),
    sb.from("rangos_edad").select("id, denominacion, edad_min, edad_max").order("edad_min"),
  ]);
  if (!b) notFound();

  const conteo = (sillas ?? []).reduce<Record<string, number>>((acc, s) => {
    acc[s.estado] = (acc[s.estado] ?? 0) + 1;
    return acc;
  }, {});
  const disponibles = (conteo["disponible"] ?? 0) + (conteo["cambio_entrante"] ?? 0);

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

      <EditarBloqueoForm
        bloqueoId={bloqueoId}
        proveedores={proveedores ?? []}
        destinos={destinos ?? []}
        rangos={rangos ?? []}
        inicial={{
          record: b.record ?? "", aerolinea: b.aerolinea ?? "", proveedorId: b.proveedor_id, destinoId: b.destino_id, ruta: b.ruta ?? "",
          vueloIda: b.vuelo_ida ?? "", fechaIda: b.fecha_ida ?? "", horaSalidaIda: b.hora_salida_ida ?? "", horaLlegadaIda: b.hora_llegada_ida ?? "",
          vueloRegreso: b.vuelo_regreso ?? "", fechaRegreso: b.fecha_regreso ?? "", horaSalidaReg: b.hora_salida_reg ?? "", horaLlegadaReg: b.hora_llegada_reg ?? "",
          tarifaParaEmpaquetar: b.tarifa_para_empaquetar ?? 0, fechaDevolucion: b.fecha_devolucion ?? "", fechaEmision: b.fecha_emision ?? "",
          notas: b.notas ?? "", rangosEdad: b.rangos_edad ?? [],
        }}
      />

      {/* Cambio de sillas entre records */}
      {disponibles > 0 && otros && otros.length > 0 && (
        <div className="mt-6">
          <CambiarSillasForm origenId={bloqueoId} disponibles={disponibles} destinos={otros} />
        </div>
      )}

      {/* Pasajeros del record (una fila por silla) */}
      <p className="mb-2 mt-6 text-sm font-semibold text-gray-700">Pasajeros</p>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Nombres</th>
              <th className="px-3 py-2">Apellidos</th>
              <th className="px-3 py-2">Tipo doc</th>
              <th className="px-3 py-2">Número</th>
              <th className="px-3 py-2">Nacimiento</th>
              <th className="px-3 py-2">Contrato</th>
              <th className="px-3 py-2">Asesor</th>
              <th className="px-3 py-2">Hotel</th>
              <th className="px-3 py-2">Acomodación</th>
              <th className="px-3 py-2">Plazo</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {(sillas ?? []).map((s) => (
              <tr key={s.id} className="border-t border-gray-100">
                <td className="px-3 py-2 font-semibold text-gray-700">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ESTADO_COLOR[s.estado] ?? "#ccc" }} />
                    {s.numero_silla}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-700">{s.pasajero_nombres || "—"}</td>
                <td className="px-3 py-2 text-gray-700">{s.pasajero_apellidos || "—"}</td>
                <td className="px-3 py-2 text-gray-500">{s.tipo_doc || "—"}</td>
                <td className="px-3 py-2 text-gray-500">{s.numero_doc || "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{s.nacimiento ? formatFechaLarga(s.nacimiento) : "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-[#1D7C9A]">
                  {s.numero_contrato ? <Link href={`/dashboard/contratos/${s.numero_contrato}`} className="hover:underline">{s.numero_contrato}</Link> : "—"}
                </td>
                <td className="px-3 py-2 text-gray-500">{s.asesor || "—"}</td>
                <td className="px-3 py-2 text-gray-500">{s.hotel || "—"}</td>
                <td className="px-3 py-2 text-gray-500">{s.acomodacion || "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{s.plazo ? formatFechaLarga(s.plazo) : "—"}</td>
                <td className="px-3 py-2">
                  <SillaEstado sillaId={s.id} estado={s.estado} bloqueoId={bloqueoId}
                    bloqueada={s.estado === "cambio" || s.estado === "cambio_entrante"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!sillas?.length && <p className="mt-6 text-sm text-gray-400">Este bloqueo no tiene sillas generadas.</p>}
    </div>
  );
}
