"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { crearEscala, eliminarEscala, guardarRangosEscala, actualizarEscalaUsuario } from "./actions";

type Rango = { pvp_desde: number; pvp_hasta: number | null; pct: number };
type Escala = { id: number; nombre: string; rangos: Rango[] };
type Vendedor = { id: string; nombre: string; escala_id: number | null; aplica_retencion: boolean };

const lbl = "mb-1 block text-xs font-medium text-gray-600";
const card = "rounded-xl border border-gray-200 bg-white p-4";

export function EscalasComisionConfig({ escalas, vendedores }: { escalas: Escala[]; vendedores: Vendedor[] }) {
  const [nombre, setNombre] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function add() {
    if (!nombre.trim()) return;
    setErr("");
    start(async () => {
      const r = await crearEscala(nombre);
      if (r.ok) setNombre(""); else setErr(r.error);
    });
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-700">Escalas de comisión (asesor interno)</h2>
        <p className="text-xs text-gray-500">
          La comisión se liquida <b>mensual y acumulada</b>: la suma del PVP del mes ubica el rango; ese % se aplica a
          toda la base comisionable (PVP − BNC) del mes. El último rango se deja con &quot;hasta&quot; vacío = abierto.
        </p>
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className={lbl}>Nueva escala</label><Input placeholder="Junior, Senior…" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <Button onClick={add} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Crear escala"}</Button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </div>

      {escalas.map((e) => <EscalaEditor key={e.id} escala={e} />)}
      {!escalas.length && <p className="text-sm text-gray-400">Aún no hay escalas.</p>}

      {/* Asignación a asesores internos (usuarios con rol venta) */}
      <div className={card}>
        <p className="mb-1 text-sm font-semibold text-gray-700">Escala y retención por asesor interno</p>
        <p className="mb-2 text-xs text-gray-400">Son los usuarios con rol <b>venta</b>. Si falta alguien, créalo en <b>Usuarios</b> con rol venta.</p>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3 pb-1 text-[11px] uppercase text-gray-400">
            <span className="flex-1">Asesor</span><span className="w-40 text-center">Escala</span><span className="w-24 text-center">Retención</span>
          </div>
          {vendedores.map((v) => <AsignacionVendedor key={v.id} vendedor={v} escalas={escalas} />)}
          {!vendedores.length && <p className="text-sm text-gray-400">No hay usuarios con rol venta.</p>}
        </div>
      </div>
    </section>
  );
}

function EscalaEditor({ escala }: { escala: Escala }) {
  const [rangos, setRangos] = useState<{ desde: string; hasta: string; pct: string }[]>(
    (escala.rangos.length ? escala.rangos : [{ pvp_desde: 0, pvp_hasta: null, pct: 0 }]).map((r) => ({
      desde: String(r.pvp_desde ?? 0),
      hasta: r.pvp_hasta == null ? "" : String(r.pvp_hasta),
      pct: String(r.pct ?? 0),
    }))
  );
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  const set = (i: number, k: "desde" | "hasta" | "pct", v: string) =>
    setRangos((arr) => arr.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const addRango = () => setRangos((arr) => [...arr, { desde: "", hasta: "", pct: "" }]);
  const delRango = (i: number) => setRangos((arr) => arr.filter((_, j) => j !== i));

  function guardar() {
    setMsg("");
    start(async () => {
      const r = await guardarRangosEscala(
        escala.id,
        rangos.map((x) => ({
          pvp_desde: Number(x.desde) || 0,
          pvp_hasta: x.hasta.trim() === "" ? null : Number(x.hasta) || 0,
          pct: Number(x.pct) || 0,
        }))
      );
      setMsg(r.ok ? "✓ Guardado" : r.error);
    });
  }

  return (
    <div className={card}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">{escala.nombre}</p>
        <DelBtn onDel={() => eliminarEscala(escala.id)} label="Eliminar escala" />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[460px] text-sm">
          <thead><tr className="text-left text-xs text-gray-400">
            <th className="px-2 py-1">PVP desde</th><th className="px-2 py-1">PVP hasta (vacío = abierto)</th><th className="px-2 py-1">% comisión</th><th></th>
          </tr></thead>
          <tbody>
            {rangos.map((r, i) => (
              <tr key={i}>
                <td className="px-1 py-1"><Input type="number" min={0} className="w-32" value={r.desde} onChange={(e) => set(i, "desde", e.target.value)} /></td>
                <td className="px-1 py-1"><Input type="number" min={0} className="w-32" value={r.hasta} onChange={(e) => set(i, "hasta", e.target.value)} placeholder="abierto" /></td>
                <td className="px-1 py-1"><Input type="number" min={0} step="0.01" className="w-24" value={r.pct} onChange={(e) => set(i, "pct", e.target.value)} placeholder="0.5" /></td>
                <td className="px-1 py-1"><button type="button" onClick={() => delRango(i)} className="text-xs text-gray-400 hover:text-red-500">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={addRango} className="text-xs font-medium text-[var(--brand-accent)]">+ Agregar rango</button>
        <Button onClick={guardar} disabled={pending} className="h-8" style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Guardar rangos"}</Button>
        {msg && <span className={msg.startsWith("✓") ? "text-xs text-green-600" : "text-xs text-red-600"}>{msg}</span>}
      </div>
      {rangos.length > 0 && (
        <p className="mt-1 text-[11px] text-gray-400">
          Ej: {formatCOP(Number(rangos[0].desde) || 0)} → {rangos[0].hasta ? formatCOP(Number(rangos[0].hasta)) : "abierto"} = {rangos[0].pct || 0}%
        </p>
      )}
    </div>
  );
}

function AsignacionVendedor({ vendedor, escalas }: { vendedor: Vendedor; escalas: Escala[] }) {
  const [escalaId, setEscalaId] = useState<string>(vendedor.escala_id ? String(vendedor.escala_id) : "");
  const [ret, setRet] = useState(vendedor.aplica_retencion ?? true);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center justify-between gap-3 border-t border-gray-50 py-1.5 text-sm first:border-t-0">
      <span className="flex-1 text-gray-700">{vendedor.nombre}</span>
      <select value={escalaId} disabled={pending}
        onChange={(e) => { setEscalaId(e.target.value); start(async () => { await actualizarEscalaUsuario(vendedor.id, { escalaId: e.target.value === "" ? null : Number(e.target.value) }); }); }}
        className="w-40 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm">
        <option value="">— Sin escala —</option>
        {escalas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
      </select>
      <label className="flex w-24 items-center justify-center gap-1.5 text-xs text-gray-600">
        <input type="checkbox" checked={ret}
          onChange={(e) => { setRet(e.target.checked); start(async () => { await actualizarEscalaUsuario(vendedor.id, { aplicaRetencion: e.target.checked }); }); }} />
        Aplica
      </label>
    </div>
  );
}

function DelBtn({ onDel, label }: { onDel: () => void | Promise<unknown>; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending}
      onClick={() => { if (confirm("¿Eliminar?")) start(() => { void onDel(); }); }}
      className="text-xs text-gray-400 hover:text-red-500">{label}</button>
  );
}
