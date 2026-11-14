import { Info } from "lucide-react";

export const AVISO_ITINERARIOS_VUELOS = "Itinerarios de vuelos sujetos a cambio sin previo aviso. Recuerde confirmarlos un día antes de su fecha y hora de viaje.";

/** Aviso informativo bajo la sección de vuelos de una cotización. Renderizarlo UNA vez por sección y solo si hay vuelos; en flujo normal, sin posición absoluta. */
export function AvisoItinerariosVuelos() {
  return (
    <p role="note" data-testid="aviso-itinerarios-vuelos" className="mt-2 flex break-inside-avoid items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <Info size={13} className="mt-0.5 shrink-0 text-gray-500" aria-hidden />
      <span className="min-w-0 break-words">{AVISO_ITINERARIOS_VUELOS}</span>
    </p>
  );
}
