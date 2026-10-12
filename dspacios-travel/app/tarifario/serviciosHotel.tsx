"use client";

// Servicios adicionales como subelección de la tarjeta de un hotel: estado de
// la selección, cotización con los datos ACTUALES del hotel y desglose
// hotel + servicios. Nada de esto escribe en el carrito: el botón del hotel
// es el único que agrega, y lo hace con `addConjunto`. Reglas puras en
// lib/tarifario/servicioAdicionalPaquete.ts.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RotateCw, X } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import { buscarReceptivos } from "@/app/(dashboard)/dashboard/reservar/actions";
import type { TourCartItem } from "@/lib/cart/CartContext";
import {
  alternarSeleccion, claveConsultaServicios, evaluarServicios,
  type ConsultaServicios, type EvaluacionServicios, type HotelParaServicios, type ServicioSeleccionable,
} from "@/lib/tarifario/servicioAdicionalPaquete";

const MENSAJE_ERROR_CONSULTA = "No pudimos cotizar los servicios en este momento. Intenta nuevamente.";

/** Selección de servicios de UNA tarjeta. Se vacía sola si cambia el paquete
 * (los servicios de un paquete nunca se arrastran a otro). */
export function useSeleccionServicios(paqueteId: number | null | undefined) {
  const pid = paqueteId ?? null;
  const [estado, setEstado] = useState<{ paqueteId: number | null; seleccion: number[] }>({ paqueteId: pid, seleccion: [] });
  // Reinicio DURANTE el render (patrón de React para "resetear estado cuando
  // cambia una prop"): nunca se pinta un frame con la selección del paquete anterior.
  let seleccion = estado.seleccion;
  if (estado.paqueteId !== pid) {
    setEstado({ paqueteId: pid, seleccion: [] });
    seleccion = [];
  }
  const alternar = useCallback((servicioId: number) => setEstado((e) => ({ ...e, seleccion: alternarSeleccion(e.seleccion, servicioId) })), []);
  const quitar = useCallback((servicioId: number) => setEstado((e) => ({ ...e, seleccion: e.seleccion.filter((s) => s !== servicioId) })), []);
  return { seleccion, alternar, quitar };
}

/** Cotiza los servicios seleccionados con los datos actuales del hotel. Una
 * sola consulta a `buscarReceptivos` por estado del hotel (devuelve todos
 * los servicios del paquete); cambiar cualquier dato del hotel cambia la
 * clave, invalida lo anterior y vuelve a cotizar. */
export function useCotizacionServicios(
  hotel: HotelParaServicios,
  seleccion: readonly number[],
  disponibles: readonly ServicioSeleccionable[],
): { evaluacion: EvaluacionServicios; reintentar: () => void } {
  const clave = claveConsultaServicios(hotel);
  const [consulta, setConsulta] = useState<ConsultaServicios | null>(null);
  const necesita = seleccion.length > 0 && clave != null && consulta?.clave !== clave;

  useEffect(() => {
    if (!necesita || clave == null) return;
    // La clave ya contiene paquete/fechas/pax — se leen de ahí para que este
    // efecto dependa SOLO de ella (si cambia, la consulta en vuelo se descarta).
    const [paqueteId, fechaIda, fechaRegreso, pax] = JSON.parse(clave) as [number, string, string, number];
    let vigente = true;
    const t = setTimeout(async () => {
      let c: ConsultaServicios;
      try {
        const r = await buscarReceptivos({ fechaIda, fechaRegreso, pax, paqueteId });
        c = r.ok ? { clave, estado: "ok", resultados: r.resultados } : { clave, estado: "error", mensaje: r.error };
      } catch {
        c = { clave, estado: "error", mensaje: MENSAJE_ERROR_CONSULTA };
      }
      if (vigente) setConsulta(c);
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [necesita, clave]);

  const evaluacion = evaluarServicios({ hotel, seleccion, disponibles, consulta });
  const reintentar = useCallback(() => setConsulta(null), []);
  return { evaluacion, reintentar };
}

/** Desglose hotel + servicios + total, con el estado de cada servicio. */
export function DesgloseServicios({ hotelNombre, precioHotel, moneda, evaluacion, onQuitar, onReintentar, soloLectura = false }: {
  hotelNombre: string;
  /** Sin botones de quitar (ej. mientras se confirma el hotel en el servidor). */
  soloLectura?: boolean;
  precioHotel: number | null;
  moneda: string | null;
  evaluacion: EvaluacionServicios;
  onQuitar: (servicioId: number) => void;
  onReintentar: () => void;
}) {
  if (!evaluacion.servicios.length) return null;
  const hayError = evaluacion.servicios.some((s) => s.estado === "error");
  return (
    <div aria-live="polite" className="space-y-2">
      <dl className="divide-y divide-gray-100 rounded-lg bg-gray-50 px-3 text-sm">
        <div className="flex items-start justify-between gap-3 py-2">
          <dt className="min-w-0 text-gray-600">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Hotel</span>
            <span className="block truncate">{hotelNombre}</span>
          </dt>
          <dd className="shrink-0 text-right font-medium text-gray-800">
            {precioHotel != null && precioHotel > 0 ? formatMoneda(precioHotel, moneda) : <span className="text-xs font-normal text-gray-400">Sin cotizar</span>}
          </dd>
        </div>
        {evaluacion.servicios.map((s) => (
          <div key={s.servicioId} className="py-2">
            <div className="flex items-start justify-between gap-3">
              <dt className="min-w-0 text-gray-600">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Servicio</span>
                <span className="block">{s.nombre}</span>
                {s.estado === "ok" && s.resultado && <span className="block text-xs text-gray-400">{s.resultado.pax} pax</span>}
              </dt>
              <dd className="flex shrink-0 items-center gap-2 text-right">
                {s.estado === "ok" && s.resultado ? (
                  <span className="font-medium text-gray-800">{formatMoneda(s.resultado.total, s.resultado.moneda)}</span>
                ) : s.estado === "cotizando" ? (
                  <span className="inline-flex items-center gap-1 text-xs text-gray-500"><Loader2 size={12} className="animate-spin" aria-hidden /> Cotizando…</span>
                ) : s.estado === "faltan_datos" ? (
                  <span className="text-xs text-gray-400">Pendiente</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><AlertTriangle size={12} aria-hidden /> Sin precio</span>
                )}
                {!soloLectura && (
                  <button type="button" onClick={() => onQuitar(s.servicioId)} aria-label={`Quitar ${s.nombre} de la selección`}
                    className="rounded p-0.5 text-gray-400 hover:text-gray-700">
                    <X size={14} aria-hidden />
                  </button>
                )}
              </dd>
            </div>
            {s.mensaje && s.estado !== "error" && <p className="mt-1 text-xs text-amber-700">{s.mensaje}</p>}
          </div>
        ))}
        {evaluacion.total && (
          <div className="flex items-center justify-between gap-3 py-2">
            <dt className="font-semibold text-gray-800">Total hotel + servicios</dt>
            <dd className="text-base font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(evaluacion.total.monto, evaluacion.total.moneda)}</dd>
          </div>
        )}
      </dl>
      {evaluacion.bloqueo && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {hayError ? (evaluacion.servicios.find((s) => s.estado === "error")?.mensaje ?? MENSAJE_ERROR_CONSULTA) : evaluacion.bloqueo}
          {hayError && (
            <button type="button" onClick={onReintentar} className="ml-2 inline-flex items-center gap-1 font-semibold underline">
              <RotateCw size={12} aria-hidden /> Reintentar
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/** Texto del botón del hotel según cuántos servicios van con él. */
export function etiquetaAgregarConjunto(nServicios: number, base = "Agregar al carrito"): string {
  if (!nServicios) return base;
  return `Agregar hotel + ${nServicios} servicio${nServicios === 1 ? "" : "s"}`;
}

/** Props de selección para `ReceptivoModal` abierto desde la tarjeta de un hotel. */
export function seleccionParaModal(
  servicioId: number | null | undefined,
  sel: { seleccion: readonly number[]; alternar: (servicioId: number) => void },
  motivoBloqueo: string | null,
): { seleccionado: boolean; onAlternar: () => void; motivoBloqueo: string | null } {
  if (servicioId == null) {
    return { seleccionado: false, onAlternar: () => {}, motivoBloqueo: "Este servicio no se puede cotizar en línea. Consulta a un asesor." };
  }
  return { seleccionado: sel.seleccion.includes(servicioId), onAlternar: () => sel.alternar(servicioId), motivoBloqueo };
}

/** Servicios que YA viajan con este hotel en el carrito (solo lectura). */
export function ServiciosEnCarrito({ servicios }: { servicios: readonly TourCartItem[] }) {
  if (!servicios.length) return null;
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <p className="font-semibold text-gray-700">En el carrito con este hotel</p>
      <ul className="mt-1 space-y-0.5">
        {servicios.map((s) => (
          <li key={s.id} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{s.nombre}</span>
            <span className="shrink-0 font-medium">{formatMoneda(s.precio, s.moneda)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
