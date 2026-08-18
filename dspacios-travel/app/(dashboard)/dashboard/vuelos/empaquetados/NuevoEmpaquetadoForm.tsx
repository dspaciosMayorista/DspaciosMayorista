"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearEmpaquetado } from "../empaquetados-actions";
import { ComboDestino, type DestinoOpt } from "@/components/ComboDestino";
import { ESTADOS_EMISION, ESTADOS_PAGO, ESTADO_EMISION_LABEL, ESTADO_PAGO_LABEL, type EstadoEmision, type EstadoPago } from "@/lib/vuelos/control";

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const card = "rounded-xl border border-gray-200 bg-white p-5 space-y-4";
const selCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

type ProvOpt = { id: number; nombre: string };

export function NuevoEmpaquetadoForm({ proveedores = [], destinos = [] }: { proveedores?: ProvOpt[]; destinos?: DestinoOpt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [proveedorId, setProveedorId] = useState<number | "">("");
  const [destinoId, setDestinoId] = useState<number | "">("");
  const [origenId, setOrigenId] = useState<number | "">("");
  const [estadoEmision, setEstadoEmision] = useState<EstadoEmision | "">("pendiente");
  const [estadoPago, setEstadoPago] = useState<EstadoPago | "">("pendiente");

  const [f, setF] = useState({
    record: "", aerolinea: "",
    vueloIda: "", fechaIda: "", horaSalidaIda: "", horaLlegadaIda: "",
    vueloRegreso: "", fechaRegreso: "", horaSalidaReg: "", horaLlegadaReg: "",
    tarifaProveedor: "", tarifaParaEmpaquetar: "", feeInfante: "0",
    compraInicio: "", compraFin: "", notas: "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const iataDe = (id: number | "") => {
    const d = destinos.find((x) => x.id === id);
    return (d?.codigo_iata || d?.nombre || "").toUpperCase().trim();
  };
  const oIATA = iataDe(origenId);
  const dIATA = iataDe(destinoId);
  const rutaAuto = oIATA && dIATA ? `${oIATA} - ${dIATA} - ${oIATA}` : "";

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.fechaIda) { setErr("La fecha de ida es obligatoria."); return; }
    setErr("");
    start(async () => {
      const r = await crearEmpaquetado({
        record: f.record, aerolinea: f.aerolinea, proveedorId: proveedorId === "" ? null : Number(proveedorId),
        destinoId: destinoId === "" ? null : Number(destinoId), ruta: rutaAuto, origen: oIATA,
        vueloIda: f.vueloIda, fechaIda: f.fechaIda, horaSalidaIda: f.horaSalidaIda, horaLlegadaIda: f.horaLlegadaIda,
        vueloRegreso: f.vueloRegreso, fechaRegreso: f.fechaRegreso, horaSalidaReg: f.horaSalidaReg, horaLlegadaReg: f.horaLlegadaReg,
        tarifaProveedor: Number(f.tarifaProveedor) || 0, tarifaParaEmpaquetar: Number(f.tarifaParaEmpaquetar) || 0,
        feeInfante: Number(f.feeInfante) || 0, compraInicio: f.compraInicio, compraFin: f.compraFin,
        estadoEmision, estadoPago, notas: f.notas, activo: true,
      });
      if (r.ok) router.push("/dashboard/vuelos?vista=empaquetados");
      else setErr(r.error);
    });
  }

  return (
    <form onSubmit={guardar} className="space-y-5">
      <section className={card}>
        <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Datos del empaquetado</p>
        <p className="text-xs text-gray-500">
          Tarifa de sistema, sin cupo negociado. Modalidad fija: <b>Sistema</b>. El record (PNR) es opcional — se
          agrega cuando se compra/emite.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div><label className={lbl}>Record (PNR)</label><Input value={f.record} onChange={set("record")} placeholder="Sin record por ahora" /></div>
          <div><label className={lbl}>Aerolínea</label><Input value={f.aerolinea} onChange={set("aerolinea")} placeholder="JETSMART" /></div>
          <div>
            <label className={lbl}>Proveedor / plataforma</label>
            <select value={proveedorId} onChange={(e) => setProveedorId(Number(e.target.value) || "")} className={selCls}>
              <option value="">—</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Origen</label>
            <ComboDestino destinos={destinos} value={origenId} onChange={setOrigenId} placeholder="Ciudad de origen…" />
          </div>
          <div>
            <label className={lbl}>Destino</label>
            <ComboDestino destinos={destinos} value={destinoId} onChange={setDestinoId} placeholder="Ciudad de destino…" />
          </div>
          <div>
            <label className={lbl}>Ruta (automática)</label>
            <Input value={rutaAuto} readOnly disabled placeholder="Se arma con Origen y Destino" className="bg-gray-50 text-gray-600" />
          </div>
        </div>
      </section>

      <section className={card}>
        <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Vuelo de ida</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><label className={lbl}># Vuelo</label><Input value={f.vueloIda} onChange={set("vueloIda")} placeholder="5410" /></div>
          <div><label className={lbl}>Fecha ida *</label><Input type="date" value={f.fechaIda} onChange={set("fechaIda")} /></div>
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
      </section>

      <section className={card}>
        <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Tarifa y vigencia</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div><label className={lbl}>Tarifa proveedor/sistema (neto)</label><Input type="number" min={0} value={f.tarifaProveedor} onChange={set("tarifaProveedor")} placeholder="200000" /></div>
          <div><label className={lbl}>Tarifa para empaquetar (reventa)</label><Input type="number" min={0} value={f.tarifaParaEmpaquetar} onChange={set("tarifaParaEmpaquetar")} placeholder="242022" /></div>
          <div><label className={lbl}>Fee infante</label><Input type="number" min={0} value={f.feeInfante} onChange={set("feeInfante")} /></div>
          <div><label className={lbl}>Vigencia de compra: desde</label><Input type="date" value={f.compraInicio} onChange={set("compraInicio")} /></div>
          <div><label className={lbl}>Vigencia de compra: hasta</label><Input type="date" value={f.compraFin} onChange={set("compraFin")} /></div>
        </div>
      </section>

      <section className={card}>
        <p className="text-sm font-semibold" style={{ color: "var(--brand-primary)" }}>Estado</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          <div><label className={lbl}>Notas</label><Input value={f.notas} onChange={set("notas")} /></div>
        </div>
      </section>

      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
          {pending ? "Creando…" : "Crear empaquetado"}
        </Button>
        <span className="text-xs text-gray-400">No genera sillas ni cupos — es una tarifa de Sistema.</span>
      </div>
    </form>
  );
}
