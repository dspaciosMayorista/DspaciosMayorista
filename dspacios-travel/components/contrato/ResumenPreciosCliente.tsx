import { formatoExacto } from "@/lib/contrato/repartoTarifa";
import { ETIQUETA_AJUSTE_CLIENTE } from "@/lib/reservar/solicitudHotel";
import type { ResumenPrecios } from "@/lib/cotizacion/resumenPrecios";
import { filasDeUnidad } from "@/lib/cotizacion/filasResumen";

// #94/#52 — lo que ve el CLIENTE, con la estructura de siempre de «Valores y Pagos»: Ítem primero, luego Adultos, Niños, Tarifa Adulto, Tarifa Niño y Valor total.
// Una fila por grupo de pasajeros; adultos y niños comparten fila cuando son del mismo paquete, con la misma cobertura y una sola tarifa por tipo (ver `filasDeUnidad`).
// Los grupos con cobertura o tarifas distintas siguen en filas separadas.
// Solo precios completos por pasajero y totales: ningún importe por servicio ni su descripción. El Ítem es el texto del paquete (editable), nunca el hotel ni los servicios.
// Solo dibuja un resumen ya validado (`resumenAplicable`); no calcula nada.
export function ResumenPreciosCliente({ resumen, titulo }: { resumen: ResumenPrecios; titulo: string }) {
  const m = resumen.moneda;
  const sufijo = resumen.modalidad === "neto" ? " NETO" : "";
  const dinero = (centavos: number) => formatoExacto(centavos / 100, m);
  const filas = resumen.unidades.flatMap(filasDeUnidad);
  return (
    <div className="mb-3" data-testid="resumen-precios">
      {/* Teléfono: una tarjeta por fila (seis columnas no caben en 390 px). Desde sm y al imprimir: la tabla de siempre. */}
      <div className="space-y-2 sm:hidden print:hidden" data-testid="resumen-movil">
        {filas.map((f) => (
          <dl key={f.clave} className="space-y-1 rounded-lg border border-gray-200 p-3 text-xs">
            <dt className="font-semibold text-gray-800">{f.ajuste ? ETIQUETA_AJUSTE_CLIENTE : titulo}</dt>
            {f.adultos > 0 && <div className="flex justify-between gap-3"><dd className="text-gray-600">Adultos ({f.adultos}) · tarifa por adulto{sufijo}</dd><dd className="tabular-nums">{dinero(f.tarifaAdulto)}</dd></div>}
            {f.ninos > 0 && <div className="flex justify-between gap-3"><dd className="text-gray-600">Niños ({f.ninos}) · tarifa por niño{sufijo}</dd><dd className="tabular-nums">{dinero(f.tarifaNino)}</dd></div>}
            <div className="flex justify-between gap-3 border-t border-gray-100 pt-1 font-medium"><dd>Valor total{sufijo}</dd><dd className="tabular-nums">{dinero(f.total)}</dd></div>
          </dl>
        ))}
      </div>
      <div className="hidden overflow-x-auto sm:block print:block">
        <table className="w-full border-collapse text-xs">
          <thead className="break-inside-avoid break-after-avoid">
            <tr className="bg-gray-50 text-left text-gray-500">
              <th className="border border-gray-200 px-2 py-1">Ítem</th>
              <th className="border border-gray-200 px-2 py-1">Adultos</th>
              <th className="border border-gray-200 px-2 py-1">Niños</th>
              <th className="border border-gray-200 px-2 py-1">Tarifa Adulto{sufijo}</th>
              <th className="border border-gray-200 px-2 py-1">Tarifa Niño{sufijo}</th>
              <th className="border border-gray-200 px-2 py-1">Valor total{sufijo}</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.clave} className="break-inside-avoid" data-testid={f.ajuste ? "resumen-ajuste" : "resumen-grupo"}>
                <td className="border border-gray-200 px-2 py-1">{f.ajuste ? ETIQUETA_AJUSTE_CLIENTE : titulo}</td>
                <td className="border border-gray-200 px-2 py-1">{f.ajuste ? "—" : f.adultos}</td>
                <td className="border border-gray-200 px-2 py-1">{f.ajuste ? "—" : f.ninos}</td>
                <td className="border border-gray-200 px-2 py-1">{f.ajuste ? "—" : dinero(f.tarifaAdulto)}</td>
                <td className="border border-gray-200 px-2 py-1">{f.ajuste ? "—" : dinero(f.tarifaNino)}</td>
                <td className="border border-gray-200 px-2 py-1 font-medium">{dinero(f.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
