import { Tag } from "lucide-react";

// #90 — Regla EBB / Long Stay que usó el cálculo de la cotización («EBB 2 · 60+ días · 23 %», «Long Stay · 25 %»).
// Solo se muestra cuando hubo descuento (sin regla = no hay etiqueta); nunca junto al precio base de la vitrina. No participa en ninguna suma.
export function EtiquetaDescuentoHotel({ descuento, className = "" }: { descuento?: { etiqueta?: string | null } | null; className?: string }) {
  const texto = descuento?.etiqueta?.trim();
  if (!texto) return null;
  return (
    <span data-testid="etiqueta-descuento-hotel" className={`inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ${className}`}>
      <Tag className="h-3 w-3" aria-hidden="true" />
      {texto}
    </span>
  );
}
