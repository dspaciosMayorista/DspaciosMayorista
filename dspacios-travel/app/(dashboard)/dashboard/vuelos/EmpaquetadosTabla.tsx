"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatFechaLarga } from "@/lib/utils";
import { EstadoBadge } from "@/components/EstadoBadge";
import {
  ESTADO_EMISION_LABEL, ESTADO_PAGO_LABEL, POR_CONFIRMAR,
  labelEstadoEmision, labelEstadoPago, tonoEstadoEmision, tonoEstadoPago,
} from "@/lib/vuelos/control";
import { mesKey, mesLabel, matchControl, SIN_DEFINIR_VAL } from "@/lib/vuelos/filtros";

// Tabla del inventario de Empaquetados (migración 156) — tarifas de SISTEMA,
// sin sillas ni cupos: nunca muestra columnas de ocupación/cupos confirmados
// (a propósito, ver la migración). "Sin record" se muestra como un estado
// normal, nunca como error — una fila puede existir antes de comprarse/
// emitirse. Mismo lenguaje visual que ControlVuelosTabla (filtros + tabla +
// EstadoBadge con los mismos tonos), para que el inventario de Sistema se
// sienta parte de la misma pantalla de vuelos.
// Revisión de PR #268, defecto 3: el requerimiento original era mostrar DOS
// orígenes — tarifas promocionales cargadas a mano ("promocion", tabla
// `empaquetados`) Y records/vuelos por sistema que YA existen como contratos
// reales tipo dinámico ("contrato", `ventas` con tipo_paquete='dinamico').
// Se listan uno junto al otro con el origen explícito — NUNCA se intenta
// "fusionar" un contrato con una fila de `empaquetados` por coincidencia de
// record/aerolínea/fecha (sería adivinar sin una relación real; ver el
// diagnóstico de solo lectura `supabase/scripts/diagnostico_empaquetados_dinamico.sql`).
// Clave estable: `promocion:<id>` / `contrato:<numero_contrato>` — nunca un
// id numérico crudo compartido entre las dos fuentes.
export type OrigenEmpaquetadoFila = "promocion" | "contrato";

export type EmpaquetadoFila = {
  id: string; // clave estable: `promocion:<id>` | `contrato:<numero_contrato>`
  origen: OrigenEmpaquetadoFila;
  record: string | null;
  numeroContrato: string | null; // solo origen "contrato" — para el link
  aerolinea: string | null;
  ruta: string | null;
  fecha_ida: string | null;
  vuelo_ida: string | null;
  fecha_regreso: string | null;
  vuelo_regreso: string | null;
  tarifa_para_empaquetar: number | null; // null en "contrato": no es una tarifa de reventa, es costo interno
  estado_emision: string | null;
  estado_pago: string | null;
  activo: boolean;
};

export function EmpaquetadosTabla({
  filas,
  puedeVerContrato,
}: {
  filas: EmpaquetadoFila[];
  // Hallazgo 2 (ronda posterior al PR #268, "ENLACE DE CONTRATO"): un origen
  // "contrato" siempre enlazaba a /dashboard/contratos/[numero] sin importar
  // el rol de quien mira esta tabla — pero `control_vuelo` (que SÍ entra al
  // módulo Vuelos) no tiene SELECT sobre `ventas`/`contrato_*`, así que ese
  // link cargaba una ficha vacía por RLS, sin ningún aviso. Decidido por el
  // SERVIDOR (`ROLES_CONTRATO_COMPLETO`, lib/roles.ts) y pasado como prop —
  // nunca inferido en el cliente. Cuando es `false`, el número de contrato se
  // muestra como texto plano (sin link, sin acceso a PII/finanzas); el resto
  // de roles (superadmin/gerencia/administracion/operaciones) conserva el
  // link tal como antes.
  puedeVerContrato: boolean;
}) {
  const [fRuta, setFRuta] = useState("");
  const [fMes, setFMes] = useState("");
  const [fAerolinea, setFAerolinea] = useState("");
  const [fEmision, setFEmision] = useState("");
  const [fPago, setFPago] = useState("");

  const rutas = useMemo(() => [...new Set(filas.map((f) => f.ruta).filter((x): x is string => !!x))].sort(), [filas]);
  const meses = useMemo(() => [...new Set(filas.map((f) => mesKey(f.fecha_ida)).filter(Boolean))].sort(), [filas]);
  const aerolineas = useMemo(() => [...new Set(filas.map((f) => f.aerolinea).filter((x): x is string => !!x))].sort(), [filas]);

  const vis = useMemo(
    () =>
      filas
        .filter(
          (f) =>
            (!fRuta || f.ruta === fRuta) &&
            (!fMes || mesKey(f.fecha_ida) === fMes) &&
            (!fAerolinea || f.aerolinea === fAerolinea) &&
            matchControl(f.estado_emision, fEmision) &&
            matchControl(f.estado_pago, fPago)
        )
        .sort((a, b) => (a.fecha_ida ?? "").localeCompare(b.fecha_ida ?? "")),
    [filas, fRuta, fMes, fAerolinea, fEmision, fPago]
  );

  const selCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
  const hayFiltros = fRuta || fMes || fAerolinea || fEmision || fPago;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={fRuta} onChange={(e) => setFRuta(e.target.value)} className={selCls} aria-label="Filtrar por ruta">
          <option value="">Ruta: todas</option>
          {rutas.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={fMes} onChange={(e) => setFMes(e.target.value)} className={selCls} aria-label="Filtrar por mes de salida">
          <option value="">Mes: todos</option>
          {meses.map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}
        </select>
        <select value={fAerolinea} onChange={(e) => setFAerolinea(e.target.value)} className={selCls} aria-label="Filtrar por aerolínea">
          <option value="">Aerolínea: todas</option>
          {aerolineas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={fEmision} onChange={(e) => setFEmision(e.target.value)} className={selCls} aria-label="Filtrar por emisión">
          <option value="">Emisión: todas</option>
          <option value="pendiente">{ESTADO_EMISION_LABEL.pendiente}</option>
          <option value="emitido">{ESTADO_EMISION_LABEL.emitido}</option>
          <option value={SIN_DEFINIR_VAL}>{POR_CONFIRMAR}</option>
        </select>
        <select value={fPago} onChange={(e) => setFPago(e.target.value)} className={selCls} aria-label="Filtrar por pago">
          <option value="">Pago: todos</option>
          <option value="pendiente">{ESTADO_PAGO_LABEL.pendiente}</option>
          <option value="pagado">{ESTADO_PAGO_LABEL.pagado}</option>
          <option value={SIN_DEFINIR_VAL}>{POR_CONFIRMAR}</option>
        </select>
        {hayFiltros && (
          <button
            type="button"
            onClick={() => { setFRuta(""); setFMes(""); setFAerolinea(""); setFEmision(""); setFPago(""); }}
            className="text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            Limpiar
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{vis.length} empaquetado(s)</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-3 py-2">Origen</th>
              {/* "Record / Contrato" (ronda siguiente, hallazgo 1 "CONECTAR
                  CONTRATO_VUELOS CON LA LISTA"): un origen "Contrato" ahora
                  puede o no tener PNR real (contrato_vuelos.record) — "Record"
                  a secas sería engañoso cuando lo que se muestra es el número
                  de contrato porque no hay PNR. */}
              <th className="px-3 py-2">Record / Contrato</th>
              <th className="px-3 py-2">Aerolínea</th>
              <th className="px-3 py-2">Ruta</th>
              <th className="px-3 py-2">Ida</th>
              <th className="px-3 py-2">Regreso</th>
              <th className="px-3 py-2">Tarifa empaquetar</th>
              <th className="px-3 py-2">Emisión</th>
              <th className="px-3 py-2">Pago</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {vis.map((f) => (
              <tr key={f.id} className="border-t border-gray-50">
                <td className="px-3 py-2">
                  {f.origen === "contrato"
                    ? <EstadoBadge estado="Contrato" tono="info" />
                    : <EstadoBadge estado="Promoción" tono="neutral" />}
                </td>
                <td className="px-3 py-2">
                  {f.origen === "contrato" && !puedeVerContrato ? (
                    <span className="font-mono text-sm font-semibold text-gray-500" title="Tu rol no tiene acceso a la ficha del contrato">
                      {f.record ?? f.numeroContrato}
                    </span>
                  ) : (
                    <Link
                      href={f.origen === "contrato" ? `/dashboard/contratos/${f.numeroContrato}` : `/dashboard/vuelos/empaquetados/${f.id.split(":")[1]}`}
                      className="font-mono text-sm font-semibold text-[#1D7C9A] hover:underline"
                    >
                      {/* record real cuando existe (contrato_vuelos.record —
                          hallazgo 1 de esta ronda); si no, el número de
                          contrato para orígenes "contrato", nunca "Sin
                          record" (sí sabemos a qué contrato pertenece). */}
                      {f.origen === "contrato" ? (f.record ?? f.numeroContrato) : (f.record ?? "Sin record")}
                    </Link>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600">{f.aerolinea ?? "—"}</td>
                <td className="px-3 py-2 text-gray-600">{f.ruta ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(f.fecha_ida)}{f.vuelo_ida ? ` · ${f.vuelo_ida}` : ""}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(f.fecha_regreso)}{f.vuelo_regreso ? ` · ${f.vuelo_regreso}` : ""}</td>
                <td className="px-3 py-2 text-gray-700">{f.tarifa_para_empaquetar ? `$${f.tarifa_para_empaquetar.toLocaleString("es-CO")}` : "—"}</td>
                <td className="px-3 py-2"><EstadoBadge estado={labelEstadoEmision(f.estado_emision)} tono={tonoEstadoEmision(f.estado_emision)} /></td>
                <td className="px-3 py-2"><EstadoBadge estado={labelEstadoPago(f.estado_pago)} tono={tonoEstadoPago(f.estado_pago)} /></td>
                <td className="px-3 py-2">
                  {f.activo
                    ? <EstadoBadge estado="Activo" tono="ok" />
                    : <EstadoBadge estado="Inactivo" tono="neutral" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!vis.length && (
        <p className="mt-4 text-center text-sm text-gray-400">No hay empaquetados que coincidan con los filtros.</p>
      )}
    </div>
  );
}
