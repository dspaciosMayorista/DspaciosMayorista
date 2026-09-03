// ─────────────────────────────────────────────────────────────────────────
// Panel presentacional: condiciones de pago PERMANENTES de un contrato ya
// convertido (`contrato_condiciones`, migración 164, Commit 6). Recibe la
// salida YA resuelta de `lib/contrato/condicionesContrato.ts` — el mismo
// resolver que usa el PDF (`ContratoDocumento.tsx`) — así que el texto y los
// montos que ve el asesor en la ficha son EXACTAMENTE los del documento.
//
// Si `hayCondiciones` es false (contrato histórico, sin snapshot) no
// renderiza nada — no se inventa "sin restricciones" para un contrato que
// nunca pasó por este motor.
// ─────────────────────────────────────────────────────────────────────────
"use client";

import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import type { CondicionesContratoResueltas, LineaCondicionContrato } from "@/lib/contrato/condicionesContrato";
import { ShieldAlert, ShieldCheck } from "lucide-react";

function RestriccionChip({ linea }: { linea: LineaCondicionContrato }) {
  if (linea.esRestringidaEfectiva) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700"
        title={linea.restriccionTexto}
      >
        <ShieldAlert className="h-3 w-3" />
        {linea.restriccionTitulo}
      </span>
    );
  }
  if (linea.override) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
        title={`Excepción autorizada: ${linea.override.motivo}`}
      >
        <ShieldCheck className="h-3 w-3" />
        Excepción autorizada
      </span>
    );
  }
  return null;
}

export default function CondicionesContratoPanel({
  resuelto,
  puedeAutorizarExcepcion = false,
  overrideForm,
}: {
  resuelto: CondicionesContratoResueltas;
  /** true solo para superadmin: muestra el formulario de excepción por fila. */
  puedeAutorizarExcepcion?: boolean;
  /** Render prop: el llamador pasa el formulario ya armado por fila (necesita
   *  Server Action + numero_contrato, que este panel no conoce). */
  overrideForm?: (linea: LineaCondicionContrato) => React.ReactNode;
}) {
  if (!resuelto.hayCondiciones || !resuelto.filas.length) return null;

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-700">
        Condiciones de pago y restricciones del contrato
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Componente</th>
              <th className="px-4 py-2">Condición</th>
              <th className="px-4 py-2 text-right">Valor</th>
              <th className="px-4 py-2 text-right">Pago mínimo</th>
              <th className="px-4 py-2">Restricción</th>
            </tr>
          </thead>
          <tbody>
            {resuelto.filas.map((l) => (
              <tr key={l.key} className="border-t border-gray-50 align-top">
                <td className="px-4 py-2">
                  <div className="text-gray-800">{l.referencia ?? l.nombreComponente}</div>
                  <div className="text-[11px] text-gray-400">{l.nombreComponente}</div>
                </td>
                <td className="px-4 py-2 text-gray-600">
                  <div>{l.condicionTexto}</div>
                  {l.condicionDetalle && <div className="text-[11px] text-gray-400">{l.condicionDetalle}</div>}
                  {l.fechaLimite && (
                    <div className="text-[11px] text-gray-400">Saldo antes del {formatFechaLarga(l.fechaLimite)}</div>
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                  {formatMoneda(l.valor, l.moneda)}
                </td>
                <td className="px-4 py-2 text-right font-medium tabular-nums text-gray-800">
                  {formatMoneda(l.exigido, l.moneda)}
                </td>
                <td className="px-4 py-2">
                  <RestriccionChip linea={l} />
                  {l.esRestringidaEfectiva && puedeAutorizarExcepcion && overrideForm?.(l)}
                </td>
              </tr>
            ))}
          </tbody>
          {resuelto.resumen && (
            <tfoot className="text-sm">
              <tr className="border-t border-gray-200 font-semibold text-gray-800">
                <td className="px-4 py-2" colSpan={4}>
                  {resuelto.resumen.texto}
                </td>
                <td className="px-4 py-2" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!resuelto.restringidas.length && resuelto.huboRestriccionOriginal && (
        <div className="border-t border-amber-100 bg-amber-50 px-5 py-2 text-[11px] text-amber-700">
          Este contrato tuvo componentes restringidos; todas las excepciones vigentes fueron autorizadas por superadmin (ver motivo en cada fila).
        </div>
      )}
    </div>
  );
}
