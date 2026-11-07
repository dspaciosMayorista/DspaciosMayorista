import { formatMoneda } from "@/lib/utils";
import { ETIQUETA_TIPO, type ResumenPrecios } from "@/lib/cotizacion/resumenPrecios";

// #94/#52 — lo que ve el CLIENTE: por unidad (paquete · hotel), grupos de pasajeros con su precio completo por persona y su subtotal, y el total.
// Lo incluido se describe con nombres, nunca con el importe de un servicio. Solo dibuja un resumen ya validado (`resumenAplicable`); no calcula nada.
const plural = (tipo: keyof typeof ETIQUETA_TIPO, n: number) => (n === 1 ? ETIQUETA_TIPO[tipo] : `${ETIQUETA_TIPO[tipo]}s`);

export function ResumenPreciosCliente({ resumen }: { resumen: ResumenPrecios }) {
  const m = resumen.moneda;
  const sufijo = resumen.modalidad === "neto" ? " NETO" : "";
  const dinero = (centavos: number) => formatMoneda(centavos / 100, m);
  return (
    <div className="mb-3 space-y-3" data-testid="resumen-precios">
      {resumen.unidades.map((u) => (
        <div key={u.ref} className="break-inside-avoid" data-testid="resumen-unidad">
          <div className="mb-1 text-xs text-gray-700">
            <span className="font-semibold">{[u.paquete.nombre, u.hotel].filter(Boolean).join(" · ") || "Alojamiento"}</span>
            {u.categoria && <span className="ml-2 text-gray-500">Categoría: {u.categoria}</span>}
            {u.regimen && <span className="ml-2 text-gray-500">Alimentación: {u.regimen}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-xs">
              <thead className="break-inside-avoid break-after-avoid">
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="border border-gray-200 px-2 py-1">Pasajeros</th>
                  <th className="border border-gray-200 px-2 py-1">Incluye</th>
                  <th className="border border-gray-200 px-2 py-1">Cant.</th>
                  <th className="border border-gray-200 px-2 py-1">Tarifa por persona{sufijo}</th>
                  <th className="border border-gray-200 px-2 py-1">Subtotal{sufijo}</th>
                </tr>
              </thead>
              <tbody>
                {u.grupos.map((g, i) => (
                  <tr key={i} className="break-inside-avoid" data-testid="resumen-grupo">
                    <td className="border border-gray-200 px-2 py-1">{plural(g.tipo, g.cantidad)}</td>
                    <td className="border border-gray-200 px-2 py-1">{["Alojamiento", ...g.incluye].join(" · ")}</td>
                    <td className="border border-gray-200 px-2 py-1">{g.cantidad}</td>
                    <td className="border border-gray-200 px-2 py-1">{dinero(g.tarifaCentavos)}</td>
                    <td className="border border-gray-200 px-2 py-1 font-medium">{dinero(g.subtotalCentavos)}</td>
                  </tr>
                ))}
                {u.ajusteCentavos > 0 && (
                  <tr className="break-inside-avoid" data-testid="resumen-ajuste">
                    <td className="border border-gray-200 px-2 py-1" colSpan={4}>Ajuste de redondeo</td>
                    <td className="border border-gray-200 px-2 py-1 font-medium">{dinero(u.ajusteCentavos)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
