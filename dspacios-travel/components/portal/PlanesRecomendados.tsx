"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// DEMOSTRACIÓN: piezas de ejemplo para mostrar cómo se verá la sección. No son productos,
// precios ni disponibilidad reales; cuando exista el origen real se reemplaza esta lista.
const PLANES_DEMO = [
  { titulo: "Plan de ejemplo · Caribe", texto: "Escapada de playa con hotel y traslados. Pieza ilustrativa." },
  { titulo: "Plan de ejemplo · Ciudad y cultura", texto: "Recorrido urbano con alojamiento céntrico. Pieza ilustrativa." },
  { titulo: "Plan de ejemplo · Naturaleza", texto: "Aventura y paisajes con actividades guiadas. Pieza ilustrativa." },
  { titulo: "Plan de ejemplo · Familiar", texto: "Todo incluido pensado para viajar en familia. Pieza ilustrativa." },
];

export function PlanesRecomendados() {
  const pista = useRef<HTMLUListElement>(null);
  const mover = (dir: 1 | -1) => {
    const el = pista.current;
    if (el) el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 240), behavior: "smooth" });
  };
  return (
    <section aria-labelledby="planes-demo-titulo" aria-roledescription="carrusel" className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="planes-demo-titulo" className="text-base font-semibold text-gray-900">Planes recomendados</h2>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Demostración</span>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={() => mover(-1)} aria-label="Planes anteriores" className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2"><ChevronLeft aria-hidden className="h-4 w-4" /></button>
          <button type="button" onClick={() => mover(1)} aria-label="Planes siguientes" className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2"><ChevronRight aria-hidden className="h-4 w-4" /></button>
        </div>
      </div>
      <ul ref={pista} className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1" tabIndex={0} aria-label="Planes de demostración">
        {PLANES_DEMO.map((p) => (
          <li key={p.titulo} aria-roledescription="diapositiva" className="w-64 shrink-0 snap-start rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
            <p className="text-sm font-semibold text-gray-800">{p.titulo}</p>
            <p className="mt-1 text-xs text-gray-500">{p.texto}</p>
            <p className="mt-3 text-[11px] font-medium text-amber-700">Contenido de demostración · sin precio ni disponibilidad</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
