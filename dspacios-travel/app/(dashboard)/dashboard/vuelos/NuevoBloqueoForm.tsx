"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearBloqueo } from "./actions";
import { RangosEdadPicker, type RangoEdad } from "@/components/RangosEdadPicker";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const card = "rounded-xl border border-gray-200 bg-white p-5 space-y-4";

type ProvOpt = { id: number; nombre: string };

export function NuevoBloqueoForm({ proveedores = [], destinos = [], rangos = [] }: { proveedores?: ProvOpt[]; destinos?: ProvOpt[]; rangos?: RangoEdad[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [proveedorId, setProveedorId] = useState<number | "">("");
  const [destinoId, setDestinoId] = useState<number | "">("");
  const [rangosSel, setRangosSel] = useState<number[]>([]);

  const [f, setF] = useState({
    record: "", aerolinea: "", ruta: "",
    vueloIda: "", fechaIda: "", horaSalidaIda: "", horaLlegadaIda: "",
    vueloRegreso: "", fechaRegreso: "", horaSalidaReg: "", horaLlegadaReg: "",
    cuposTotal: "10", tarifaParaEmpaquetar: "", fechaDevolucion: "", fechaEmision: "", notas: "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.record.trim()) { setErr("El record (PNR) es obligatorio."); return; }
    setErr("");
    start(async () => {
      const r = await crearBloqueo({
        record: f.record, aerolinea: f.aerolinea, proveedorId: proveedorId === "" ? null : Number(proveedorId),
        destinoId: destinoId === "" ? null : Number(destinoId), ruta: f.ruta,
        vueloIda: f.vueloIda, fechaIda: f.fechaIda, horaSalidaIda: f.horaSalidaIda, horaLlegadaIda: f.horaLlegadaIda,
        vueloRegreso: f.vueloRegreso, fechaRegreso: f.fechaRegreso, horaSalidaReg: f.horaSalidaReg, horaLlegadaReg: f.horaLlegadaReg,
        cuposTotal: Number(f.cuposTotal) || 0, tarifaParaEmpaquetar: Number(f.tarifaParaEmpaquetar) || 0,
        fechaDevolucion: f.fechaDevolucion, fechaEmision: f.fechaEmision, notas: f.notas, rangosEdad: rangosSel,
      });
      if (r.ok) router.push("/dashboard/vuelos");
      else setErr(r.error);
    });
  }

  return (
    <form onSubmit={guardar} className="space-y-5">
      <section className={card}>
        <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Datos del bloqueo</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div><label className={lbl}>Record (PNR) *</label><Input value={f.record} onChange={set("record")} placeholder="L93FYZ" /></div>
          <div><label className={lbl}>Aerolínea</label><Input value={f.aerolinea} onChange={set("aerolinea")} placeholder="JETSMART" /></div>
          <div>
            <label className={lbl}>Proveedor aéreo</label>
            <select value={proveedorId} onChange={(e) => setProveedorId(Number(e.target.value) || "")}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">—</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Destino</label>
            <select value={destinoId} onChange={(e) => setDestinoId(Number(e.target.value) || "")}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">—</option>
              {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Ruta</label><Input value={f.ruta} onChange={set("ruta")} placeholder="MDE - CTG - MDE" /></div>
          <div><label className={lbl}>Cupos totales</label><Input type="number" min={0} value={f.cuposTotal} onChange={set("cuposTotal")} /></div>
          <div><label className={lbl}>Tarifa para empaquetar</label><Input type="number" min={0} value={f.tarifaParaEmpaquetar} onChange={set("tarifaParaEmpaquetar")} placeholder="242022" /></div>
          <div><label className={lbl}>Fecha devolución</label><Input type="date" value={f.fechaDevolucion} onChange={set("fechaDevolucion")} /></div>
        </div>
        <RangosEdadPicker rangos={rangos} seleccionados={rangosSel} onChange={setRangosSel} label="Rangos de edad del vuelo (infante/niño)" />
      </section>

      <section className={card}>
        <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Vuelo de ida</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><label className={lbl}># Vuelo</label><Input value={f.vueloIda} onChange={set("vueloIda")} placeholder="5410" /></div>
          <div><label className={lbl}>Fecha ida</label><Input type="date" value={f.fechaIda} onChange={set("fechaIda")} /></div>
          <div><label className={lbl}>Hora salida</label><Input type="time" value={f.horaSalidaIda} onChange={set("horaSalidaIda")} /></div>
          <div><label className={lbl}>Hora llegada</label><Input type="time" value={f.horaLlegadaIda} onChange={set("horaLlegadaIda")} /></div>
        </div>
      </section>

      <section className={card}>
        <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Vuelo de regreso</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><label className={lbl}># Vuelo</label><Input value={f.vueloRegreso} onChange={set("vueloRegreso")} placeholder="5414" /></div>
          <div><label className={lbl}>Fecha regreso</label><Input type="date" value={f.fechaRegreso} onChange={set("fechaRegreso")} /></div>
          <div><label className={lbl}>Hora salida</label><Input type="time" value={f.horaSalidaReg} onChange={set("horaSalidaReg")} /></div>
          <div><label className={lbl}>Hora llegada</label><Input type="time" value={f.horaLlegadaReg} onChange={set("horaLlegadaReg")} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Fecha emisión</label><Input type="date" value={f.fechaEmision} onChange={set("fechaEmision")} /></div>
          <div><label className={lbl}>Notas</label><Input value={f.notas} onChange={set("notas")} /></div>
        </div>
      </section>

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Creando…" : "Crear bloqueo"}
        </Button>
        <span className="text-xs text-gray-400">Se generarán {Number(f.cuposTotal) || 0} sillas disponibles.</span>
      </div>
    </form>
  );
}
