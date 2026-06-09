"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCOP, formatFechaLarga } from "@/lib/utils";
import { generarPlanCobro } from "./cobros-actions";

export type CuotaRow = { id: number; orden: number; tipo: string; fecha_limite: string; monto: number };

const TIPO_LABEL: Record<string, string> = { abono: "Abono inicial", cuota: "Cuota", total: "Pago total" };

export function PlanCobroPanel({ numero, cuotas, pagado }: { numero: string; cuotas: CuotaRow[]; pagado: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function generar() {
    setMsg("");
    start(async () => {
      const r = await generarPlanCobro(numero);
      if (r.ok) { setMsg(`✓ Plan de ${r.n} pago(s)`); router.refresh(); }
      else setMsg(r.error);
    });
  }

  // Marca como cubiertas las cuotas que el total pagado ya alcanza (acumulado).
  const filas = cuotas.map((c, i) => {
    const acum = cuotas.slice(0, i + 1).reduce((s, x) => s + x.monto, 0);
    return { c, cubierta: pagado >= acum };
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-700">Plan de cobro</p>
        <Button onClick={generar} disabled={pending} variant="outline">
          {pending ? "Generando…" : cuotas.length ? "Regenerar plan" : "Generar plan de cobro"}
        </Button>
      </div>
      {msg && <p className={`mt-1 text-xs ${msg.startsWith("✓") ? "text-green-600" : "text-red-600"}`}>{msg}</p>}
      {cuotas.length > 0 ? (
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-gray-400">
            <th className="py-1">Concepto</th><th className="py-1">Fecha límite</th>
            <th className="py-1 text-right">Monto</th><th className="py-1 text-right">Estado</th>
          </tr></thead>
          <tbody>
            {filas.map(({ c, cubierta }) => {
              return (
                <tr key={c.id} className="border-t border-gray-50">
                  <td className="py-1.5 text-gray-700">{TIPO_LABEL[c.tipo] ?? c.tipo}</td>
                  <td className="py-1.5 text-gray-500">{formatFechaLarga(c.fecha_limite)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCOP(c.monto)}</td>
                  <td className="py-1.5 text-right">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${cubierta ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                      {cubierta ? "Cubierta" : "Pendiente"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-xs text-gray-400">Sin plan. Genera las cuotas: abono inicial + saldo mensual hasta 1 mes antes del viaje.</p>
      )}
    </div>
  );
}
