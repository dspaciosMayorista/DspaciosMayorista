"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP, formatFechaLarga } from "@/lib/utils";
import {
  crearTemporada, eliminarTemporada, crearTarifa, actualizarTarifa, eliminarTarifa,
} from "../actions";

type Temporada = { id: number; nombre: string; fecha_inicio: string | null; fecha_fin: string | null };
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
  const [nombre, setNombre] = useState("");
  const [ini, setIni] = useState("");
  const [fin, setFin] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  function add() {
    if (!nombre.trim()) return;
    setErr("");
    start(async () => {
      const r = await crearTemporada(hotelId, nombre, ini, fin);
      if (r.ok) { setNombre(""); setIni(""); setFin(""); } else setErr(r.error);
    });
  }
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Temporadas del hotel (rangos propios)</h2>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div><label className={lbl}>Temporada</label><Input placeholder="ALTA, MEDIA, BAJA, SEMANA SANTA…" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div><label className={lbl}>Desde</label><Input type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></div>
          <div><label className={lbl}>Hasta</label><Input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></div>
          <Button onClick={add} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Agregar"}</Button>
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <ul className="mt-3 divide-y divide-gray-100">
          {temporadas.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2 text-sm">
              <span><b>{t.nombre}</b> <span className="text-gray-400">· {formatFechaLarga(t.fecha_inicio)} → {formatFechaLarga(t.fecha_fin)}</span></span>
              <DelBtn onDel={() => eliminarTemporada(t.id, hotelId)} />
            </li>
          ))}
          {!temporadas.length && <li className="py-2 text-sm text-gray-400">Sin temporadas aún.</li>}
        </ul>
      </div>
    </section>
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
