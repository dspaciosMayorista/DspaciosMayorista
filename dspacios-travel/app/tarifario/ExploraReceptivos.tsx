"use client";

import Image from "next/image";
import { formatMoneda } from "@/lib/utils";
import type { Receptivo, ReceptivoModalInfo } from "./tarjetaHotelCompartida";

/**
 * Catálogo general de receptivos que se muestra DEBAJO de «Tu búsqueda» (Vista Booking > Receptivos). Se distingue a propósito de los resultados de la búsqueda:
 * encabezado propio, fondo y borde discontinuo distintos y una nota que dice que estas tarjetas NO aplican los filtros buscados (fechas, pasajeros, tipo, modalidad)
 * y que el precio es el «desde» por persona, no el de una búsqueda.
 */
export function ExploraReceptivos({ porDestino, onVer }: { porDestino: [string, Receptivo[]][]; onVer: (info: ReceptivoModalInfo) => void }) {
  return (
    <section aria-labelledby="titulo-explora-receptivos" data-testid="explora-receptivos" className="mt-12 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 sm:p-6">
      <h2 id="titulo-explora-receptivos" className="text-base font-bold text-slate-800">Explora todos los receptivos</h2>
      <p className="mb-6 mt-1 text-xs text-slate-500" data-testid="explora-nota">
        Catálogo general del destino: estas tarjetas no aplican los filtros de tu búsqueda (fechas, pasajeros, tipo ni modalidad) y pueden no estar disponibles para ellos. El precio es «desde», por persona.
      </p>
      <div className="space-y-8">
        {porDestino.map(([destino, items]) => (
          <div key={destino}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              {destino} <span className="ml-1 font-normal normal-case text-gray-400">({items.length})</span>
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onVer({ nombre: r.nombre, destino: r.destino, descripcion: r.descripcion, foto: r.foto, precio: r.desde, moneda: r.moneda, notaPrecio: "desde · por persona", paqueteId: r.paqueteId })}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-left transition-all hover:-translate-y-1 hover:shadow-[0_20px_48px_rgba(0,0,0,0.14)] hover:border-[var(--brand-accent)]"
                >
                  <div className="relative aspect-[16/10] w-full bg-gray-100">
                    {r.foto ? (
                      <Image src={r.foto} alt={r.nombre} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover transition-transform group-hover:scale-[1.03]" unoptimized />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm text-gray-300">Sin foto</div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <div className="font-semibold text-gray-800">{r.nombre}</div>
                    {r.descripcion?.trim() && (
                      <p className="mt-1 line-clamp-2 text-xs text-gray-400">{r.descripcion}</p>
                    )}
                    <div className="mt-3 flex items-end justify-between">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-400">desde</div>
                        <div className="text-lg font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(r.desde, r.moneda)}</div>
                        <div className="text-[10px] text-gray-400">por persona</div>
                      </div>
                      <span className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90" style={{ backgroundColor: "var(--brand-accent)" }}>
                        Ver más →
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
