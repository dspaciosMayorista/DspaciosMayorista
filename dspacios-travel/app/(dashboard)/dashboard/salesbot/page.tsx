import { PanelBloqueos } from "./PanelBloqueos";
import { PanelPorcion } from "./PanelPorcion";
import { PanelProgramas } from "./PanelProgramas";
import { Pestanas, productoDe, type Params } from "./comun";

// Consulta comercial interna (#56): la base de datos que alimentará al
// SalesBot, expuesta como consulta para el asesor, con una pestaña por
// producto. NO es un chat. Programas muestra el PVP por persona como
// referencia; Bloqueos y Porción terrestre, además, un total ORIENTATIVO del
// motor de venta vigente. Nunca base comisionable ni monto de comisión (#57).
export const dynamic = "force-dynamic";

export default async function ConsultaComercialPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const producto = productoDe(sp);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">Consulta comercial</h1>
      <Pestanas activo={producto} />
      {producto === "bloqueos" ? <PanelBloqueos sp={sp} /> : producto === "porcion" ? <PanelPorcion sp={sp} /> : <PanelProgramas sp={sp} />}
    </div>
  );
}
