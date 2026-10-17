"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";
import { formatMoneda } from "@/lib/utils";
import {
  ETIQUETA_FALTA_DESTINO,
  ETIQUETA_POR_CLASIFICAR,
  conteosAviso,
  mensajeFaltanDestinos,
  mensajePorClasificar,
  tieneDestinoFijo,
} from "@/lib/programas/destinoFijo";

export type ProgramaListado = {
  id: number;
  nombre: string;
  subtitulo: string | null;
  dias: number | null;
  noches: number | null;
  publicado: boolean;
  activo: boolean;
  destino_fijo_id: number | null;
  destino: string | null;
  /** El destino asignado es el PROVISIONAL «Por clasificar» (marca es_provisional, no el nombre). */
  destino_es_provisional: boolean;
  proveedor: string | null;
  desde: { neto: number; moneda: string } | null;
};

export type FiltroPendientes = "sin_destino" | "por_clasificar";

/**
 * Aviso de pendientes de destino, con DOS conteos separados: programas SIN destino (ocultos del
 * tarifario) y programas en «Por clasificar» (visibles, falta su destino real). Se muestra CADA VEZ que
 * se monta la página (sin recordar el descarte por sesión/almacenamiento) y solo si alguno es > 0.
 * Es una ventana pequeña y no bloqueante: se cierra con la X o con Escape.
 */
export function AvisoDestinosPendientes({
  sinDestino,
  porClasificar,
  onVer,
}: {
  sinDestino: number;
  porClasificar: number;
  onVer: (f: FiltroPendientes) => void;
}) {
  const [abierto, setAbierto] = useState(sinDestino > 0 || porClasificar > 0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (abierto) ref.current?.focus();
  }, [abierto]);

  if ((sinDestino <= 0 && porClasificar <= 0) || !abierto) return null;
  const btn = "mt-2 rounded-lg px-3 py-1.5 text-xs font-medium text-white";
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby="aviso-destinos-titulo"
      aria-describedby="aviso-destinos-texto"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === "Escape") setAbierto(false); }}
      className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-amber-300 bg-white p-4 shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p id="aviso-destinos-titulo" className="text-sm font-semibold text-gray-900">Programas pendientes de destino</p>
          <div id="aviso-destinos-texto" className="mt-1 space-y-3 text-sm text-gray-600">
            {sinDestino > 0 && (
              <div data-aviso="sin-destino">
                <p>{mensajeFaltanDestinos(sinDestino)}</p>
                <button type="button" onClick={() => { onVer("sin_destino"); setAbierto(false); }} className={btn} style={{ backgroundColor: "var(--brand-primary)" }}>
                  Ver sin destino
                </button>
              </div>
            )}
            {porClasificar > 0 && (
              <div data-aviso="por-clasificar">
                <p>{mensajePorClasificar(porClasificar)}</p>
                <button type="button" onClick={() => { onVer("por_clasificar"); setAbierto(false); }} className={btn} style={{ backgroundColor: "var(--brand-primary)" }}>
                  Ver por clasificar
                </button>
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          aria-label="Cerrar aviso"
          className="rounded p-1 text-gray-400 hover:text-gray-700"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function ProgramasLista({ programas }: { programas: ProgramaListado[] }) {
  const [filtro, setFiltro] = useState<FiltroPendientes | null>(null);
  const { sinDestino, porClasificar } = conteosAviso(programas.map((p) => ({ activo: p.activo, destino_fijo_id: p.destino_fijo_id, destino_es_provisional: p.destino_es_provisional })));
  const visibles =
    filtro === "sin_destino" ? programas.filter((p) => p.activo && !tieneDestinoFijo(p))
    : filtro === "por_clasificar" ? programas.filter((p) => p.activo && tieneDestinoFijo(p) && p.destino_es_provisional)
    : programas;

  return (
    <>
      <AvisoDestinosPendientes sinDestino={sinDestino} porClasificar={porClasificar} onVer={setFiltro} />

      {filtro && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>
            Mostrando solo los {visibles.length} programa(s) activos {filtro === "sin_destino" ? "sin destino (ocultos del tarifario)" : "en «Por clasificar» (visibles, falta su destino real)"}.
          </span>
          <button type="button" onClick={() => setFiltro(null)} className="font-medium underline">
            Ver todos
          </button>
        </div>
      )}

      {!programas.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">Aún no hay programas</p>
          <p className="mt-1 text-sm">Crea el primero con el botón “Nuevo programa”.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {visibles.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/producto/programas/${p.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-5 transition-all hover:border-[#1D7C9A] hover:shadow-sm"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-gray-800">{p.nombre}</span>
                  {p.publicado ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Publicado</span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Borrador</span>
                  )}
                  {tieneDestinoFijo(p) && p.destino_es_provisional && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                      {ETIQUETA_POR_CLASIFICAR}
                    </span>
                  )}
                  {!tieneDestinoFijo(p) && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      <AlertTriangle size={12} aria-hidden="true" /> {ETIQUETA_FALTA_DESTINO}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-gray-500">
                  {p.subtitulo ?? "—"}
                  {p.dias ? ` · ${p.dias}d/${p.noches ?? ""}n` : ""}
                  {p.destino ? ` · Destino: ${p.destino}` : ""}
                  {p.proveedor ? ` · ${p.proveedor}` : ""}
                </p>
              </div>
              {p.desde && (
                <div className="text-right">
                  <div className="text-xs text-gray-400">desde (neto)</div>
                  <div className="font-semibold" style={{ color: "var(--brand-primary)" }}>
                    {formatMoneda(p.desde.neto, p.desde.moneda)}
                  </div>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
