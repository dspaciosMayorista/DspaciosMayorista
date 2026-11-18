"use client";
// #43/#60 entrega 4 — Elección de días (sin valor por defecto) y editor de reglas por grupo de una promoción
// por noche. Editar no hace solicitudes; guardar = 1 Server Action (RPC de la 300, una transacción).
import { useMemo, useState, useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEscapeCerrar } from "@/components/ui/useEscapeCerrar";
import { DIAS, textoDias, type GrupoCfg } from "@/lib/hoteles/alcanceGrupos";
import type { EleccionDias } from "@/lib/hoteles/promocionesVigencia";
import { guardarReglasPromocion, type ReglaPromoInput } from "../actions";
import { planPromoPorNoche } from "@/lib/calc/promoCalculadora";
import type { TemporadaRango } from "@/lib/calc/paquetes";
import { validarNinoGratis } from "@/lib/hoteles/ninoGratis";
import { PlanPromoPorNoche } from "./PlanPromoPorNoche";

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
  /** #125: modo «seguir la base ganadora cada noche» y «un niño gratis por habitación» (edad propia opcional). */
  promo_sigue_base?: boolean; nino_gratis?: boolean; nino_gratis_edad_min?: number | null; nino_gratis_edad_max?: number | null;
};
export type BaseParaReglas = { id: number; nombre: string; prioridad: number; grupos: GrupoCfg[] };
/** Lo mínimo de `tarifa_hotel` que necesita la vista previa fechada (la tarifa de adulto doble y la de niño por persona). */
export type TarifaParaPlan = { tipo_habitacion: string | null; alimentacion: string | null; temporada: string | null; neto_doble: number | null; neto_nino: number | null; grupo_id?: string | null };

type Fila = { activa: boolean; valor: string; dias: EleccionDias };
const SIGUE = "sigue";

function filasIniciales(base: BaseParaReglas | undefined, promo: PromoConReglas): Record<string, Fila> {
  const out: Record<string, Fila> = {};
  const claves = base?.grupos.length ? base.grupos.map((g) => g.id) : [""];
  for (const k of claves) {
    const r = promo.promo_base_id === base?.id ? promo.reglas.find((x) => (x.grupo_id ?? "") === k) : undefined;
    out[k] = r ? { activa: true, valor: String(r.valor), dias: r.dias ?? "todos" } : { activa: false, valor: "", dias: null };
  }
  return out;
}

const aEntero = (t: string): number | null => (t.trim() === "" ? null : Number(t.trim()));

/** Reglas por grupo de una promoción por noche (porcentaje, o monto por persona/noche o habitación/noche). */
export function ReglasPromoPanel({ hotelId, promo, bases, onCerrar, vigencias, tarifas, regimenes, moneda }: {
  hotelId: number; promo: PromoConReglas; bases: BaseParaReglas[]; onCerrar: () => void;
  /** Con vigencias y tarifas se muestra la vista previa fechada (opcional: sin ellas el panel es el de siempre). */
  vigencias?: TemporadaRango[]; tarifas?: TarifaParaPlan[]; regimenes?: string[]; moneda?: string;
}) {
  const candidatas = bases.filter((b) => b.prioridad < promo.prioridad);
  const [sigue, setSigue] = useState(promo.promo_sigue_base === true);
  const [baseId, setBaseId] = useState<number | null>(promo.promo_base_id);
  const base = sigue ? undefined : candidatas.find((b) => b.id === baseId);
  const pct = promo.tipo === "descuento_pct";
  const [filas, setFilas] = useState<Record<string, Fila>>(() => filasIniciales(base, promo));
  // Modo «seguir la base ganadora»: UNA regla para todas las bases (grupo nulo). El % se sugiere desde la vigencia, los días no traen valor por defecto.
  const [regla, setRegla] = useState<{ valor: string; dias: EleccionDias }>(() => {
    const r = promo.promo_sigue_base ? promo.reglas.find((x) => x.grupo_id == null) : undefined;
    return r ? { valor: String(r.valor), dias: r.dias ?? "todos" } : { valor: pct && promo.descuento_valor != null ? String(promo.descuento_valor) : "", dias: null };
  });
  const [ng, setNg] = useState(promo.nino_gratis === true);
  const [edMin, setEdMin] = useState(promo.nino_gratis_edad_min != null ? String(promo.nino_gratis_edad_min) : "");
  const [edMax, setEdMax] = useState(promo.nino_gratis_edad_max != null ? String(promo.nino_gratis_edad_max) : "");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  useEscapeCerrar(true, onCerrar, pending); // Escape = Cancelar (deshabilitado mientras se guarda)
  const unidad = pct ? "%" : promo.descuento_unidad === "habitacion_noche" ? "$ por habitación y noche" : "$ por persona y noche";

  function elegirModo(v: string) {
    if (v === SIGUE) { setSigue(true); setBaseId(null); return; }
    const id = v ? Number(v) : null;
    setSigue(false); setBaseId(id);
    setFilas(filasIniciales(candidatas.find((b) => b.id === id), promo));
  }
  const grupoDe = (k: string) => base?.grupos.find((g) => g.id === k);

  function reglas(): ReglaPromoInput[] | string {
    const out: ReglaPromoInput[] = [];
    if (sigue) {
      const v = Number(regla.valor.replace(",", "."));
      if (!(v > 0) || (pct && v >= 100)) return `El valor debe ser mayor que 0${pct ? " y menor que 100" : ""}.`;
      if (regla.dias == null) return "Elige «Todos los días» o «Elegir días».";
      if (Array.isArray(regla.dias) && !regla.dias.length) return "Con «Elegir días» marca al menos un día.";
      return [{ grupo_id: null, valor: v, dias: regla.dias === "todos" ? null : regla.dias }];
    }
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
    if (!desvincular && ((!sigue && !baseId) || !rs.length)) { setErr("Elige la base (o «Seguir la base ganadora cada noche») y activa al menos una regla (un grupo sin regla conserva la base)."); return; }
    const usaNuevos = sigue || ng || promo.promo_sigue_base === true || promo.nino_gratis === true;
    const ninoGratis = { activo: !desvincular && ng, edadMin: desvincular || !ng ? null : aEntero(edMin), edadMax: desvincular || !ng ? null : aEntero(edMax) };
    if (usaNuevos && !desvincular) {
      const v = validarNinoGratis(ninoGratis, { tipo: promo.tipo, conReglas: true });
      if (!v.ok) { setErr(v.error); return; }
    }
    setErr("");
    start(async () => {
      const r = await guardarReglasPromocion({
        hotelId, promocionId: promo.id, baseId: desvincular || sigue ? null : baseId, reglas: rs,
        previas: usaNuevos
          ? { base: promo.promo_base_id, reglas: promo.reglas, sigueBase: promo.promo_sigue_base === true,
              ninoGratis: { activo: promo.nino_gratis === true, edadMin: promo.nino_gratis_edad_min ?? null, edadMax: promo.nino_gratis_edad_max ?? null } }
          : { base: promo.promo_base_id, reglas: promo.reglas },
        ...(usaNuevos ? { sigueBase: !desvincular && sigue, ninoGratis } : {}),
      });
      if (!r.ok) { setErr(r.error); return; }
      onCerrar();
    });
  }

  // ── Vista previa fechada (solo con vigencias y tarifas) ──────────────────────────────────────
  const [regimen, setRegimen] = useState(regimenes?.[0] ?? "");
  const [categoria, setCategoria] = useState("");
  const categorias = useMemo(
    () => [...new Set((tarifas ?? []).filter((t) => t.alimentacion?.trim() === regimen && !t.grupo_id && t.neto_doble != null && t.tipo_habitacion).map((t) => t.tipo_habitacion as string))],
    [tarifas, regimen],
  );
  const catSel = categorias.includes(categoria) ? categoria : categorias[0] ?? "";
  const hayGrupos = !!vigencias?.some((v) => (v.grupos?.length ?? 0) > 0);
  const pctPlan = sigue ? Number(regla.valor.replace(",", "."))
    : Number((Object.values(filas).find((f) => f.activa)?.valor ?? "").replace(",", ".")) || Number(promo.descuento_valor ?? NaN);
  const plan = useMemo(() => {
    if (!vigencias || !regimen || !(sigue || base) || !pct || !(pctPlan > 0 && pctPlan < 100)) return null;
    const celda = (b: string, col: "neto_doble" | "neto_nino") =>
      (tarifas ?? []).find((t) => t.temporada?.trim() === b && t.alimentacion?.trim() === regimen && t.tipo_habitacion === catSel && !t.grupo_id)?.[col] ?? null;
    return planPromoPorNoche({
      promo: promo.nombre, vigencias, regimen, pct: pctPlan, ninoGratis: ng,
      ...(hayGrupos ? {} : { valorBase: (b: string) => celda(b, "neto_doble"), valorNinoBase: (b: string) => celda(b, "neto_nino") }),
    });
  }, [vigencias, tarifas, regimen, catSel, sigue, base, pct, pctPlan, ng, hayGrupos, promo.nombre]);

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
          <select value={sigue ? SIGUE : baseId ?? ""} onChange={(e) => elegirModo(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm">
            <option value="">Elige la vigencia base…</option>
            <option value={SIGUE}>Seguir la base ganadora cada noche (varias temporadas)</option>
            {candidatas.map((b) => <option key={b.id} value={b.id}>{b.nombre} (P{b.prioridad}){b.grupos.length ? ` · ${b.grupos.length} grupo(s)` : ""}</option>)}
          </select>
          {!candidatas.length && <span className="mt-1 block text-amber-700">No hay vigencias de tarifa con menor prioridad que esta promoción.</span>}
        </label>
        {sigue && (
          <div className="mb-3 space-y-2 rounded-lg border border-gray-100 p-2" data-modo-sigue>
            <p className="text-xs text-gray-500">
              Cada noche la promoción se calcula sobre la <b>temporada base que gana esa noche</b>, aunque el viaje cruce varias temporadas sucesivas; no hace falta partirla.
              Adultos, Niño 1 y Niño 2 reciben el porcentaje; el <b>infante conserva su tarifa base</b>. Si dos bases empatan en prioridad una misma noche, o falta la tarifa de la base,
              esa noche no se vende. La promoción debe tener mayor prioridad que las bases que cruza.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-gray-600">Valor ({unidad})
                <Input inputMode="decimal" value={regla.valor} onChange={(e) => setRegla((r) => ({ ...r, valor: e.target.value }))} />
              </label>
              <EleccionDiasControl nombre={`dias-${promo.id}-sigue`} valor={regla.dias} onChange={(d) => setRegla((r) => ({ ...r, dias: d }))} etiquetaTodos="Todos los días" />
            </div>
          </div>
        )}
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
        {(sigue || base) && pct && (
          <fieldset className="mt-3 space-y-2 rounded-lg border border-gray-100 p-2" data-nino-gratis>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={ng} onChange={(e) => setNg(e.target.checked)} className="mt-1" />
              <span><b>Un niño gratis por habitación</b> (con al menos 2 adultos en la habitación)</span>
            </label>
            <p className="text-xs text-gray-500">
              Se evalúa habitación por habitación: cada habitación con 2 o más adultos no paga el alojamiento de UN niño; el segundo niño paga su tarifa promocional de niño.
              Solo aplica al alojamiento de este hotel, en las noches en que gana esta promoción: no toca vuelos, asistencia, traslados, tours ni otros servicios.
              El infante conserva su tarifa base.
            </p>
            {ng && (
              <div className="grid gap-2 sm:grid-cols-2" data-nino-edad>
                <label className="text-xs text-gray-600">Edad mínima del niño (años)
                  <Input inputMode="numeric" value={edMin} onChange={(e) => setEdMin(e.target.value)} placeholder="Vacío = edad del hotel" />
                </label>
                <label className="text-xs text-gray-600">Edad máxima del niño (años)
                  <Input inputMode="numeric" value={edMax} onChange={(e) => setEdMax(e.target.value)} placeholder="Vacío = edad del hotel" />
                </label>
                <p className="text-[11px] text-gray-400 sm:col-span-2">
                  Edad propia de la promoción (opcional, mínima y máxima juntas, años cumplidos a la entrada). Si la dejas vacía se usa la regla de edad del hotel.
                </p>
              </div>
            )}
          </fieldset>
        )}
        {plan && (
          <div className="mt-3 space-y-2" data-plan-seccion>
            {((regimenes?.length ?? 0) > 1 || categorias.length > 1) && (
              <div className="flex flex-wrap gap-2 text-xs text-gray-600">
                {(regimenes?.length ?? 0) > 1 && (
                  <label>Régimen
                    <select value={regimen} onChange={(e) => setRegimen(e.target.value)} className="ml-1 rounded-md border border-gray-200 px-2 py-1 text-xs">
                      {regimenes!.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </label>
                )}
                {categorias.length > 1 && (
                  <label>Categoría
                    <select value={catSel} onChange={(e) => setCategoria(e.target.value)} className="ml-1 rounded-md border border-gray-200 px-2 py-1 text-xs">
                      {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}
            <PlanPromoPorNoche plan={plan} moneda={moneda} baseUnica={sigue ? null : base?.nombre} conPrecios={!hayGrupos}
              titulo={`Vista previa por noche${catSel ? ` · ${catSel}` : ""}${regimen ? ` · ${regimen}` : ""} (habitación doble, por persona)`} />
            {hayGrupos && <p className="text-[11px] text-gray-500">Hay bases que se venden por grupos de días: la vista previa muestra base y porcentaje; los importes dependen del grupo de cada noche.</p>}
          </div>
        )}
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => guardar()} disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>{pending ? "…" : "Guardar reglas"}</Button>
          {(promo.promo_base_id != null || promo.promo_sigue_base === true) && (
            <Button variant="outline" onClick={() => guardar(true)} disabled={pending}>Quitar reglas y desvincular</Button>
          )}
          <Button variant="outline" onClick={onCerrar} disabled={pending}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}
