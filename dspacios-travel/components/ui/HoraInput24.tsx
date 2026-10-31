"use client";

import { useId } from "react";

/**
 * Hora en formato de 24 horas (HH:MM) con dos listas nativas: hora y minutos. A diferencia de `<input type="time">`, el navegador no la pinta con
 * AM/PM según la región, funciona igual con teclado (flechas, escribir «19») y en móvil (rueda nativa). Valor: "" (sin hora) o "HH:MM".
 * `opcional`: muestra «Quitar» para dejarla vacía. `permite24`: agrega «24:00» para el fin de una franja que llega hasta la medianoche.
 */
export function HoraInput24({ value, onChange, etiqueta, permite24 = false, opcional = false, className = "" }: {
  value: string; onChange: (v: string) => void; etiqueta: string; permite24?: boolean; opcional?: boolean; className?: string;
}) {
  const id = useId();
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  const hh = m ? m[1] : "";
  const mm = m ? m[2] : "";
  const horas = Array.from({ length: permite24 ? 25 : 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutos = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
  const cls = "h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)]";
  const cambiar = (h: string, mi: string) => {
    if (!h) { onChange(""); return; }
    onChange(`${h}:${h === "24" ? "00" : (mi || "00")}`);
  };
  return (
    <div role="group" aria-label={etiqueta} className={`flex flex-wrap items-center gap-1 ${className}`}>
      <select id={`${id}-h`} aria-label={`${etiqueta}: hora`} value={hh} onChange={(e) => cambiar(e.target.value, mm)} className={cls}>
        <option value="">--</option>
        {horas.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span aria-hidden className="text-gray-400">:</span>
      <select id={`${id}-m`} aria-label={`${etiqueta}: minutos`} value={mm} disabled={!hh || hh === "24"} onChange={(e) => cambiar(hh, e.target.value)} className={cls}>
        <option value="">--</option>
        {minutos.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      {opcional && value && <button type="button" onClick={() => onChange("")} aria-label={`Quitar ${etiqueta}`} className="ml-1 text-xs text-gray-400 hover:text-gray-700">Quitar</button>}
    </div>
  );
}
