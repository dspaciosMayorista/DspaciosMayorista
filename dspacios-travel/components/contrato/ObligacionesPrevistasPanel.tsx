import { formatMoneda } from "@/lib/utils";

export type ObligacionPrevista = { clave: string; servicio: string | null; proveedor: string | null; tipo_proveedor: string | null; valor_total: number; moneda: string | null };

/**
 * 288 (#75): obligaciones PREVISTAS de un contrato pendiente. NO son cuentas por pagar exigibles: nacen (una vez) al confirmar el contrato. Se rotulan así,
 * aparte de las obligaciones reales, para que nadie las lea como deuda ya contraída.
 */
export function ObligacionesPrevistasPanel({ filas }: { filas: ObligacionPrevista[] }) {
  if (!filas.length) return null;
  const total = filas.reduce((s, f) => s + (Number(f.valor_total) || 0), 0);
  return (
    <section aria-label="Obligaciones previstas" className="mb-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-sm">
      <h3 className="font-semibold text-gray-700">Obligaciones previstas — aún no exigibles</h3>
      <p className="mt-1 text-xs text-gray-500">Se registran como cuentas por pagar al confirmar el contrato. Mientras esté pendiente son solo información preparada.</p>
      <table className="mt-2 w-full text-xs">
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave} className="border-t border-gray-200">
              <td className="py-1 pr-2">{f.servicio ?? f.tipo_proveedor ?? "Servicio"}</td>
              <td className="py-1 pr-2 text-gray-500">{f.proveedor ?? "Sin especificar"}</td>
              <td className="py-1 text-right tabular-nums">{formatMoneda(Number(f.valor_total) || 0)}{f.moneda && f.moneda !== "COP" ? ` ${f.moneda}` : ""}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-300 font-semibold"><td className="py-1" colSpan={2}>Total previsto</td><td className="py-1 text-right tabular-nums">{formatMoneda(total)}</td></tr>
        </tbody>
      </table>
    </section>
  );
}
