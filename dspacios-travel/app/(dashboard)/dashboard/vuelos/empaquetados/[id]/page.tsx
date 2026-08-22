import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatFechaLarga } from "@/lib/utils";
import { EditarEmpaquetadoForm } from "./EditarEmpaquetadoForm";
import { ControlEmpaquetadoForm } from "./ControlEmpaquetadoForm";
import { EstadoBadge } from "@/components/EstadoBadge";
import { labelEstadoEmision, labelEstadoPago, tonoEstadoEmision, tonoEstadoPago } from "@/lib/vuelos/control";

export const dynamic = "force-dynamic";

export default async function EmpaquetadoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const empaquetadoId = Number(id);
  if (isNaN(empaquetadoId)) notFound();

  const sb = await createClient();
  const [{ data: e }, { data: destinos }, { data: proveedores }, { data: vinculos }] = await Promise.all([
    sb.from("empaquetados").select("*").eq("id", empaquetadoId).single(),
    sb.from("destinos").select("id, nombre, codigo_iata").order("nombre"),
    sb.from("proveedores").select("id, nombre").eq("tipo", "aereo").order("nombre"),
    sb.from("armado_empaquetados").select("paquete_id, armado_paquetes(nombre, activo)").eq("empaquetado_id", empaquetadoId),
  ]);
  if (!e) notFound();

  return (
    <div className="mx-auto max-w-[1100px] p-4 md:p-8">
      <Link href="/dashboard/vuelos?vista=empaquetados" className="text-sm text-gray-400 hover:text-gray-600">← Empaquetados</Link>

      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h1 className="font-mono text-2xl font-semibold text-gray-900">{e.record ?? "Sin record"}</h1>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-sm text-gray-600">{e.aerolinea ?? "—"}</span>
        <EstadoBadge estado="Sistema" tono="info" />
      </div>
      <p className="mt-1 text-sm text-gray-500">{e.ruta ?? "—"}</p>
      <p className="text-xs text-gray-400">
        Ida {formatFechaLarga(e.fecha_ida)} ({e.vuelo_ida ?? "—"} · {e.hora_salida_ida ?? "—"}) ·
        Regreso {formatFechaLarga(e.fecha_regreso)} ({e.vuelo_regreso ?? "—"} · {e.hora_salida_reg ?? "—"})
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <EstadoBadge estado={labelEstadoEmision(e.estado_emision)} tono={tonoEstadoEmision(e.estado_emision)} />
        <EstadoBadge estado={labelEstadoPago(e.estado_pago)} tono={tonoEstadoPago(e.estado_pago)} />
        {e.activo ? <EstadoBadge estado="Activo" tono="ok" /> : <EstadoBadge estado="Inactivo" tono="neutral" />}
      </div>

      <section className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-gray-700">Paquetes vinculados</p>
        {!vinculos?.length ? (
          <p className="text-xs text-gray-400">Todavía no está vinculado a ningún paquete — se puede vincular desde el editor del paquete (sección Vuelos).</p>
        ) : (
          <ul className="space-y-1">
            {vinculos.map((v) => {
              const pq = v.armado_paquetes as unknown as { nombre: string; activo: boolean } | null;
              return (
                <li key={v.paquete_id} className="text-sm">
                  <Link href={`/dashboard/paquetes/${v.paquete_id}`} className="text-[var(--brand-accent)] hover:underline">
                    {pq?.nombre ?? `Paquete #${v.paquete_id}`}
                  </Link>
                  {pq && !pq.activo && <span className="ml-2 text-xs text-gray-400">(inactivo)</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mt-5">
        <ControlEmpaquetadoForm
          empaquetadoId={empaquetadoId}
          inicial={{ record: e.record, estadoEmision: e.estado_emision, estadoPago: e.estado_pago }}
        />
      </div>

      <div className="mt-5">
        <EditarEmpaquetadoForm
          empaquetadoId={empaquetadoId}
          proveedores={proveedores ?? []}
          destinos={destinos ?? []}
          inicial={{
            aerolinea: e.aerolinea ?? "", proveedorId: e.proveedor_id, destinoId: e.destino_id,
            ruta: e.ruta ?? "", origen: e.origen ?? "",
            vueloIda: e.vuelo_ida ?? "", fechaIda: e.fecha_ida ?? "", horaSalidaIda: e.hora_salida_ida ?? "", horaLlegadaIda: e.hora_llegada_ida ?? "",
            vueloRegreso: e.vuelo_regreso ?? "", fechaRegreso: e.fecha_regreso ?? "", horaSalidaReg: e.hora_salida_reg ?? "", horaLlegadaReg: e.hora_llegada_reg ?? "",
            tarifaProveedor: e.tarifa_proveedor ?? 0, tarifaParaEmpaquetar: e.tarifa_para_empaquetar ?? 0, feeInfante: e.fee_infante ?? 0,
            compraInicio: e.compra_inicio ?? "", compraFin: e.compra_fin ?? "", notas: e.notas ?? "", activo: e.activo,
          }}
        />
      </div>
    </div>
  );
}
