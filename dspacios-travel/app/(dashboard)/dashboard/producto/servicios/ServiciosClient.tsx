"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { crearServicio, actualizarServicio, eliminarServicio, type ServicioInput, type TierPax } from "./actions";
import { RangosEdadPicker, type RangoEdad } from "@/components/RangosEdadPicker";
import { Paginador } from "@/components/Paginador";

type Opt = { id: number; nombre: string };
type Tier = { pax_desde: number; pax_hasta: number; precio: number };
type Servicio = {
  id: number; nombre: string; temporada: string | null; precio_persona: number | null;
  proveedor_id: number | null; destino_id: number | null; rangos_edad: number[] | null;
  categoria?: string | null;
  liquidacion?: string | null;
  proveedores: { nombre: string } | null; destinos: { nombre: string } | null;
  servicio_tarifa_pax: Tier[];
};

const CATEGORIAS: { v: string; label: string }[] = [
  { v: "tour_traslado", label: "Tour / Traslado" },
  { v: "asistencia", label: "Asistencia médica" },
  { v: "otro", label: "Otro" },
];

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

type TierForm = { paxDesde: string; paxHasta: string; precio: string };
const tierVacio = (): TierForm => ({ paxDesde: "1", paxHasta: "4", precio: "" });

export function ServiciosClient({ servicios, proveedores, destinos, rangos }: { servicios: Servicio[]; proveedores: Opt[]; destinos: Opt[]; rangos: RangoEdad[] }) {
  const [nombre, setNombre] = useState("");
  const [provId, setProvId] = useState<number | "">("");
  const [destId, setDestId] = useState<number | "">("");
  const [rangosSel, setRangosSel] = useState<number[]>([]);
  const [temp, setTemp] = useState("");
  const [pPersona, setPPersona] = useState("");
  const [categoria, setCategoria] = useState("otro");
  const [liquidacion, setLiquidacion] = useState<"dia" | "noche" | "paquete">("paquete");
  const [grupo, setGrupo] = useState<TierForm[]>([tierVacio()]);
  const [editId, setEditId] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;

  const filtrados = query.trim()
    ? servicios.filter((s) => s.nombre.toLowerCase().includes(query.trim().toLowerCase()))
    : servicios;
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const paginaActual = Math.min(page, totalPaginas - 1);
  const visibles = filtrados.slice(paginaActual * PAGE_SIZE, paginaActual * PAGE_SIZE + PAGE_SIZE);

  function resetForm() {
    setNombre(""); setProvId(""); setDestId(""); setTemp(""); setPPersona(""); setCategoria("otro"); setLiquidacion("paquete"); setGrupo([tierVacio()]); setRangosSel([]); setEditId(null);
  }

  function startEdit(s: Servicio) {
    setErr("");
    setEditId(s.id);
    setNombre(s.nombre);
    setProvId(s.proveedor_id ?? "");
    setDestId(s.destino_id ?? "");
    setTemp(s.temporada ?? "");
    setPPersona(s.precio_persona != null ? String(s.precio_persona) : "");
    setCategoria(s.categoria ?? "otro");
    setLiquidacion((s.liquidacion as "dia" | "noche" | "paquete") ?? "paquete");
    const t = (s.servicio_tarifa_pax ?? []).map((x) => ({ paxDesde: String(x.pax_desde), paxHasta: String(x.pax_hasta), precio: String(x.precio) }));
    setGrupo(t.length ? t : [tierVacio()]);
    setRangosSel(s.rangos_edad ?? []);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setTier(i: number, k: keyof TierForm, v: string) {
    setGrupo((prev) => prev.map((t, idx) => (idx === i ? { ...t, [k]: v } : t)));
  }

  function add() {
    if (!nombre.trim()) { setErr("El nombre es obligatorio."); return; }
    const persona = pPersona.trim() === "" ? null : Number(pPersona) || 0;
    const grupoTiers: TierPax[] = grupo
      .filter((t) => Number(t.precio) > 0)
      .map((t) => ({ paxDesde: Number(t.paxDesde) || 1, paxHasta: Number(t.paxHasta) || Number(t.paxDesde) || 1, precio: Number(t.precio) || 0 }));
    if (persona == null && !grupoTiers.length) { setErr("Pon el precio por persona y/o al menos un rango por grupo."); return; }
    setErr("");
    const input: ServicioInput = {
      nombre, proveedorId: provId === "" ? null : Number(provId), destinoId: destId === "" ? null : Number(destId),
      precioPersona: persona, grupoTiers, temporada: temp, rangosEdad: rangosSel, categoria, liquidacion,
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
          <div><label className={lbl}>Temporada (opcional)</label><Input value={temp} onChange={(e) => setTemp(e.target.value)} /></div>
          <div>
            <label className={lbl}>Categoría (en el contrato)</label>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={sel}>
              {CATEGORIAS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Tipo de cobro</label>
            <select value={liquidacion} onChange={(e) => setLiquidacion(e.target.value as "dia" | "noche" | "paquete")} className={sel}>
              <option value="paquete">Un solo cobro</option>
              <option value="dia">Por día</option>
              <option value="noche">Por noche</option>
            </select>
          </div>
        </div>

        {/* Rangos por grupo */}
        <div className="mt-4 rounded-lg border border-gray-100 p-3">
          <p className="mb-2 text-xs font-medium text-gray-600">Precio por grupo (rangos de pax) — el valor es fijo del grupo para ese rango</p>
          <div className="space-y-2">
            {grupo.map((t, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="w-24"><label className={lbl}>Pax desde</label><Input type="number" min={1} value={t.paxDesde} onChange={(e) => setTier(i, "paxDesde", e.target.value)} /></div>
                <div className="w-24"><label className={lbl}>Pax hasta</label><Input type="number" min={1} value={t.paxHasta} onChange={(e) => setTier(i, "paxHasta", e.target.value)} /></div>
                <div className="w-40"><label className={lbl}>Precio del grupo</label><Input type="number" min={0} value={t.precio} onChange={(e) => setTier(i, "precio", e.target.value)} placeholder="—" /></div>
                {grupo.length > 1 && (
                  <button type="button" onClick={() => setGrupo((p) => p.filter((_, idx) => idx !== i))} className="pb-2 text-xs text-gray-400 hover:text-red-500">Quitar</button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setGrupo((p) => [...p, tierVacio()])} className="mt-2 text-xs font-medium text-[var(--brand-accent)]">+ Agregar rango</button>
        </div>

        <p className="mt-2 text-[11px] text-gray-400">
          Llena precio por persona y/o rangos por grupo. En el paquete eliges cuál se cobra para ese paquete.
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
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Buscar por nombre…" className="max-w-xs" />
            <span className="text-xs text-gray-400">
              {filtrados.length} {filtrados.length === 1 ? "servicio" : "servicios"}{query.trim() ? ` · filtrado de ${servicios.length}` : ""}
            </span>
          </div>

          {visibles.length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">Sin resultados para “{query}”.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                  <th className="px-4 py-2">Servicio</th><th className="px-4 py-2">Proveedor</th><th className="px-4 py-2">Destino</th>
                  <th className="px-4 py-2 text-right">Por persona</th><th className="px-4 py-2">Por grupo (rangos)</th><th className="px-4 py-2"></th>
                </tr></thead>
                <tbody>{visibles.map((s) => <Row key={s.id} s={s} onEdit={startEdit} />)}</tbody>
              </table>
            </div>
          )}

          <Paginador page={paginaActual} totalPaginas={totalPaginas} onPage={setPage} />
        </div>
      )}
    </div>
  );
}

function Row({ s, onEdit }: { s: Servicio; onEdit: (s: Servicio) => void }) {
  const [pending, start] = useTransition();
  const grupo = s.servicio_tarifa_pax ?? [];
  const resumenGrupo = grupo.length
    ? grupo.map((t) => `${t.pax_desde}–${t.pax_hasta}: ${formatCOP(t.precio)}`).join(" · ")
    : "—";
  return (
    <tr className="border-t border-gray-50">
      <td className="px-4 py-2 text-gray-700">{s.nombre}</td>
      <td className="px-4 py-2 text-gray-500">{s.proveedores?.nombre ?? "—"}</td>
      <td className="px-4 py-2 text-gray-500">{s.destinos?.nombre ?? "Nacional"}</td>
      <td className="px-4 py-2 text-right tabular-nums">{s.precio_persona != null ? formatCOP(s.precio_persona) : "—"}</td>
      <td className="px-4 py-2 text-xs text-gray-500">{resumenGrupo}</td>
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
