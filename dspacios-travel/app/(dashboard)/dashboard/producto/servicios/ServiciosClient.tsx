"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { crearServicio, actualizarServicio, eliminarServicio, type Liquidacion, type TierPax } from "./actions";
import { RangosEdadPicker, type RangoEdad } from "@/components/RangosEdadPicker";

type Opt = { id: number; nombre: string };
type Tier = { pax_desde: number; pax_hasta: number; precio: number };
type Servicio = {
  id: number; nombre: string; tarifa_neta: number; temporada: string | null;
  liquidacion: string; proveedor_id: number | null; destino_id: number | null;
  rangos_edad: number[] | null; tipo_tarifa: string;
  proveedores: { nombre: string } | null; destinos: { nombre: string } | null;
  servicio_tarifa_pax: Tier[];
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

type TierForm = { paxDesde: string; paxHasta: string; precio: string };
const tierVacio = (): TierForm => ({ paxDesde: "1", paxHasta: "1", precio: "" });

export function ServiciosClient({ servicios, proveedores, destinos, rangos }: { servicios: Servicio[]; proveedores: Opt[]; destinos: Opt[]; rangos: RangoEdad[] }) {
  const [nombre, setNombre] = useState("");
  const [provId, setProvId] = useState<number | "">("");
  const [destId, setDestId] = useState<number | "">("");
  const [rangosSel, setRangosSel] = useState<number[]>([]);
  const [temp, setTemp] = useState("");
  const [tipoTarifa, setTipoTarifa] = useState<"persona" | "grupo">("persona");
  const [tiers, setTiers] = useState<TierForm[]>([tierVacio()]);
  const [editId, setEditId] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function resetForm() {
    setNombre(""); setProvId(""); setDestId(""); setTemp(""); setTipoTarifa("persona");
    setTiers([tierVacio()]); setRangosSel([]); setEditId(null);
  }

  function startEdit(s: Servicio) {
    setErr("");
    setEditId(s.id);
    setNombre(s.nombre);
    setProvId(s.proveedor_id ?? "");
    setDestId(s.destino_id ?? "");
    setTemp(s.temporada ?? "");
    setTipoTarifa((s.tipo_tarifa as "persona" | "grupo") ?? "persona");
    const t = (s.servicio_tarifa_pax ?? []).map((x) => ({ paxDesde: String(x.pax_desde), paxHasta: String(x.pax_hasta), precio: String(x.precio) }));
    setTiers(t.length ? t : [tierVacio()]);
    setRangosSel(s.rangos_edad ?? []);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setTier(i: number, k: keyof TierForm, v: string) {
    setTiers((prev) => prev.map((t, idx) => (idx === i ? { ...t, [k]: v } : t)));
  }

  function add() {
    if (!nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    const tiersValidos: TierPax[] = tiers
      .filter((t) => Number(t.precio) > 0)
      .map((t) => ({ paxDesde: Number(t.paxDesde) || 1, paxHasta: Number(t.paxHasta) || Number(t.paxDesde) || 1, precio: Number(t.precio) || 0 }));
    if (!tiersValidos.length) { setErr("Agrega al menos una escala con precio."); return; }
    setErr("");
    const input = {
      nombre, proveedorId: provId === "" ? null : Number(provId), destinoId: destId === "" ? null : Number(destId),
      tarifaNeta: tiersValidos[0]?.precio ?? 0, temporada: temp, liquidacion: "paquete" as Liquidacion,
      rangosEdad: rangosSel, tipoTarifa, tiers: tiersValidos,
    };
    start(async () => {
      const r = editId ? await actualizarServicio(editId, input) : await crearServicio(input);
      if (r.ok) resetForm();
      else setErr(r.error);
    });
  }

  const precioLabel = tipoTarifa === "persona" ? "Precio por persona" : "Precio del grupo";

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
          <div>
            <label className={lbl}>Tipo de tarifa</label>
            <select value={tipoTarifa} onChange={(e) => setTipoTarifa(e.target.value as "persona" | "grupo")} className={sel}>
              <option value="persona">Por persona (× pax)</option>
              <option value="grupo">Por grupo (valor fijo del rango)</option>
            </select>
          </div>
          <div><label className={lbl}>Temporada (opcional)</label><Input value={temp} onChange={(e) => setTemp(e.target.value)} /></div>
        </div>

        {/* Escalas por pax */}
        <div className="mt-4 rounded-lg border border-gray-100 p-3">
          <p className="mb-2 text-xs font-medium text-gray-600">
            Escalas por pax — {tipoTarifa === "persona" ? "el precio es por persona (total = pax × precio)" : "el precio es fijo del grupo para ese rango"}
          </p>
          <div className="space-y-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="w-24"><label className={lbl}>Pax desde</label><Input type="number" min={1} value={t.paxDesde} onChange={(e) => setTier(i, "paxDesde", e.target.value)} /></div>
                <div className="w-24"><label className={lbl}>Pax hasta</label><Input type="number" min={1} value={t.paxHasta} onChange={(e) => setTier(i, "paxHasta", e.target.value)} /></div>
                <div className="w-36"><label className={lbl}>{precioLabel}</label><Input type="number" min={0} value={t.precio} onChange={(e) => setTier(i, "precio", e.target.value)} placeholder="0" /></div>
                {tiers.length > 1 && (
                  <button type="button" onClick={() => setTiers((p) => p.filter((_, idx) => idx !== i))} className="pb-2 text-xs text-gray-400 hover:text-red-500">Quitar</button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setTiers((p) => [...p, tierVacio()])} className="mt-2 text-xs font-medium text-[var(--brand-accent)]">+ Agregar escala</button>
        </div>

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
              <th className="px-4 py-2">Tipo</th><th className="px-4 py-2">Escalas</th><th className="px-4 py-2"></th>
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
  const tiers = s.servicio_tarifa_pax ?? [];
  const resumen = tiers.length
    ? tiers.map((t) => `${t.pax_desde}${t.pax_hasta !== t.pax_desde ? `–${t.pax_hasta}` : ""}: ${formatCOP(t.precio)}`).join(" · ")
    : formatCOP(s.tarifa_neta);
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2 text-gray-700">{s.nombre}</td>
      <td className="px-4 py-2 text-gray-500">{s.proveedores?.nombre ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{s.destinos?.nombre ?? "Nacional"}</td>
      <td className="px-4 py-2 text-gray-500">{s.tipo_tarifa === "grupo" ? "Grupo" : "Persona"}</td>
      <td className="px-4 py-2 text-xs text-gray-500">{resumen}</td>
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
