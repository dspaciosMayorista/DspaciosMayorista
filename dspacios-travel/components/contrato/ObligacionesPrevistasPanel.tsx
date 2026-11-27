import { formatCOP } from "@/lib/utils";
import type { IdentidadContrato } from "@/lib/contrato/identidad";
import { estadoCosto, formatoTrm, importeOrigen, textoEquivalente, totalesPorMoneda, trmComun, type CostoOrigen } from "@/lib/finanzas/costoProvisional";
import { TrmCostoEditor } from "./TrmCostoEditor";

export type ObligacionPrevista = {
  clave: string; servicio: string | null; proveedor: string | null; tipo_proveedor: string | null; valor_total: number; moneda: string | null;
  /** 236/348: equivalente en pesos provisional y la TRM de costos con que se calculó (solo obligaciones en USD con TRM). */
  trm_costo?: number | null; valor_cop_costo?: number | null;
};

const origen = (f: ObligacionPrevista): CostoOrigen => ({ moneda: f.moneda, valor: Number(f.valor_total) || 0, trm: f.trm_costo ?? null, valorCop: f.valor_cop_costo ?? null });

/**
 * 288 (#75): obligaciones PREVISTAS de un contrato pendiente. NO son cuentas por pagar exigibles: nacen (una vez) al confirmar el contrato. Se rotulan así,
 * aparte de las obligaciones reales, para que nadie las lea como deuda ya contraída.
 * NETA-05/06: cada obligación en USD se muestra en dólares (moneda de origen) con su equivalente en pesos PROVISIONAL a la TRM de costos, o «TRM de costos pendiente»;
 * los totales van por moneda (nunca se suman USD y COP como una sola cifra). Con `puedeEditarTrm` hay un lugar para corregir esa TRM mientras el contrato siga pendiente.
 */
export function ObligacionesPrevistasPanel({ filas, numero, identidad, puedeEditarTrm = false }: { filas: ObligacionPrevista[]; numero?: string; identidad?: IdentidadContrato; puedeEditarTrm?: boolean }) {
  if (!filas.length) return null;
  const orig = filas.map(origen);
  const totales = totalesPorMoneda(orig);
  const hayUsd = totales.some((t) => t.moneda === "USD");
  const comun = trmComun(orig);
  const editar = puedeEditarTrm && !!numero && identidad != null;
  return (
    <section aria-label="Obligaciones previstas" className="mb-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-sm">
      <h3 className="font-semibold text-gray-700">Obligaciones previstas — aún no exigibles</h3>
      <p className="mt-1 text-xs text-gray-500">Se registran como cuentas por pagar al confirmar el contrato. Mientras esté pendiente son solo información preparada.</p>
      {hayUsd && (
        <p className="mt-1 text-xs text-gray-500" data-testid="nota-trm-costos">
          Las obligaciones en USD se deben en dólares. Su equivalente en pesos usa la <b>TRM de costos provisional</b> del contrato (una estimación de costeo, distinta de la TRM del pago real a proveedor y de la TRM de cobro); se congela al confirmar.
          {comun != null && <> TRM de costos actual: <b data-testid="trm-costos-actual">{formatoTrm(comun)}</b>. </>}
          {editar && comun != null && <TrmCostoEditor numero={numero!} identidad={identidad!} clave={null} trmActual={comun} etiqueta="Corregir la TRM de costos de este contrato" />}
          {!editar && comun != null && puedeEditarTrm === false && <span className="text-gray-400">(solo administración, gerencia, operaciones o superadmin la corrigen)</span>}
        </p>
      )}
      <table className="mt-2 w-full text-xs">
        <tbody>
          {filas.map((f, i) => {
            const eq = textoEquivalente(orig[i]);
            const estado = estadoCosto(orig[i]);
            return (
              <tr key={f.clave} className="border-t border-gray-200 align-top">
                <td className="py-1 pr-2">{f.servicio ?? f.tipo_proveedor ?? "Servicio"}</td>
                <td className="py-1 pr-2 text-gray-500">{f.proveedor ?? "Sin especificar"}</td>
                <td className="py-1 text-right tabular-nums">
                  <span data-testid="importe-origen">{importeOrigen(orig[i])}</span>
                  {eq && <span className={`block text-[11px] ${estado === "usd_sin_trm" ? "text-amber-700" : "text-gray-500"}`} data-testid="equivalente-provisional">{eq}</span>}
                  {editar && estado === "usd_con_trm" && comun == null && (
                    <TrmCostoEditor numero={numero!} identidad={identidad!} clave={f.clave} trmActual={Number(f.trm_costo)} etiqueta="Corregir TRM" />
                  )}
                  {editar && estado === "usd_sin_trm" && f.clave.startsWith("cxp:ed:") && (
                    <TrmCostoEditor numero={numero!} identidad={identidad!} clave={f.clave} trmActual={null} etiqueta="Fijar TRM de costos" />
                  )}
                </td>
              </tr>
            );
          })}
          {totales.map((t) => (
            <tr key={t.moneda} className="border-t border-gray-300 font-semibold align-top">
              <td className="py-1" colSpan={2}>{totales.length > 1 || t.moneda === "USD" ? `Total previsto en ${t.moneda}` : "Total previsto"}</td>
              <td className="py-1 text-right tabular-nums">
                {t.moneda === "USD" ? importeOrigen({ moneda: "USD", valor: t.total }) : formatCOP(t.total)}
                {t.moneda === "USD" && (
                  <span className={`block text-[11px] font-normal ${t.equivalenteCop == null ? "text-amber-700" : "text-gray-500"}`} data-testid="total-equivalente">
                    {t.equivalenteCop == null ? `Equivalente en pesos incompleto: ${t.sinTrm} obligación(es) sin TRM de costos` : `≈ ${formatCOP(t.equivalenteCop)} (provisional)`}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
