"use client";

import { useEffect, useRef, useState } from "react";

type Tema = "marca" | "indigo" | "verde";
const KEY = "dsp-theme";
const POS_KEY = "dsp-theme-pos";

// Botón flotante 🎨 (oculto por defecto): un clic muestra/oculta la barra de
// estilo; arrastrándolo se mueve donde quieras (posición persistida).
export function ThemeSwitcher() {
  const [tema, setTema] = useState<Tema>("marca");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [mostrar, setMostrar] = useState(false);
  const cont = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null);

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
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top, sx: e.clientX, sy: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.sx) > 4 || Math.abs(e.clientY - d.sy) > 4) d.moved = true;
    if (!d.moved) return;
    const w = cont.current?.offsetWidth ?? 0;
    const h = cont.current?.offsetHeight ?? 0;
    const x = Math.min(Math.max(0, e.clientX - d.dx), window.innerWidth - w);
    const y = Math.min(Math.max(0, e.clientY - d.dy), window.innerHeight - h);
    setPos({ x, y });
  }
  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) setPos((p) => { try { if (p) localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* ignore */ } return p; });
    else setMostrar((m) => !m);
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
      className="fixed z-50 flex items-center gap-1"
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : { right: 16, bottom: 16 }}
    >
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex h-9 w-9 cursor-grab items-center justify-center rounded-full border border-gray-200 bg-white/95 text-base shadow-lg backdrop-blur select-none active:cursor-grabbing"
        title="Estilo · clic para mostrar/ocultar · arrastra para mover"
        aria-label="Barra de estilo"
      >
        🎨
      </button>
      {mostrar && (
        <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur">
          <span className="pl-2 pr-1 text-[10px] uppercase tracking-wide text-gray-400">Estilo</span>
          {btn("marca", "Turquesa")}
          {btn("indigo", "Índigo")}
          {btn("verde", "Verde")}
        </div>
      )}
    </div>
  );
}
