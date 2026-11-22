import { Sparkles } from "lucide-react";

// #126-D — Promoción que REALMENTE ganó en el cálculo de esta estadía/ocupación («Promoción PRE BF», «… · solo en algunas noches»).
// Solo se pinta con etiqueta (sin promoción ganadora no hay nada que anunciar); nunca menciona niños gratis ni participa en ninguna suma.
export function EtiquetaPromocionHotel({ promocion, className = "" }: { promocion?: { etiqueta?: string | null } | null; className?: string }) {
  const texto = promocion?.etiqueta?.trim();
  if (!texto) return null;
  return (
    <span data-testid="etiqueta-promocion-hotel" className={`inline-flex max-w-full items-start gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-left text-xs font-medium leading-snug whitespace-normal text-amber-800 ${className}`}>
      <Sparkles className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{texto}</span>
    </span>
  );
}
