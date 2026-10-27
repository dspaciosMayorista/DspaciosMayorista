"use client";

// PR #409 — Fórmula del PVP paso a paso. SOLO presenta los pasos que calcula el motor compartido (`pvpProgramaDesglose`):
// no recalcula nada. «Neto del proveedor» es la tarifa que cobra el proveedor; no es el «NETO» de venta B2B (PVP − comisión).
import type { DesglosePvp } from "@/lib/calc/programaPrecio";

const dinero = (v: number, moneda: string) =>
  `${String(moneda).toUpperCase() === "USD" ? "USD $" : "$"}${v.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function FormulaPasos({ desglose, moneda, titulo }: { desglose: DesglosePvp; moneda: string; titulo?: string }) {
  if (!desglose.pasos.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs" aria-label={titulo ?? "Fórmula del PVP"}>
      {titulo && <p className="mb-1 font-medium text-gray-700">{titulo}</p>}
      <ol className="space-y-1">
        {desglose.pasos.map((p, i) => (
          <li key={p.clave} className="flex items-baseline justify-between gap-3">
            <span className="text-gray-600">
              <span className="mr-1 text-gray-400">{i + 1}.</span>
              {p.etiqueta}
              <span className="ml-1 text-gray-400">({p.operacion})</span>
            </span>
            <span className={`tabular-nums ${p.clave === "redondeo" ? "font-semibold" : ""}`} style={p.clave === "redondeo" ? { color: "var(--brand-primary)" } : undefined}>
              {p.clave === "redondeo" ? dinero(p.valor, moneda).replace(/[.,]00$/, "") : dinero(p.valor, moneda)}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] text-gray-400">
        El «neto del proveedor» es lo que cobra el proveedor; no es el «NETO» de venta B2B, que se elige al reservar (PVP menos la comisión del aliado).
      </p>
    </div>
  );
}
