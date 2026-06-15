"use client";

import { useMemo, useRef, useState } from "react";

export type DestinoOpt = { id: number; nombre: string; codigo_iata?: string | null };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Selector de destino con buscador: escribe y filtra la lista, luego eliges. */
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
  const ref = useRef<HTMLDivElement>(null);

  const filtradas = useMemo(() => {
    const t = norm(q.trim());
    const list = !t ? destinos : destinos.filter((d) => norm(d.nombre).includes(t) || norm(d.codigo_iata ?? "").includes(t));
    return list.slice(0, 50);
  }, [destinos, q]);

  const cls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  return (
    <div ref={ref} className="relative" onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <input
        className={cls}
        value={open ? q : (sel ? `${sel.nombre}${sel.codigo_iata ? ` (${sel.codigo_iata})` : ""}` : "")}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQ(""); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
      />
      {value !== "" && !open && (
        <button type="button" onMouseDown={(e) => { e.preventDefault(); onChange(""); setQ(""); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500" aria-label="Limpiar">✕</button>
      )}
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {filtradas.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">Sin coincidencias</div>
          ) : filtradas.map((d) => (
            <button
              key={d.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(d.id); setOpen(false); }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 ${d.id === value ? "bg-[rgba(29,124,154,0.06)]" : ""}`}
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
