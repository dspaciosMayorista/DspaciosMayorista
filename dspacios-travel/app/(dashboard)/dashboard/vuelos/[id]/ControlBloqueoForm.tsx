"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actualizarControlBloqueo } from "../actions";
import {
  MODALIDADES_EMISION,
  ESTADOS_EMISION,
  ESTADOS_PAGO,
  MODALIDAD_LABEL,
  ESTADO_EMISION_LABEL,
  ESTADO_PAGO_LABEL,
  type ModalidadEmision,
  type EstadoEmision,
  type EstadoPago,
} from "@/lib/vuelos/control";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const selCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

// Editor de los tres campos de control del record (migración 152). Cada
// guardado queda en `bloqueo_cambios` (antes→después, quién, cuándo) — la
// misma Server Action se encarga de eso, aquí solo se arma el formulario.
//
// La modalidad no tiene un valor neutral por defecto: si el bloqueo es
// anterior a esta migración (null), el select arranca vacío y hay que
// elegir antes de poder guardar — igual que exige el formulario de creación.
// Los estados sí parten de 'pendiente' cuando están sin definir: abrir este
// editor y guardar sin tocarlos es una decisión explícita del usuario, no un
// default silencioso de la base de datos (ver cabecera de la migración 152).
export function ControlBloqueoForm({
  bloqueoId,
  inicial,
}: {
  bloqueoId: number;
  inicial: { modalidadEmision: string | null; estadoEmision: string | null; estadoPago: string | null };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [modalidad, setModalidad] = useState<ModalidadEmision | "">(
    (inicial.modalidadEmision as ModalidadEmision | null) ?? ""
  );
  const [estadoEmision, setEstadoEmision] = useState<EstadoEmision>(
    (inicial.estadoEmision as EstadoEmision | null) ?? "pendiente"
  );
  const [estadoPago, setEstadoPago] = useState<EstadoPago>(
    (inicial.estadoPago as EstadoPago | null) ?? "pendiente"
  );
  const [nota, setNota] = useState("");

  function guardar() {
    if (!modalidad) { setMsg("Selecciona la modalidad de emisión."); return; }
    setMsg("");
    start(async () => {
      const r = await actualizarControlBloqueo(bloqueoId, { modalidadEmision: modalidad, estadoEmision, estadoPago, nota });
      if (r.ok) { setMsg("Guardado."); setNota(""); router.refresh(); } else setMsg(r.error);
    });
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-1 text-sm font-semibold text-gray-700">Control del record</p>
      <p className="mb-4 text-xs text-gray-500">
        Modalidad, emisión y pago al proveedor/aerolínea — manuales, independientes del estado de cada silla. El
        pago del cliente se maneja aparte, en Cartera del contrato.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={lbl}>Modalidad de emisión *</label>
          <select value={modalidad} onChange={(e) => setModalidad(e.target.value as ModalidadEmision)} className={selCls}>
            <option value="">— Elegir —</option>
            {MODALIDADES_EMISION.map((m) => <option key={m} value={m}>{MODALIDAD_LABEL[m]}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Estado de emisión</label>
          <select value={estadoEmision} onChange={(e) => setEstadoEmision(e.target.value as EstadoEmision)} className={selCls}>
            {ESTADOS_EMISION.map((e) => <option key={e} value={e}>{ESTADO_EMISION_LABEL[e]}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Estado de pago</label>
          <select value={estadoPago} onChange={(e) => setEstadoPago(e.target.value as EstadoPago)} className={selCls}>
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
