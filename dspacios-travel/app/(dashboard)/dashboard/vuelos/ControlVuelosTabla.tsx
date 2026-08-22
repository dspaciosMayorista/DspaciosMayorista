"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatFechaLarga } from "@/lib/utils";
import { EstadoBadge } from "@/components/EstadoBadge";
import {
  MODALIDAD_LABEL, MODALIDAD_CONTROL_LABEL, ESTADO_EMISION_LABEL, ESTADO_PAGO_LABEL, SIN_DEFINIR, POR_CONFIRMAR,
  labelModalidadControl, labelEstadoEmision, labelEstadoPago,
  tonoModalidadControl, tonoEstadoEmision, tonoEstadoPago,
  type ModalidadControl,
} from "@/lib/vuelos/control";
import { mesKey, mesLabel, matchControl, SIN_DEFINIR_VAL } from "@/lib/vuelos/filtros";

// Tabla de CONTROL: modalidad/emisión/pago por record — independiente del
// inventario de sillas (esa vista vive en `BloqueosTabla`). Modalidad,
// Emisión y Pago son columnas separadas (no un solo badge combinado como
// `ControlBadges`, que se usa en el detalle del record con la MISMA
// semántica de color — ambos toman el tono de tonoModalidad/tonoEstadoEmision/
// tonoEstadoPago en lib/vuelos/control.ts).
//
// FUSIÓN con Empaquetados (Sistema): esta tabla mezcla filas de dos tablas
// distintas (`bloqueos_vuelo` y `empaquetados`) — NUNCA se mezclan sus ids
// numéricos crudos (un id=12 de un bloqueo y un id=12 de un empaquetado son
// filas completamente distintas). Cada fila trae una clave discriminada
// `origen:id` (`bloqueo:12` / `sistema:12`) como `id` de React, y `origen`+
// `numericId` por separado para construir el link correcto a cada detalle
// (`/dashboard/vuelos/{id}` vs `/dashboard/vuelos/empaquetados/{id}`).
export type ControlOrigen = "bloqueo" | "sistema";
export type ControlFila = {
  id: string;             // clave discriminada "bloqueo:12" / "sistema:12" — NUNCA un id crudo compartido
  origen: ControlOrigen;
  numericId: number;
  record: string | null;  // nullable: un empaquetado puede no tener PNR todavía
  aerolinea: string | null;
  ruta: string | null;
  fecha_ida: string | null;
  vuelo_ida: string | null;
  fecha_regreso: string | null;
  vuelo_regreso: string | null;
  fecha_emision: string | null; // "Fecha límite de emisión" — SOLO aplica a bloqueos; null en sistema (concepto distinto: vigencia de compra, ver el detalle del empaquetado)
  modalidad: ModalidadControl | null;
  estado_emision: string | null;
  estado_pago: string | null;
};

function hrefDetalle(f: ControlFila): string {
  return f.origen === "bloqueo" ? `/dashboard/vuelos/${f.numericId}` : `/dashboard/vuelos/empaquetados/${f.numericId}`;
}

export function ControlVuelosTabla({ filas }: { filas: ControlFila[] }) {
  const [fRuta, setFRuta] = useState("");
  const [fMes, setFMes] = useState("");
  const [fModalidad, setFModalidad] = useState("");
  const [fEmision, setFEmision] = useState("");
  const [fPago, setFPago] = useState("");

  const rutas = useMemo(() => [...new Set(filas.map((b) => b.ruta).filter((x): x is string => !!x))].sort(), [filas]);
  const meses = useMemo(() => [...new Set(filas.map((b) => mesKey(b.fecha_ida)).filter(Boolean))].sort(), [filas]);

  const vis = useMemo(
    () =>
      filas.filter(
        (b) =>
          (!fRuta || b.ruta === fRuta) &&
          (!fMes || mesKey(b.fecha_ida) === fMes) &&
          (!fModalidad || (fModalidad === SIN_DEFINIR_VAL ? b.modalidad == null : b.modalidad === fModalidad)) &&
          matchControl(b.estado_emision, fEmision) &&
          matchControl(b.estado_pago, fPago)
      ),
    [filas, fRuta, fMes, fModalidad, fEmision, fPago]
  );

  const selCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
  const hayFiltros = fRuta || fMes || fModalidad || fEmision || fPago;

  return (
    <div>
      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={fRuta} onChange={(e) => setFRuta(e.target.value)} className={selCls} aria-label="Filtrar por ruta">
          <option value="">Ruta: todas</option>
          {rutas.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={fMes} onChange={(e) => setFMes(e.target.value)} className={selCls} aria-label="Filtrar por mes de salida">
          <option value="">Mes: todos</option>
          {meses.map((m) => <option key={m} value={m}>{mesLabel(m)}</option>)}
        </select>
        <select value={fModalidad} onChange={(e) => setFModalidad(e.target.value)} className={selCls} aria-label="Filtrar por modalidad">
          <option value="">Modalidad: todas</option>
          <option value="sistema">{MODALIDAD_CONTROL_LABEL.sistema}</option>
          <option value="serie">{MODALIDAD_LABEL.serie}</option>
          <option value="grupo">{MODALIDAD_LABEL.grupo}</option>
          <option value={SIN_DEFINIR_VAL}>{SIN_DEFINIR}</option>
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
            onClick={() => { setFRuta(""); setFMes(""); setFModalidad(""); setFEmision(""); setFPago(""); }}
            className="text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            Limpiar
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{vis.length} record(s)</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-3 py-2">Record</th>
              <th className="px-3 py-2">Aerolínea</th>
              <th className="px-3 py-2">Ruta</th>
              <th className="px-3 py-2">Ida</th>
              <th className="px-3 py-2">Regreso</th>
              <th className="px-3 py-2">Fecha límite de emisión</th>
              <th className="px-3 py-2">Modalidad</th>
              <th className="px-3 py-2">Emisión</th>
              <th className="px-3 py-2">Pago</th>
            </tr>
          </thead>
          <tbody>
            {vis.map((b) => (
              <tr key={b.id} className="border-t border-gray-50">
                <td className="px-3 py-2">
                  <Link href={hrefDetalle(b)} className="font-mono text-sm font-semibold text-[#1D7C9A] hover:underline">
                    {b.record ?? "Sin record"}
                  </Link>
                </td>
                <td className="px-3 py-2 text-gray-600">{b.aerolinea ?? "—"}</td>
                <td className="px-3 py-2 text-gray-600">{b.ruta ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(b.fecha_ida)}{b.vuelo_ida ? ` · ${b.vuelo_ida}` : ""}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(b.fecha_regreso)}{b.vuelo_regreso ? ` · ${b.vuelo_regreso}` : ""}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{b.origen === "bloqueo" ? formatFechaLarga(b.fecha_emision) : "—"}</td>
                <td className="px-3 py-2"><EstadoBadge estado={labelModalidadControl(b.modalidad)} tono={tonoModalidadControl(b.modalidad)} /></td>
                <td className="px-3 py-2"><EstadoBadge estado={labelEstadoEmision(b.estado_emision)} tono={tonoEstadoEmision(b.estado_emision)} /></td>
                <td className="px-3 py-2"><EstadoBadge estado={labelEstadoPago(b.estado_pago)} tono={tonoEstadoPago(b.estado_pago)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
