"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type DestinoOpt = { id: number; nombre: string; codigo_iata?: string | null; pais?: string | null };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Selector de destino con buscador: escribe y filtra por nombre o IATA, luego eliges. No crea destinos. */
export function ComboDestino({
  destinos, value, onChange, placeholder = "Escribe el destino o su IATA…",
}: {
  destinos: DestinoOpt[];
  value: number | "";
  onChange: (id: number | "") => void;
  placeholder?: string;
}) {
  const sel = destinos.find((d) => d.id === value) ?? null;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const popupId = `${uid}-listbox`;

  const filtradas = useMemo(() => {
    const t = norm(q.trim());
    const list = !t ? destinos : destinos.filter((d) => norm(d.nombre).includes(t) || norm(d.codigo_iata ?? "").includes(t));
    return list.slice(0, 50);
  }, [destinos, q]);

  const actClamped = Math.min(Math.max(act, 0), filtradas.length - 1);
  const actId = open && filtradas.length > 0 && actClamped >= 0 ? `${uid}-opt-${filtradas[actClamped].id}` : undefined;

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${actClamped}"]`)?.scrollIntoView({ block: "nearest" });
  }, [actClamped]);

  function elegir(d: DestinoOpt) {
    onChange(d.id);
    setOpen(false);
    setAct(0);
  }

  function actDesdeSeleccion() {
    const i = destinos.slice(0, 50).findIndex((d) => d.id === value);
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
        value={open ? q : (sel ? `${sel.nombre}${sel.codigo_iata ? ` (${sel.codigo_iata})` : ""}` : "")}
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
          ) : filtradas.map((d, i) => (
            <button
              key={d.id}
              type="button"
              id={`${uid}-opt-${d.id}`}
              role="option"
              tabIndex={-1}
              aria-selected={d.id === value}
              data-idx={i}
              onMouseDown={(e) => { e.preventDefault(); elegir(d); }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 ${i === actClamped ? "bg-gray-100" : d.id === value ? "bg-[rgba(29,124,154,0.06)]" : ""}`}
            >
              <span className="text-gray-700">{d.nombre}</span>
              {d.codigo_iata && <span className="text-xs text-gray-400">{d.codigo_iata}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
