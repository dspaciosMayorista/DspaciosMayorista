"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { crearServicio, actualizarServicio, eliminarServicio, type ServicioInput } from "./actions";
import { RangosEdadPicker, type RangoEdad } from "@/components/RangosEdadPicker";

type Opt = { id: number; nombre: string };
type Servicio = {
  id: number; nombre: string; temporada: string | null;
  precio_persona: number | null; precio_grupo: number | null;
  proveedor_id: number | null; destino_id: number | null; rangos_edad: number[] | null;
  proveedores: { nombre: string } | null; destinos: { nombre: string } | null;
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function ServiciosClient({ servicios, proveedores, destinos, rangos }: { servicios: Servicio[]; proveedores: Opt[]; destinos: Opt[]; rangos: RangoEdad[] }) {
  const [nombre, setNombre] = useState("");
  const [provId, setProvId] = useState<number | "">("");
  const [destId, setDestId] = useState<number | "">("");
  const [rangosSel, setRangosSel] = useState<number[]>([]);
  const [temp, setTemp] = useState("");
  const [pPersona, setPPersona] = useState("");
  const [pGrupo, setPGrupo] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function resetForm() {
    setNombre(""); setProvId(""); setDestId(""); setTemp(""); setPPersona(""); setPGrupo(""); setRangosSel([]); setEditId(null);
  }

  function startEdit(s: Servicio) {
    setErr("");
    setEditId(s.id);
    setNombre(s.nombre);
    setProvId(s.proveedor_id ?? "");
    setDestId(s.destino_id ?? "");
    setTemp(s.temporada ?? "");
    setPPersona(s.precio_persona != null ? String(s.precio_persona) : "");
    setPGrupo(s.precio_grupo != null ? String(s.precio_grupo) : "");
    setRangosSel(s.rangos_edad ?? []);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function add() {
    if (!nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    const persona = pPersona.trim() === "" ? null : Number(pPersona) || 0;
    const grupo = pGrupo.trim() === "" ? null : Number(pGrupo) || 0;
    if (persona == null && grupo == null) { setErr("Pon al menos un precio (por persona o por grupo)."); return; }
    setErr("");
    const input: ServicioInput = {
      nombre, proveedorId: provId === "" ? null : Number(provId), destinoId: destId === "" ? null : Number(destId),
      precioPersona: persona, precioGrupo: grupo, temporada: temp, rangosEdad: rangosSel,
    };
    start(async () => {
      const r = editId ? await actualizarServicio(editId, input) : await crearServicio(input);
      if (r.ok) resetForm();
      else setErr(r.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">{editId ? "Editar servicio" : "Nuevo servicio adicional"}</p>
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
              <option value="">Todos los destinos (nacional)</option>
              {destinos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Precio por persona</label><Input type="number" min={0} value={pPersona} onChange={(e) => setPPersona(e.target.value)} placeholder="—" /></div>
          <div><label className={lbl}>Precio por grupo</label><Input type="number" min={0} value={pGrupo} onChange={(e) => setPGrupo(e.target.value)} placeholder="—" /></div>
          <div><label className={lbl}>Temporada (opcional)</label><Input value={temp} onChange={(e) => setTemp(e.target.value)} /></div>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          Puedes llenar uno o ambos. En el paquete eliges si este servicio se cobra por persona o por grupo.
        </p>
        <div className="mt-3">
          <RangosEdadPicker rangos={rangos} seleccionados={rangosSel} onChange={setRangosSel} />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={add} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "…" : editId ? "Guardar cambios" : "Agregar servicio"}
          </Button>
          {editId && <Button variant="outline" onClick={resetForm} disabled={pending}>Cancelar</Button>}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {servicios.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-4 py-2">Servicio</th><th className="px-4 py-2">Proveedor</th><th className="px-4 py-2">Destino</th>
              <th className="px-4 py-2 text-right">Por persona</th><th className="px-4 py-2 text-right">Por grupo</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>{servicios.map((s) => <Row key={s.id} s={s} onEdit={startEdit} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ s, onEdit }: { s: Servicio; onEdit: (s: Servicio) => void }) {
  const [pending, start] = useTransition();
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2 text-gray-700">{s.nombre}</td>
      <td className="px-4 py-2 text-gray-500">{s.proveedores?.nombre ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{s.destinos?.nombre ?? "Nacional"}</td>
      <td className="px-4 py-2 text-right tabular-nums">{s.precio_persona != null ? formatCOP(s.precio_persona) : "—"}</td>
      <td className="px-4 py-2 text-right tabular-nums">{s.precio_grupo != null ? formatCOP(s.precio_grupo) : "—"}</td>
      <td className="px-4 py-2 text-right">
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => onEdit(s)} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>
          <button type="button" disabled={pending}
            onClick={() => { if (confirm(`¿Eliminar ${s.nombre}?`)) start(() => { void eliminarServicio(s.id); }); }}
            className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
        </div>
      </td>
    </tr>
  );
}
