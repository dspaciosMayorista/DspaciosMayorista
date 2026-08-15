import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCOP, formatFechaLarga } from "@/lib/utils";
import { CambiarSillasForm } from "./CambiarSillasForm";
import { SillaEstado } from "./SillaEstado";
import { PasajeroAcciones } from "./PasajeroAcciones";
import { EditarBloqueoForm } from "./EditarBloqueoForm";
import { CambioOperacionalForm } from "./CambioOperacionalForm";
import { SillaContrato } from "./SillaContrato";
import { BloqueoTabs } from "./BloqueoTabs";
import { ControlBloqueoForm } from "./ControlBloqueoForm";
import { ControlBadges } from "@/components/vuelos/ControlBadges";

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
  const [{ data: b }, { data: sillas }, { data: otros }, { data: destinos }, { data: proveedores }, { data: rangos }, { data: cambios }, { data: movimientos }] = await Promise.all([
    sb.from("bloqueos_vuelo").select("*").eq("id", bloqueoId).single(),
    sb.from("sillas").select("id, numero_silla, estado, numero_contrato, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, hotel, acomodacion, plazo").eq("bloqueo_id", bloqueoId).order("numero_silla"),
    sb.from("bloqueos_vuelo").select("id, record, fecha_ida").neq("id", bloqueoId).order("fecha_ida"),
    sb.from("destinos").select("id, nombre, codigo_iata").order("nombre"),
    sb.from("proveedores").select("id, nombre").eq("tipo", "aereo").order("nombre"),
    sb.from("rangos_edad").select("id, denominacion, edad_min, edad_max").order("edad_min"),
    sb.from("bloqueo_cambios").select("id, fecha, detalle, nota, registrado_por").eq("bloqueo_id", bloqueoId).order("fecha", { ascending: false }),
    sb.from("movimientos_silla").select("id, motivo, fecha_movimiento, registrado_por, bloqueo_origen_id, bloqueo_destino_id").or(`bloqueo_origen_id.eq.${bloqueoId},bloqueo_destino_id.eq.${bloqueoId}`).order("fecha_movimiento", { ascending: false }),
  ]);
  if (!b) notFound();

  // Mapa id→record para mostrar los movimientos (este bloqueo + los demás).
  const recordPorId = new Map<number, string>([[bloqueoId, b.record as string]]);
  for (const o of otros ?? []) recordPorId.set(o.id, o.record);

  // Contrato manual por silla (columna de la migración 085). Query aparte y
  // tolerante: si la columna aún no existe, simplemente no hay contratos manuales.
  const contratoManualPorSilla = new Map<number, string | null>();
  {
    // Cast: los tipos generados aún no incluyen la columna (migración 085).
    const { data: cm, error: cmErr } = await (sb.from("sillas").select("id, contrato_manual").eq("bloqueo_id", bloqueoId) as unknown as Promise<{ data: { id: number; contrato_manual: string | null }[] | null; error: unknown }>);
    if (!cmErr) for (const r of cm ?? []) contratoManualPorSilla.set(r.id, r.contrato_manual ?? null);
  }

  const conteo = (sillas ?? []).reduce<Record<string, number>>((acc, s) => {
    acc[s.estado] = (acc[s.estado] ?? 0) + 1;
    return acc;
  }, {});
  const disponibles = (conteo["disponible"] ?? 0) + (conteo["cambio_entrante"] ?? 0);
  // Total REAL = sillas que pertenecen al record ahora (todas menos las que
  // salieron a otro record en estado 'cambio'). Consistente con la lista.
  const totalReal = (sillas ?? []).filter((s) => s.estado !== "cambio").length;

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8">
      <Link href="/dashboard/vuelos" className="text-sm text-gray-400 hover:text-gray-600">← Vuelos</Link>

      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h1 className="font-mono text-2xl font-semibold text-gray-900">{b.record}</h1>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-sm text-gray-600">{b.aerolinea ?? "—"}</span>
      </div>
      <div className="mt-2">
        <ControlBadges modalidad={b.modalidad_emision} estadoEmision={b.estado_emision} estadoPago={b.estado_pago} />
      </div>
      <p className="mt-1 text-sm text-gray-500">{b.ruta ?? "—"}</p>
      <p className="text-xs text-gray-400">
        Ida {formatFechaLarga(b.fecha_ida)} ({b.vuelo_ida ?? "—"} · {b.hora_salida_ida ?? "—"}) ·
        Regreso {formatFechaLarga(b.fecha_regreso)} ({b.vuelo_regreso ?? "—"} · {b.hora_salida_reg ?? "—"})
      </p>
      <p className="mt-1 text-xs text-gray-400">
        Cupos {totalReal}{totalReal !== (b.cupos_total ?? 0) ? ` (contratados ${b.cupos_total})` : ""} · Tarifa empaquetar {formatCOP(b.tarifa_para_empaquetar)} ·
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
          record: b.record ?? "", aerolinea: b.aerolinea ?? "", proveedorId: b.proveedor_id, destinoId: b.destino_id, ruta: b.ruta ?? "", origen: b.origen ?? "",
          vueloIda: b.vuelo_ida ?? "", fechaIda: b.fecha_ida ?? "", horaSalidaIda: b.hora_salida_ida ?? "", horaLlegadaIda: b.hora_llegada_ida ?? "",
          vueloRegreso: b.vuelo_regreso ?? "", fechaRegreso: b.fecha_regreso ?? "", horaSalidaReg: b.hora_salida_reg ?? "", horaLlegadaReg: b.hora_llegada_reg ?? "",
          tarifaNeta: b.tarifa_neta ?? 0, tarifaParaEmpaquetar: b.tarifa_para_empaquetar ?? 0, fechaDevolucion: b.fecha_devolucion ?? "", fechaEmision: b.fecha_emision ?? "",
          notas: b.notas ?? "", rangosEdad: b.rangos_edad ?? [],
        }}
      />

      {/* Pestañas: Pasajeros (sillas activas) · Cambios (movimientos/cupos) · Control (modalidad/emisión/pago) */}
      <BloqueoTabs
        nCambios={(movimientos?.length ?? 0) + (cambios?.length ?? 0)}
        control={
          <ControlBloqueoForm
            bloqueoId={bloqueoId}
            inicial={{ modalidadEmision: b.modalidad_emision, estadoEmision: b.estado_emision, estadoPago: b.estado_pago }}
          />
        }
        pasajeros={
          <>
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
                    <th className="px-3 py-2">Acciones</th>
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
                      <td className="px-3 py-2">
                        <SillaContrato sillaId={s.id} bloqueoId={bloqueoId} estado={s.estado} numeroContrato={s.numero_contrato} contratoManual={contratoManualPorSilla.get(s.id) ?? null} />
                      </td>
                      <td className="px-3 py-2 text-gray-500">{s.asesor || "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{s.hotel || "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{s.acomodacion || "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{s.plazo ? formatFechaLarga(s.plazo) : "—"}</td>
                      <td className="px-3 py-2">
                        <SillaEstado sillaId={s.id} estado={s.estado} bloqueoId={bloqueoId}
                          bloqueada={s.estado === "cambio"} />
                      </td>
                      <td className="px-3 py-2">
                        <PasajeroAcciones
                          sillaId={s.id}
                          bloqueoId={bloqueoId}
                          bloqueada={s.estado === "cambio"}
                          otros={otros ?? []}
                          inicial={{
                            pasajero_nombres: s.pasajero_nombres ?? "", pasajero_apellidos: s.pasajero_apellidos ?? "",
                            tipo_doc: s.tipo_doc ?? "", numero_doc: s.numero_doc ?? "", nacimiento: s.nacimiento ?? "",
                            asesor: s.asesor ?? "", hotel: s.hotel ?? "", acomodacion: s.acomodacion ?? "", plazo: s.plazo ?? "",
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!sillas?.length && <p className="mt-4 text-sm text-gray-400">Este bloqueo no tiene sillas generadas.</p>}
            <p className="mt-2 text-xs text-gray-400">Para registrar una venta externa, usa “+ Contrato manual” en un cupo disponible. Para quitar un cupo libre, usa “eliminar cupo”.</p>
          </>
        }
        cambios={
          <div className="space-y-5">
            {/* Cambio de sillas entre records */}
            {disponibles > 0 && otros && otros.length > 0 ? (
              <CambiarSillasForm origenId={bloqueoId} disponibles={disponibles} destinos={otros} />
            ) : (
              <p className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-3 text-sm text-gray-400">
                No hay cupos disponibles para cambiar a otro record (o no hay otros records).
              </p>
            )}

            {/* Cambio operacional (vuelos / horas) */}
            <CambioOperacionalForm
              bloqueoId={bloqueoId}
              inicial={{
                vueloIda: b.vuelo_ida ?? "", fechaIda: b.fecha_ida ?? "", horaSalidaIda: b.hora_salida_ida ?? "", horaLlegadaIda: b.hora_llegada_ida ?? "",
                vueloRegreso: b.vuelo_regreso ?? "", fechaRegreso: b.fecha_regreso ?? "", horaSalidaReg: b.hora_salida_reg ?? "", horaLlegadaReg: b.hora_llegada_reg ?? "",
              }}
            />

            {/* Historial de movimientos de sillas (cambios entre records) */}
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="mb-2 text-sm font-semibold text-gray-700">Movimientos de sillas</p>
              {(movimientos?.length ?? 0) === 0 ? (
                <p className="text-xs text-gray-400">Sin movimientos de sillas registrados.</p>
              ) : (
                <ul className="space-y-2">
                  {(movimientos ?? []).map((m) => {
                    const ori = recordPorId.get(m.bloqueo_origen_id as number) ?? "?";
                    const des = recordPorId.get(m.bloqueo_destino_id as number) ?? "?";
                    const entra = m.bloqueo_destino_id === bloqueoId;
                    return (
                      <li key={m.id} className="border-l-2 pl-3 text-xs" style={{ borderColor: entra ? "#BFE3EE" : "#C7B3E8" }}>
                        <div className="text-gray-400">{formatFechaLarga(m.fecha_movimiento)}{m.registrado_por ? ` · ${m.registrado_por}` : ""}</div>
                        <div className="text-gray-700">{entra ? "Entró desde" : "Salió hacia"} <b>{entra ? ori : des}</b> (cambio {ori} → {des})</div>
                        {m.motivo && <div className="text-gray-500 italic">“{m.motivo}”</div>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Historial de cambios operacionales + eliminación de cupos */}
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="mb-2 text-sm font-semibold text-gray-700">Historial del bloqueo</p>
              {(cambios?.length ?? 0) === 0 ? (
                <p className="text-xs text-gray-400">Sin cambios operacionales ni de cupos registrados.</p>
              ) : (
                <ul className="space-y-2">
                  {(cambios ?? []).map((c) => (
                    <li key={c.id} className="border-l-2 border-gray-200 pl-3 text-xs">
                      <div className="text-gray-400">{formatFechaLarga(c.fecha)}{c.registrado_por ? ` · ${c.registrado_por}` : ""}</div>
                      {c.detalle && <div className="text-gray-700">{c.detalle}</div>}
                      {c.nota && <div className="text-gray-500 italic">“{c.nota}”</div>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        }
      />
    </div>
  );
}
