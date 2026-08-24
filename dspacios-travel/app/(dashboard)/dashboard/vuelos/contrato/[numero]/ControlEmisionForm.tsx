"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actualizarEstadoEmisionContrato } from "../../contrato-vuelos-actions";
import { ESTADOS_EMISION, ESTADO_EMISION_LABEL, POR_CONFIRMAR, type EstadoEmision } from "@/lib/vuelos/control";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const selCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

// Control de emisión del CONTRATO completo (1:1, migración 157) — nunca por
// tramo. Mismo patrón que ControlEmpaquetadoForm/ControlBloqueoForm: NULL
// ("Por confirmar") es una opción real, nunca se coacciona a 'pendiente'.
export function ControlEmisionForm({
  numeroContrato,
  estadoEmisionInicial,
}: {
  numeroContrato: string;
  estadoEmisionInicial: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [estadoEmision, setEstadoEmision] = useState<EstadoEmision | "">((estadoEmisionInicial as EstadoEmision | null) ?? "");
  const [nota, setNota] = useState("");

  function guardar() {
    setMsg(""); setOk(false);
    start(async () => {
      const r = await actualizarEstadoEmisionContrato(numeroContrato, estadoEmision, nota);
      // Nunca se comporta como éxito si el RPC falló: `nota` solo se limpia
      // en la rama ok — si falla, el usuario conserva lo que escribió.
      if (r.ok) { setOk(true); setMsg("Guardado."); setNota(""); router.refresh(); } else { setOk(false); setMsg(r.error); }
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-1 text-sm font-semibold text-gray-700">Estado de emisión</p>
      <p className="mb-4 text-xs text-gray-500">
        Del contrato completo, no de cada tramo por separado — con historial de cambios, más abajo. El estado de
        pago se calcula solo, desde las cuentas por pagar aéreas reales (pestaña Proveedores del contrato).
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={lbl}>Estado de emisión</label>
          <select value={estadoEmision} onChange={(e) => setEstadoEmision(e.target.value as EstadoEmision | "")} className={selCls}>
            <option value="">{POR_CONFIRMAR}</option>
            {ESTADOS_EMISION.map((e) => <option key={e} value={e}>{ESTADO_EMISION_LABEL[e]}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Nota (opcional)</label>
          <Input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} placeholder="Referencia de emisión, motivo del cambio, etc." />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Guardar estado de emisión"}
        </Button>
        {msg && <span className={`text-sm ${ok ? "text-green-700" : "text-red-600"}`}>{msg}</span>}
      </div>
    </section>
  );
}
