"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { corregirTrmCostoPrevista } from "@/app/(dashboard)/dashboard/contratos/[numero]/trm-costo-actions";
import type { IdentidadContrato } from "@/lib/contrato/identidad";
import { formatoTrm } from "@/lib/finanzas/costoProvisional";

/**
 * NETA-06: corrige la TRM de costos PROVISIONAL de las obligaciones previstas en USD (solo mientras el contrato está pendiente; migración 348).
 * `clave` null = todas las previstas en USD con TRM del contrato. La TRM del pago real a proveedor es otra y se registra al pagar.
 */
export function TrmCostoEditor({ numero, identidad, clave, trmActual, etiqueta }: { numero: string; identidad: IdentidadContrato; clave: string | null; trmActual: number | null; etiqueta: string }) {
  const [abierto, setAbierto] = useState(false);
  const [trm, setTrm] = useState(trmActual == null ? "" : String(trmActual));
  const [nota, setNota] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function guardar() {
    setMsg(null);
    start(async () => {
      const r = await corregirTrmCostoPrevista(numero, identidad, clave, trm, trmActual, nota);
      if (!r.ok) { setMsg({ ok: false, t: r.error }); return; }
      setMsg({ ok: true, t: r.cambiadas > 0 ? (trmActual == null ? `TRM de costos fijada en ${formatoTrm(r.trmNueva)} (provisional; ${r.cambiadas} obligación(es)).` : `TRM de costos actualizada a ${formatoTrm(r.trmNueva)} (${r.cambiadas} obligación(es)).`) : "La TRM no cambió." });
      setAbierto(false);
      router.refresh();
    });
  }

  return (
    <span className="inline-block" data-testid={clave ? "trm-editor-fila" : "trm-editor-contrato"}>
      {!abierto ? (
        <button type="button" onClick={() => { setAbierto(true); setMsg(null); }} className="text-xs font-medium hover:underline" style={{ color: "var(--brand-accent)" }}>{etiqueta}</button>
      ) : (
        <span className="mt-1 flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-2">
          <label className="text-[11px] text-gray-600">TRM de costos (COP por USD)
            <input type="text" inputMode="decimal" value={trm} onChange={(e) => setTrm(e.target.value)} className="mt-0.5 block w-28 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums" aria-label="Nueva TRM de costos" />
          </label>
          <label className="text-[11px] text-gray-600">Motivo (opcional)
            <input type="text" maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} className="mt-0.5 block w-48 rounded border border-gray-300 px-2 py-1 text-sm" aria-label="Motivo de la corrección" />
          </label>
          <button type="button" onClick={guardar} disabled={pending} className="rounded px-3 py-1 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "Guardando…" : "Guardar TRM"}</button>
          <button type="button" onClick={() => setAbierto(false)} className="px-2 py-1 text-xs text-gray-500 hover:underline">Cancelar</button>
        </span>
      )}
      {msg && <span role="status" className={`ml-2 text-xs ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.t}</span>}
    </span>
  );
}
