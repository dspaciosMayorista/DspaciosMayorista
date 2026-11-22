"use client";

import { Input } from "@/components/ui/input";
import { copDeUsdNativo, previsualizarPagoUsd, type ModoPagoUsd } from "@/lib/finanzas/pagoUsd";
import { formatCOP, formatMoneda } from "@/lib/utils";

// #126-A — campos de un pago a un contrato en USD: cada pago pide SU TRM (sin valor por defecto) y muestra, antes de guardar,
// cuántos USD acredita y cuánto saldo queda. Un pago nativo en USD acredita exactamente lo digitado.

/** Valor en pesos que se envía al servidor: lo digitado (modo COP) o el equivalente de un pago nativo en USD. */
export function valorCopDelPago(modo: ModoPagoUsd, valor: string, trm: string): string {
  if (modo === "cop") return valor;
  const cop = copDeUsdNativo(Number(valor), trm);
  return cop == null ? "" : String(cop);
}

export function CamposPagoUsd({ modo, onModo, valor, onValor, trm, onTrm, saldo }: {
  modo: ModoPagoUsd; onModo: (m: ModoPagoUsd) => void;
  valor: string; onValor: (v: string) => void;
  trm: string; onTrm: (v: string) => void;
  /** Saldo del contrato en USD ANTES de este pago (para la vista previa). */
  saldo?: number;
}) {
  const prev = Number(valor) > 0 ? previsualizarPagoUsd({ principalUsd: saldo ?? 0, abonadoUsd: 0, modo, monto: Number(valor), trm }) : null;
  const btn = (m: ModoPagoUsd, texto: string) => (
    <button
      type="button"
      onClick={() => onModo(m)}
      aria-pressed={modo === m}
      className={`px-3 py-1.5 text-xs font-medium ${modo === m ? "bg-[var(--brand-primary)] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
    >
      {texto}
    </button>
  );
  return (
    <>
      <div>
        <span className="mb-1 block text-xs font-medium text-gray-600">Moneda del pago</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-300" role="group" aria-label="Moneda del pago">
          {btn("cop", "Pesos (COP)")}{btn("usd", "Dólares (USD)")}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">{modo === "cop" ? "Valor pagado (COP)" : "Valor pagado (USD)"}</label>
        <Input type="number" min={0} step={modo === "usd" ? "0.01" : "1"} value={valor} onChange={(e) => onValor(e.target.value)} placeholder="0" className="w-40" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">TRM de este pago</label>
        <Input type="number" min={0} step="0.0001" value={trm} onChange={(e) => onTrm(e.target.value)} placeholder="COP por 1 USD" className="w-36" aria-describedby="trm-pago-ayuda" />
        <p id="trm-pago-ayuda" className="mt-1 max-w-[11rem] text-[11px] text-gray-400">
          {modo === "cop" ? "Cada pago usa su propia TRM." : "Solo da el equivalente en pesos del asiento; no cambia los USD acreditados."}
        </p>
      </div>
      {prev && (
        <p data-testid="vista-previa-pago-usd" className={`basis-full text-xs ${"error" in prev ? "text-amber-700" : "text-gray-600"}`}>
          {"error" in prev ? prev.error : (
            <>
              Acredita <b>{formatMoneda(prev.usdAcreditado, "USD")}</b>
              {modo === "usd" ? <> · equivale a {formatCOP(prev.copEquivalente)} a esa TRM</> : null}
              {saldo != null ? <> · saldo después del pago: <b>{formatMoneda(prev.saldoDespues, "USD")}</b></> : null}
              {prev.excede ? <span className="ml-1 font-medium text-amber-700">(supera el saldo: se pedirá confirmación)</span> : null}
            </>
          )}
        </p>
      )}
    </>
  );
}
