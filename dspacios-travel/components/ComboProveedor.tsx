"use client";

import { useMemo, useRef, useState } from "react";

export type ProveedorOpt = { id: number; nombre: string };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Selector de proveedor con buscador: escribe y filtra la lista, luego eliges. No crea proveedores. */
export function ComboProveedor({
  proveedores, value, onChange, placeholder = "Escribe el proveedor…",
}: {
  proveedores: ProveedorOpt[];
  value: number | "";
  onChange: (id: number | "") => void;
  placeholder?: string;
}) {
  const sel = proveedores.find((p) => p.id === value) ?? null;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtradas = useMemo(() => {
    const t = norm(q.trim());
    const list = !t ? proveedores : proveedores.filter((p) => norm(p.nombre).includes(t));
    return list.slice(0, 50);
  }, [proveedores, q]);

  const cls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  return (
    <div ref={ref} className="relative" onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <input
        className={cls}
        value={open ? q : (sel ? sel.nombre : "")}
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
          ) : filtradas.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(p.id); setOpen(false); }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50 ${p.id === value ? "bg-[rgba(29,124,154,0.06)]" : ""}`}
            >
              <span className="text-gray-700">{p.nombre}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}