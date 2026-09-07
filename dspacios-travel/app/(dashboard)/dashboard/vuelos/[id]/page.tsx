import { Fragment } from "react";
import { CornerDownRight, TriangleAlert } from "lucide-react";
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
import { normalizarReferenciaManual, resolverManifiestoAutorizado } from "@/lib/vuelos/contratoManual";
import { emparejarInfantesConSilla, descripcionEdadInfante } from "@/lib/vuelos/manifiestoInfantes";
import { contratosQuePuedeAbrir, enlaceContratoEnVuelo } from "@/lib/vuelos/enlaceContrato";
import { EnlaceEditarContrato } from "@/components/vuelos/EnlaceEditarContrato";
import { tenantContext } from "@/lib/tenant.server";

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

  // Infantes de este vuelo (no ocupan silla — ver lib/reservar/pasajeros.ts —
  // así que nunca tienen fila propia en `sillas`, pero deben seguir
  // apareciendo en el manifiesto). Se listan aparte, en solo lectura: la tabla
  // de arriba está ligada 1:1 a operaciones reales sobre `sillas` (cambiar,
  // liberar, editar) y una fila de infante no tiene una silla sobre la cual
  // ejecutarlas.
  //
  // Además del contrato ORGÁNICO (`sillas.numero_contrato`, con FK), una
  // silla puede estar asociada a un contrato MANUAL (`contrato_manual`,
  // texto libre, pensado para ventas externas al sistema — migración 085)
  // que en la práctica a veces SÍ corresponde a una venta interna real
  // (típicamente minorista, sin tarifario/reservar propio) escrita sin su
  // prefijo de tenant.
  //
  // ⚠️ `resolverManifiestoAutorizado` (lib/vuelos/contratoManual.ts) NO usa
  // el cliente `sb` de esta página para las lecturas de `ventas`/
  // `contrato_pasajeros`: primero AUTORIZA con `sb` (mi_rol() en el módulo
  // Vuelos — misma fuente que `proxy.ts`) y solo entonces usa un cliente
  // admin para ver la tabla COMPLETA. Es necesario porque este bloqueo es
  // infraestructura COMPARTIDA (bloqueos_vuelo/sillas no tienen columna de
  // tenant) pero `ventas`/`contrato_pasajeros` sí filtran por tenant para
  // administracion/operaciones — con el cliente de sesión, un usuario de
  // mayorista ni siquiera vería que existe la venta minorista candidata
  // (ambigüedad oculta) ni al infante ya resuelto (RLS de nuevo). Las
  // referencias que se le pasan salen SIEMPRE de las sillas de ESTE
  // bloqueo, ya autorizado — nunca un número suelto.
  const contratosOrganicosDelBloqueo = [...new Set((sillas ?? []).map((s) => s.numero_contrato).filter((n): n is string => !!n))];
  const { infantes: infantesDelBloqueo, referenciaManualPorContrato } = await resolverManifiestoAutorizado(
    sb,
    contratosOrganicosDelBloqueo,
    [...contratoManualPorSilla.values()]
  );

  // Presentación: cada infante debe aparecer como renglón subordinado
  // INMEDIATAMENTE debajo de la silla de su adulto responsable — nunca en
  // una tabla aparte. La agrupación es exclusivamente por `responsable_id`
  // (resuelto arriba a su documento, nunca a su nombre) emparejado contra el
  // documento+contrato EFECTIVO de las sillas de ESTE bloqueo — ver
  // lib/vuelos/manifiestoInfantes.ts. Si el responsable no viaja en este
  // bloqueo (o su documento no cruza con ninguna silla), el infante no se
  // asocia arbitrariamente: cae en `infantesSinResponsable` para la
  // advertencia compacta del final.
  const { infantesPorSillaId, sinResponsable: infantesSinResponsable } = emparejarInfantesConSilla(
    (sillas ?? []).map((s) => ({
      id: s.id,
      tipoDoc: s.tipo_doc,
      numeroDoc: s.numero_doc,
      contratoEfectivo:
        s.numero_contrato ??
        (() => {
          const manual = normalizarReferenciaManual(contratoManualPorSilla.get(s.id) ?? null);
          return manual ? referenciaManualPorContrato.get(manual) ?? null : null;
        })(),
    })),
    infantesDelBloqueo.map((i) => ({
      id: i.id,
      nombre: i.nombre,
      tipoId: i.tipo_id,
      identificacion: i.identificacion,
      numeroContrato: i.numero_contrato,
      fechaNacimiento: i.fecha_nacimiento,
      responsable: i.responsable ? { id: i.responsable.id, tipoId: i.responsable.tipo_id, identificacion: i.responsable.identificacion } : null,
    }))
  );

  // Acción "Editar en contrato" del renglón del infante (ver
  // lib/vuelos/enlaceContrato.ts): se muestra SOLO si el usuario actual puede
  // abrir ese contrato. Se resuelve EN LOTE, una sola consulta para todos los
  // infantes del manifiesto (nunca una por infante), leyendo `ventas` con el
  // cliente de SESIÓN — la misma consulta que hace la ficha del contrato
  // (app/(dashboard)/dashboard/contratos/[numero]/page.tsx). La RLS devuelve
  // exactamente los contratos que este rol/tenant puede abrir Y su tenant
  // REAL (columna `ventas.tenant`, jamás el prefijo del número): superadmin/
  // gerencia ven ambos tenants, administracion/operaciones solo el suyo, y
  // control_vuelo ninguno (no pasa la policy "lectura operativa", migración
  // 116). Jamás el cliente admin — eso resuelve qué contrato ES una
  // referencia, no quién puede abrirlo.
  //
  // El selector puro además cierra el caso cross-tenant: un contrato de la
  // OTRA agencia solo genera enlace si quien lo mira PUEDE cambiar la agencia
  // activa (solo superadmin, tenantContext). Si no puede cambiarla, abrir el
  // enlace lo dejaría en la agencia equivocada — fail-closed, sin enlace, sin
  // revelar la ruta. Quien sí puede cambiar recibe el enlace y el componente
  // cliente (EnlaceEditarContrato) cambia la agencia ANTES de navegar, con
  // recarga completa para que layout/sidebar usen la cookie nueva.
  const { tenant: tenantActivo, puedeCambiar: puedeCambiarTenant } = await tenantContext();
  const numerosContratosInfantes = [...infantesPorSillaId.values()].flatMap((infs) =>
    infs.map((inf) => inf.numeroContrato)
  );
  const contratosAutorizados = await contratosQuePuedeAbrir(sb, numerosContratosInfantes);

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
                    <Fragment key={s.id}>
                      <tr className="border-t border-gray-100">
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
                      {/* Infante(s) a cargo de esta silla — renglón subordinado, sin
                          silla propia: sin estado, sin acciones de silla. */}
                      {(infantesPorSillaId.get(s.id) ?? []).map((inf) => {
                        const enlace = enlaceContratoEnVuelo(
                          inf.numeroContrato,
                          contratosAutorizados,
                          tenantActivo,
                          puedeCambiarTenant
                        );
                        return (
                          <tr key={`infante-${inf.id}`} className="border-t border-gray-50 bg-gray-50/60">
                            <td colSpan={13} className="px-3 py-1.5 pl-8 text-xs">
                              <span className="inline-flex flex-wrap items-center gap-1.5 text-gray-600">
                                <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-gray-300" aria-hidden="true" />
                                <span>Infante a cargo: <b className="font-medium text-gray-800">{inf.nombre || "—"}</b></span>
                                <span className="text-gray-400">· {descripcionEdadInfante(inf.fechaNacimiento, b.fecha_ida)}</span>
                                <span className="rounded bg-gray-200/70 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">No ocupa silla</span>
                                {enlace && (
                                  <EnlaceEditarContrato
                                    numeroContrato={enlace.numeroContrato}
                                    tenantContrato={enlace.tenant}
                                    tenantActivo={tenantActivo}
                                  />
                                )}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {!sillas?.length && <p className="mt-4 text-sm text-gray-400">Este bloqueo no tiene sillas generadas.</p>}
            <p className="mt-2 text-xs text-gray-400">Para registrar una venta externa, usa “+ Contrato manual” en un cupo disponible. Para quitar un cupo libre, usa “eliminar cupo”.</p>

            {infantesSinResponsable.length > 0 && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  {infantesSinResponsable.length === 1
                    ? "1 infante no se pudo ubicar bajo su responsable en este manifiesto: "
                    : `${infantesSinResponsable.length} infantes no se pudieron ubicar bajo su responsable en este manifiesto: `}
                  {infantesSinResponsable.map((inf) => inf.nombre || "—").join(", ")}. Revisa el vínculo de responsable en el contrato.
                </p>
              </div>
            )}
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
