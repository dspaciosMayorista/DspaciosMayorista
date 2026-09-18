import type { ReactNode } from "react";
import { textoEtiquetaOferta } from "@/lib/tarifario/recomendados";

// ── Etiqueta compacta de OFERTA (hotel + paquete) ──────────────────────────
// Un mismo hotel puede estar armado en VARIOS paquetes (ej. tarifa normal y
// un paquete 3x2): cada tarjeta es una OFERTA distinta y necesita decir a
// CUÁL paquete pertenece — recomendada o no. El nombre del paquete es lo que
// distingue dos tarjetas del mismo hotel; no es un adorno de la recomendada.
//   · recomendada    → "Recomendado · <paquete>"
//   · no recomendada → "<paquete>"
// Sin nombre de paquete no se pinta nada: nunca un badge vacío ni un
// placeholder inventado (y nunca se deriva el nombre por `hotelId` — el
// llamador pasa el nombre del paquete de ESA oferta).
//
// Mismo tratamiento en persona y unidad, en exploración y en búsqueda: es una
// sola pieza compartida a propósito, para que las cuatro superficies no
// diverjan. Color de marca: acento para la recomendada, negro translúcido
// para la oferta normal (el mismo que ya usa el badge de cupos).
//
// El TEXTO no se decide acá: vive en `textoEtiquetaOferta`
// (lib/tarifario/recomendados.ts), puro y probado con ejecución real — este
// componente solo lo pinta.
export function EtiquetaOferta({ paqueteNombre, recomendada = false }: {
  paqueteNombre?: string | null;
  recomendada?: boolean;
}): ReactNode {
  const texto = textoEtiquetaOferta(paqueteNombre, recomendada);
  if (!texto) return null;
  return (
    <span
      className="absolute left-2 top-2 max-w-[85%] truncate rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
      style={{ backgroundColor: recomendada ? "var(--brand-accent)" : "rgba(0,0,0,0.55)" }}
      title={texto}
    >
      {texto}
    </span>
  );
}
