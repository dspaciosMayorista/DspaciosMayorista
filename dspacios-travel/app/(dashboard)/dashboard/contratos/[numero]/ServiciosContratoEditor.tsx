"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCOP } from "@/lib/utils";
import { precioServicio } from "@/lib/calc/paquetes";
import { actualizarServiciosContrato } from "../actions";

export type ServicioDispContrato = {
  servicioId: number;
  nombre: string;
  modo: "persona" | "grupo";
  personaPvp: number | null;
  grupos: { pax_desde: number; pax_hasta: number; precio: number }[];
};

export function ServiciosContratoEditor({
  numero, pax, serviciosDisp, seleccionInicial,
}: {
  numero: string;
  pax: number;
  serviciosDisp: ServicioDispContrato[];
  seleccionInicial: number[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<number>>(new Set(seleccionInicial));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  if (!serviciosDisp.length) return null;

  const precioDe = (s: ServicioDispContrato) => precioServicio(s.modo, s.personaPvp, s.grupos, pax);
  const total = serviciosDisp.reduce((acc, s) => (sel.has(s.servicioId) ? acc + precioDe(s) : acc), 0);

  function toggle(id: number) {
    setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarServiciosContrato(numero, [...sel]);
      if (r.ok) { setMsg("✓ Servicios actualizados"); router.refresh(); } else setMsg(r.error ?? "Error");
    });
  }

  return (
    <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-1 text-sm font-semibold text-gray-700">Servicios adicionales (contrato pendiente)</p>
      <p className="mb-3 text-xs text-gray-400">Marca/desmarca servicios; se re-liquidan sobre {pax} pax y se actualiza el precio del contrato.</p>
      <ul className="divide-y divide-gray-100">
        {serviciosDisp.map((s) => (
          <li key={s.servicioId} className="flex items-center justify-between py-2.5">
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={sel.has(s.servicioId)} onChange={() => toggle(s.servicioId)} />
              <span className="text-sm text-gray-800">
                {s.nombre} <span className="text-xs text-gray-400">({s.modo === "grupo" ? `por grupo · ${pax} pax` : "por persona"})</span>
              </span>
            </label>
            <span className="text-sm tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatCOP(precioDe(s))}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Guardar servicios"}
        </Button>
        <span className="text-sm text-gray-500">Servicios: <b className="tabular-nums">{formatCOP(total)}</b></span>
        {msg && <span className="text-sm text-green-600">{msg}</span>}
      </div>
    </div>
  );
}
