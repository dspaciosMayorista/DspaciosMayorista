"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actualizarConfigCobros } from "../contratos/[numero]/cobros-actions";

type Cfg = { tipo_paquete: string; pct_abono: number };

const LABEL: Record<string, string> = {
  bloqueo: "Bloqueo (producto propio)",
  porcion_terrestre: "Porción terrestre (propio)",
  servicios: "Servicios",
  dinamico: "Dinámico",
};

export function CobrosConfig({ config, esSuperadmin }: { config: Cfg[]; esSuperadmin: boolean }) {
  const [rows, setRows] = useState(() => Object.fromEntries(config.map((c) => [c.tipo_paquete, String(Math.round(c.pct_abono * 100))])));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function guardar(tipo: string) {
    setMsg("");
    start(async () => {
      const r = await actualizarConfigCobros(tipo, (Number(rows[tipo]) || 0) / 100);
      setMsg(r.ok ? "✓ Guardado" : r.error);
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-700">Cobros — % mínimo de abono para confirmar</h2>
      <p className="mt-1 mb-4 text-xs text-gray-500">
        El abono mínimo (por tipo de contrato) que auto-confirma la reserva. El saldo se reparte en cuotas mensuales hasta 1 mes antes del viaje.
        {!esSuperadmin && " Solo un superadmin puede cambiarlo."}
      </p>
      <div className="space-y-2">
        {config.map((c) => (
          <div key={c.tipo_paquete} className="flex flex-wrap items-center gap-3">
            <span className="w-56 text-sm text-gray-700">{LABEL[c.tipo_paquete] ?? c.tipo_paquete}</span>
            <Input type="number" className="w-24" value={rows[c.tipo_paquete] ?? ""} disabled={!esSuperadmin}
              onChange={(e) => setRows((p) => ({ ...p, [c.tipo_paquete]: e.target.value }))} />
            <span className="text-sm text-gray-400">%</span>
            {esSuperadmin && <Button variant="outline" onClick={() => guardar(c.tipo_paquete)} disabled={pending}>Guardar</Button>}
          </div>
        ))}
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.startsWith("✓") ? "text-green-600" : "text-red-600"}`}>{msg}</p>}
    </section>
  );
}
