"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registrarAbono } from "../actions";
import { formatUSD } from "@/lib/utils";
import { fechaNegocio } from "@/lib/fechaNegocio";
import { ConfirmarExcedenteAbono } from "@/components/contrato/ConfirmarExcedenteAbono";
import { useRegistroAbono } from "@/components/contrato/useRegistroAbono";

export function AbonoForm({ numeroContrato, formasPago = [], moneda = "COP" }: { numeroContrato: string; formasPago?: string[]; moneda?: string }) {
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState("");
  const [ref, setRef] = useState("");
  const [trm, setTrm] = useState("");
  const [fecha, setFecha] = useState(() => fechaNegocio());
  const esUSD = (moneda ?? "COP").toUpperCase() === "USD";
  const usdEq = esUSD && Number(valor) > 0 && Number(trm) > 0 ? Number(valor) / Number(trm) : null;
  const reg = useRegistroAbono({
    campos: { valor, forma, ref, trm, fecha },
    esUSD,
    registrar: (e, confirmar) => registrarAbono(numeroContrato, e.valor, e.forma, e.ref, e.trm, e.fecha, confirmar, e.operacion),
    reiniciar: () => { setValor(""); setForma(""); setRef(""); setTrm(""); setFecha(fechaNegocio()); },
  });
  const { pending, error } = reg;

  return (
    <form onSubmit={(e) => { e.preventDefault(); reg.enviar(); }} className="flex flex-wrap items-end gap-3">
      <ConfirmarExcedenteAbono datos={reg.excedente} onCancelar={reg.cancelar} onConfirmar={reg.confirmar} />
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
        <DateInput aria-label="Fecha del abono" type="date" value={fecha} onValueChange={(dateValue) => setFecha(dateValue)} className="w-40" />
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
