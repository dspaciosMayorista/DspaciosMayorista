"use client";

import { useMemo, useRef, useState } from "react";
import type { DestinoOpt } from "@/components/ComboDestino";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Selector de CIUDAD/IATA con buscador, alimentado por el catálogo de Destinos.
 * A diferencia de `ComboDestino` (que devuelve el id), éste trabaja con TEXTO:
 * devuelve el nombre de la ciudad (modo "nombre") o el código IATA (modo "iata").
 * Permite texto libre (`permitirLibre`) para ciudades fuera del catálogo
 * (p. ej. circuitos internacionales).
 */
export function ComboCiudad({
  destinos,
  value,
  onChange,
  modo = "nombre",
  placeholder = "Ciudad o IATA…",
  permitirLibre = true,
  className = "",
}: {
  destinos: DestinoOpt[];
  value: string;
  onChange: (v: string) => void;
  modo?: "nombre" | "iata";
  placeholder?: string;
  permitirLibre?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const valorDe = (d: DestinoOpt) => (modo === "iata" ? (d.codigo_iata ?? "") : d.nombre);

  const filtradas = useMemo(() => {
    const t = norm((open ? q : value).trim());
    const list = !t
      ? destinos
      : destinos.filter((d) => norm(d.nombre).includes(t) || norm(d.codigo_iata ?? "").includes(t));
    return list.slice(0, 50);
  }, [destinos, q, open, value]);

  const cls = `w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm ${className}`;

  return (
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false); }}
    >
      <input
        className={cls}
        value={open ? q : value}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQ(value); }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (permitirLibre) onChange(e.target.value);
        }}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {filtradas.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">
              Sin coincidencias{permitirLibre ? " · se usa lo escrito" : ""}
            </div>
          ) : (
            filtradas.map((d) => (
              <button
                key={d.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onChange(valorDe(d)); setQ(valorDe(d)); setOpen(false); }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                <span className="text-gray-700">{d.nombre}</span>
                {d.codigo_iata && <span className="text-xs text-gray-400">{d.codigo_iata}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
