"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  // Tarjeta de destino de la última pulsación: varios clics seguidos suman tarjetas aunque la animación siga en curso.
  const objetivo = useRef<{ idx: number; hasta: number } | null>(null);
  const [extremos, setExtremos] = useState({ inicio: true, fin: false });

  const medir = useCallback(() => {
    const el = pista.current;
    if (!el) return;
    // Al llegar a la tarjeta pedida, el objetivo ya no manda: la próxima pulsación parte de la posición real.
    const tarjetas = el.children;
    const paso = tarjetas.length > 1 ? (tarjetas[1] as HTMLElement).offsetLeft - (tarjetas[0] as HTMLElement).offsetLeft : 0;
    if (objetivo.current && paso > 0 && Math.abs(el.scrollLeft - objetivo.current.idx * paso) <= 1) objetivo.current = null;
    const inicio = el.scrollLeft <= 1;
    const fin = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setExtremos((a) => (a.inicio === inicio && a.fin === fin ? a : { inicio, fin }));
  }, []);

  useEffect(() => {
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [medir]);

  const mover = (dir: 1 | -1) => {
    const el = pista.current;
    if (!el) return;
    const tarjetas = Array.from(el.children) as HTMLElement[];
    if (tarjetas.length < 2) return;
    const paso = tarjetas[1].offsetLeft - tarjetas[0].offsetLeft; // ancho de tarjeta + separación
    if (paso <= 0) return;
    const vigente = objetivo.current && objetivo.current.hasta > Date.now() ? objetivo.current.idx : Math.round(el.scrollLeft / paso);
    // Último índice alcanzable: el que deja la última tarjeta entera y pegada al borde.
    const maxIdx = Math.max(0, Math.round((el.scrollWidth - el.clientWidth) / paso));
    const idx = Math.min(maxIdx, Math.max(0, vigente + dir));
    objetivo.current = { idx, hasta: Date.now() + 500 };
    const reducido = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: idx * paso, behavior: reducido ? "auto" : "smooth" });
  };

  return (
    <section aria-labelledby="planes-demo-titulo" aria-roledescription="carrusel" className={s.panel}>
      <div className={s.cabPanel}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 id="planes-demo-titulo" className={s.h2}>Planes recomendados</h2>
          <span className={s.demo}>Demostración</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => mover(-1)} disabled={extremos.inicio} aria-label="Planes anteriores" className={s.carruselBtn}><ChevronLeft aria-hidden size={16} /></button>
          <button type="button" onClick={() => mover(1)} disabled={extremos.fin} aria-label="Planes siguientes" className={s.carruselBtn}><ChevronRight aria-hidden size={16} /></button>
        </div>
      </div>
      <ul
        ref={pista}
        className={s.carrusel}
        tabIndex={0}
        aria-label="Planes de demostración"
        onScroll={medir}
        onTouchStart={() => { objetivo.current = null; }}
        onWheel={() => { objetivo.current = null; }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); mover(1); }
          else if (e.key === "ArrowLeft") { e.preventDefault(); mover(-1); }
        }}
      >
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
