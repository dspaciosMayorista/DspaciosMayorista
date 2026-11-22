"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { IdentidadContrato } from "@/lib/contrato/identidad";
import { registrarAbono } from "../actions";
import { CamposPagoUsd, valorCopDelPago } from "@/components/contrato/PagoUsdCampos";
import type { ModoPagoUsd } from "@/lib/finanzas/pagoUsd";
import { fechaNegocio } from "@/lib/fechaNegocio";
import { ConfirmarExcedenteAbono } from "@/components/contrato/ConfirmarExcedenteAbono";
import { useRegistroAbono } from "@/components/contrato/useRegistroAbono";
import { ConfirmacionPendienteAbono } from "@/components/contrato/ConfirmacionPendienteAbono";

export function AbonoForm({ numeroContrato, formasPago = [], moneda = "COP", identidad, saldo }: { numeroContrato: string; formasPago?: string[]; moneda?: string; identidad: IdentidadContrato; saldo?: number }) {
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState("");
  const [ref, setRef] = useState("");
  const [trm, setTrm] = useState("");
  const [fecha, setFecha] = useState(() => fechaNegocio());
  const esUSD = (moneda ?? "COP").toUpperCase() === "USD";
  const [modo, setModo] = useState<ModoPagoUsd>("cop");
  // #126-A: un pago nativo en USD se envía como su equivalente en pesos con SU TRM; la base acredita exactamente lo digitado (a centavos).
  const valorEnviado = esUSD ? valorCopDelPago(modo, valor, trm) : valor;
  const reg = useRegistroAbono({
    campos: { valor: valorEnviado, forma, ref, trm, fecha, monedaPago: esUSD ? (modo === "usd" ? "USD" : "COP") : undefined },
    esUSD,
    registrar: (e, confirmar) => registrarAbono(numeroContrato, e.valor, e.forma, e.ref, e.trm, e.fecha, confirmar, e.operacion, identidad, e.monedaPago),
    reiniciar: () => { setValor(""); setForma(""); setRef(""); setTrm(""); setFecha(fechaNegocio()); },
  });
  const { pending, error } = reg;

  return (
    <form onSubmit={(e) => { e.preventDefault(); reg.enviar(); }} className="flex flex-wrap items-end gap-3">
      <ConfirmarExcedenteAbono datos={reg.excedente} onCancelar={reg.cancelar} onConfirmar={reg.confirmar} />
      <ConfirmacionPendienteAbono mensaje={reg.confirmacionPendiente} pending={pending} onReintentar={reg.reintentarConfirmacion} />
      {esUSD ? (
        <CamposPagoUsd modo={modo} onModo={setModo} valor={valor} onValor={setValor} trm={trm} onTrm={setTrm} saldo={saldo} />
      ) : (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Valor del abono</label>
          <Input type="number" min={0} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0" className="w-40" />
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
        disabled={pending || !!reg.confirmacionPendiente}
        style={{ backgroundColor: "var(--brand-primary)" }}
      >
        {pending ? "Guardando…" : "Registrar abono"}
      </Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  );
}
