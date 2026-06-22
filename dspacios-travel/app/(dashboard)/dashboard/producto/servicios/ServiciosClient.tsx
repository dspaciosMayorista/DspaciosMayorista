"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import {
  crearServicio, actualizarServicio, eliminarServicio,
  crearTemporadaServicio, actualizarTemporadaServicio, eliminarTemporadaServicio,
  type ServicioInput, type TierPax, type TemporadaServicioInput,
} from "./actions";
import { RangosEdadPicker, type RangoEdad } from "@/components/RangosEdadPicker";
import { Paginador } from "@/components/Paginador";
import { ComboDestino, type DestinoOpt } from "@/components/ComboDestino";

type Opt = { id: number; nombre: string };
type Tier = { pax_desde: number; pax_hasta: number; precio: number };
export type TemporadaServicio = {
  id: number; servicio_id: number; nombre: string;
  fecha_inicio: string | null; fecha_fin: string | null;
  compra_inicio: string | null; compra_fin: string | null;
  prioridad: number; precio_persona: number | null;
};
type Servicio = {
  id: number; nombre: string; temporada: string | null; precio_persona: number | null;
  proveedor_id: number | null; destino_id: number | null; rangos_edad: number[] | null;
  categoria?: string | null;
  liquidacion?: string | null;
  descripcion?: string | null;
  recargo_individual?: number | null;
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

export function ServiciosClient({ servicios, proveedores, destinos, rangos, temporadas }: { servicios: Servicio[]; proveedores: Opt[]; destinos: DestinoOpt[]; rangos: RangoEdad[]; temporadas: Record<number, TemporadaServicio[]> }) {
  const [nombre, setNombre] = useState("");
  const [provId, setProvId] = useState<number | "">("");
  const [destId, setDestId] = useState<number | "">("");
  const [rangosSel, setRangosSel] = useState<number[]>([]);
  const [temp, setTemp] = useState("");
  const [pPersona, setPPersona] = useState("");
  const [categoria, setCategoria] = useState("otro");
  const [liquidacion, setLiquidacion] = useState<"dia" | "noche" | "paquete">("paquete");
  const [descripcion, setDescripcion] = useState("");
  const [recargoOn, setRecargoOn] = useState(false);
  const [recargoVal, setRecargoVal] = useState("");
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
    setNombre(""); setProvId(""); setDestId(""); setTemp(""); setPPersona(""); setCategoria("otro"); setLiquidacion("paquete"); setDescripcion(""); setRecargoOn(false); setRecargoVal(""); setGrupo([tierVacio()]); setRangosSel([]); setEditId(null);
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
    setDescripcion(s.descripcion ?? "");
    setRecargoOn((Number(s.recargo_individual) || 0) > 0);
    setRecargoVal((Number(s.recargo_individual) || 0) > 0 ? String(s.recargo_individual) : "");
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
      descripcion, recargoIndividual: recargoOn ? Number(recargoVal) || 0 : 0,
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
            <ComboDestino destinos={destinos} value={destId} onChange={setDestId} placeholder="Todos los destinos (nacional)…" />
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

        {/* Descripción del tour */}
        <div className="mt-4">
          <label className={lbl}>Descripción del tour (se muestra al cliente)</label>
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={3}
            placeholder="Qué incluye el tour, recorrido, horarios, punto de encuentro…"
            className="w-full rounded-lg border border-gray-300 p-2 text-sm"
          />
        </div>

        {/* Recargo individual (1 pax) */}
        <div className="mt-4 rounded-lg border border-gray-100 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={recargoOn} onChange={(e) => setRecargoOn(e.target.checked)} className="h-4 w-4" />
            Recargo individual (cuando va 1 pax)
          </label>
          {recargoOn && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="w-48">
                <label className={lbl}>Costo adicional (neto)</label>
                <Input type="number" min={0} value={recargoVal} onChange={(e) => setRecargoVal(e.target.value)} placeholder="—" />
              </div>
              <p className="pb-2 text-[11px] text-gray-400">
                Tarifa de individual: <b>costo neto</b> que cobra el proveedor cuando va 1 solo pax (cobro
                <b> por persona</b>). Entra al costo/CxP y el precio sube con su markup.
              </p>
            </div>
          )}
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

        {/* Temporadas (tarifa por fecha) — necesitan el servicio ya guardado (FK),
            así que el editor solo aparece al EDITAR. En creación, una guía. */}
        {editId ? (
          <TemporadasServicio servicioId={editId} lista={temporadas[editId] ?? []} />
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
            <p className="text-sm font-semibold text-gray-700">Temporadas (tarifa por fecha del viaje)</p>
            <p className="mt-1 text-xs text-gray-500">
              Guarda primero el servicio con <b>«Agregar servicio»</b>; luego ábrelo con <b>Editar</b> (en
              la lista de abajo) y aquí podrás cargar tarifas por temporada con sus fechas y vigencia de
              compra. El campo <b>«Temporada (opcional)»</b> de arriba es solo una etiqueta de la tarifa base.
            </p>
          </div>
        )}
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

// ── Editor de temporadas (tarifa por fecha + vigencia de compra) ────────────
const vacia = (): TemporadaServicioInput => ({
  nombre: "", fechaInicio: "", fechaFin: "", compraInicio: "", compraFin: "", prioridad: 1, precioPersona: null,
});

function aInput(t: TemporadaServicio): TemporadaServicioInput {
  return {
    nombre: t.nombre, fechaInicio: t.fecha_inicio ?? "", fechaFin: t.fecha_fin ?? "",
    compraInicio: t.compra_inicio ?? "", compraFin: t.compra_fin ?? "",
    prioridad: t.prioridad ?? 1, precioPersona: t.precio_persona,
  };
}

function TemporadasServicio({ servicioId, lista }: { servicioId: number; lista: TemporadaServicio[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nueva, setNueva] = useState<TemporadaServicioInput>(vacia());
  const [err, setErr] = useState("");

  function refrescar() { router.refresh(); }

  function agregar() {
    if (!nueva.nombre.trim()) { setErr("Pon un nombre (ej. ALTA, TEMPORADA NAVIDAD)."); return; }
    setErr("");
    start(async () => {
      const r = await crearTemporadaServicio(servicioId, nueva);
      if (r.ok) { setNueva(vacia()); refrescar(); } else setErr(r.error);
    });
  }

  return (
    <div className="mt-5 rounded-lg border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 p-3">
      <p className="mb-1 text-sm font-semibold text-gray-700">Temporadas (tarifa por fecha del viaje)</p>
      <p className="mb-3 text-[11px] text-gray-500">
        La tarifa de arriba es la <b>GENERAL</b> (aplica siempre). Aquí defines tarifas que ganan cuando la
        <b> fecha del viaje</b> cae en su rango y están en <b>vigencia de compra</b>. Gana la de mayor prioridad.
      </p>

      <div className="space-y-2">
        {lista.map((t) => (
          <TemporadaFila key={t.id} t={t} onChanged={refrescar} setErr={setErr} />
        ))}
      </div>

      {/* Agregar */}
      <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-white p-3">
        <p className="mb-2 text-xs font-medium text-gray-600">+ Agregar temporada</p>
        <CamposTemporada value={nueva} onChange={setNueva} />
        <div className="mt-2 flex items-center gap-2">
          <Button type="button" variant="outline" onClick={agregar} disabled={pending}>Agregar temporada</Button>
          {err && <span className="text-xs text-red-600">{err}</span>}
        </div>
      </div>
    </div>
  );
}

function TemporadaFila({ t, onChanged, setErr }: { t: TemporadaServicio; onChanged: () => void; setErr: (s: string) => void }) {
  const [pending, start] = useTransition();
  const [v, setV] = useState<TemporadaServicioInput>(aInput(t));
  const [editando, setEditando] = useState(false);

  function guardar() {
    start(async () => {
      const r = await actualizarTemporadaServicio(t.id, v);
      if (r.ok) { setEditando(false); onChanged(); } else setErr(r.error);
    });
  }
  function borrar() {
    if (!confirm(`¿Eliminar la temporada "${t.nombre}"?`)) return;
    start(async () => { const r = await eliminarTemporadaServicio(t.id); if (r.ok) onChanged(); else setErr(r.error); });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      {!editando ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium text-gray-700">{t.nombre}</span>
          <span className="text-xs text-gray-500">
            {t.fecha_inicio || "—"} → {t.fecha_fin || "—"} · compra {t.compra_inicio || "—"}→{t.compra_fin || "—"} · prio {t.prioridad}
          </span>
          <span className="tabular-nums text-gray-700">{t.precio_persona != null ? formatCOP(Number(t.precio_persona)) : "—"}/persona</span>
          <span className="flex gap-3">
            <button type="button" onClick={() => setEditando(true)} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>
            <button type="button" disabled={pending} onClick={borrar} className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
          </span>
        </div>
      ) : (
        <>
          <CamposTemporada value={v} onChange={setV} />
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>Guardar</Button>
            <button type="button" onClick={() => { setEditando(false); setV(aInput(t)); }} className="text-sm text-gray-500 hover:text-gray-800">Cancelar</button>
          </div>
        </>
      )}
    </div>
  );
}

function CamposTemporada({ value, onChange }: { value: TemporadaServicioInput; onChange: (v: TemporadaServicioInput) => void }) {
  const set = (k: keyof TemporadaServicioInput, val: string | number | null) => onChange({ ...value, [k]: val });
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <div className="col-span-2 md:col-span-1"><label className={lbl}>Nombre</label><Input value={value.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="ALTA, NAVIDAD…" /></div>
      <div><label className={lbl}>Viaje desde</label><Input type="date" value={value.fechaInicio} onChange={(e) => set("fechaInicio", e.target.value)} /></div>
      <div><label className={lbl}>Viaje hasta</label><Input type="date" value={value.fechaFin} onChange={(e) => set("fechaFin", e.target.value)} /></div>
      <div><label className={lbl}>Precio por persona</label><Input type="number" min={0} value={value.precioPersona ?? ""} onChange={(e) => set("precioPersona", e.target.value === "" ? null : Number(e.target.value))} /></div>
      <div><label className={lbl}>Compra desde</label><Input type="date" value={value.compraInicio} onChange={(e) => set("compraInicio", e.target.value)} /></div>
      <div><label className={lbl}>Compra hasta</label><Input type="date" value={value.compraFin} onChange={(e) => set("compraFin", e.target.value)} /></div>
      <div><label className={lbl}>Prioridad</label><Input type="number" min={1} value={value.prioridad} onChange={(e) => set("prioridad", Number(e.target.value) || 1)} /></div>
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
      <td className="px-4 py-2 text-right tabular-nums">
        {s.precio_persona != null ? formatCOP(s.precio_persona) : "—"}
        {(Number(s.recargo_individual) || 0) > 0 && (
          <div className="text-[11px] font-normal text-amber-600">+{formatCOP(Number(s.recargo_individual))} si 1 pax</div>
        )}
      </td>
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
