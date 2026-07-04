"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registrarAbono } from "../actions";
import { formatUSD } from "@/lib/utils";

export function AbonoForm({ numeroContrato, formasPago = [], moneda = "COP" }: { numeroContrato: string; formasPago?: string[]; moneda?: string }) {
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState("");
  const [ref, setRef] = useState("");
  const [trm, setTrm] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const esUSD = (moneda ?? "COP").toUpperCase() === "USD";
  const usdEq = esUSD && Number(valor) > 0 && Number(trm) > 0 ? Number(valor) / Number(trm) : null;

  function handle(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const v = Number(valor);
    if (!v || v <= 0) return;
    if (esUSD && !(Number(trm) > 0)) return;
    startTransition(async () => {
      const r = await registrarAbono(numeroContrato, v, forma, ref, esUSD ? Number(trm) : undefined, fecha);
      if (!r.ok) { setError(r.error ?? "No se pudo registrar el abono."); return; }
      setValor("");
      setForma("");
      setRef("");
      setTrm("");
      setFecha(new Date().toISOString().slice(0, 10));
    });
  }

  return (
    <form onSubmit={handle} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          {esUSD ? "Valor pagado (COP)" : "Valor del abono"}
        </label>
        <Input
          type="number"
          min={0}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="0"
          className="w-40"
        />
      </div>
      {esUSD && (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">TRM del día</label>
          <Input type="number" min={0} value={trm} onChange={(e) => setTrm(e.target.value)} placeholder="4000" className="w-32" />
          <p className="mt-1 text-[11px] text-gray-400">{usdEq != null ? `= ${formatUSD(usdEq)}` : "COP por 1 USD"}</p>
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Forma de pago
        </label>
        <select
          value={forma}
          onChange={(e) => setForma(e.target.value)}
          className="w-44 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Selecciona…</option>
          {formasPago.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Referencia
        </label>
        <Input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="Comprobante / nota"
          className="w-44"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Fecha del abono</label>
        <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-40" />
      </div>
      <Button
        type="submit"
        disabled={pending}
        style={{ backgroundColor: "var(--brand-primary)" }}
      >
        {pending ? "Guardando…" : "Registrar abono"}
      </Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  );
}
