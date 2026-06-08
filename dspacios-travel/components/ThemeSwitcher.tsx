"use client";

import { useEffect, useRef, useState } from "react";

type Tema = "marca" | "indigo" | "verde";
const KEY = "dsp-theme";
const POS_KEY = "dsp-theme-pos";

// Interruptor flotante y MOVIBLE para PROBAR el estilo: alterna entre la marca
// actual (turquesa), índigo y verde. Guarda la elección y la posición en el
// navegador. Arrástralo desde el asa (⠿). Ayuda temporal de decisión.
export function ThemeSwitcher() {
  const [tema, setTema] = useState<Tema>("marca");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const cont = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Tema) || "marca";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza con lo guardado al montar
    setTema(saved);
    try {
      const p = localStorage.getItem(POS_KEY);
      if (p) setPos(JSON.parse(p) as { x: number; y: number });
    } catch { /* ignore */ }
  }, []);

  function aplicar(t: Tema) {
    setTema(t);
    const el = document.documentElement;
    if (t === "marca") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", t);
    try { localStorage.setItem(KEY, t); } catch { /* sin almacenamiento */ }
  }

  function onPointerDown(e: React.PointerEvent) {
    const box = cont.current?.getBoundingClientRect();
    if (!box) return;
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const w = cont.current?.offsetWidth ?? 0;
    const h = cont.current?.offsetHeight ?? 0;
    const x = Math.min(Math.max(0, e.clientX - drag.current.dx), window.innerWidth - w);
    const y = Math.min(Math.max(0, e.clientY - drag.current.dy), window.innerHeight - h);
    setPos({ x, y });
  }
  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    try { if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
  }

  const btn = (t: Tema, label: string) => (
    <button
      type="button"
      onClick={() => aplicar(t)}
      className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
      style={tema === t ? { backgroundColor: "var(--brand-primary)", color: "white" } : { color: "#4b5563" }}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={cont}
      className="fixed z-50 flex items-center gap-1 rounded-full border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur"
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : { right: 16, bottom: 16 }}
    >
      <span
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="cursor-grab select-none px-1 text-gray-400 active:cursor-grabbing"
        title="Arrastra para mover"
        aria-label="Mover barra de estilo"
      >
        ⠿
      </span>
      <span className="pr-1 text-[10px] uppercase tracking-wide text-gray-400">Estilo</span>
      {btn("marca", "Turquesa")}
      {btn("indigo", "Índigo")}
      {btn("verde", "Verde")}
    </div>
  );
}
