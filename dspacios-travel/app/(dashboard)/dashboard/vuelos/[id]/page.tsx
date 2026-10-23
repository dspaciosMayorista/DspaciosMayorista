import { Fragment } from "react";
import { CornerDownRight, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { formatCOP, formatFechaLarga, calcularEdad } from "@/lib/utils";
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
import { InfanteVueloForm } from "@/components/vuelos/InfanteVueloForm";
import { esSillaLibre } from "@/lib/vuelos/sillaLibre";
import { filtrarCompatibles, describirDestinos } from "@/lib/vuelos/compatibles";
import { agruparHistorial, describirEntrada, esSillaActiva, type MovimientoFila } from "@/lib/vuelos/historial";
import { tenantContext } from "@/lib/tenant.server";

export const dynamic = "force-dynamic";

const ESTADO_COLOR: Record<string, string> = {
  disponible: "#E5E7EB",
  en_plazo: "#FCE7B5",
  confirmada: "#66B596",
  devuelta: "#F3C6C6",
  no_vendida: "#D1D5DB",
  retirada: "#9CA3AF",
  cambio: "#C7B3E8",
  cambio_entrante: "#BFE3EE",
};

// Columnas del historial (migración 194). Si la base aún no la tiene, la
// consulta falla y el historial se ve vacío; el orden de despliegue es
// 192 → 194 → código.
const COLUMNAS_HISTORIAL =
  "id, tipo, operacion_id, motivo, fecha_movimiento, registrado_por, bloqueo_origen_id, bloqueo_destino_id, " +
  "numero_silla_origen, numero_silla_destino, numero_contrato, contrato_manual, " +
  "cupos_origen_antes, cupos_origen_despues, cupos_destino_antes, cupos_destino_despues";

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
    sb.from("sillas").select("id, numero_silla, estado, numero_contrato, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, hotel, acomodacion, plazo, agencia, inf_nombres, inf_apellidos, inf_tipo_doc, inf_numero, inf_nacimiento, responsable_menor").eq("bloqueo_id", bloqueoId).order("numero_silla"),
    sb.from("bloqueos_vuelo").select("id, record, fecha_ida, fecha_regreso, destino_id, proveedor_id, tarifa_neta").neq("id", bloqueoId).order("fecha_ida"),
    sb.from("destinos").select("id, nombre, codigo_iata").order("nombre"),
    sb.from("proveedores").select("id, nombre").eq("tipo", "aereo").order("nombre"),
    sb.from("rangos_edad").select("id, denominacion, edad_min, edad_max").order("edad_min"),
    sb.from("bloqueo_cambios").select("id, fecha, detalle, nota, registrado_por").eq("bloqueo_id", bloqueoId).order("fecha", { ascending: false }),
    sb.from("movimientos_silla").select(COLUMNAS_HISTORIAL).or(`bloqueo_origen_id.eq.${bloqueoId},bloqueo_destino_id.eq.${bloqueoId}`).order("fecha_movimiento", { ascending: false }).order("id"),
  ]);
  if (!b) notFound();
  const historial = agruparHistorial((movimientos ?? []) as unknown as MovimientoFila[]);

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

  // Dos cifras distintas (decisión aprobada): CUPOS ACTIVOS (sillas que hoy
  // son del record; única cifra vendible) y MOVIMIENTOS HISTÓRICOS (filas de
  // movimientos_silla, solo trazabilidad). Las filas 'cambio' (legado) y
  // 'retirada' son historial: no cuentan como cupo ni van en la tabla.
  const activas = (sillas ?? []).filter((s) => esSillaActiva(s.estado));
  const conteo = activas.reduce<Record<string, number>>((acc, s) => {
    acc[s.estado] = (acc[s.estado] ?? 0) + 1;
    return acc;
  }, {});
  const libreSilla = (s: (typeof activas)[number]) => esSillaLibre({ ...s, contrato_manual: contratoManualPorSilla.get(s.id) ?? null });
  const disponibles = activas.filter(libreSilla).length;
  const totalReal = activas.length;
  const movimientosHistoricos = movimientos?.length ?? 0;

  // Records destino COMPATIBLES para trasladar/mover (lib/vuelos/compatibles.ts;
  // la base vuelve a validarlo): mismo destino, mismo proveedor y vuelo que no
  // ha salido según el día de negocio de Bogotá. Tarifa distinta: solo
  // advertencia (D4b).
  const compatibles = filtrarCompatibles(b, otros ?? []);
  const libresPorRecord = new Map<number, number>();
  if (compatibles.length) {
    const { data: sillasDestino } = await (sb.from("sillas")
      .select("bloqueo_id, estado, numero_contrato, contrato_manual, pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, hotel, acomodacion, plazo, agencia, inf_nombres, inf_apellidos, inf_tipo_doc, inf_numero, inf_nacimiento, responsable_menor")
      .in("bloqueo_id", compatibles.map((o) => o.id)) as unknown as Promise<{ data: ({ bloqueo_id: number } & Parameters<typeof esSillaLibre>[0])[] | null }>);
    for (const sd of sillasDestino ?? []) if (esSillaLibre(sd)) libresPorRecord.set(sd.bloqueo_id, (libresPorRecord.get(sd.bloqueo_id) ?? 0) + 1);
  }
  const destinosCompatibles = describirDestinos(b, compatibles, libresPorRecord);

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

  // Candidatos a "adulto responsable" para el alta manual de PasajeroAcciones
  // (ver ese componente): cualquier silla de ESTE vuelo con documento propio,
  // que no esté en 'cambio', con fecha de nacimiento VÁLIDA y mayoría de edad
  // REAL (≥18) a la fecha_ida del vuelo — un menor nunca debe ofrecerse como
  // responsable en el <select>, aunque el servidor (guardar_infante_vuelo)
  // vuelva a validar todo (documento, mayoría de edad, contrato) al guardar;
  // esta lista solo alimenta el <select> en el cliente.
  const candidatosResponsable = (sillas ?? [])
    .filter((s) => s.estado !== "cambio" && s.tipo_doc && s.numero_doc && s.nacimiento)
    .filter((s) => {
      const edad = calcularEdad(s.nacimiento, b.fecha_ida);
      return edad != null && edad >= 18;
    })
    .map((s) => ({
      sillaId: s.id,
      nombre: `${s.pasajero_nombres ?? ""} ${s.pasajero_apellidos ?? ""}`.trim() || `Silla #${s.numero_silla}`,
    }));

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
        Cupos activos <b className="text-gray-600">{totalReal}</b>{totalReal !== (b.cupos_total ?? 0) ? ` (registrados ${b.cupos_total})` : ""} ·
        Movimientos históricos <b className="text-gray-600">{movimientosHistoricos}</b> <span className="text-gray-300">(no son cupos)</span> · Tarifa empaquetar {formatCOP(b.tarifa_para_empaquetar)} ·
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
        nCambios={movimientosHistoricos + (cambios?.length ?? 0)}
        control={
          <ControlBloqueoForm
            bloqueoId={bloqueoId}
            inicial={{ modalidadEmision: b.modalidad_emision, estadoEmision: b.estado_emision, estadoPago: b.estado_pago }}
          />
        }
        pasajeros={
          <>
            <ResponsiveTableShell minWidth={1000} className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
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
                  {activas.map((s) => (
                    <Fragment key={s.id}>
                      <tr className="border-t border-gray-100">
                        <td className="px-3 py-2 font-semibold text-gray-700" data-label="#">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ESTADO_COLOR[s.estado] ?? "#ccc" }} />
                            {s.numero_silla}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-700" data-label="Nombres">{s.pasajero_nombres || "—"}</td>
                        <td className="px-3 py-2 text-gray-700" data-label="Apellidos">{s.pasajero_apellidos || "—"}</td>
                        <td className="px-3 py-2 text-gray-500" data-label="Tipo doc">{s.tipo_doc || "—"}</td>
                        <td className="px-3 py-2 text-gray-500" data-label="Número">{s.numero_doc || "—"}</td>
                        <td className="px-3 py-2 text-xs text-gray-500" data-label="Nacimiento">{s.nacimiento ? formatFechaLarga(s.nacimiento) : "—"}</td>
                        <td className="px-3 py-2" data-label="Contrato">
                          <SillaContrato sillaId={s.id} bloqueoId={bloqueoId} numeroContrato={s.numero_contrato} contratoManual={contratoManualPorSilla.get(s.id) ?? null} libre={libreSilla(s)} />
                        </td>
                        <td className="px-3 py-2 text-gray-500" data-label="Asesor">{s.asesor || "—"}</td>
                        <td className="px-3 py-2 text-gray-500" data-label="Hotel">{s.hotel || "—"}</td>
                        <td className="px-3 py-2 text-gray-500" data-label="Acomodación">{s.acomodacion || "—"}</td>
                        <td className="px-3 py-2 text-xs text-gray-500" data-label="Plazo">{s.plazo ? formatFechaLarga(s.plazo) : "—"}</td>
                        <td className="px-3 py-2" data-label="Estado">
                          <SillaEstado sillaId={s.id} estado={s.estado} bloqueoId={bloqueoId} libre={libreSilla(s)} />
                        </td>
                        <td className="px-3 py-2" data-label="Acciones">
                          <div className="flex flex-col items-start gap-1">
                            <PasajeroAcciones
                              sillaId={s.id}
                              bloqueoId={bloqueoId}
                              bloqueada={false}
                              otros={destinosCompatibles}
                              fechaIdaBloqueo={b.fecha_ida}
                              candidatosResponsable={candidatosResponsable.filter((c) => c.sillaId !== s.id)}
                              inicial={{
                                pasajero_nombres: s.pasajero_nombres ?? "", pasajero_apellidos: s.pasajero_apellidos ?? "",
                                tipo_doc: s.tipo_doc ?? "", numero_doc: s.numero_doc ?? "", nacimiento: s.nacimiento ?? "",
                                asesor: s.asesor ?? "", hotel: s.hotel ?? "", acomodacion: s.acomodacion ?? "", plazo: s.plazo ?? "",
                              }}
                              libre={libreSilla(s)}
                              contratoOrganico={!!s.numero_contrato}
                            />
                            {/* Alta de infante SIN silla a cargo de este adulto — exige
                                documento propio (es, a la vez, la autorización de
                                control_vuelo y el ancla del contrato efectivo — migración 168). */}
                            {s.estado !== "cambio" && s.tipo_doc && s.numero_doc && (
                              <InfanteVueloForm
                                bloqueoId={bloqueoId}
                                sillaResponsableId={s.id}
                                fechaIdaBloqueo={b.fecha_ida}
                                modo="crear"
                              />
                            )}
                          </div>
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
                                <span className="text-gray-400">· {inf.tipoId || "—"} {inf.identificacion || "—"}</span>
                                <span className="text-gray-400">· {descripcionEdadInfante(inf.fechaNacimiento, b.fecha_ida)}</span>
                                <span className="rounded bg-gray-200/70 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">No ocupa silla</span>
                                {inf.tipoId && inf.identificacion && inf.fechaNacimiento && (
                                  <InfanteVueloForm
                                    bloqueoId={bloqueoId}
                                    sillaResponsableId={s.id}
                                    fechaIdaBloqueo={b.fecha_ida}
                                    modo="editar"
                                    inicial={{
                                      id: inf.id,
                                      nombreCompleto: inf.nombre,
                                      tipoDoc: inf.tipoId,
                                      numeroDoc: inf.identificacion,
                                      fechaNacimiento: inf.fechaNacimiento,
                                    }}
                                  />
                                )}
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
            </ResponsiveTableShell>
            {!activas.length && <p className="mt-4 text-sm text-gray-400">Este bloqueo no tiene sillas activas.</p>}
            <p className="mt-2 text-xs text-gray-400">Para registrar una venta externa, usa “+ Contrato manual” en un cupo libre. Para quitar un cupo libre, usa “retirar cupo”: la silla no se borra, queda en el historial.</p>

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
            {disponibles > 0 && destinosCompatibles.length > 0 ? (
              <CambiarSillasForm origenId={bloqueoId} disponibles={disponibles} destinos={destinosCompatibles} />
            ) : (
              <p className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-3 text-sm text-gray-400">
                No hay cupos libres para trasladar, o no hay records compatibles (mismo destino y proveedor, sin salir).
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
              <p className="mb-1 text-sm font-semibold text-gray-700">Movimientos históricos</p>
              <p className="mb-2 text-xs text-gray-400">Trazabilidad de traslados, pasajeros movidos y cupos retirados. No son cupos ni se venden.</p>
              {historial.length === 0 ? (
                <p className="text-xs text-gray-400">Sin movimientos de sillas registrados.</p>
              ) : (
                <ul className="space-y-2">
                  {historial.map((e) => {
                    const entra = e.destinoId === bloqueoId;
                    const cupos = entra ? e.cuposDestino : e.cuposOrigen;
                    const nums = entra ? e.numerosDestino : e.numerosOrigen;
                    return (
                      <li key={e.clave} className="border-l-2 pl-3 text-xs" style={{ borderColor: entra ? ESTADO_COLOR.cambio_entrante : ESTADO_COLOR.cambio }}>
                        <div className="text-gray-400">{formatFechaLarga(e.fecha)}{e.registradoPor ? ` · ${e.registradoPor}` : ""}</div>
                        <div className="text-gray-700">{describirEntrada(e, bloqueoId, (rid) => (rid == null ? "—" : recordPorId.get(rid) ?? `#${rid}`))}</div>
                        {(nums.length > 0 || cupos) && (
                          <div className="text-gray-400">
                            {nums.length > 0 ? `Silla(s) ${nums.map((n) => `#${n}`).join(", ")}` : ""}
                            {nums.length > 0 && cupos ? " · " : ""}
                            {cupos ? `cupos ${cupos[0]} → ${cupos[1]}` : ""}
                          </div>
                        )}
                        {e.motivo && <div className="italic text-gray-500">“{e.motivo}”</div>}
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
