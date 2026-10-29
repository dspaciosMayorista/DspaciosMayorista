"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import s from "./vidrio.module.css";

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
    <section aria-labelledby="planes-demo-titulo" aria-roledescription="carrusel" className={s.panel}>
      <div className={s.cabPanel}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 id="planes-demo-titulo" className={s.h2}>Planes recomendados</h2>
          <span className={s.demo}>Demostración</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => mover(-1)} aria-label="Planes anteriores" className={s.carruselBtn}><ChevronLeft aria-hidden size={16} /></button>
          <button type="button" onClick={() => mover(1)} aria-label="Planes siguientes" className={s.carruselBtn}><ChevronRight aria-hidden size={16} /></button>
        </div>
      </div>
      <ul ref={pista} className={s.carrusel} tabIndex={0} aria-label="Planes de demostración">
        {PLANES_DEMO.map((p) => (
          <li key={p.titulo} aria-roledescription="diapositiva" className={s.diapositiva}>
            <p className={s.diapTitulo}>{p.titulo}</p>
            <p className={s.diapTexto}>{p.texto}</p>
            <p className={s.diapPie}>Contenido de demostración · sin precio ni disponibilidad</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
