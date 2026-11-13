"use client";
// #43/#60 entrega 4 — Elección de días (sin valor por defecto) y editor de reglas por grupo de una promoción
// por noche. Editar no hace solicitudes; guardar = 1 Server Action (RPC de la 300, una transacción).
import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEscapeCerrar } from "@/components/ui/useEscapeCerrar";
import { DIAS, textoDias, type GrupoCfg } from "@/lib/hoteles/alcanceGrupos";
import type { EleccionDias } from "@/lib/hoteles/promocionesVigencia";
import { guardarReglasPromocion, type ReglaPromoInput } from "../actions";

/** «Todos los días…» o «Elegir días»: nada viene elegido (Y.1, reglas comunes). `permitidos` acota los días visibles. */
export function EleccionDiasControl({ nombre, valor, onChange, etiquetaTodos, permitidos }: {
  nombre: string; valor: EleccionDias; onChange: (v: EleccionDias) => void; etiquetaTodos: string; permitidos?: readonly number[];
}) {
  const elegir = Array.isArray(valor);
  const dias = DIAS.filter((d) => !permitidos || permitidos.includes(d.n));
  return (
    <fieldset className="space-y-1 text-xs" data-eleccion-dias={nombre}>
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-1">
          <input type="radio" name={nombre} checked={valor === "todos"} onChange={() => onChange("todos")} /> {etiquetaTodos}
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name={nombre} checked={elegir} onChange={() => onChange([])} /> Elegir días
        </label>
      </div>
      {elegir && (
        <div className="flex flex-wrap gap-2">
          {dias.map((d) => (
            <label key={d.n} className="flex items-center gap-1" title={d.nombre}>
              <input type="checkbox" checked={valor.includes(d.n)}
                onChange={(e) => onChange(e.target.checked ? [...valor, d.n].sort() : valor.filter((x) => x !== d.n))} />
              {d.corto}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

export type ReglaGuardada = { grupo_id: string | null; valor: number; dias: number[] | null };
export type PromoConReglas = {
  id: number; nombre: string; tipo: string; prioridad: number; descuento_valor: number | null;
  descuento_unidad: string | null; promo_base_id: number | null; reglas: ReglaGuardada[];
};
export type BaseParaReglas = { id: number; nombre: string; prioridad: number; grupos: GrupoCfg[] };

type Fila = { activa: boolean; valor: string; dias: EleccionDias };

function filasIniciales(base: BaseParaReglas | undefined, promo: PromoConReglas): Record<string, Fila> {
  const out: Record<string, Fila> = {};
  const claves = base?.grupos.length ? base.grupos.map((g) => g.id) : [""];
  for (const k of claves) {
    const r = promo.promo_base_id === base?.id ? promo.reglas.find((x) => (x.grupo_id ?? "") === k) : undefined;
    out[k] = r ? { activa: true, valor: String(r.valor), dias: r.dias ?? "todos" } : { activa: false, valor: "", dias: null };
  }
  return out;
}

/** Reglas por grupo de una promoción por noche (porcentaje, o monto por persona/noche o habitación/noche). */
export function ReglasPromoPanel({ hotelId, promo, bases, onCerrar }: {
  hotelId: number; promo: PromoConReglas; bases: BaseParaReglas[]; onCerrar: () => void;
}) {
  const candidatas = bases.filter((b) => b.prioridad < promo.prioridad);
  const [baseId, setBaseId] = useState<number | null>(promo.promo_base_id);
  const base = candidatas.find((b) => b.id === baseId);
  const [filas, setFilas] = useState<Record<string, Fila>>(() => filasIniciales(base, promo));
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const pct = promo.tipo === "descuento_pct";
  useEscapeCerrar(true, onCerrar, pending); // Escape = Cancelar (deshabilitado mientras se guarda)
  const unidad = pct ? "%" : promo.descuento_unidad === "habitacion_noche" ? "$ por habitación y noche" : "$ por persona y noche";

  function elegirBase(id: number | null) {
    setBaseId(id);
    setFilas(filasIniciales(candidatas.find((b) => b.id === id), promo));
  }
  const grupoDe = (k: string) => base?.grupos.find((g) => g.id === k);

  function reglas(): ReglaPromoInput[] | string {
    const out: ReglaPromoInput[] = [];
    for (const [k, f] of Object.entries(filas)) {
      if (!f.activa) continue;
      const nombre = grupoDe(k)?.nombre ?? "todos los días";
      const v = Number(f.valor.replace(",", "."));
      if (!(v > 0) || (pct && v >= 100)) return `«${nombre}»: el valor debe ser mayor que 0${pct ? " y menor que 100" : ""}.`;
      if (f.dias == null) return `«${nombre}»: elige «Todos los días del grupo» o «Elegir días».`;
      if (Array.isArray(f.dias) && !f.dias.length) return `«${nombre}»: con «Elegir días» marca al menos un día.`;
      out.push({ grupo_id: k || null, valor: v, dias: f.dias === "todos" ? null : f.dias });
    }
    return out;
  }

  function guardar(desvincular = false) {
    const rs = desvincular ? [] : reglas();
    if (typeof rs === "string") { setErr(rs); return; }
    if (!desvincular && (!baseId || !rs.length)) { setErr("Elige la base y activa al menos una regla (un grupo sin regla conserva la base)."); return; }
    setErr("");
    start(async () => {
      const r = await guardarReglasPromocion({
        hotelId, promocionId: promo.id, baseId: desvincular ? null : baseId, reglas: rs,
        previas: { base: promo.promo_base_id, reglas: promo.reglas },
      });
      if (!r.ok) { setErr(r.error); return; }
      onCerrar();
    });
  }

  return (
    <div role="dialog" aria-label={`Reglas por grupo de ${promo.nombre}`} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-4 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Reglas por grupo · {promo.nombre}</h3>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Primero se resuelve la <b>base</b> de cada noche; esta promoción solo actúa en las noches que gana <b>su</b> base, en los
          grupos y días con regla. Un grupo sin regla conserva la base. La promoción <b>no crea disponibilidad</b>: sin tarifa en la base
          esa noche no se vende.{!pct && " Si el monto supera la tarifa de su unidad, no aplica (igual = 0)."}
        </p>
        <label className="mb-3 block text-xs text-gray-600">
          Base vinculada
          <select value={baseId ?? ""} onChange={(e) => elegirBase(e.target.value ? Number(e.target.value) : null)}
            className="mt-1 block w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm">
            <option value="">Elige la vigencia base…</option>
            {candidatas.map((b) => <option key={b.id} value={b.id}>{b.nombre} (P{b.prioridad}){b.grupos.length ? ` · ${b.grupos.length} grupo(s)` : ""}</option>)}
          </select>
          {!candidatas.length && <span className="mt-1 block text-amber-700">No hay vigencias de tarifa con menor prioridad que esta promoción.</span>}
        </label>
        {base && (
          <ul className="space-y-3">
            {Object.entries(filas).map(([k, f]) => {
              const g = grupoDe(k);
              const set = (p: Partial<Fila>) => setFilas((m) => ({ ...m, [k]: { ...m[k], ...p } }));
              return (
                <li key={k || "todos"} className="rounded-lg border border-gray-100 p-2" data-regla-grupo={k || "todos"}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={f.activa} onChange={(e) => set({ activa: e.target.checked })} />
                    <b>{g ? `${g.nombre} ${textoDias(g.dias)}` : "Todos los días de la base"}</b>
                    {g && !g.activo && <span className="text-[11px] text-gray-400">(preparado: aplica cuando el grupo se venda)</span>}
                  </label>
                  {f.activa && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="text-xs text-gray-600">Valor ({unidad})
                        <Input inputMode="decimal" value={f.valor} onChange={(e) => set({ valor: e.target.value })} />
                      </label>
                      <EleccionDiasControl nombre={`dias-${promo.id}-${k || "todos"}`} valor={f.dias} onChange={(d) => set({ dias: d })}
                        etiquetaTodos={g ? "Todos los días del grupo" : "Todos los días"} permitidos={g?.dias} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => guardar()} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Guardar reglas"}</Button>
          {promo.promo_base_id != null && (
            <Button variant="outline" onClick={() => guardar(true)} disabled={pending}>Quitar reglas y desvincular</Button>
          )}
          <Button variant="outline" onClick={onCerrar} disabled={pending}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}
