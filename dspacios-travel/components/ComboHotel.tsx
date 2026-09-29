"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type HotelOpt = { id: number; nombre: string; zona?: string | null };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const etiqueta = (h: HotelOpt) => (h.zona ? `${h.nombre} (${h.zona})` : h.nombre);

/** Selector de hotel con buscador: escribe y filtra por nombre o zona, luego eliges. No crea hoteles. */
export function ComboHotel({
  hoteles, value, onChange, placeholder = "Escribe el hotel…",
}: {
  hoteles: HotelOpt[];
  value: number | "";
  onChange: (id: number | "") => void;
  placeholder?: string;
}) {
  const sel = hoteles.find((h) => h.id === value) ?? null;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const popupId = `${uid}-listbox`;

  const filtradas = useMemo(() => {
    const t = norm(q.trim());
    const list = !t ? hoteles : hoteles.filter((h) => norm(h.nombre).includes(t) || norm(h.zona ?? "").includes(t));
    return list.slice(0, 50);
  }, [hoteles, q]);

  const actClamped = Math.min(Math.max(act, 0), filtradas.length - 1);
  const actId = open && filtradas.length > 0 && actClamped >= 0 ? `${uid}-opt-${filtradas[actClamped].id}` : undefined;

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${actClamped}"]`)?.scrollIntoView({ block: "nearest" });
  }, [actClamped]);

  function elegir(h: HotelOpt) {
    onChange(h.id);
    setOpen(false);
    setAct(0);
  }

  function actDesdeSeleccion() {
    const i = hoteles.slice(0, 50).findIndex((h) => h.id === value);
    return i >= 0 ? i : 0;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
        setQ("");
        setAct(actDesdeSeleccion());
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAct(filtradas.length === 0 ? 0 : (actClamped >= filtradas.length - 1 ? 0 : actClamped + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAct(filtradas.length === 0 ? 0 : (actClamped <= 0 ? filtradas.length - 1 : actClamped - 1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQ("");
      setAct(0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtradas.length > 0) elegir(filtradas[actClamped]);
    }
  }

  const cls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  return (
    <div ref={ref} className="relative" onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <input
        className={cls}
        role="combobox"
        aria-label={placeholder}
        aria-expanded={open}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={popupId}
        aria-activedescendant={actId}
        value={open ? q : (sel ? etiqueta(sel) : "")}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQ(""); setAct(actDesdeSeleccion()); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setAct(0); if (value !== "") onChange(""); }}
        onKeyDown={onKeyDown}
      />
      {value !== "" && !open && (
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onChange(""); setQ(""); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500" aria-label="Limpiar">✕</button>
      )}
      {open && (
        <div ref={listRef} id={popupId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {filtradas.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">Sin coincidencias</div>
          ) : filtradas.map((h, i) => (
            <button
              key={h.id}
              type="button"
              id={`${uid}-opt-${h.id}`}
              role="option"
              tabIndex={-1}
              aria-selected={h.id === value}
              data-idx={i}
              onMouseDown={(e) => { e.preventDefault(); elegir(h); }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 ${i === actClamped ? "bg-gray-100" : h.id === value ? "bg-[rgba(29,124,154,0.06)]" : ""}`}
            >
              <span className="text-gray-700">{h.nombre}</span>
              {h.zona && <span className="text-xs text-gray-400">{h.zona}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
