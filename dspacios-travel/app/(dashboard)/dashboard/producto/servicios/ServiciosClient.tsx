"use client";

import { DateInput } from "@/components/ui/DateInput";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP, formatMoneda } from "@/lib/utils";
import {
  crearServicio, actualizarServicio, eliminarServicio,
  crearTemporadaServicio, actualizarTemporadaServicio, eliminarTemporadaServicio, guardarFranjaServicio, eliminarFranjaServicio,
  type ServicioInput, type TierPax, type TemporadaServicioInput, type FranjaServicioInput,
} from "./actions";
import { describirFranja, type FranjaSuplemento } from "@/lib/calc/trasladoFranjas";
import { RangosEdadPicker, type RangoEdad } from "@/components/RangosEdadPicker";
import { Paginador } from "@/components/Paginador";
import { ComboDestino, type DestinoOpt } from "@/components/ComboDestino";
import { ComboProveedor, type ProveedorOpt } from "@/components/ComboProveedor";
import { ServicioFotoCell } from "./ServicioFotoCell";
import { Info, Clock, Trash2, AlertTriangle, Settings2, List } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoraInput24 } from "@/components/ui/HoraInput24";
import { serviciosSinVigencia } from "@/lib/tarifario/serviciosSinVigencia";

type Tier = { pax_desde: number; pax_hasta: number; precio: number; temporada?: string | null };
export type TemporadaServicio = {
  id: number; servicio_id: number; nombre: string;
  fecha_inicio: string | null; fecha_fin: string | null;
  compra_inicio: string | null; compra_fin: string | null;
  prioridad: number; precio_persona: number | null;
  precio_infante?: number | null;
  recargo_individual: number | null;
  grupos: Tier[];
  // Suplementos de traslado por franja horaria (migración 255). null = la migración aún no está aplicada.
  franjas?: FranjaGuardada[] | null;
};
type FranjaGuardada = FranjaSuplemento & { id: number };
type Servicio = {
  id: number; nombre: string; temporada: string | null; precio_persona: number | null;
  proveedor_id: number | null; destino_id: number | null; alcance?: string | null; rangos_edad: number[] | null;
  moneda?: string | null;
  categoria?: string | null;
  liquidacion?: string | null;
  descripcion?: string | null;
  recargo_individual?: number | null;
  precio_infante?: number | null;
  foto_url?: string | null;
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

export function ServiciosClient({ servicios, proveedores, destinos, rangos, temporadas }: { servicios: Servicio[]; proveedores: ProveedorOpt[]; destinos: DestinoOpt[]; rangos: RangoEdad[]; temporadas: Record<number, TemporadaServicio[]> }) {
  const [nombre, setNombre] = useState("");
  const [provId, setProvId] = useState<number | "">("");
  const [destId, setDestId] = useState<number | "">("");
  // Cobertura del servicio: un destino puntual, todos los nacionales, o todos los internacionales.
  const [cobertura, setCobertura] = useState<"destino" | "nacional" | "internacional">("nacional");
  const [rangosSel, setRangosSel] = useState<number[]>([]);
  const [moneda, setMoneda] = useState<"COP" | "USD">("COP");
  const [pPersona, setPPersona] = useState("");
  const [pInfante, setPInfante] = useState("");
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
  const [tab, setTab] = useState<"config" | "listado">("listado");
  const [destFiltro, setDestFiltro] = useState("");
  const [avisoAbierto, setAvisoAbierto] = useState(true);
  const PAGE_SIZE = 10;

  const sinInfante = servicios.filter((s) => s.precio_persona != null && s.precio_infante == null);
  const sinVigencia = serviciosSinVigencia(servicios, temporadas);
  const porDestino = (s: Servicio) => !destFiltro || (destFiltro === "nacional" ? s.destino_id == null && s.alcance !== "internacional" : destFiltro === "internacional" ? s.destino_id == null && s.alcance === "internacional" : String(s.destino_id) === destFiltro);
  const filtrados = (query.trim()
    ? servicios.filter((s) => s.nombre.toLowerCase().includes(query.trim().toLowerCase()))
    : servicios).filter(porDestino);
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const paginaActual = Math.min(page, totalPaginas - 1);
  const visibles = filtrados.slice(paginaActual * PAGE_SIZE, paginaActual * PAGE_SIZE + PAGE_SIZE);

  function resetForm() {
    setNombre(""); setProvId(""); setDestId(""); setCobertura("nacional"); setMoneda("COP"); setPPersona(""); setPInfante(""); setCategoria("otro"); setLiquidacion("paquete"); setDescripcion(""); setRecargoOn(false); setRecargoVal(""); setGrupo([tierVacio()]); setRangosSel([]); setEditId(null);
  }

  function startEdit(s: Servicio) {
    setTab("config");
    setErr("");
    setEditId(s.id);
    setNombre(s.nombre);
    setProvId(s.proveedor_id ?? "");
    setDestId(s.destino_id ?? "");
    setCobertura(s.destino_id != null ? "destino" : (s.alcance === "internacional" ? "internacional" : "nacional"));
    setMoneda(s.moneda === "USD" ? "USD" : "COP");
    setPPersona(s.precio_persona != null ? String(s.precio_persona) : "");
    setPInfante(s.precio_infante != null ? String(s.precio_infante) : "");
    setCategoria(s.categoria ?? "otro");
    setLiquidacion((s.liquidacion as "dia" | "noche" | "paquete") ?? "paquete");
    setDescripcion(s.descripcion ?? "");
    setRecargoOn((Number(s.recargo_individual) || 0) > 0);
    setRecargoVal((Number(s.recargo_individual) || 0) > 0 ? String(s.recargo_individual) : "");
    // Solo los rangos de la tarifa base (GENERAL); los de temporada se editan
    // dentro de cada temporada.
    const t = (s.servicio_tarifa_pax ?? [])
      .filter((x) => (x.temporada ?? "GENERAL") === "GENERAL")
      .map((x) => ({ paxDesde: String(x.pax_desde), paxHasta: String(x.pax_hasta), precio: String(x.precio) }));
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
    // Cobertura → destinoId/alcance: "destino" usa el combo; los catch-all van sin destino.
    const destinoId = cobertura === "destino" ? (destId === "" ? null : Number(destId)) : null;
    const alcance: "nacional" | "internacional" = cobertura === "internacional" ? "internacional" : "nacional";
    if (cobertura === "destino" && destinoId == null) { setErr("Elige un destino o cambia la cobertura."); return; }
    const input: ServicioInput = {
      nombre, proveedorId: provId === "" ? null : Number(provId), destinoId, alcance, moneda,
      precioPersona: persona, precioInfante: pInfante.trim() === "" ? null : Math.max(Number(pInfante) || 0, 0),
      grupoTiers, temporada: "", rangosEdad: rangosSel, categoria, liquidacion,
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
      <div role="tablist" aria-label="Secciones de servicios" className="flex gap-1 border-b border-gray-200">
        {([["listado", "Listado", List], ["config", editId ? "Configuración (editando)" : "Configuración", Settings2]] as const).map(([k, etiqueta, Icono]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? "border-[var(--brand-primary)] text-[var(--brand-primary)]" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            <Icono size={15} aria-hidden /> {etiqueta}
          </button>
        ))}
      </div>
      {tab === "config" && (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-gray-700">{editId ? "Editar servicio" : "Nuevo servicio adicional"}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div><label className={lbl}>Nombre *</label><Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tour Playa Blanca, traslado…" /></div>
          <div>
            <label className={lbl}>Proveedor</label>
            <ComboProveedor proveedores={proveedores} value={provId} onChange={setProvId} placeholder="Escribe el proveedor…" />
          </div>
          <div>
            <label className={lbl}>Destino / cobertura</label>
            <select value={cobertura} onChange={(e) => setCobertura(e.target.value as "destino" | "nacional" | "internacional")} className={`${sel} mb-2`}>
              <option value="nacional">Todos los destinos nacionales</option>
              <option value="internacional">Todos los destinos internacionales</option>
              <option value="destino">Un destino específico…</option>
            </select>
            {cobertura === "destino" && (
              <ComboDestino destinos={destinos} value={destId} onChange={setDestId} placeholder="Escribe el destino o su IATA…" />
            )}
          </div>
          <div>
            <label className={lbl}>Moneda</label>
            <select value={moneda} onChange={(e) => setMoneda(e.target.value as "COP" | "USD")} className={sel}>
              <option value="COP">COP (pesos)</option>
              <option value="USD">USD (dólares)</option>
            </select>
          </div>
          <div><label className={lbl}>Precio por persona <span className="font-normal text-gray-400">(tarifa base · {moneda})</span></label><Input type="number" min={0} value={pPersona} onChange={(e) => setPPersona(e.target.value)} placeholder="—" /></div>
          <div>
            <label className={lbl}>Precio de infante <span className="font-normal text-gray-400">(0 a 1,99 años · neto · {moneda})</span></label>
            <Input type="number" min={0} value={pInfante} onChange={(e) => setPInfante(e.target.value)} placeholder="vacío = paga como adulto" />
            <p className="mt-1 text-[11px] text-gray-400">
              <b>0</b> = el infante no paga este servicio; <b>vacío</b> = sin configurar, paga como adulto.
              Solo cobro por persona: en cobro por grupo el infante no cuenta para el rango ni paga extra.
            </p>
          </div>
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
          <p className="mb-2 text-xs font-medium text-gray-600">Precio por grupo (rangos de pax) <span className="text-gray-400">— tarifa base; el valor es fijo del grupo para ese rango</span></p>
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
              compra. La tarifa base de arriba es solo un dato histórico: no se vende.
            </p>
          </div>
        )}
      </div>
      )}

      {tab === "config" && sinInfante.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            <b>{sinInfante.length} {sinInfante.length === 1 ? "servicio por persona no tiene" : "servicios por persona no tienen"} precio de infante</b>{" "}
            (0 a 1,99 años): hasta que lo configures, el infante paga como adulto en {sinInfante.length === 1 ? "él" : "ellos"}.
            Pon <b>0</b> si el infante no paga el servicio.
          </p>
        </div>
      )}

      {tab === "listado" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Buscar por nombre…" aria-label="Buscar servicio por nombre" className="w-full sm:w-auto sm:max-w-xs sm:flex-1" />
            <select value={destFiltro} onChange={(e) => { setDestFiltro(e.target.value); setPage(0); }} aria-label="Filtrar por destino" className="h-9 w-full min-w-0 rounded-lg sm:w-auto border border-gray-300 bg-white px-2 text-sm">
              <option value="">Todos los destinos</option>
              <option value="nacional">Todos los nacionales</option>
              <option value="internacional">Todos los internacionales</option>
              {destinos.map((d) => <option key={d.id} value={String(d.id)}>{d.nombre}</option>)}
            </select>
            <span className="text-xs text-gray-400">
              {filtrados.length} {filtrados.length === 1 ? "servicio" : "servicios"}{query.trim() || destFiltro ? ` · filtrado de ${servicios.length}` : ""}
            </span>
            {sinVigencia.length > 0 && (
              <button type="button" onClick={() => setAvisoAbierto(true)} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline">
                <AlertTriangle size={14} aria-hidden /> {sinVigencia.length} sin vigencia
              </button>
            )}
          </div>

          {visibles.length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
              {servicios.length === 0 ? "Aún no hay servicios. Créalos en la pestaña Configuración." : "Sin resultados para ese filtro."}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
              {visibles.map((s) => <FilaServicio key={s.id} s={s} vigencias={temporadas[s.id] ?? []} sinVigencia={sinVigencia.some((x) => x.id === s.id)} onEdit={startEdit} />)}
            </ul>
          )}

          <Paginador page={paginaActual} totalPaginas={totalPaginas} onPage={setPage} />
        </div>
      )}

      <Dialog open={avisoAbierto && sinVigencia.length > 0} onOpenChange={setAvisoAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Servicios sin rango de fechas</DialogTitle>
            <DialogDescription>
              Estos {sinVigencia.length} servicios no tienen ninguna vigencia con fechas válidas, así que <b>no aparecen en la oferta pública</b>. Ábrelos y carga una vigencia con su rango de fechas.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
            {sinVigencia.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-2 py-1.5">
                <span className="min-w-0 truncate text-gray-700">{s.nombre}</span>
                <button type="button" onClick={() => { setAvisoAbierto(false); startEdit(s); }} className="shrink-0 text-xs font-medium text-[var(--brand-accent)] hover:underline">Corregir</button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Editor de temporadas (tarifa por fecha + vigencia de compra) ────────────
// Una temporada es una tarifa COMPLETA: precio por persona + recargo individual
// + rangos por grupo, para su rango de fechas del viaje.
const vacia = (): TemporadaServicioInput => ({
  nombre: "", fechaInicio: "", fechaFin: "", compraInicio: "", compraFin: "", prioridad: 1,
  precioPersona: null, precioInfante: null, recargoIndividual: null, grupoTiers: [],
});

function aInput(t: TemporadaServicio): TemporadaServicioInput {
  return {
    nombre: t.nombre, fechaInicio: t.fecha_inicio ?? "", fechaFin: t.fecha_fin ?? "",
    compraInicio: t.compra_inicio ?? "", compraFin: t.compra_fin ?? "",
    prioridad: t.prioridad ?? 1, precioPersona: t.precio_persona,
    precioInfante: t.precio_infante ?? null,
    recargoIndividual: t.recargo_individual,
    grupoTiers: (t.grupos ?? []).map((g) => ({ paxDesde: g.pax_desde, paxHasta: g.pax_hasta, precio: g.precio })),
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
        Un servicio <b>solo se vende con una vigencia</b> que cubra la <b>fecha del viaje</b> y esté en <b>vigencia de compra</b>
        (gana la de mayor prioridad); en cobro por grupo, además con un <b>rango de pasajeros de esa vigencia</b>. La tarifa
        <b> GENERAL</b> de arriba ya no se usa para vender ni para calcular el costo: se conserva solo como dato histórico.
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
          <span className="tabular-nums text-gray-700">
            {t.precio_persona != null ? `${formatCOP(Number(t.precio_persona))}/persona` : "—"}
            {t.precio_infante != null ? ` · infante ${formatCOP(Number(t.precio_infante))}` : ""}
            {t.recargo_individual != null ? ` · indiv ${formatCOP(Number(t.recargo_individual))}` : ""}
            {(t.grupos ?? []).length ? ` · ${t.grupos.length} rango(s) grupo` : ""}
          </span>
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
      <FranjasTraslado temporadaId={t.id} franjas={t.franjas ?? null} moneda={undefined} onChanged={onChanged} setErr={setErr} />
    </div>
  );
}

// ── Suplementos de traslado por franja horaria (migración 255) ───────────────
// Se suman al COSTO NETO de la vigencia y luego pasa el margen. La franja es [desde, hasta): el inicio se incluye y el fin no; si desde > hasta cruza la
// medianoche (19:00 a 06:00). Cada regla se muestra con su descripción legible (la misma función que valida y evalúa).
const franjaVacia = (): FranjaServicioInput => ({ hora_desde: "19:00", hora_hasta: "06:00", tramo: "ambos", tipo: "monto", valor: 0, cobro: "grupo" });

function FranjasTraslado({ temporadaId, franjas, moneda, onChanged, setErr }: {
  temporadaId: number; franjas: FranjaGuardada[] | null; moneda?: string; onChanged: () => void; setErr: (s: string) => void;
}) {
  const [pending, start] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState<FranjaServicioInput>(franjaVacia());
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const lista = franjas ?? [];

  if (franjas === null) {
    return <p className="mt-2 text-[11px] text-amber-700">Suplementos por horario no disponibles: falta aplicar la migración 255 en la base de datos.</p>;
  }

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await guardarFranjaServicio(temporadaId, f, editId ?? undefined);
      if (r.ok) { setF(franjaVacia()); setEditId(null); onChanged(); } else { setMsg(r.error); setErr(""); }
    });
  }
  function borrar(id: number) {
    if (!confirm("¿Eliminar esta franja horaria?")) return;
    start(async () => { const r = await eliminarFranjaServicio(id); if (r.ok) onChanged(); else setMsg(r.error); });
  }
  const set = <K extends keyof FranjaServicioInput>(k: K, v: FranjaServicioInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const previa = f.valor > 0 ? describirFranja(f as FranjaSuplemento, moneda) : "";
  const selCls = "h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm";

  return (
    <div className="mt-3 border-t border-gray-100 pt-2">
      <button type="button" onClick={() => setAbierto((a) => !a)} className="flex items-center gap-1 text-xs font-medium text-[var(--brand-primary)] hover:underline">
        <Clock className="h-3.5 w-3.5" aria-hidden /> Suplementos por horario (traslados){lista.length ? ` · ${lista.length}` : ""}
      </button>
      {abierto && (
        <div className="mt-2 space-y-2">
          {lista.length === 0 && <p className="text-[11px] text-gray-500">Sin franjas: el traslado no lleva suplemento por horario en esta vigencia.</p>}
          {lista.map((x) => (
            <div key={x.id} className="flex items-start justify-between gap-2 rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-700">
              <span>{describirFranja(x, moneda)}</span>
              <span className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => { setEditId(x.id); setF({ hora_desde: x.hora_desde, hora_hasta: x.hora_hasta, tramo: x.tramo, tipo: x.tipo, valor: x.valor, cobro: x.cobro }); }} className="text-[var(--brand-accent)] hover:underline">Editar</button>
                <button type="button" disabled={pending} onClick={() => borrar(x.id)} aria-label="Eliminar franja" className="text-gray-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
              </span>
            </div>
          ))}
          <div className="rounded-md border border-dashed border-gray-300 p-2">
            <p className="mb-2 text-[11px] font-medium text-gray-600">{editId ? "Editar franja" : "Agregar franja"}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div className="text-[11px] text-gray-500">Desde (incluida)<HoraInput24 etiqueta="Hora desde" value={f.hora_desde} onChange={(v) => set("hora_desde", v)} /></div>
              <div className="text-[11px] text-gray-500">Hasta (no incluida)<HoraInput24 etiqueta="Hora hasta" permite24 value={f.hora_hasta} onChange={(v) => set("hora_hasta", v)} /></div>
              <label className="text-[11px] text-gray-500">Tramo
                <select className={selCls} value={f.tramo} onChange={(e) => set("tramo", e.target.value as FranjaServicioInput["tramo"])}>
                  <option value="llegada">Llegada (ida)</option><option value="salida">Salida (regreso)</option><option value="ambos">Ambos</option>
                </select>
              </label>
              <label className="text-[11px] text-gray-500">Tipo
                <select className={selCls} value={f.tipo} onChange={(e) => set("tipo", e.target.value as FranjaServicioInput["tipo"])}>
                  <option value="monto">Monto fijo (neto)</option><option value="porcentaje">% del neto base</option>
                </select>
              </label>
              <label className="text-[11px] text-gray-500">{f.tipo === "porcentaje" ? "Porcentaje" : "Monto neto"}
                <Input type="number" min={0} step="any" value={f.valor || ""} onChange={(e) => set("valor", Number(e.target.value))} />
              </label>
              <label className="text-[11px] text-gray-500">Cobro
                <select className={selCls} value={f.cobro} disabled={f.tipo === "porcentaje"} onChange={(e) => set("cobro", e.target.value as FranjaServicioInput["cobro"])}>
                  <option value="grupo">Una vez por grupo</option><option value="persona">Por persona</option>
                </select>
              </label>
            </div>
            {previa && <p className="mt-2 text-[11px] text-gray-600">{previa}</p>}
            <div className="mt-2 flex items-center gap-2">
              <Button type="button" variant="outline" onClick={guardar} disabled={pending}>{editId ? "Guardar cambios" : "Agregar franja"}</Button>
              {editId && <button type="button" onClick={() => { setEditId(null); setF(franjaVacia()); setMsg(""); }} className="text-xs text-gray-500 hover:text-gray-800">Cancelar</button>}
              {msg && <span className="text-xs text-red-600">{msg}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CamposTemporada({ value, onChange }: { value: TemporadaServicioInput; onChange: (v: TemporadaServicioInput) => void }) {
  const set = (k: keyof TemporadaServicioInput, val: string | number | null) => onChange({ ...value, [k]: val });
  const tiers = value.grupoTiers ?? [];
  const setTier = (i: number, k: keyof TierPax, val: number) =>
    onChange({ ...value, grupoTiers: tiers.map((t, idx) => (idx === i ? { ...t, [k]: val } : t)) });
  const addTier = () => onChange({ ...value, grupoTiers: [...tiers, { paxDesde: 1, paxHasta: 4, precio: 0 }] });
  const delTier = (i: number) => onChange({ ...value, grupoTiers: tiers.filter((_, idx) => idx !== i) });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="col-span-2 md:col-span-1"><label className={lbl}>Nombre</label><Input value={value.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="ALTA, NAVIDAD…" /></div>
        <div><label className={lbl}>Viaje desde</label><DateInput aria-label="Viaje desde" type="date" value={value.fechaInicio} onValueChange={(dateValue) => set("fechaInicio", dateValue)} /></div>
        <div><label className={lbl}>Viaje hasta</label><DateInput aria-label="Viaje hasta" type="date" value={value.fechaFin} onValueChange={(dateValue) => set("fechaFin", dateValue)} /></div>
        <div><label className={lbl}>Precio por persona</label><Input type="number" min={0} value={value.precioPersona ?? ""} onChange={(e) => set("precioPersona", e.target.value === "" ? null : Number(e.target.value))} /></div>
        <div><label className={lbl}>Precio de infante</label><Input type="number" min={0} value={value.precioInfante ?? ""} placeholder="vacío = paga como adulto" onChange={(e) => set("precioInfante", e.target.value === "" ? null : Number(e.target.value))} /></div>
        <div><label className={lbl}>Compra desde</label><DateInput aria-label="Compra desde" type="date" value={value.compraInicio} onValueChange={(dateValue) => set("compraInicio", dateValue)} /></div>
        <div><label className={lbl}>Compra hasta</label><DateInput aria-label="Compra hasta" type="date" value={value.compraFin} onValueChange={(dateValue) => set("compraFin", dateValue)} /></div>
        <div><label className={lbl}>Prioridad</label><Input type="number" min={1} value={value.prioridad} onChange={(e) => set("prioridad", Number(e.target.value) || 1)} /></div>
        <div>
          <label className={lbl}>Recargo individual (1 pax)</label>
          <Input type="number" min={0} value={value.recargoIndividual ?? ""} placeholder="sin recargo"
            onChange={(e) => set("recargoIndividual", e.target.value === "" ? null : Number(e.target.value))} />
        </div>
      </div>
      {/* Rangos por grupo de ESTA vigencia: aplican solo dentro de ella; sin rango que cubra los pasajeros no hay precio. */}
      <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-2">
        <p className="mb-2 text-[11px] font-medium text-gray-500">Precio por grupo en esta temporada (obligatorio en cobro por grupo)</p>
        <div className="space-y-2">
          {tiers.map((t, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="w-20"><label className={lbl}>Pax desde</label><Input type="number" min={1} value={t.paxDesde} onChange={(e) => setTier(i, "paxDesde", Number(e.target.value) || 1)} /></div>
              <div className="w-20"><label className={lbl}>Pax hasta</label><Input type="number" min={1} value={t.paxHasta} onChange={(e) => setTier(i, "paxHasta", Number(e.target.value) || 1)} /></div>
              <div className="w-36"><label className={lbl}>Precio del grupo</label><Input type="number" min={0} value={t.precio || ""} onChange={(e) => setTier(i, "precio", Number(e.target.value) || 0)} placeholder="—" /></div>
              <button type="button" onClick={() => delTier(i)} className="pb-2 text-xs text-gray-400 hover:text-red-500">Quitar</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addTier} className="mt-2 text-xs font-medium text-[var(--brand-accent)]">+ Agregar rango</button>
      </div>
    </div>
  );
}

function FilaServicio({ s, vigencias, sinVigencia, onEdit }: { s: Servicio; vigencias: TemporadaServicio[]; sinVigencia: boolean; onEdit: (s: Servicio) => void }) {
  const [pending, start] = useTransition();
  const moneda = s.moneda === "USD" ? "USD" : "COP";
  const fmt = (n: number) => formatMoneda(n, moneda);
  const conSuplemento = vigencias.some((v) => (v.franjas ?? []).length > 0);
  const precioVigencia = (v: TemporadaServicio) => {
    const grupos = (v.grupos ?? []).map((t) => `${t.pax_desde}–${t.pax_hasta} pax: ${fmt(Number(t.precio))}`);
    // Cada precio se muestra una sola vez: por persona o por rangos de grupo, nunca ambos repetidos.
    if (v.precio_persona != null) return `${fmt(Number(v.precio_persona))} por persona`;
    return grupos.length ? grupos.join(" · ") : "Sin precio";
  };
  const permanente = s.categoria === "asistencia" && vigencias.length === 0 && s.precio_persona != null;
  return (
    <li className="flex gap-3 p-3 sm:p-4">
      <ServicioFotoCell servicioId={s.id} fotoUrl={s.foto_url ?? null} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-gray-800">{s.nombre}</span>
          {moneda === "USD" && <span className="rounded bg-[#1D7C9A]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#1D7C9A]">USD</span>}
          {sinVigencia && <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"><AlertTriangle size={11} aria-hidden /> Sin vigencia: no se ofrece</span>}
        </div>
        <p className="text-xs text-gray-500">
          {s.proveedores?.nombre ?? "Sin proveedor"} · {s.destinos?.nombre ?? (s.alcance === "internacional" ? "Todos internacionales" : "Todos nacionales")}
        </p>
        <ul className="mt-1.5 space-y-0.5 text-xs text-gray-600">
          {vigencias.map((v) => (
            <li key={v.id}><span className="font-medium text-gray-700">{v.nombre}</span> · {v.fecha_inicio || "—"} → {v.fecha_fin || "—"} · <span className="tabular-nums">{precioVigencia(v)}</span>
              {(Number(v.recargo_individual) || 0) > 0 && <span className="text-amber-600"> · +{fmt(Number(v.recargo_individual))} si 1 pax</span>}
            </li>
          ))}
          {permanente && <li>Tarifa base permanente · <span className="tabular-nums">{fmt(Number(s.precio_persona))} por persona</span></li>}
        </ul>
        {conSuplemento && <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--brand-primary)]"><Clock size={12} aria-hidden /> Tiene suplemento por horario</p>}
        {s.precio_persona != null && s.precio_infante == null && (
          <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-600" title="Sin precio de infante: los menores de 2 años pagan como adulto en este servicio.">
            <Info size={12} aria-hidden="true" /> Sin precio de infante
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-start sm:gap-3">
        <button type="button" onClick={() => onEdit(s)} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>
        <button type="button" disabled={pending}
          onClick={() => { if (confirm(`¿Eliminar ${s.nombre}?`)) start(() => { void eliminarServicio(s.id); }); }}
          className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
      </div>
    </li>
  );
}
