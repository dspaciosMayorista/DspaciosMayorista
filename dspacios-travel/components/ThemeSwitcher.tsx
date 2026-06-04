"use client";

import { useEffect, useState } from "react";

type Tema = "marca" | "indigo";
const KEY = "dsp-theme";

// Interruptor flotante para PROBAR el estilo: alterna entre la marca actual
// (turquesa) y el tema índigo (estilo del sitio). Guarda la elección en el
// navegador. Es una ayuda temporal de decisión; se puede quitar luego.
export function ThemeSwitcher() {
  const [tema, setTema] = useState<Tema>("marca");

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Tema) || "marca";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza el estado con el tema guardado al montar
    setTema(saved);
  }, []);

  function aplicar(t: Tema) {
    setTema(t);
    const el = document.documentElement;
    if (t === "indigo") el.setAttribute("data-theme", "indigo");
    else el.removeAttribute("data-theme");
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // sin almacenamiento (modo privado): se aplica solo en esta sesión
    }
  }

  const btn = (t: Tema, label: string) => (
    <button
      type="button"
      onClick={() => aplicar(t)}
      className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
      style={
        tema === t
          ? { backgroundColor: "var(--brand-primary)", color: "white" }
          : { color: "#4b5563" }
      }
    >
      {label}
    </button>
  );

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1 rounded-full border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur">
      <span className="pl-2 pr-1 text-[10px] uppercase tracking-wide text-gray-400">Estilo</span>
      {btn("marca", "Turquesa")}
      {btn("indigo", "Índigo")}
    </div>
  );
}
