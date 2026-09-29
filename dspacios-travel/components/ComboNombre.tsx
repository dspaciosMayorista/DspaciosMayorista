"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Selector de opción con buscador por NOMBRE (devuelve el string tal cual, sin
 * id). A diferencia de `ComboProveedor`/`ComboHotel`/`ComboDestino` (que
 * devuelven `number | ""`), éste trabaja con texto plano: sirve para contratos
 * donde el valor persistido es el NOMBRE (p. ej. el proveedor de una CxP).
 * No crea opciones: solo se pueden elegir las de la lista dada.
 */
export function ComboNombre({
  opciones, value, onChange, placeholder = "Escribe para buscar…",
}: {
  opciones: string[];
  value: string;
  onChange: (nombre: string) => void;
  placeholder?: string;
}) {
  const sel = opciones.find((o) => o === value) ?? "";
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const popupId = `${uid}-listbox`;

  const filtradas = useMemo(() => {
    const t = norm(q.trim());
    const list = !t ? opciones : opciones.filter((o) => norm(o).includes(t));
    return list.slice(0, 50);
  }, [opciones, q]);

  const actClamped = Math.min(Math.max(act, 0), filtradas.length - 1);
  const actId = open && filtradas.length > 0 && actClamped >= 0 ? `${uid}-opt-${actClamped}` : undefined;

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${actClamped}"]`)?.scrollIntoView({ block: "nearest" });
  }, [actClamped]);

  function elegir(nombre: string) {
    onChange(nombre);
    setOpen(false);
    setAct(0);
  }

  function actDesdeSeleccion() {
    const i = opciones.slice(0, 50).findIndex((o) => o === value);
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
        value={open ? q : sel}
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
          ) : filtradas.map((o, i) => (
            <button
              key={`${uid}-${o}`}
              type="button"
              id={`${uid}-opt-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={o === value}
              data-idx={i}
              onMouseDown={(e) => { e.preventDefault(); elegir(o); }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 ${i === actClamped ? "bg-gray-100" : o === value ? "bg-[rgba(29,124,154,0.06)]" : ""}`}
            >
              <span className="text-gray-700">{o}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}