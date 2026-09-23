import { LoadingScreen } from "@/components/LoadingScreen";

// `fullScreen={false}`: esta página vive dentro de `<main>` de
// `(dashboard)/layout.tsx` (ya `position: relative`) — el overlay debe
// quedar acotado al área de contenido, sin volver a tapar el sidebar/topbar
// ya renderizados.
export default function CargandoTarifarioInterno() {
  return <LoadingScreen fullScreen={false} />;
}
