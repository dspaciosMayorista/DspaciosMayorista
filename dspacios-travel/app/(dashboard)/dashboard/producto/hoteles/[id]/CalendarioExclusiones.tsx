"use client";

import { useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Save, Trash2 } from "lucide-react";
import {
  aplicarConjunto, exclusionesFueraDeVigencia, msDeIso, nochesDeRangos, nochesEntre, rangosDeNoches, TIPOS_CONJUNTO,
  type ConjuntoFechas, type RangoFechas,
} from "@/lib/hoteles/conjuntosFechas";
import { actualizarConjuntoFechas, crearConjuntoFechas, eliminarConjuntoFechas } from "./conjuntos-actions";

// Block 2026-11-22 (D): the nights EXCLUDED from one validity, chosen on a calendar. The data stays what it always was (`blackouts`: inclusive ranges inside the validity); this component only
// converts nights ⇄ ranges. Named sets are a catalogue: applying one COPIES its nights into this validity's exclusions (see lib/hoteles/conjuntosFechas.ts, migration 327).
const SEMANA = ["L", "M", "M", "J", "V", "S", "D"];
const pad = (n: number) => String(n).padStart(2, "0");
const etiquetaMes = (y: number, m: number) => { const t = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m, 1))); return t.charAt(0).toUpperCase() + t.slice(1); };
const etiquetaDia = (iso: string) => new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "UTC" }).format(new Date(msDeIso(iso) ?? 0));
const corta = (iso: string) => new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(msDeIso(iso) ?? 0));
const noches = (r: RangoFechas) => nochesDeRangos([r]).length;

export function CalendarioExclusiones({ vigencia, value, onChange, conjuntos: conjuntosIniciales, conjuntosDisponibles, nombreVigencia, onNuevaVigencia }: {
  vigencia: RangoFechas[]; value: RangoFechas[]; onChange: (v: RangoFechas[]) => void; conjuntos: ConjuntoFechas[]; conjuntosDisponibles: boolean;
  /** Vigencia que se está editando en el formulario (vacío = una vigencia nueva todavía sin guardar). Solo para decir con claridad a QUÉ se copian las fechas. */
  nombreVigencia?: string;
  /** Solo en una vigencia NUEVA: rellena el formulario con el nombre y las noches del conjunto. No guarda nada. */
  onNuevaVigencia?: (c: ConjuntoFechas) => void;
}) {
  const vigNoches = useMemo(() => new Set(nochesDeRangos(vigencia)), [vigencia]);
  const seleccion = useMemo(() => new Set(nochesDeRangos(value)), [value]);
  const rangosSeleccion = useMemo(() => rangosDeNoches(seleccion), [seleccion]);
  const fuera = useMemo(() => exclusionesFueraDeVigencia(vigencia, value), [vigencia, value]);

  // Months spanned by the validity (a full year = 12). The visible month is clamped into that list.
  const meses = useMemo(() => {
    const orden = [...vigNoches].sort();
    if (!orden.length) return [] as { y: number; m: number }[];
    const [y0, m0] = orden[0].split("-").map(Number), [y1, m1] = orden[orden.length - 1].split("-").map(Number);
    const out: { y: number; m: number }[] = [];
    let y = y0, m = m0 - 1;
    while ((y < y1 || (y === y1 && m <= m1 - 1)) && out.length < 120) {
      out.push({ y, m });
      if (m === 11) { y++; m = 0; } else m++;
    }
    return out;
  }, [vigNoches]);
  const [idx, setIdx] = useState(0);
  const i = Math.min(idx, Math.max(0, meses.length - 1));
  const mes = meses[i];
  const anchor = useRef<string | null>(null);

  const [conjuntos, setConjuntos] = useState<ConjuntoFechas[]>(conjuntosIniciales);
  const [elegido, setElegido] = useState<number | "">("");
  const [aviso, setAviso] = useState("");
  const [err, setErr] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const [nuevo, setNuevo] = useState<{ nombre: string; anio: string; tipo: string; nota: string } | null>(null);
  const conjuntoElegido = conjuntos.find((c) => c.id === elegido) ?? null;

  function cambiarNoches(lista: string[], excluir: boolean) {
    const n = new Set(seleccion);
    for (const d of lista) { if (!vigNoches.has(d)) continue; if (excluir) n.add(d); else n.delete(d); }
    onChange(rangosDeNoches(n));
  }
  function clicDia(d: string, shift: boolean) {
    setAviso(""); setErr("");
    const excluir = !seleccion.has(d);
    if (shift && anchor.current) cambiarNoches(nochesEntre(anchor.current, d), excluir);
    else cambiarNoches([d], excluir);
    anchor.current = d;
  }

  function aplicar() {
    if (!conjuntoElegido) return;
    setErr("");
    const r = aplicarConjunto(vigencia, value, conjuntoElegido.rangos);
    onChange(r.blackouts);
    const partes = [`Se agregaron ${r.agregadas} noche(s) de «${conjuntoElegido.nombre} ${conjuntoElegido.anio}» a las exclusiones de esta vigencia (aún sin guardar).`];
    if (r.yaExcluidas) partes.push(`${r.yaExcluidas} ya estaban excluidas.`);
    if (r.fueraDeVigencia.length) partes.push(`${r.fueraDeVigencia.length} noche(s) del conjunto caen fuera de esta vigencia y NO se copiaron (${corta(r.fueraDeVigencia[0])}${r.fueraDeVigencia.length > 1 ? ` … ${corta(r.fueraDeVigencia[r.fueraDeVigencia.length - 1])}` : ""}).`);
    setAviso(partes.join(" "));
  }

  async function guardarNuevo() {
    if (!nuevo || ocupado) return;
    setOcupado(true); setErr("");
    try {
      const r = await crearConjuntoFechas({ nombre: nuevo.nombre, anio: Number(nuevo.anio), tipo: nuevo.tipo, rangos: rangosSeleccion, nota: nuevo.nota });
      if (!r.ok) { setErr(r.error); return; }
      setConjuntos((p) => [...p, r.conjunto]); setElegido(r.conjunto.id); setNuevo(null);
      setAviso(`Conjunto «${r.conjunto.nombre} ${r.conjunto.anio}» guardado (${nochesDeRangos(r.conjunto.rangos).length} noches). Es una copia: cambiarlo después no modifica las vigencias donde ya lo usaste.`);
    } catch { setErr("No se pudo guardar el conjunto. Intenta de nuevo."); }
    finally { setOcupado(false); }
  }
  async function reemplazarFechas() {
    if (!conjuntoElegido || ocupado) return;
    setOcupado(true); setErr("");
    try {
      const r = await actualizarConjuntoFechas(conjuntoElegido.id, { nombre: conjuntoElegido.nombre, anio: conjuntoElegido.anio, tipo: conjuntoElegido.tipo, rangos: rangosSeleccion, nota: conjuntoElegido.nota });
      if (!r.ok) { setErr(r.error); return; }
      setConjuntos((p) => p.map((c) => (c.id === r.conjunto.id ? r.conjunto : c)));
      setAviso(`Conjunto «${r.conjunto.nombre} ${r.conjunto.anio}» actualizado con la selección actual. Las vigencias que ya lo usaron conservan sus propias fechas.`);
    } catch { setErr("No se pudo actualizar el conjunto. Intenta de nuevo."); }
    finally { setOcupado(false); }
  }
  async function borrar() {
    if (!conjuntoElegido || ocupado) return;
    if (!confirmarBorrar) { setConfirmarBorrar(true); return; }
    setOcupado(true); setErr("");
    try {
      const r = await eliminarConjuntoFechas(conjuntoElegido.id);
      if (!r.ok) { setErr(r.error); return; }
      setConjuntos((p) => p.filter((c) => c.id !== conjuntoElegido.id)); setElegido("");
      setAviso("Conjunto eliminado. Las vigencias que ya lo usaron conservan sus propias fechas.");
    } catch { setErr("No se pudo eliminar el conjunto. Intenta de nuevo."); }
    finally { setOcupado(false); setConfirmarBorrar(false); }
  }

  const celdas = useMemo(() => {
    if (!mes) return [] as (string | null)[];
    const dow = (new Date(Date.UTC(mes.y, mes.m, 1)).getUTCDay() + 6) % 7;
    const n = new Date(Date.UTC(mes.y, mes.m + 1, 0)).getUTCDate();
    return [...Array<null>(dow).fill(null), ...Array.from({ length: n }, (_, k) => `${mes.y}-${pad(mes.m + 1)}-${pad(k + 1)}`)];
  }, [mes]);
  const anioSugerido = String(rangosSeleccion.length ? Number(rangosSeleccion[0].fecha_inicio.slice(0, 4)) : (mes?.y ?? new Date().getFullYear()));

  return (
    <div className="rounded-lg border border-gray-100 p-3" data-testid="calendario-exclusiones">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-600"><CalendarDays className="h-3.5 w-3.5" aria-hidden /> Noches excluidas de esta vigencia (black-outs)</p>
      <p className="mb-2 text-[11px] text-gray-500">Solo afectan a esta vigencia: no cierran el hotel. Para cerrar la venta del hotel entero usa «Black out general». Clic = excluir/incluir una noche · Mayús + clic = un rango desde la última noche tocada.</p>

      {!mes ? (
        <p role="note" className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-500">Define primero las fechas de la vigencia (desde / hasta) para elegir las noches excluidas.</p>
      ) : (
        <div className="max-w-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <button type="button" aria-label="Mes anterior" disabled={i === 0} onClick={() => setIdx(i - 1)} className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
            <select aria-label="Mes" value={i} onChange={(e) => setIdx(Number(e.target.value))} className="rounded border border-gray-200 bg-white px-2 py-1 text-xs">
              {meses.map((x, k) => <option key={`${x.y}-${x.m}`} value={k}>{etiquetaMes(x.y, x.m)}</option>)}
            </select>
            <button type="button" aria-label="Mes siguiente" disabled={i >= meses.length - 1} onClick={() => setIdx(i + 1)} className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" aria-hidden /></button>
          </div>
          <div role="grid" aria-label={etiquetaMes(mes.y, mes.m)} className="grid grid-cols-7 gap-1 text-center">
            {SEMANA.map((d, k) => <div key={k} role="columnheader" className="text-[10px] font-medium text-gray-400">{d}</div>)}
            {celdas.map((d, k) => {
              if (!d) return <div key={`v${k}`} />;
              const dentro = vigNoches.has(d), excl = seleccion.has(d);
              return (
                <button key={d} type="button" role="gridcell" disabled={!dentro} aria-pressed={dentro ? excl : undefined}
                  aria-label={`${etiquetaDia(d)}${dentro ? (excl ? ", excluida" : ", incluida") : ", fuera de la vigencia"}`}
                  onClick={(e) => clicDia(d, e.shiftKey)}
                  className={`h-8 rounded text-xs ${!dentro ? "cursor-not-allowed text-gray-300" : excl ? "bg-amber-100 font-semibold text-amber-800 ring-1 ring-amber-300" : "border border-gray-100 bg-white text-gray-700 hover:bg-gray-50"}`}>
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-live="polite">
        {rangosSeleccion.length === 0 && <span className="text-[11px] text-gray-400">Ninguna noche excluida.</span>}
        {rangosSeleccion.map((r) => (
          <span key={r.fecha_inicio} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
            {r.fecha_inicio === r.fecha_fin ? corta(r.fecha_inicio) : `${corta(r.fecha_inicio)} → ${corta(r.fecha_fin)}`} · {noches(r)} {noches(r) === 1 ? "noche" : "noches"}
          </span>
        ))}
        {seleccion.size > 0 && <button type="button" onClick={() => { onChange([]); setAviso(""); anchor.current = null; }} className="ml-1 text-[11px] text-gray-400 hover:text-red-500">Quitar todas ({seleccion.size})</button>}
      </div>
      {fuera.length > 0 && <p role="alert" className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{fuera.length} noche(s) excluida(s) quedan fuera de la vigencia ({corta(fuera[0])}{fuera.length > 1 ? ` … ${corta(fuera[fuera.length - 1])}` : ""}). Amplía la vigencia o quítalas: así no se pueden guardar.</p>}

      <div className="mt-3 border-t border-gray-100 pt-3" data-testid="conjuntos-fechas">
        <p className="mb-1 text-xs font-semibold text-gray-600">Conjuntos de fechas guardados</p>
        {!conjuntosDisponibles ? (
          <p role="note" className="text-[11px] text-gray-400">Los conjuntos de fechas estarán disponibles cuando se aplique la migración 327.</p>
        ) : (
          <>
            <p className="mb-1 text-[11px] text-gray-500" data-testid="conjunto-destino">Vigencia en edición: <b>{nombreVigencia?.trim() ? nombreVigencia.trim() : "nueva (sin guardar)"}</b>.</p>
            <p className="mb-2 text-[11px] text-gray-500" data-testid="conjunto-aclaracion">Un conjunto es solo una lista de noches guardada: no es una vigencia. Copiar un conjunto COPIA sus noches a las exclusiones de la vigencia que estás editando; no crea una vigencia nueva ni cambia otra ya guardada (la vigencia se guarda con su propio botón). Si luego editas o borras el conjunto, las vigencias donde ya lo usaste no cambian.</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[14rem] flex-1">
                <label className="block text-[10px] text-gray-400" htmlFor="conjunto-elegido">Conjunto</label>
                <select id="conjunto-elegido" value={elegido} onChange={(e) => { setElegido(e.target.value ? Number(e.target.value) : ""); setConfirmarBorrar(false); setAviso(""); setErr(""); }} className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm">
                  <option value="">{conjuntos.length ? "Elige un conjunto…" : "Aún no hay conjuntos"}</option>
                  {[...conjuntos].sort((a, b) => b.anio - a.anio || a.nombre.localeCompare(b.nombre)).map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre} · {c.anio} · {nochesDeRangos(c.rangos).length} noches · {TIPOS_CONJUNTO.find((t) => t.valor === c.tipo)?.etiqueta ?? c.tipo}</option>
                  ))}
                </select>
              </div>
              <button type="button" disabled={!conjuntoElegido || !mes} onClick={aplicar} className="rounded bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">Copiar fechas a esta vigencia</button>
              {onNuevaVigencia && <button type="button" disabled={!conjuntoElegido} onClick={() => conjuntoElegido && onNuevaVigencia(conjuntoElegido)} title="Solo rellena el formulario de la vigencia nueva: no guarda nada" className="rounded border border-[var(--brand-accent)] px-3 py-1.5 text-xs font-medium text-[var(--brand-primary)] disabled:opacity-40">Empezar una vigencia nueva con este conjunto</button>}
              <button type="button" disabled={!conjuntoElegido || ocupado || !rangosSeleccion.length} onClick={() => void reemplazarFechas()} className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-600 disabled:opacity-40" title="Reemplaza las fechas del conjunto por la selección actual">Reemplazar sus fechas con la selección</button>
              <button type="button" disabled={!conjuntoElegido || ocupado} onClick={() => void borrar()} className={`flex items-center gap-1 rounded border px-3 py-1.5 text-xs disabled:opacity-40 ${confirmarBorrar ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200 text-gray-500"}`}><Trash2 className="h-3.5 w-3.5" aria-hidden />{confirmarBorrar ? "Confirmar eliminar" : "Eliminar"}</button>
            </div>
            {nuevo ? (
              <div className="mt-2 grid gap-2 rounded bg-gray-50 p-2 sm:grid-cols-[1fr_5rem_9rem]">
                <div><label className="block text-[10px] text-gray-400" htmlFor="conjunto-nombre">Nombre</label><input id="conjunto-nombre" value={nuevo.nombre} maxLength={80} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm" placeholder="Ej. Semana Santa" /></div>
                <div><label className="block text-[10px] text-gray-400" htmlFor="conjunto-anio">Año</label><input id="conjunto-anio" inputMode="numeric" value={nuevo.anio} onChange={(e) => setNuevo({ ...nuevo, anio: e.target.value.replace(/\D/g, "").slice(0, 4) })} className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm" /></div>
                <div><label className="block text-[10px] text-gray-400" htmlFor="conjunto-tipo">Tipo</label><select id="conjunto-tipo" value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })} className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm">{TIPOS_CONJUNTO.map((t) => <option key={t.valor} value={t.valor}>{t.etiqueta}</option>)}</select></div>
                <div className="sm:col-span-3"><label className="block text-[10px] text-gray-400" htmlFor="conjunto-nota">Nota (opcional)</label><input id="conjunto-nota" value={nuevo.nota} maxLength={500} onChange={(e) => setNuevo({ ...nuevo, nota: e.target.value })} className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm" placeholder="Fuente de las fechas, ej. calendario del colegio X" /></div>
                <div className="flex gap-2 sm:col-span-3">
                  <button type="button" disabled={ocupado} onClick={() => void guardarNuevo()} className="flex items-center gap-1 rounded bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" aria-hidden />{ocupado ? "Guardando…" : "Guardar conjunto"}</button>
                  <button type="button" onClick={() => setNuevo(null)} className="text-xs text-gray-500">Cancelar</button>
                </div>
              </div>
            ) : (
              <button type="button" disabled={!rangosSeleccion.length} onClick={() => setNuevo({ nombre: "", anio: anioSugerido, tipo: "personalizado", nota: "" })} className="mt-2 text-xs font-medium text-[var(--brand-accent)] disabled:opacity-40">+ Guardar la selección actual como conjunto</button>
            )}
          </>
        )}
        {err && <p role="alert" className="mt-2 text-xs text-red-600">{err}</p>}
        {aviso && <p role="status" className="mt-2 text-xs text-gray-600">{aviso}</p>}
      </div>
    </div>
  );
}

