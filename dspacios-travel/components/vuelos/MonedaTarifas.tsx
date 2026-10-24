"use client";

import { AlertTriangle } from "lucide-react";
import { camposSospechososUsd, mensajeValorSospechoso, PREGUNTA_VALOR_USD, type MonedaVuelo } from "@/lib/vuelos/monedaSospechosa";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const selCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

/**
 * Campo "Moneda de las tarifas" de Empaquetados y de las salidas dinámicas (#90, 230). Con COP y un valor positivo menor a
 * 1.000 muestra la pregunta "¿Este valor está en USD?" con un botón para corregirlo; el formulario debe bloquear el guardado
 * mientras `etiquetasSospechosas(...)` no esté vacío (el servidor de Empaquetados también lo rechaza).
 */
export function etiquetasSospechosas(
  moneda: string,
  campos: readonly { etiqueta: string; valor: number | string | null | undefined }[]
): string[] {
  return camposSospechososUsd(moneda, campos);
}

export function MonedaTarifas({
  moneda,
  onChange,
  campos,
  ayuda,
}: {
  moneda: MonedaVuelo;
  onChange: (m: MonedaVuelo) => void;
  campos: readonly { etiqueta: string; valor: number | string | null | undefined }[];
  ayuda?: string;
}) {
  const sospechosos = camposSospechososUsd(moneda, campos);
  return (
    <div>
      <label className={lbl} htmlFor="moneda-tarifas">Moneda de las tarifas</label>
      <select
        id="moneda-tarifas"
        aria-label="Moneda de las tarifas"
        value={moneda}
        onChange={(e) => onChange(e.target.value === "USD" ? "USD" : "COP")}
        className={selCls}
      >
        <option value="COP">COP (pesos)</option>
        <option value="USD">USD (dólares)</option>
      </select>
      {ayuda && <p className="mt-1 text-[11px] text-gray-400">{ayuda}</p>}
      {sospechosos.length > 0 && (
        <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="valor-sospechoso-usd">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p className="font-semibold">{PREGUNTA_VALOR_USD}</p>
            <p>{mensajeValorSospechoso(sospechosos).replace(`${PREGUNTA_VALOR_USD} `, "")}</p>
            <button type="button" onClick={() => onChange("USD")} className="font-semibold underline">
              Sí, es USD
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
