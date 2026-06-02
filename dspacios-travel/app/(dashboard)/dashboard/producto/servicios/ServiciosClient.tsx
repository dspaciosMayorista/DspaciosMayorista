"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { crearServicio, eliminarServicio, type Liquidacion } from "./actions";

type Opt = { id: number; nombre: string };
type Servicio = {
  id: number; nombre: string; tarifa_neta: number; temporada: string | null;
  liquidacion: string; proveedores: { nombre: string } | null; destinos: { nombre: string } | null;
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const LIQ: Record<string, string> = { dia: "Por día", noche: "Por noche", paquete: "Por paquete" };

export function ServiciosClient({ servicios, proveedores, destinos }: { servicios: Servicio[]; proveedores: Opt[]; destinos: Opt[] }) {
  const [nombre, setNombre] = useState("");
  const [provId, setProvId] = useState<number | "">("");
  const [destId, setDestId] = useState<number | "">("");
  const [tarifa, setTarifa] = useState("");
  const [temp, setTemp] = useState("");
  const [liq, setLiq] = useState<Liquidacion>("paquete");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function add() {
    if (!nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    setErr("");
    start(async () => {
      const r = await crearServicio({
        nombre, proveedorId: provId === "" ? null : Number(provId), destinoId: destId === "" ? null : Number(destId),
        tarifaNeta: Number(tarifa) || 0, temporada: temp, liquidacion: liq,
      });
      if (r.ok) { setNombre(""); setProvId(""); setDestId(""); setTarifa(""); setTemp(""); setLiq("paquete"); }
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">Nuevo servicio adicional</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div><label className={lbl}>Nombre *</label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tour Playa Blanca, traslado…" /></div>
          <div>
            <label className={lbl}>Proveedor</label>
            <select value={provId} onChange={(e) => setProvId(Number(e.target.value) || "")} className={sel}>
              <option value="">—</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Destino</label>
            <select value={destId} onChange={(e) => setDestId(Number(e.target.value) || "")} className={sel}>
              <option value="">—</option>
              {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Tarifa neta</label><Input type="number" min={0} value={tarifa} onChange={(e) => setTarifa(e.target.value)} placeholder="0" /></div>
          <div><label className={lbl}>Temporada (opcional)</label><Input value={temp} onChange={(e) => setTemp(e.target.value)} /></div>
          <div>
            <label className={lbl}>Liquidación</label>
            <select value={liq} onChange={(e) => setLiq(e.target.value as Liquidacion)} className={sel}>
              <option value="paquete">Un solo cobro por paquete</option>
              <option value="dia">Por día</option>
              <option value="noche">Por noche</option>
            </select>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={add} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Agregar servicio"}</Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {servicios.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Servicio</th><th className="px-4 py-2">Proveedor</th><th className="px-4 py-2">Destino</th>
              <th className="px-4 py-2 text-right">Tarifa neta</th><th className="px-4 py-2">Liquidación</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>{servicios.map((s) => <Row key={s.id} s={s} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ s }: { s: Servicio }) {
  const [pending, start] = useTransition();
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2 text-gray-700">{s.nombre}</td>
      <td className="px-4 py-2 text-gray-500">{s.proveedores?.nombre ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{s.destinos?.nombre ?? "—"}</td>
      <td className="px-4 py-2 text-right tabular-nums">{formatCOP(s.tarifa_neta)}</td>
      <td className="px-4 py-2 text-gray-500">{LIQ[s.liquidacion] ?? s.liquidacion}</td>
      <td className="px-4 py-2 text-right">
        <button type="button" disabled={pending}
          onClick={() => { if (confirm(`¿Eliminar ${s.nombre}?`)) start(() => { void eliminarServicio(s.id); }); }}
          className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
      </td>
    </tr>
  );
}
