"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actualizarControlEmpaquetado } from "../../empaquetados-actions";
import {
  ESTADOS_EMISION,
  ESTADOS_PAGO,
  ESTADO_EMISION_LABEL,
  ESTADO_PAGO_LABEL,
  POR_CONFIRMAR,
  type EstadoEmision,
  type EstadoPago,
} from "@/lib/vuelos/control";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const selCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

// Editor de los campos OPERATIVOS de un empaquetado — record, estado de
// emisión, estado de pago (migración 156). Cada guardado queda en
// `empaquetado_cambios` (antes→después, quién, cuándo) vía el RPC
// `actualizar_control_empaquetado`, mismo patrón que ControlBloqueoForm/
// `actualizar_control_bloqueo` (migración 152).
//
// ⚠️ A DIFERENCIA de ControlBloqueoForm (defecto 7, revisión de PR #268):
// estado_emision/estado_pago NULL ("Por confirmar") NUNCA se coacciona a
// 'pendiente' al abrir el formulario ni al guardar — hay una opción real
// "Por confirmar" en cada select, y si el usuario la deja así, eso es
// exactamente lo que se guarda. Guardar sin tocar nada no debe inventar un
// estado que nadie confirmó.
export function ControlEmpaquetadoForm({
  empaquetadoId,
  inicial,
}: {
  empaquetadoId: number;
  inicial: { record: string | null; estadoEmision: string | null; estadoPago: string | null };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [record, setRecord] = useState(inicial.record ?? "");
  const [estadoEmision, setEstadoEmision] = useState<EstadoEmision | "">((inicial.estadoEmision as EstadoEmision | null) ?? "");
  const [estadoPago, setEstadoPago] = useState<EstadoPago | "">((inicial.estadoPago as EstadoPago | null) ?? "");
  const [nota, setNota] = useState("");

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarControlEmpaquetado(empaquetadoId, { record, estadoEmision, estadoPago, nota });
      if (r.ok) { setMsg("Guardado."); setNota(""); router.refresh(); } else setMsg(r.error);
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-1 text-sm font-semibold text-gray-700">Control operativo</p>
      <p className="mb-4 text-xs text-gray-500">
        Record (PNR), emisión y pago al proveedor/sistema — manuales, con historial de cambios. La modalidad es
        siempre &quot;Sistema&quot; (no aplica aquí).
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={lbl}>Record (PNR)</label>
          <Input value={record} onChange={(e) => setRecord(e.target.value)} placeholder="Sin record por ahora" />
        </div>
        <div>
          <label className={lbl}>Estado de emisión</label>
          <select value={estadoEmision} onChange={(e) => setEstadoEmision(e.target.value as EstadoEmision | "")} className={selCls}>
            <option value="">{POR_CONFIRMAR}</option>
            {ESTADOS_EMISION.map((e) => <option key={e} value={e}>{ESTADO_EMISION_LABEL[e]}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Estado de pago</label>
          <select value={estadoPago} onChange={(e) => setEstadoPago(e.target.value as EstadoPago | "")} className={selCls}>
            <option value="">{POR_CONFIRMAR}</option>
            {ESTADOS_PAGO.map((e) => <option key={e} value={e}>{ESTADO_PAGO_LABEL[e]}</option>)}
          </select>
        </div>
      </div>
      <div className="mt-3">
        <label className={lbl}>Nota (opcional)</label>
        <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Motivo del cambio, referencia de pago, etc." />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Guardando…" : "Guardar control"}
        </Button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </section>
  );
}
