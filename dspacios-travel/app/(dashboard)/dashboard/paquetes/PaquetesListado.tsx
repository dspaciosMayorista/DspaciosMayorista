"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoneda } from "@/lib/utils";
import { EliminarPaqueteBtn } from "./EliminarPaqueteBtn";
import { DuplicarPaqueteBtn } from "./DuplicarPaqueteBtn";
import { TABS_TIPO_PAQUETE, construirUrlConTab, filtrarYOrdenarPaquetes, type TipoPaquete } from "./tipo-paquetes";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleAlert, ClipboardList, Clock } from "lucide-react";
import type { ClavePublicacion, PublicacionPaquete, TonoPublicacion } from "@/lib/paquetes/estadoPublicacion";
import { etiquetaDias, type EstadoCompra } from "@/lib/paquetes/vencimientoCompra";

const TONO_PUBLICACION: Record<TonoPublicacion, string> = { ok: "bg-emerald-50 text-emerald-700", aviso: "bg-amber-100 text-amber-800", error: "bg-red-50 text-red-700" };
const ICONO_PUBLICACION: Record<ClavePublicacion, typeof Clock> = {
  publicado: CheckCircle2, publicado_avisos: AlertTriangle, publicado_oculto: Clock, error: CircleAlert, generando: Clock, pendiente: Clock, desactualizado: Clock,
  cotizacion_unidad: ClipboardList, bajo_solicitud: ClipboardList, sin_oferta: AlertTriangle, oferta_sin_verificar: AlertTriangle,
};

export type PaqueteItem = {
  id: number;
  nombre: string;
  activo: boolean;
  pctMk: number;
  tipo: TipoPaquete;
  destino: string | null;
  fechaViajeInicio: string | null;
  fechaViajeFin: string | null;
  nTarifas: number;
  /** #36: estado de publicación derivado del estado autoritativo del tarifario (no del check «Activo»). */
  publicacion: PublicacionPaquete;
  /** #13: fin de la vigencia de compra del paquete y su estado frente a hoy (Bogotá). */
  compra: { fin: string | null; estado: EstadoCompra; dias: number | null };
  /** «Desde» = tarifa DOBLE publicable, un importe por moneda (nunca mezcladas). Vacío = «Consultar». */
  desde: { moneda: string; valor: number }[];
};

export function PaquetesListado({ paquetes, tabInicial }: { paquetes: PaqueteItem[]; tabInicial: TipoPaquete }) {
  // `tabInicial` ya viene resuelto por el Server Component (page.tsx, vía
  // resolverTabInicial() sobre `searchParams`) — se usa directo como valor
  // inicial del estado, sin un efecto que lea `window` después de montar:
  // eso evitaba el flash pestaña-por-defecto → pestaña-real y disparaba
  // react-hooks/set-state-in-effect. Cambiar de pestaña sigue siendo 100%
  // en memoria (filtra sobre `paquetes`, ya cargado por el server).
  const [tab, setTab] = useState<TipoPaquete>(tabInicial);

  // El query string es solo una conveniencia (conservar el filtro al
  // recargar/compartir el link). Se escribe con history.replaceState —
  // nunca router.push/replace — para NO disparar una navegación/refetch de
  // este Server Component: los datos ya están cargados y cambiar de
  // pestaña filtra en memoria. Se construye la URL completa a partir de
  // `window.location.href` (conserva pathname, cualquier otro query param y
  // el hash — solo se toca `tipo`) y se pasa `window.history.state` como
  // primer argumento (en vez de `null`) para no pisar el estado interno que
  // Next.js guarda ahí (scroll/navegación).
  function seleccionarTab(siguiente: TipoPaquete) {
    setTab(siguiente);
    window.history.replaceState(window.history.state, "", construirUrlConTab(window.location.href, siguiente));
  }

  const visibles = useMemo(() => filtrarYOrdenarPaquetes(paquetes, tab), [paquetes, tab]);

  if (!paquetes.length) {
    return (
      <div className="mt-6 rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
        <p className="text-lg">No hay paquetes armados</p>
        <p className="mt-1 text-sm">Crea el primero con “Nuevo paquete”.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mt-4 flex gap-5 overflow-x-auto border-b border-gray-200">
        {TABS_TIPO_PAQUETE.map((t) => {
          const activo = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => seleccionarTab(t.key)}
              aria-pressed={activo}
              className="shrink-0 whitespace-nowrap border-b-2 bg-transparent px-1 pb-2 pt-1 text-sm font-medium tracking-wide transition-colors"
              style={
                activo
                  ? { borderColor: "var(--brand-primary)", color: "var(--brand-primary)" }
                  : { borderColor: "transparent", color: "#6b7280" }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {!visibles.length ? (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
          <p className="text-base">Sin paquetes en esta categoría</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((p) => (
            <div
              key={p.id}
              className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 transition hover:border-[var(--brand-accent)] hover:shadow-sm"
            >
              <Link href={`/dashboard/paquetes/${p.id}`} className="block">
                <div className="flex items-start justify-between gap-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: p.activo ? "var(--brand-success)" : "#9ca3af" }}
                  >
                    {p.activo ? "Activo" : "Inactivo"}
                  </span>
                  <span className="text-xs text-gray-400">mk {Math.round((p.pctMk ?? 0) * 100)}%</span>
                </div>
                <h2 className="mt-2 font-semibold text-gray-900">{p.nombre}</h2>
                <p className="text-xs text-gray-500">
                  {p.destino ?? "Sin destino"}
                  {p.fechaViajeInicio ? ` · viaje ${p.fechaViajeInicio} → ${p.fechaViajeFin ?? ""}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="publicacion-paquete">
                  {(() => {
                    const Icono = ICONO_PUBLICACION[p.publicacion.clave];
                    return (
                      <span data-estado={p.publicacion.clave} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONO_PUBLICACION[p.publicacion.tono]}`}>
                        <Icono size={12} aria-hidden="true" />{p.publicacion.etiqueta}
                      </span>
                    );
                  })()}
                  {p.publicacion.secundarias.map((s) => (
                    <span key={s} className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700"><ClipboardList size={12} aria-hidden="true" />{s}</span>
                  ))}
                  {p.activo && (p.compra.estado === "por_vencer" || p.compra.estado === "vence_hoy" || p.compra.estado === "vencida") && (
                    <span data-compra={p.compra.estado} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${p.compra.estado === "por_vencer" ? "bg-amber-100 text-amber-800" : "bg-red-50 text-red-700"}`}>
                      <CalendarClock size={12} aria-hidden="true" />
                      {p.compra.estado === "vencida" ? "Compra vencida" : `Compra: ${etiquetaDias(p.compra.dias ?? 0).toLowerCase()}`}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words text-xs text-gray-500">{p.publicacion.detalle ?? ""}</span>
                  {p.nTarifas > 0 && (
                    <span className="text-sm">
                      {p.desde.length ? (
                        <>
                          Desde{" "}
                          {p.desde.map((d, i) => (
                            <span key={d.moneda}>
                              {i > 0 && <span className="text-gray-400"> · </span>}
                              <b style={{ color: "var(--brand-primary)" }}>{formatMoneda(d.valor, d.moneda)}</b>
                            </span>
                          ))}
                        </>
                      ) : (
                        <span className="text-gray-400">Consultar</span>
                      )}
                    </span>
                  )}
                </div>
              </Link>
              <div className="mt-2 flex items-center justify-end gap-4 border-t border-gray-100 pt-2">
                <DuplicarPaqueteBtn id={p.id} nombre={p.nombre} />
                <EliminarPaqueteBtn id={p.id} nombre={p.nombre} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
