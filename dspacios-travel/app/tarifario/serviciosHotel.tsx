"use client";

// Servicios adicionales como subelección de la tarjeta de un hotel: estado de
// la selección, cotización con los datos ACTUALES del hotel y desglose
// hotel + servicios. Nada de esto escribe en el carrito: el botón del hotel
// es el único que agrega, y lo hace con `addConjunto`. Reglas puras en
// lib/tarifario/servicioAdicionalPaquete.ts.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, PencilLine, RotateCw, Undo2, X } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import { buscarReceptivos } from "@/app/(dashboard)/dashboard/reservar/actions";
import type { CartItem, TourCartItem } from "@/lib/cart/CartContext";
import { firmaConjunto, serviciosDeHotel, type MotivoRechazoConjunto } from "@/lib/cart/vinculoServicios";
import {
  alternarSeleccion, claveConsultaServicios, evaluarServicios, mismaCotizacion, mismaSeleccion,
  type ConsultaServicios, type EvaluacionEdicion, type EvaluacionServicios, type HotelParaServicios, type ServicioSeleccionable,
} from "@/lib/tarifario/servicioAdicionalPaquete";

const MENSAJE_ERROR_CONSULTA = "No pudimos cotizar los servicios en este momento. Intenta nuevamente.";
const SIN_SELECCION: readonly number[] = [];

/** #54: conjunto que YA está en el carrito para la reserva EXACTA de una
 * tarjeta — de aquí se hidrata su selección. */
export type ConjuntoGuardado = {
  hotelItemId: string;
  /** `firmaConjunto`: la edición solo se aplica si el carrito sigue igual. */
  firma: string;
  servicioIds: number[];
  /** No `null` = este conjunto no se puede editar desde la tarjeta (y por qué). */
  bloqueo: string | null;
};

export const MENSAJE_SERVICIO_NO_EDITABLE =
  "Este hotel tiene en el carrito un servicio de una versión anterior que no se puede editar en línea. Quita el hotel del carrito y vuelve a agregarlo para cambiar sus servicios.";

/** Conjunto guardado del hotel `hotelItemId`, o `null` si no está en el carrito. */
export function conjuntoGuardadoDe(items: readonly CartItem[], hotelItemId: string | null | undefined): ConjuntoGuardado | null {
  if (!hotelItemId) return null;
  const firma = firmaConjunto(items, hotelItemId);
  if (firma == null) return null;
  const servicios = serviciosDeHotel(items, hotelItemId);
  const servicioIds = servicios.flatMap((s) => (s.tipo === "tour" && typeof s.servicioId === "number" ? [s.servicioId] : []));
  // Un servicio sin `servicioId` no se puede representar en la selección:
  // editar lo haría desaparecer en silencio, así que el conjunto se bloquea.
  return { hotelItemId, firma, servicioIds, bloqueo: servicioIds.length === servicios.length ? null : MENSAJE_SERVICIO_NO_EDITABLE };
}

type Borrador = { hotelItemId: string; firmaBase: string; seleccion: number[] };

/** Selección de servicios de UNA tarjeta. Se vacía sola si cambia el paquete
 * (los servicios de un paquete nunca se arrastran a otro).
 *
 * #54: con `guardado` (el hotel exacto ya está en el carrito) la selección
 * visible ES la guardada hasta que el usuario cambia algo; entonces nace un
 * BORRADOR propio de ese hotel del carrito (con la huella del conjunto sobre
 * el que se empezó) y el carrito no se toca hasta confirmar. Nada se copia en
 * un efecto: lo guardado se lee en cada render, así que la hidratación desde
 * localStorage, un remontaje o un cambio externo del carrito se ven solos y
 * nunca pisan un borrador. Si la tarjeta pasa a otra reserva (o el hotel sale
 * del carrito), el borrador se descarta. */
export function useSeleccionServicios(paqueteId: number | null | undefined, guardado: ConjuntoGuardado | null = null) {
  const pid = paqueteId ?? null;
  const [estado, setEstado] = useState<{ paqueteId: number | null; seleccion: number[]; borrador: Borrador | null }>(
    { paqueteId: pid, seleccion: [], borrador: null },
  );
  // Reinicio DURANTE el render (patrón de React para "resetear estado cuando
  // cambia una prop"): nunca se pinta un frame con la selección del paquete anterior.
  let seleccion = estado.seleccion;
  let borrador = estado.borrador;
  if (estado.paqueteId !== pid) {
    setEstado({ paqueteId: pid, seleccion: [], borrador: null });
    seleccion = [];
    borrador = null;
  } else if (borrador && borrador.hotelItemId !== guardado?.hotelItemId) {
    setEstado((e) => ({ ...e, borrador: null }));
    borrador = null;
  }

  const cambiar = useCallback((f: (s: readonly number[]) => number[]) => {
    if (guardado?.bloqueo) return;
    setEstado((e) => {
      if (!guardado) return { ...e, seleccion: f(e.seleccion) };
      const base = e.borrador?.hotelItemId === guardado.hotelItemId
        ? e.borrador
        : { hotelItemId: guardado.hotelItemId, firmaBase: guardado.firma, seleccion: guardado.servicioIds };
      return { ...e, borrador: { ...base, seleccion: f(base.seleccion) } };
    });
  }, [guardado]);
  const alternar = useCallback((servicioId: number) => cambiar((s) => alternarSeleccion(s, servicioId)), [cambiar]);
  const quitar = useCallback((servicioId: number) => cambiar((s) => s.filter((x) => x !== servicioId)), [cambiar]);
  const descartar = useCallback(() => setEstado((e) => (e.borrador ? { ...e, borrador: null } : e)), []);

  if (!guardado) return { seleccion, paraCotizar: seleccion, alternar, quitar, descartar, edicion: null };
  const propio = borrador?.hotelItemId === guardado.hotelItemId ? borrador : null;
  const actual = propio?.seleccion ?? guardado.servicioIds;
  const cambios = !mismaSeleccion(guardado.servicioIds, actual);
  return {
    seleccion: actual,
    // Sin cambios no se cotiza nada: lo guardado se muestra con su precio del carrito.
    paraCotizar: cambios ? actual : SIN_SELECCION,
    alternar, quitar, descartar,
    edicion: { guardados: guardado.servicioIds, borrador: actual, firmaBase: propio?.firmaBase ?? guardado.firma, cambios },
  };
}

/** Cotiza los servicios seleccionados con los datos actuales del hotel. Una
 * sola consulta a `buscarReceptivos` por estado del hotel (devuelve todos
 * los servicios del paquete); cambiar cualquier dato del hotel cambia la
 * clave, invalida lo anterior y vuelve a cotizar. */
export function useCotizacionServicios(
  hotel: HotelParaServicios,
  seleccion: readonly number[],
  disponibles: readonly ServicioSeleccionable[],
): { evaluacion: EvaluacionServicios; reintentar: () => void; fijarConsulta: (c: ConsultaServicios) => void } {
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
  // #54: la cotización fresca pedida al confirmar reemplaza a la mostrada
  // (si cambió, el usuario ve los precios nuevos antes de volver a confirmar).
  const fijarConsulta = useCallback((c: ConsultaServicios) => setConsulta(c), []);
  return { evaluacion, reintentar, fijarConsulta };
}

export type RevalidacionServicios =
  | { estado: "ok"; evaluacion: EvaluacionServicios }
  | { estado: "cambio"; consulta: ConsultaServicios; mensaje: string }
  | { estado: "error"; mensaje: string };

export const MENSAJE_PRECIOS_SERVICIOS_CAMBIARON =
  "Los precios de los servicios cambiaron desde que los cotizaste. Revisa el total y vuelve a confirmar.";

/** #54: vuelve a cotizar los servicios del borrador con el MISMO motor
 * (`buscarReceptivos`) justo antes de confirmar. Solo `ok` si la cotización
 * fresca es idéntica a la que vio el usuario (`mostrada`); un precio distinto,
 * un servicio que dejó de tener precio o un error nunca dejan pasar el cambio.
 * Nunca lanza. */
export async function revalidarServicios(
  hotel: HotelParaServicios,
  seleccion: readonly number[],
  disponibles: readonly ServicioSeleccionable[],
  mostrada: EvaluacionServicios,
): Promise<RevalidacionServicios> {
  const clave = claveConsultaServicios(hotel);
  if (clave == null) return { estado: "error", mensaje: "Completa fechas, pasajeros y precio del hotel para cotizar los servicios seleccionados." };
  const [paqueteId, fechaIda, fechaRegreso, pax] = JSON.parse(clave) as [number, string, string, number];
  let consulta: ConsultaServicios;
  try {
    const r = await buscarReceptivos({ fechaIda, fechaRegreso, pax, paqueteId });
    if (!r.ok) return { estado: "error", mensaje: r.error || MENSAJE_ERROR_CONSULTA };
    consulta = { clave, estado: "ok", resultados: r.resultados };
  } catch {
    return { estado: "error", mensaje: MENSAJE_ERROR_CONSULTA };
  }
  const nueva = evaluarServicios({ hotel, seleccion, disponibles, consulta });
  if (mismaCotizacion(mostrada, nueva)) return { estado: "ok", evaluacion: nueva };
  return { estado: "cambio", consulta, mensaje: nueva.listo ? MENSAJE_PRECIOS_SERVICIOS_CAMBIARON : (nueva.bloqueo ?? MENSAJE_PRECIOS_SERVICIOS_CAMBIARON) };
}

/** Texto para el usuario cuando el carrito rechaza la actualización. */
export function mensajeRechazoConjunto(motivo: MotivoRechazoConjunto): string {
  switch (motivo) {
    case "hotel_no_encontrado": return "Este hotel ya no está en el carrito. No se aplicó ningún cambio.";
    case "conjunto_cambio": return "Los servicios de este hotel cambiaron en el carrito mientras confirmabas. No se aplicó ningún cambio.";
    case "reserva_distinta": return "La reserva del hotel cambió mientras confirmabas. No se aplicó ningún cambio.";
    case "servicio_invalido": return "Uno de los servicios no corresponde a este paquete. No se aplicó ningún cambio.";
  }
}

/** #54: borrador de los servicios de un hotel que YA está en el carrito —
 * desglose con el total del borrador, servicios que ya no se ofrecen (para
 * quitarlos a conciencia) y los dos comandos: confirmar o descartar. El
 * carrito conserva el conjunto anterior hasta que se confirma. */
export function EdicionServiciosCarrito({
  hotelNombre, precioHotel, moneda, evaluacion, edicion, nombres, avisoHotel, error, confirmando,
  onQuitar, onReintentar, onConfirmar, onDescartar,
}: {
  hotelNombre: string;
  /** Precio del hotel con el que quedaría el conjunto (el guardado si se retiran todos). */
  precioHotel: number | null;
  moneda: string | null;
  evaluacion: EvaluacionServicios;
  edicion: EvaluacionEdicion;
  /** Nombre de cada servicio guardado, para nombrar los que ya no se ofrecen. */
  nombres: Readonly<Record<number, string>>;
  avisoHotel: string | null;
  error: string | null;
  confirmando: boolean;
  onQuitar: (servicioId: number) => void;
  onReintentar: () => void;
  onConfirmar: () => void;
  onDescartar: () => void;
}) {
  const total = edicion.retiroTotal
    ? (precioHotel != null && precioHotel > 0 ? { monto: precioHotel, moneda: (moneda ?? "COP").toUpperCase() } : null)
    : evaluacion.total;
  return (
    <section aria-label="Cambios en los servicios de este hotel" className="space-y-2 rounded-lg border border-gray-200 p-3">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-700"><PencilLine size={14} aria-hidden /> Cambios sin confirmar</p>
        <p className="text-[11px] text-gray-500">El carrito conserva los servicios anteriores hasta que confirmes la actualización.</p>
      </div>
      {edicion.fueraDeCatalogo.length > 0 && (
        <ul className="space-y-1">
          {edicion.fueraDeCatalogo.map((id) => (
            <li key={id} className="flex items-start justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span>«{nombres[id] ?? `Servicio ${id}`}» ya no se ofrece en este paquete.</span>
              <button type="button" onClick={() => onQuitar(id)} disabled={confirmando} aria-label={`Quitar ${nombres[id] ?? `Servicio ${id}`} del conjunto`}
                className="shrink-0 font-semibold underline disabled:opacity-50">
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      {edicion.retiroTotal ? (
        <dl className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <dt className="text-xs text-gray-600">Se quitarán todos los servicios de este hotel; el hotel sigue en el carrito.</dt>
          {total && (
            <dd className="mt-1 flex items-center justify-between gap-3">
              <span className="font-semibold text-gray-800">Total del hotel</span>
              <span className="text-base font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(total.monto, total.moneda)}</span>
            </dd>
          )}
        </dl>
      ) : (
        <DesgloseServicios hotelNombre={hotelNombre} precioHotel={precioHotel} moneda={moneda} evaluacion={evaluacion}
          onQuitar={onQuitar} onReintentar={onReintentar} soloLectura={confirmando} />
      )}
      {avisoHotel && <p className="text-xs text-amber-700">{avisoHotel}</p>}
      {edicion.bloqueo && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{edicion.bloqueo}</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onConfirmar} disabled={!edicion.listo || confirmando}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: "var(--brand-primary)" }}>
          {confirmando
            ? <><Loader2 size={14} className="animate-spin" aria-hidden /> Actualizando el carrito…</>
            : <><Check size={14} aria-hidden /> Confirmar actualización{edicion.listo && total ? ` · ${formatMoneda(total.monto, total.moneda)}` : ""}</>}
        </button>
        <button type="button" onClick={onDescartar} disabled={confirmando}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-50">
          <Undo2 size={14} aria-hidden /> Descartar cambios
        </button>
      </div>
    </section>
  );
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
                  <span className="font-medium text-gray-800">{s.resultado.requiereHora?.length ? "Desde " : ""}{formatMoneda(s.resultado.total, s.resultado.moneda)}</span>
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
            <dt className="font-semibold text-gray-800">{evaluacion.referencial ? "Total referencial (sin recargo por horario)" : "Total hotel + servicios"}</dt>
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

/** Servicios que YA viajan con este hotel en el carrito (solo lectura). Con
 * `pista` (#54) se explica cómo cambiarlos desde la tarjeta. */
export function ServiciosEnCarrito({ servicios, pista = null }: { servicios: readonly TourCartItem[]; pista?: string | null }) {
  if (!servicios.length && !pista) return null;
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
      {servicios.length > 0 && (
        <>
          <p className="font-semibold text-gray-700">En el carrito con este hotel</p>
          <ul className="mt-1 space-y-0.5">
            {servicios.map((s) => (
              <li key={s.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{s.nombre}</span>
                <span className="shrink-0 font-medium">{formatMoneda(s.precio, s.moneda)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {pista && <p className={servicios.length ? "mt-1.5 text-gray-500" : "text-gray-500"}>{pista}</p>}
    </div>
  );
}

export const PISTA_EDITAR_SERVICIOS =
  "Para agregar o quitar servicios, ábrelos en «Servicios adicionales»: el carrito se actualiza cuando confirmes.";

/** Aviso cuando el hotel con el que quedaría el conjunto no tiene la misma
 * tarifa que el guardado (presentación: el checkout siempre re-liquida). */
export function avisoTarifaHotel(guardado: { precio: number; moneda?: string | null }, actual: { precio: number | null; moneda: string | null }): string | null {
  if (actual.precio == null || !(actual.precio > 0)) return null;
  const mg = (guardado.moneda ?? "COP").toUpperCase(), ma = (actual.moneda ?? "COP").toUpperCase();
  if (guardado.precio === actual.precio && mg === ma) return null;
  return `La tarifa actual del hotel (${formatMoneda(actual.precio, ma)}) es distinta a la del carrito (${formatMoneda(guardado.precio, mg)}). Al confirmar, el hotel se actualiza a ${formatMoneda(actual.precio, ma)}.`;
}
