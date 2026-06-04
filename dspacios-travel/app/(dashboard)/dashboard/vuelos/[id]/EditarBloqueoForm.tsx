"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RangosEdadPicker, type RangoEdad } from "@/components/RangosEdadPicker";
import { actualizarBloqueo } from "../actions";

type Opt = { id: number; nombre: string };
const lbl = "mb-1 block text-xs font-medium text-gray-600";
const selCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function EditarBloqueoForm({
  bloqueoId, inicial, proveedores, destinos, rangos,
}: {
  bloqueoId: number;
  inicial: {
    record: string; aerolinea: string; proveedorId: number | null; destinoId: number | null; ruta: string;
    vueloIda: string; fechaIda: string; horaSalidaIda: string; horaLlegadaIda: string;
    vueloRegreso: string; fechaRegreso: string; horaSalidaReg: string; horaLlegadaReg: string;
    tarifaParaEmpaquetar: number; fechaDevolucion: string; fechaEmision: string; notas: string; rangosEdad: number[];
  };
  proveedores: Opt[]; destinos: Opt[]; rangos: RangoEdad[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [f, setF] = useState({ ...inicial, tarifaParaEmpaquetar: String(inicial.tarifaParaEmpaquetar) });
  const [proveedorId, setProveedorId] = useState<number | "">(inicial.proveedorId ?? "");
  const [destinoId, setDestinoId] = useState<number | "">(inicial.destinoId ?? "");
  const [rangosSel, setRangosSel] = useState<number[]>(inicial.rangosEdad);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await actualizarBloqueo(bloqueoId, {
        record: f.record, aerolinea: f.aerolinea, proveedorId: proveedorId === "" ? null : Number(proveedorId),
        destinoId: destinoId === "" ? null : Number(destinoId), ruta: f.ruta,
        vueloIda: f.vueloIda, fechaIda: f.fechaIda, horaSalidaIda: f.horaSalidaIda, horaLlegadaIda: f.horaLlegadaIda,
        vueloRegreso: f.vueloRegreso, fechaRegreso: f.fechaRegreso, horaSalidaReg: f.horaSalidaReg, horaLlegadaReg: f.horaLlegadaReg,
        tarifaParaEmpaquetar: Number(f.tarifaParaEmpaquetar) || 0, fechaDevolucion: f.fechaDevolucion, fechaEmision: f.fechaEmision,
        notas: f.notas, rangosEdad: rangosSel,
      });
      if (r.ok) { setMsg("Guardado."); setOpen(false); router.refresh(); } else setMsg(r.error);
    });
  }

  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-700">Editar bloqueo (no cambia cupos)</span>
        <span className="text-gray-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-gray-100 p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div><label className={lbl}>Record (PNR)</label><Input value={f.record} onChange={set("record")} /></div>
            <div><label className={lbl}>Aerolínea</label><Input value={f.aerolinea} onChange={set("aerolinea")} /></div>
            <div>
              <label className={lbl}>Proveedor aéreo</label>
              <select value={proveedorId} onChange={(e) => setProveedorId(Number(e.target.value) || "")} className={selCls}>
                <option value="">—</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Destino</label>
              <select value={destinoId} onChange={(e) => setDestinoId(Number(e.target.value) || "")} className={selCls}>
                <option value="">—</option>
                {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Ruta</label><Input value={f.ruta} onChange={set("ruta")} /></div>
            <div><label className={lbl}>Tarifa para empaquetar</label><Input type="number" min={0} value={f.tarifaParaEmpaquetar} onChange={set("tarifaParaEmpaquetar")} /></div>
            <div><label className={lbl}># Vuelo ida</label><Input value={f.vueloIda} onChange={set("vueloIda")} /></div>
            <div><label className={lbl}>Fecha ida</label><Input type="date" value={f.fechaIda} onChange={set("fechaIda")} /></div>
            <div><label className={lbl}>Hora salida ida</label><Input type="time" value={f.horaSalidaIda} onChange={set("horaSalidaIda")} /></div>
            <div><label className={lbl}>Hora llegada ida</label><Input type="time" value={f.horaLlegadaIda} onChange={set("horaLlegadaIda")} /></div>
            <div><label className={lbl}># Vuelo regreso</label><Input value={f.vueloRegreso} onChange={set("vueloRegreso")} /></div>
            <div><label className={lbl}>Fecha regreso</label><Input type="date" value={f.fechaRegreso} onChange={set("fechaRegreso")} /></div>
            <div><label className={lbl}>Hora salida reg.</label><Input type="time" value={f.horaSalidaReg} onChange={set("horaSalidaReg")} /></div>
            <div><label className={lbl}>Hora llegada reg.</label><Input type="time" value={f.horaLlegadaReg} onChange={set("horaLlegadaReg")} /></div>
            <div><label className={lbl}>Fecha devolución</label><Input type="date" value={f.fechaDevolucion} onChange={set("fechaDevolucion")} /></div>
            <div><label className={lbl}>Fecha emisión</label><Input type="date" value={f.fechaEmision} onChange={set("fechaEmision")} /></div>
            <div className="col-span-2 md:col-span-3"><label className={lbl}>Notas</label><Input value={f.notas} onChange={set("notas")} /></div>
          </div>
          <RangosEdadPicker rangos={rangos} seleccionados={rangosSel} onChange={setRangosSel} label="Rangos de edad del vuelo" />
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
