"use client";

// ─────────────────────────────────────────────────────────────────────────
// Panel presentacional: desglose de las condiciones de pago por componente de
// una cotización YA congelada (commit 4/5 escribe `cotizacion_condiciones`).
//
// Es un componente cliente puramente de vista: recibe las líneas ya etiquetadas
// (`condicionesParaUI`) y la moneda, y renderiza:
//   · una fila por componente (referencia + tipo + frase de condición),
//   · el chip de restricción si la componente es no reembolsable/no endosable,
//   · el total exigido (abono mínimo) de la cotización.
//
// Si no llegan filas (snapshot aún no congelado) no renderiza nada: el padre
// decide mostrar el aviso "aún sin condiciones congeladas".
// ─────────────────────────────────────────────────────────────────────────
import { formatMoneda } from "@/lib/utils";
import type { CondicionesParaUI, LineaCondicionUI } from "@/lib/cotizacion/condicionesParaUI";
import { esNoReembolsable } from "@/lib/cotizacion/etiquetasCondicion";

function RestriccionChip({ linea }: { linea: LineaCondicionUI }) {
  if (!esNoReembolsable(linea.restriccion)) return null;
  return (
    <span
      className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700"
      title={linea.restriccionTitulo}
    >
      {linea.restriccionTitulo}
    </span>
  );
}

export default function CondicionesPanel({
  ui,
  moneda,
}: {
  ui: CondicionesParaUI;
  moneda: string;
}) {
  if (!ui.filas.length || ui.totalExigidoMoneda == null) return null;

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-700">
        Condiciones de pago por componente
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Componente</th>
              <th className="px-4 py-2">Condición</th>
              <th className="px-4 py-2 text-right">Valor</th>
              <th className="px-4 py-2 text-right">Pago mínimo</th>
            </tr>
          </thead>
          <tbody>
            {ui.filas.map((l) => (
              <tr key={l.key} className="border-t border-gray-50 align-top">
                <td className="px-4 py-2">
                  <div className="text-gray-800">{l.referencia ?? l.nombreComponente}</div>
                  <div className="text-[11px] text-gray-400">{l.nombreComponente}</div>
                  <div className="mt-1">
                    <RestriccionChip linea={l} />
                  </div>
                </td>
                <td className="px-4 py-2 text-gray-600">
                  <div>{l.condicionTexto}</div>
                  {l.condicionDetalle && (
                    <div className="text-[11px] text-gray-400">{l.condicionDetalle}</div>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                  {formatMoneda(l.valor, moneda)}
                </td>
                <td className="px-4 py-2 text-right font-medium tabular-nums text-gray-800">
                  {formatMoneda(l.exigido, moneda)}
                </td>
              </tr>
            ))}
          </tbody>
          {ui.totalExigidoMoneda != null && (
            <tfoot className="text-sm">
              <tr className="border-t border-gray-200 font-semibold text-gray-800">
                <td className="px-4 py-2" colSpan={3}>
                  Total a abonar para confirmar (pago mínimo)
                </td>
                <td
                  className="px-4 py-2 text-right tabular-nums"
                  style={{ color: "var(--brand-primary)" }}
                >
                  {formatMoneda(ui.totalExigidoMoneda, moneda)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
