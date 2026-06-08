"use client";

import { useState } from "react";

export type PlanInfo = { nombre?: string | null; descripcion?: string | null; nota_especial?: string | null };
export type PlanesInfo = Record<string, PlanInfo>;

// Muestra el código del régimen y, si tiene descripción/nota, un disparador para
// ver "qué incluye" (popover). variant: 'icon' (compacto, para la tabla) o
// 'link' (texto, para el detalle del Booking).
export function RegimenInfo({
  codigo, info, variant = "icon", className = "",
}: {
  codigo: string; info?: PlanInfo; variant?: "icon" | "link"; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const tiene = !!(info && (info.descripcion?.trim() || info.nota_especial?.trim()));

  return (
    <span className={`relative inline-flex items-center gap-1 ${className}`}>
      {variant === "icon" && <span>{codigo}</span>}
      {tiene ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          className="font-semibold"
          style={{ color: "var(--brand-accent)" }}
          title="Ver qué incluye"
        >
          {variant === "icon" ? "ⓘ" : "Ver descripción de alimentación"}
        </button>
      ) : (
        variant === "link" && <span className="text-xs text-gray-400">Sin descripción de alimentación</span>
      )}

      {open && tiene && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <span className="absolute left-0 top-full z-50 mt-1 block w-72 max-w-[80vw] rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal shadow-lg">
            <span className="block font-semibold text-gray-700">{(info?.nombre?.trim() || codigo)} — qué incluye</span>
            {info?.descripcion?.trim() && <span className="mt-1 block whitespace-pre-wrap text-gray-600">{info.descripcion}</span>}
            {info?.nota_especial?.trim() && <span className="mt-1 block whitespace-pre-wrap text-gray-500">Nota: {info.nota_especial}</span>}
          </span>
        </>
      )}
    </span>
  );
}
