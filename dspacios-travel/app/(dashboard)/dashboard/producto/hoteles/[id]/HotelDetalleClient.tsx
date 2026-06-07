"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP, formatFechaLarga } from "@/lib/utils";
import {
  crearTemporada, actualizarTemporada, eliminarTemporada, crearTarifa, actualizarTarifa, eliminarTarifa,
} from "../actions";

type RangoFechas = { fecha_inicio: string; fecha_fin: string };
type Temporada = {
  id: number; nombre: string; fecha_inicio: string | null; fecha_fin: string | null;
  prioridad?: number; compra_inicio?: string | null; compra_fin?: string | null;
  tipo?: string | null; descuento_valor?: number | null;
  rangos?: unknown; blackouts?: unknown;
};

// jsonb → lista de rangos válidos.
function asRangos(v: unknown): RangoFechas[] {
  if (!Array.isArray(v)) return [];
  return v.filter((r): r is RangoFechas =>
    !!r && typeof r === "object" &&
    typeof (r as { fecha_inicio?: unknown }).fecha_inicio === "string" &&
    typeof (r as { fecha_fin?: unknown }).fecha_fin === "string");
}

const TIPOS_TEMP: { value: string; label: string }[] = [
  { value: "tarifa", label: "Temporada / tarifa de reemplazo" },
  { value: "descuento_pct", label: "Promo: descuento %" },
  { value: "descuento_monto", label: "Promo: descuento $ por pax" },
];
const TIPO_BADGE: Record<string, string> = {
  tarifa: "tarifa", descuento_pct: "promo %", descuento_monto: "promo $",
};
type Tarifa = {
  id: number; tipo_habitacion: string | null; alimentacion: string | null; temporada: string | null;
  neto_sencilla: number | null; neto_doble: number | null; neto_triple: number | null;
  neto_multiple: number | null; neto_nino: number | null; neto_nino2: number | null;
};

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const sel = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

export function HotelDetalleClient({
  hotelId, categorias, regimenes, temporadas, tarifas,
}: { hotelId: number; categorias: string[]; regimenes: string[]; temporadas: Temporada[]; tarifas: Tarifa[] }) {
  return (
    <div className="space-y-8">
      <TemporadasBox hotelId={hotelId} temporadas={temporadas} />
      <TarifasBox hotelId={hotelId} categorias={categorias} regimenes={regimenes} temporadas={temporadas} tarifas={tarifas} />
    </div>
  );
}

function TemporadasBox({ hotelId, temporadas }: { hotelId: number; temporadas: Temporada[] }) {
  const [editId, setEditId] = useState<number | null>(null);
  const [nombre, setNombre] = useState("");
  const [ini, setIni] = useState("");
  const [fin, setFin] = useState("");
  const [prioridad, setPrioridad] = useState("1");
  const [compraIni, setCompraIni] = useState("");
  const [compraFin, setCompraFin] = useState("");
  const [tipo, setTipo] = useState("tarifa");
  const [descuento, setDescuento] = useState("");
  const [rangosExtra, setRangosExtra] = useState<RangoFechas[]>([]);
  const [blackouts, setBlackouts] = useState<RangoFechas[]>([]);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const esPromo = tipo !== "tarifa";
  const editando = editId != null;

  function reset() {
    setEditId(null); setNombre(""); setIni(""); setFin(""); setPrioridad("1");
    setCompraIni(""); setCompraFin(""); setTipo("tarifa"); setDescuento("");
    setRangosExtra([]); setBlackouts([]); setErr("");
  }

  function editar(t: Temporada) {
    setEditId(t.id);
    setNombre(t.nombre);
    const rangos = asRangos(t.rangos);
    // El primer rango es el principal (Viaje desde/hasta); el resto son adicionales.
    setIni(rangos[0]?.fecha_inicio ?? t.fecha_inicio ?? "");
    setFin(rangos[0]?.fecha_fin ?? t.fecha_fin ?? "");
    setRangosExtra(rangos.slice(1));
    setBlackouts(asRangos(t.blackouts));
    setPrioridad(String(t.prioridad ?? 1));
    setCompraIni(t.compra_inicio ?? "");
    setCompraFin(t.compra_fin ?? "");
    setTipo(t.tipo ?? "tarifa");
    setDescuento(t.descuento_valor != null ? String(t.descuento_valor) : "");
    setErr("");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function guardar() {
    if (!nombre.trim()) { setErr("Ponle un nombre."); return; }
    setErr("");
    const payload = {
      hotelId, nombre, inicio: ini, fin,
      prioridad: Number(prioridad) || 1,
      compraInicio: compraIni, compraFin: compraFin,
      tipo, descuentoValor: esPromo ? Number(descuento) || 0 : null,
      rangos: rangosExtra, blackouts,
    };
    start(async () => {
      const r = editId == null ? await crearTemporada(payload) : await actualizarTemporada(editId, payload);
      if (r.ok) reset(); else setErr(r.error);
    });
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Temporadas y promociones</h2>
      <p className="mb-3 text-xs text-gray-500">
        Las fechas <b>pueden cruzarse</b>: gana la de mayor <b>prioridad</b>. La <b>vigencia de compra</b> define
        cuándo está disponible para vender (si hoy está fuera, no aplica). Una promo descuenta la tarifa base de esas fechas.
        Usa <b>rangos adicionales</b> para una misma vigencia con varias fechas (ej. puentes) y <b>black-outs</b> para excluir fechas.
      </p>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        {editando && <p className="mb-2 text-xs font-medium text-[var(--brand-accent)]">Editando: {nombre || "temporada"}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1"><label className={lbl}>Nombre</label><Input placeholder="ALTA, BAJA, PROMO JULIO…" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div><label className={lbl}>Viaje desde</label><Input type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></div>
          <div><label className={lbl}>Viaje hasta</label><Input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></div>
          <div><label className={lbl}>Prioridad</label><Input type="number" min={1} value={prioridad} onChange={(e) => setPrioridad(e.target.value)} /></div>
          <div><label className={lbl}>Compra desde</label><Input type="date" value={compraIni} onChange={(e) => setCompraIni(e.target.value)} /></div>
          <div><label className={lbl}>Compra hasta</label><Input type="date" value={compraFin} onChange={(e) => setCompraFin(e.target.value)} /></div>
          <div className="col-span-2 sm:col-span-1">
            <label className={lbl}>Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={`${sel} w-full`}>
              {TIPOS_TEMP.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {esPromo && (
            <div>
              <label className={lbl}>{tipo === "descuento_pct" ? "Descuento %" : "Descuento $/pax"}</label>
              <Input type="number" min={0} value={descuento} onChange={(e) => setDescuento(e.target.value)} placeholder={tipo === "descuento_pct" ? "20" : "50000"} />
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ListaRangos titulo="Rangos adicionales (misma vigencia)" items={rangosExtra} onChange={setRangosExtra} />
          <ListaRangos titulo="Black-outs (fechas a excluir)" items={blackouts} onChange={setBlackouts} />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button onClick={guardar} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : editando ? "Guardar cambios" : esPromo ? "Agregar promoción" : "Agregar temporada"}</Button>
          {editando && <Button variant="outline" onClick={reset} disabled={pending}>Cancelar</Button>}
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>

        <ul className="mt-3 divide-y divide-gray-100">
          {temporadas.map((t) => {
            const tp = t.tipo ?? "tarifa";
            const promo = tp !== "tarifa";
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <b>{t.nombre}</b>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${promo ? "bg-[var(--brand-highlight)]/25 text-gray-700" : "bg-gray-100 text-gray-500"}`}>{TIPO_BADGE[tp] ?? tp}</span>
                  <span className="text-[11px] text-gray-400">P{t.prioridad ?? 1}</span>
                  {promo && t.descuento_valor != null && (
                    <span className="text-[11px] font-medium text-[var(--brand-success)]">
                      {tp === "descuento_pct" ? `−${t.descuento_valor}%` : `−${formatCOP(t.descuento_valor)}/pax`}
                    </span>
                  )}
                  <span className="text-gray-400">· {formatFechaLarga(t.fecha_inicio)} → {formatFechaLarga(t.fecha_fin)}</span>
                  {asRangos(t.rangos).length > 1 && (
                    <span className="text-[11px] text-gray-400">· +{asRangos(t.rangos).length - 1} rango(s)</span>
                  )}
                  {asRangos(t.blackouts).length > 0 && (
                    <span className="text-[11px] font-medium text-amber-600">· {asRangos(t.blackouts).length} black-out</span>
                  )}
                  {(t.compra_inicio || t.compra_fin) && (
                    <span className="text-[11px] text-gray-400">· compra {t.compra_inicio ?? "…"} → {t.compra_fin ?? "…"}</span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <button type="button" onClick={() => editar(t)} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>
                  <DelBtn onDel={() => eliminarTemporada(t.id, hotelId)} />
                </span>
              </li>
            );
          })}
          {!temporadas.length && <li className="py-2 text-sm text-gray-400">Sin temporadas aún.</li>}
        </ul>
      </div>
    </section>
  );
}

// Editor de una lista de rangos de fechas (para rangos adicionales y black-outs).
function ListaRangos({ titulo, items, onChange }: { titulo: string; items: RangoFechas[]; onChange: (v: RangoFechas[]) => void }) {
  const set = (i: number, k: keyof RangoFechas, v: string) =>
    onChange(items.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <p className={lbl}>{titulo}</p>
      <div className="space-y-2">
        {items.map((r, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1"><label className="block text-[10px] text-gray-400">Desde</label><Input type="date" value={r.fecha_inicio} onChange={(e) => set(i, "fecha_inicio", e.target.value)} /></div>
            <div className="flex-1"><label className="block text-[10px] text-gray-400">Hasta</label><Input type="date" value={r.fecha_fin} onChange={(e) => set(i, "fecha_fin", e.target.value)} /></div>
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="pb-2 text-xs text-gray-400 hover:text-red-500">Quitar</button>
          </div>
        ))}
        {!items.length && <p className="text-[11px] text-gray-400">Ninguno.</p>}
      </div>
      <button type="button" onClick={() => onChange([...items, { fecha_inicio: "", fecha_fin: "" }])} className="mt-2 text-xs font-medium text-[var(--brand-accent)]">+ Agregar</button>
    </div>
  );
}

function TarifasBox({ hotelId, categorias, regimenes, temporadas, tarifas }: {
  hotelId: number; categorias: string[]; regimenes: string[]; temporadas: Temporada[]; tarifas: Tarifa[];
}) {
  const [tipo, setTipo] = useState("");
  const [alim, setAlim] = useState("");
  const [temp, setTemp] = useState("");
  const [p, setP] = useState({ sencilla: "", doble: "", triple: "", multiple: "", nino: "", nino2: "" });
  const [editId, setEditId] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const nombresTemporada = Array.from(new Set(temporadas.map((t) => t.nombre)));
  const num = (s: string) => (s === "" ? null : Number(s));
  const str = (n: number | null) => (n == null ? "" : String(n));

  function resetForm() {
    setTipo(""); setAlim(""); setTemp("");
    setP({ sencilla: "", doble: "", triple: "", multiple: "", nino: "", nino2: "" });
    setEditId(null);
  }

  function startEdit(t: Tarifa) {
    setErr("");
    setEditId(t.id);
    setTipo(t.tipo_habitacion ?? "");
    setAlim(t.alimentacion ?? "");
    setTemp(t.temporada ?? "");
    setP({
      sencilla: str(t.neto_sencilla), doble: str(t.neto_doble), triple: str(t.neto_triple),
      multiple: str(t.neto_multiple), nino: str(t.neto_nino), nino2: str(t.neto_nino2),
    });
  }

  function add() {
    if (!tipo || !alim || !temp) { setErr("Elige categoría, régimen y temporada."); return; }
    setErr("");
    const input = {
      tipoHabitacion: tipo, alimentacion: alim, temporada: temp,
      netoSencilla: num(p.sencilla), netoDoble: num(p.doble), netoTriple: num(p.triple),
      netoMultiple: num(p.multiple), netoNino: num(p.nino), netoNino2: num(p.nino2),
    };
    start(async () => {
      const r = editId
        ? await actualizarTarifa(editId, hotelId, input)
        : await crearTarifa({ hotelId, ...input });
      if (r.ok) resetForm();
      else setErr(r.error);
    });
  }

  const faltaConfig = categorias.length === 0 || regimenes.length === 0 || temporadas.length === 0;

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Tarifa neta (lo que pagas al proveedor)</h2>
      {faltaConfig && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Para cargar tarifas necesitas: al menos una categoría y un régimen aplicados al hotel, y una temporada creada arriba.
        </p>
      )}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className={lbl}>Categoría de habitación</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={`${sel} w-full`}>
              <option value="">Selecciona</option>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Régimen</label>
            <select value={alim} onChange={(e) => setAlim(e.target.value)} className={`${sel} w-full`}>
              <option value="">Selecciona</option>
              {regimenes.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Temporada</label>
            <select value={temp} onChange={(e) => setTemp(e.target.value)} className={`${sel} w-full`}>
              <option value="">Selecciona</option>
              {nombresTemporada.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-6">
          {([["sencilla","Sencilla"],["doble","Doble"],["triple","Triple"],["multiple","Múltiple"],["nino","Niño 1"],["nino2","Niño 2"]] as [keyof typeof p, string][]).map(([k, label]) => (
            <div key={k}>
              <label className={lbl}>{label}</label>
              <Input type="number" min={0} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} placeholder="—" />
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={add} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "…" : editId ? "Guardar cambios" : "Agregar tarifa"}
          </Button>
          {editId && (
            <Button variant="outline" onClick={resetForm} disabled={pending}>Cancelar</Button>
          )}
          {err && <span className="text-sm text-red-600">{err}</span>}
          {!editId && <span className="text-xs text-gray-400">Niño 1 puede ir gratis ($0); Niño 2 con su valor. Infante siempre $0.</span>}
        </div>
      </div>

      {tarifas.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[680px] text-sm">
            <thead><tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th className="px-3 py-2">Categoría</th><th className="px-3 py-2">Régimen</th><th className="px-3 py-2">Temporada</th>
              <th className="px-3 py-2 text-right">Sencilla</th><th className="px-3 py-2 text-right">Doble</th>
              <th className="px-3 py-2 text-right">Triple</th><th className="px-3 py-2 text-right">Múltiple</th>
              <th className="px-3 py-2 text-right">Niño 1</th><th className="px-3 py-2 text-right">Niño 2</th><th className="px-3 py-2"></th>
            </tr></thead>
            <tbody>{tarifas.map((t) => (
              <tr key={t.id} className="border-t border-gray-50">
                <td className="px-3 py-2 text-gray-700">{t.tipo_habitacion ?? "—"}</td>
                <td className="px-3 py-2 text-gray-500">{t.alimentacion ?? "—"}</td>
                <td className="px-3 py-2 text-gray-500">{t.temporada ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.neto_sencilla ? formatCOP(t.neto_sencilla) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.neto_doble ? formatCOP(t.neto_doble) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.neto_triple ? formatCOP(t.neto_triple) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.neto_multiple ? formatCOP(t.neto_multiple) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.neto_nino != null ? formatCOP(t.neto_nino) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.neto_nino2 != null ? formatCOP(t.neto_nino2) : "—"}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <button type="button" onClick={() => startEdit(t)} className="text-xs text-[var(--brand-accent)] hover:underline">Editar</button>
                    <DelBtn onDel={() => eliminarTarifa(t.id, hotelId)} />
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DelBtn({ onDel }: { onDel: () => void | Promise<unknown> }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending}
      onClick={() => { if (confirm("¿Eliminar?")) start(() => { void onDel(); }); }}
      className="text-xs text-gray-400 hover:text-red-500">Eliminar</button>
  );
}
