"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { briefFlyer, type BriefFlyerInput } from "@/lib/flyer/brief";

// Botón que genera un BRIEF de texto del producto (precios, datos, estilo de
// marca) para pegarlo en una IA y que ésta genere el flyer. No usa ninguna API.
export function BriefFlyerButton({ datos, className = "" }: { datos: BriefFlyerInput; className?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const texto = abierto ? briefFlyer(datos) : "";

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      /* el usuario puede seleccionar y copiar manual */
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAbierto(true); }}
        className={`inline-flex items-center gap-1 text-xs font-normal ${className}`}
        style={{ color: "var(--brand-accent)" }}
      >
        <Sparkles size={12} /> Brief de flyer
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAbierto(false)}>
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">Brief para generar el flyer con IA</h3>
              <button type="button" onClick={() => setAbierto(false)} className="text-gray-400 hover:text-gray-700" aria-label="Cerrar">✕</button>
            </div>
            <p className="mb-3 text-xs text-gray-500">Copia este texto y pégalo en tu IA generadora de imágenes/diseño. Trae los precios y datos reales + el estilo de marca.</p>
            <textarea
              readOnly
              value={texto}
              className="flex-1 resize-none rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-700"
              style={{ minHeight: 320 }}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setAbierto(false)} className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100">Cerrar</button>
              <button type="button" onClick={copiar} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
                {copiado ? "✓ Copiado" : "Copiar brief"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
