import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { miRol, ROLES_EDITOR_VUELOS_CONTRATO } from "@/lib/roles";
import { formatFechaLarga } from "@/lib/utils";
import { EstadoBadge } from "@/components/EstadoBadge";
import { labelEstadoEmision, labelEstadoPago, tonoEstadoEmision, tonoEstadoPago } from "@/lib/vuelos/control";
import { TramosEditor } from "./TramosEditor";
import { ControlEmisionForm } from "./ControlEmisionForm";

export const dynamic = "force-dynamic";

// Editor operativo de vuelos del contrato (migración 157) — pestaña
// Empaquetados, filas de origen "Contrato". A propósito NO es la ficha
// financiera completa del contrato (esa sigue en /dashboard/contratos/
// [numero], superadmin-only para el contenido vía ContenidoContratoEditor):
// esta pantalla es accesible también para `control_vuelo`, y por eso NUNCA
// consulta ni muestra cliente/pasajeros/precios/costos/cuentas bancarias —
// solo lo que ya expone `ventas_vuelo_sistema`/`contrato_vuelos_editor`
// (ambas vistas ya filtran esas columnas en Postgres, no aquí).
export default async function EditorVuelosContratoPage({ params }: { params: Promise<{ numero: string }> }) {
  const { numero: numeroParam } = await params;
  const numero = decodeURIComponent(numeroParam);

  const rol = await miRol();
  if (!rol || !ROLES_EDITOR_VUELOS_CONTRATO.includes(rol)) {
    return (
      <div className="mx-auto max-w-[900px] p-4 md:p-8">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Tu rol no tiene acceso al editor operativo de vuelos del contrato.
        </div>
      </div>
    );
  }

  const sb = await createClient();
  const [{ data: resumen, error: errResumen }, { data: tramos, error: errTramos }, { data: historial, error: errHistorial }] =
    await Promise.all([
      sb.from("ventas_vuelo_sistema").select("*").eq("numero_contrato", numero).maybeSingle(),
      sb.from("contrato_vuelos_editor").select("*").eq("numero_contrato", numero).order("orden", { ascending: true }),
      sb.from("contrato_vuelo_control_cambios").select("id, detalle, nota, registrado_por, created_at").eq("numero_contrato", numero).order("created_at", { ascending: false }),
    ]);

  // Fallo real de la consulta (red/RLS/timeout) — NUNCA se confunde con
  // "el contrato no existe o no tengo permiso" (defecto pedido explícitamente:
  // "un error de consulta debe mostrarse como error, no como sin información").
  if (errResumen || errTramos) {
    return (
      <div className="mx-auto max-w-[900px] p-4 md:p-8">
        <Link href="/dashboard/vuelos?vista=empaquetados" className="text-sm text-gray-400 hover:text-gray-600">← Empaquetados</Link>
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          No se pudo cargar el vuelo de este contrato: {(errResumen ?? errTramos)?.message}
        </div>
      </div>
    );
  }

  if (!resumen) {
    return (
      <div className="mx-auto max-w-[900px] p-4 md:p-8">
        <Link href="/dashboard/vuelos?vista=empaquetados" className="text-sm text-gray-400 hover:text-gray-600">← Empaquetados</Link>
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          Contrato {numero} no encontrado, sin vuelo por sistema (bloqueo/porción sin origen dinámico) o sin permiso para verlo desde tu tenant.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] p-4 md:p-8">
      <Link href="/dashboard/vuelos?vista=empaquetados" className="text-sm text-gray-400 hover:text-gray-600">← Empaquetados</Link>

      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h1 className="font-mono text-2xl font-semibold text-gray-900">{resumen.numero_contrato}</h1>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-sm text-gray-600">{resumen.aerolinea ?? "Sin aerolínea"}</span>
        <EstadoBadge estado="Contrato" tono="info" />
      </div>
      <p className="mt-1 text-sm text-gray-500">{resumen.ruta ?? "Sin ruta cargada"}</p>
      <p className="text-xs text-gray-400">
        Salida {formatFechaLarga(resumen.fecha_salida)}
        {resumen.fecha_regreso ? ` · Regreso ${formatFechaLarga(resumen.fecha_regreso)}` : ""}
        {resumen.record ? ` · Record ${resumen.record}` : " · Sin PNR"}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <EstadoBadge estado={labelEstadoEmision(resumen.estado_emision)} tono={tonoEstadoEmision(resumen.estado_emision)} />
        <EstadoBadge estado={labelEstadoPago(resumen.estado_pago)} tono={tonoEstadoPago(resumen.estado_pago)} />
        {resumen.cxp_aereas_total ? (
          <span className="text-xs text-gray-400">
            {resumen.cxp_aereas_pagadas} de {resumen.cxp_aereas_total} cuentas por pagar aéreas pagadas
          </span>
        ) : null}
      </div>

      <div className="mt-5">
        <ControlEmisionForm numeroContrato={numero} estadoEmisionInicial={resumen.estado_emision} />
      </div>

      <div className="mt-5">
        <TramosEditor numeroContrato={numero} tramosIniciales={tramos ?? []} />
      </div>

      <section className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-gray-700">Historial de emisión</p>
        {errHistorial ? (
          <p className="text-xs text-red-600">No se pudo cargar el historial: {errHistorial.message}</p>
        ) : !historial?.length ? (
          <p className="text-xs text-gray-400">Sin cambios de estado de emisión registrados todavía.</p>
        ) : (
          <ul className="space-y-2">
            {historial.map((h) => (
              <li key={h.id} className="border-l-2 border-gray-200 pl-3 text-xs">
                <div className="text-gray-400">{formatFechaLarga(h.created_at)}{h.registrado_por ? ` · ${h.registrado_por}` : ""}</div>
                {h.detalle && <div className="text-gray-700">{h.detalle}</div>}
                {h.nota && <div className="text-gray-500 italic">“{h.nota}”</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
