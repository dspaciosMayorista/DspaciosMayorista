import { LoadingScreen } from "@/components/LoadingScreen";

// Suspense fallback del tarifario público. `page.tsx` es 100% dinámico
// (lee sesión + hace 3 consultas concurrentes de datos reales — ver la nota
// del incidente de ~13s en `page.tsx`) y hasta ahora no tenía NINGÚN
// fallback: la primera visita se quedaba en blanco todo ese tiempo. Cubre
// solo la carga inicial de la página; los buscadores/tabs internos
// (`TarifarioPublic.tsx`, `VistaBooking.tsx`) tienen sus propios estados de
// carga puntuales y no se tocan acá.
export default function CargandoTarifarioPublico() {
  return <LoadingScreen />;
}
