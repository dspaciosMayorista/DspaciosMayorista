import { PanelBloqueos } from "./PanelBloqueos";
import { PanelConversacion } from "./PanelConversacion";
import { PanelPorcion } from "./PanelPorcion";
import { PanelProgramas } from "./PanelProgramas";
import { conversar } from "./actions";
import { Pestanas, productoDe, type Params } from "./comun";

// SalesBot (#56). La vista principal es la conversación guiada: un flujo
// determinista (sin IA) sobre las mismas consultas saneadas. Programas,
// Bloqueos y Porción terrestre quedan como vistas de consulta secundarias.
// Programas muestra el PVP por persona como referencia; Bloqueos y Porción,
// un total ORIENTATIVO del motor de venta vigente. Nunca base comisionable ni
// monto de comisión (#57).
export const dynamic = "force-dynamic";

export default async function ConsultaComercialPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const producto = productoDe(sp);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">Consulta comercial</h1>
      <Pestanas activo={producto} />
      {producto === "conversacion" ? (
        <PanelConversacion inicial={await conversar(null, { tipo: "inicio" })} />
      ) : producto === "bloqueos" ? (
        <PanelBloqueos sp={sp} />
      ) : producto === "porcion" ? (
        <PanelPorcion sp={sp} />
      ) : (
        <PanelProgramas sp={sp} />
      )}
    </div>
  );
}
