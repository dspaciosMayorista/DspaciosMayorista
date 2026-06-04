"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actualizarVenta, type VentaEditInput } from "../actions";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const selCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function EditarVentaForm({ numero, inicial }: { numero: string; inicial: VentaEditInput }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(inicial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const set = (k: keyof VentaEditInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarVenta(numero, f);
      if (r.ok) { setMsg("Guardado."); setOpen(false); router.refresh(); } else setMsg(r.error);
    });
  }

  return (
    <section className="mt-5 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-700">Editar datos del contrato</span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-gray-100 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2"><label className={lbl}>Cliente *</label><Input value={f.cliente} onChange={set("cliente")} /></div>
            <div><label className={lbl}>Documento</label><Input value={f.clienteDocumento} onChange={set("clienteDocumento")} /></div>
            <div><label className={lbl}>Teléfono</label><Input value={f.clienteTelefono} onChange={set("clienteTelefono")} /></div>
            <div><label className={lbl}>Email</label><Input value={f.clienteEmail} onChange={set("clienteEmail")} /></div>
            <div><label className={lbl}>Dirección</label><Input value={f.clienteDireccion} onChange={set("clienteDireccion")} /></div>
            <div><label className={lbl}>Destino</label><Input value={f.destino} onChange={set("destino")} /></div>
            <div><label className={lbl}>Fecha salida</label><Input type="date" value={f.fechaSalida} onChange={set("fechaSalida")} /></div>
            <div><label className={lbl}>Fecha regreso</label><Input type="date" value={f.fechaRegreso} onChange={set("fechaRegreso")} /></div>
            <div><label className={lbl}>Plazo</label><Input type="date" value={f.plazo} onChange={set("plazo")} /></div>
            <div><label className={lbl}>Plan</label><Input value={f.planNombre} onChange={set("planNombre")} /></div>
            <div>
              <label className={lbl}>Tipo de venta</label>
              <select value={f.tipoAsesor} onChange={set("tipoAsesor")} className={selCls}>
                <option value="interno">Asesor interno (B2C)</option>
                <option value="agencia">Agencia (B2B)</option>
                <option value="freelance">Freelance (B2B)</option>
              </select>
            </div>
            {f.tipoAsesor === "agencia" && (
              <>
                <div><label className={lbl}>Agencia</label><Input value={f.agenciaNombre} onChange={set("agenciaNombre")} /></div>
                <div><label className={lbl}>Asesor agencia</label><Input value={f.agenciaAsesor} onChange={set("agenciaAsesor")} /></div>
              </>
            )}
            {f.tipoAsesor === "freelance" && (
              <div><label className={lbl}>Freelance</label><Input value={f.freelanceNombre} onChange={set("freelanceNombre")} /></div>
            )}
            <div><label className={lbl}>Asesor (firma)</label><Input value={f.asesorNombre} onChange={set("asesorNombre")} /></div>
            <div className="sm:col-span-3"><label className={lbl}>Observaciones</label><textarea value={f.observaciones} onChange={set("observaciones")} className={selCls} rows={2} /></div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
              {pending ? "Guardando…" : "Guardar cambios"}
            </Button>
            {msg && <span className="text-sm text-gray-600">{msg}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
