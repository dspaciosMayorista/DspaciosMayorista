"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registrarAbono } from "../actions";

export function AbonoForm({ numeroContrato }: { numeroContrato: string }) {
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState("");
  const [ref, setRef] = useState("");
  const [pending, startTransition] = useTransition();

  function handle(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(valor);
    if (!v || v <= 0) return;
    startTransition(async () => {
      await registrarAbono(numeroContrato, v, forma, ref);
      setValor("");
      setForma("");
      setRef("");
    });
  }

  return (
    <form onSubmit={handle} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Valor del abono
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
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Forma de pago
        </label>
        <Input
          value={forma}
          onChange={(e) => setForma(e.target.value)}
          placeholder="Transferencia, efectivo…"
          className="w-44"
        />
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
      <Button
        type="submit"
        disabled={pending}
        style={{ backgroundColor: "var(--brand-primary)" }}
      >
        {pending ? "Guardando…" : "Registrar abono"}
      </Button>
    </form>
  );
}
