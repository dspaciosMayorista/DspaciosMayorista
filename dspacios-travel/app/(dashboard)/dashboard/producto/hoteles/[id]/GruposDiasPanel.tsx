"use client";

// #43/#60 incremento 3 — Editor de grupos de días y de su PROPUESTA de tarifas (preparación inactiva).
// Solicitudes: abrir = 1 lectura; editar y revisar = 0 (todo en memoria, lib/hoteles/alcanceGrupos.ts);
// confirmar = 1 RPC, que devuelve la configuración nueva (no hay recarga de la página ni sondeos).
// Nada de lo que se hace aquí cambia lo que hoy se vende: los grupos siguen inactivos (migración 293).
// Importes: se muestran y se leen con UN solo formato (coma decimal, punto de miles: formatNeto/leerNeto).
// Notas y edades: si no se tocan se OMITEN (se conservan); «Quitar notas y edades» es un borrado explícito.
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ACOMS, CAMPOS_EXTRA, DIAS, EXTRAS_VACIOS, NETOS_VACIOS, claveCombo, coberturaPrevista, explicarCelda, extrasDe, formatNeto,
  leerEdad, leerNeto, planGrupos, planPropuesta, sugerencia, textoBorrado, textoDias, tieneExtras, validarEdades,
  type ColExtra, type ColNeto, type ConfigGrupos, type Extras, type FilaPropuesta, type GrupoCfg, type GrupoEditado, type ModoPropuesta,
} from "@/lib/hoteles/alcanceGrupos";
import { borrarGrupoDias, guardarGruposVigencia, guardarPropuestaGrupos, leerConfigGrupos } from "./grupos-actions";

type Celda = {
  texto: Record<ColNeto, string>; origen: number | null; tocada: boolean;
  extras: Record<ColExtra, string>; extrasTocados: boolean;
};
const TEXTO_VACIO = Object.fromEntries(ACOMS.map((a) => [a.col, ""])) as Record<ColNeto, string>;
const textoExtras = (e: Extras) => Object.fromEntries(CAMPOS_EXTRA.map((c) => [c.col, e[c.col] == null ? "" : String(e[c.col])])) as Record<ColExtra, string>;
const CELDA_VACIA: Celda = { texto: TEXTO_VACIO, origen: null, tocada: false, extras: textoExtras(EXTRAS_VACIOS), extrasTocados: false };

function celdasDe(cfg: ConfigGrupos): Record<string, Celda> {
  const out: Record<string, Celda> = {};
  for (const p of cfg.propuestas) {
    out[claveCombo(p.grupo_id, p.tipo_habitacion, p.alimentacion)] = {
      texto: Object.fromEntries(ACOMS.map((a) => [a.col, formatNeto(p[a.col])])) as Record<ColNeto, string>,
      origen: p.origen_tarifa_id, tocada: false, extras: textoExtras(extrasDe(p)), extrasTocados: false,
    };
  }
  return out;
}
const gruposDe = (cfg: ConfigGrupos): GrupoEditado[] => cfg.grupos.map((g) => ({ id: g.id, nombre: g.nombre, dias: [...g.dias] }));

/** Lee notas y edades escritas. */
function leerExtras(t: Record<ColExtra, string>): { ok: true; valor: Extras } | { ok: false; error: string } {
  const e: Extras = { ...EXTRAS_VACIOS };
  for (const c of CAMPOS_EXTRA) {
    if (c.tipo === "texto") { (e as Record<string, unknown>)[c.col] = t[c.col].trim() === "" ? null : t[c.col].trim(); continue; }
    const v = leerEdad(t[c.col]);
    if (!v.ok) return { ok: false, error: `${c.etiqueta}: ${v.error}` };
    (e as Record<string, unknown>)[c.col] = v.valor;
  }
  const err = validarEdades(e);
  return err ? { ok: false, error: err } : { ok: true, valor: e };
}

export function GruposDiasPanel({ temporadaId, nombreVigencia, onCerrar, onGruposCambiados }: {
  temporadaId: number; nombreVigencia: string; onCerrar: () => void; onGruposCambiados: (grupos: GrupoCfg[]) => void;
}) {
  const [cfg, setCfg] = useState<ConfigGrupos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [desactualizada, setDesactualizada] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [grupos, setGrupos] = useState<GrupoEditado[]>([]);
  const [celdas, setCeldas] = useState<Record<string, Celda>>({});
  const [grupoActivo, setGrupoActivo] = useState<string | null>(null);
  const [modo, setModo] = useState<ModoPropuesta>("actualizar");
  const [revision, setRevision] = useState<null | "grupos" | "propuesta" | { borrar: string }>(null);
  const [extrasAbiertos, setExtrasAbiertos] = useState<Record<string, boolean>>({});
  const leido = useRef(false);

  function aplicar(c: ConfigGrupos) {
    setCfg(c); setGrupos(gruposDe(c)); setCeldas(celdasDe(c)); setRevision(null); setDesactualizada(false);
    setGrupoActivo((g) => (g && c.grupos.some((x) => x.id === g) ? g : c.grupos[0]?.id ?? null));
  }
  async function cargar() {
    setError(null); setAviso(null);
    const r = await leerConfigGrupos(temporadaId);
    if (r.ok) aplicar(r.config); else setError(r.error);
  }
  // Una sola lectura al abrir (la ref evita repetirla si React monta dos veces el efecto).
  useEffect(() => { if (!leido.current) { leido.current = true; void cargar(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function falloEscritura(r: { error: string; desactualizada?: true }) {
    if (r.desactualizada) setDesactualizada(true);
    setError(r.error); setRevision(null);
  }

  // ── Grupos ──
  const planG = useMemo(() => (cfg ? planGrupos(cfg, grupos) : null), [cfg, grupos]);
  const diaUsadoPorOtro = (i: number, d: number) => grupos.some((g, j) => j !== i && g.dias.includes(d));
  async function confirmarGrupos() {
    if (!cfg) return;
    setOcupado(true);
    const r = await guardarGruposVigencia(temporadaId, cfg.huella, grupos);
    setOcupado(false);
    if (!r.ok) return falloEscritura(r);
    aplicar(r.config); onGruposCambiados(r.config.grupos);
    setAviso(`Grupos guardados: ${r.altas} nuevo(s), ${r.cambios} cambiado(s). Siguen inactivos.`);
  }
  async function confirmarBorrado(grupoId: string) {
    if (!cfg) return;
    setOcupado(true);
    const r = await borrarGrupoDias(grupoId, cfg.huella);
    setOcupado(false);
    if (!r.ok) return falloEscritura(r);
    aplicar(r.config); onGruposCambiados(r.config.grupos);
    setAviso(`Grupo borrado con ${r.propuestasEliminadas} propuesta(s). Nada de lo que se vende cambió.`);
  }

  // ── Propuesta ──
  const combos = useMemo(() => (cfg ? cfg.categorias.flatMap((c) => cfg.regimenes.map((r) => ({ cat: c, reg: r }))) : []), [cfg]);
  const celda = (k: string): Celda => celdas[k] ?? CELDA_VACIA;
  const editar = (k: string, cambio: (c: Celda) => Celda) => { setCeldas((m) => ({ ...m, [k]: cambio(m[k] ?? CELDA_VACIA) })); setRevision(null); };
  const escribir = (k: string, col: ColNeto, valor: string) => editar(k, (c) => ({ ...c, texto: { ...c.texto, [col]: valor }, tocada: true }));
  const escribirExtra = (k: string, col: ColExtra, valor: string) => editar(k, (c) => ({ ...c, extras: { ...c.extras, [col]: valor }, tocada: true, extrasTocados: true }));
  // «Usar sugerencia» SOLO pone los netos; las notas y edades de la tarifa actual se aceptan aparte, explícitamente.
  const usarSugerencia = (k: string, fila: Record<ColNeto, number | null>, origen: number) =>
    editar(k, (c) => ({ ...c, texto: Object.fromEntries(ACOMS.map((a) => [a.col, formatNeto(fila[a.col])])) as Record<ColNeto, string>, origen, tocada: true }));
  const usarExtrasSugeridos = (k: string, e: Extras) => editar(k, (c) => ({ ...c, extras: textoExtras(e), tocada: true, extrasTocados: true }));
  const quitarExtras = (k: string) => editar(k, (c) => ({ ...c, extras: textoExtras(EXTRAS_VACIOS), tocada: true, extrasTocados: true }));

  const lectura = useMemo(() => {
    if (!cfg) return { filas: [] as FilaPropuesta[], errores: [] as string[] };
    const errores: string[] = [];
    const filas: FilaPropuesta[] = [];
    for (const g of cfg.grupos) {
      if (modo === "reemplazar_grupo" && g.id !== grupoActivo) continue;
      for (const { cat, reg } of combos) {
        const k = claveCombo(g.id, cat, reg);
        const c = celda(k);
        if (modo === "actualizar" && !c.tocada) continue;
        const netos = { ...NETOS_VACIOS };
        for (const a of ACOMS) {
          const v = leerNeto(c.texto[a.col]);
          if (!v.ok) errores.push(`${g.nombre} · ${cat} / ${reg} · ${a.etiqueta}: ${v.error}`); else netos[a.col] = v.valor;
        }
        // Notas y edades: en «actualizar», solo si se tocaron (omitidas = se conservan); en un reemplazo, siempre
        // (la fila se reescribe completa con lo que hay en pantalla, que viene de lo guardado).
        let extras: Extras | undefined;
        if (modo !== "actualizar" || c.extrasTocados) {
          const e = leerExtras(c.extras);
          if (!e.ok) errores.push(`${g.nombre} · ${cat} / ${reg}: ${e.error}`); else extras = e.valor;
        }
        filas.push({ grupo_id: g.id, tipo_habitacion: cat, alimentacion: reg, netos, origen_tarifa_id: c.origen, ...(extras ? { extras } : {}) });
      }
    }
    return { filas, errores };
  }, [cfg, celdas, modo, grupoActivo, combos]); // eslint-disable-line react-hooks/exhaustive-deps
  const planP = useMemo(() => (cfg ? planPropuesta(cfg, modo, grupoActivo, lectura.filas) : null), [cfg, modo, grupoActivo, lectura.filas]);
  const cobertura = useMemo(() => {
    if (!cfg) return null;
    const finales = cfg.grupos.flatMap((g) => combos.map(({ cat, reg }) => {
      const netos = { ...NETOS_VACIOS };
      for (const a of ACOMS) { const v = leerNeto(celda(claveCombo(g.id, cat, reg)).texto[a.col]); netos[a.col] = v.ok ? v.valor : null; }
      return { grupo_id: g.id, tipo_habitacion: cat, alimentacion: reg, netos };
    }));
    return coberturaPrevista(cfg, grupos, finales);
  }, [cfg, celdas, grupos, combos]); // eslint-disable-line react-hooks/exhaustive-deps
  async function confirmarPropuesta() {
    if (!cfg || !planP) return;
    setOcupado(true);
    const r = await guardarPropuestaGrupos(temporadaId, cfg.huella, modo, grupoActivo, planP.filas);
    setOcupado(false);
    if (!r.ok) return falloEscritura(r);
    aplicar(r.config);
    setAviso(`Propuesta guardada: ${r.nuevas} nueva(s), ${r.actualizadas} actualizada(s), ${r.eliminadas} quitada(s). No se activó nada.`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Grupos de días de ${nombreVigencia}`}>
      <div className="w-full max-w-5xl space-y-5 rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--brand-primary)]"><CalendarDays className="h-5 w-5" aria-hidden /> Grupos de días · {nombreVigencia}</h3>
            <p className="text-xs text-gray-500">Preparado — inactivo. Lo que configures aquí no cambia lo que hoy se vende hasta que se active en una entrega futura.</p>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" aria-hidden /></button>
        </div>

        {desactualizada && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <span>La configuración cambió desde que la abriste. Recarga y revisa de nuevo antes de confirmar.</span>
            <Button type="button" variant="outline" onClick={() => void cargar()}><RefreshCw className="mr-1 h-4 w-4" aria-hidden /> Recargar</Button>
          </div>
        )}
        {error && !desactualizada && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {aviso && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</p>}
        {!cfg && !error && <p className="text-sm text-gray-500">Cargando…</p>}

        {cfg && cfg.vigencia.nombre_repetido && (
          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">El nombre «{cfg.vigencia.nombre}» se repite en otra vigencia del hotel: solo una vigencia con nombre único puede tener grupos.</p>
        )}

        {cfg && (
          <section aria-label="Grupos" className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-700">Grupos</h4>
            {grupos.length === 0 && <p className="text-sm text-gray-500">Esta vigencia no tiene grupos: se resuelve como «todos los días».</p>}
            {grupos.map((g, i) => (
              <div key={g.id ?? `nuevo-${i}`} className="flex flex-wrap items-center gap-2 rounded border border-gray-200 p-2">
                <Input aria-label={`Nombre del grupo ${i + 1}`} value={g.nombre} onChange={(e) => setGrupos((gs) => gs.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} className="w-48" />
                <div className="flex gap-1" role="group" aria-label={`Días del grupo ${g.nombre || i + 1}`}>
                  {DIAS.map((d) => {
                    const activo = g.dias.includes(d.n);
                    const bloqueado = !activo && diaUsadoPorOtro(i, d.n);
                    return (
                      <button key={d.n} type="button" aria-pressed={activo} disabled={bloqueado} title={bloqueado ? `El ${d.nombre} ya está en otro grupo` : d.nombre}
                        onClick={() => setGrupos((gs) => gs.map((x, j) => (j === i ? { ...x, dias: activo ? x.dias.filter((y) => y !== d.n) : [...x.dias, d.n] } : x)))}
                        className={`h-8 w-8 rounded text-xs font-medium ${activo ? "bg-[var(--brand-primary)] text-white" : "bg-gray-100 text-gray-700"} disabled:opacity-30`}>
                        {d.corto}
                      </button>
                    );
                  })}
                </div>
                {g.id
                  ? <button type="button" onClick={() => setRevision({ borrar: g.id! })} className="ml-auto flex items-center gap-1 text-xs text-red-600 hover:underline"><Trash2 className="h-3.5 w-3.5" aria-hidden /> Borrar grupo</button>
                  : <button type="button" onClick={() => setGrupos((gs) => gs.filter((_, j) => j !== i))} className="ml-auto text-xs text-gray-500 hover:underline">Quitar</button>}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setGrupos((gs) => [...gs, { nombre: "", dias: [] }])}><Plus className="mr-1 h-4 w-4" aria-hidden /> Agregar grupo</Button>
              <Button type="button" onClick={() => setRevision("grupos")} disabled={ocupado || !planG || (planG.altas.length + planG.cambios.length === 0)}>Revisar cambios de grupos</Button>
            </div>
            {revision === "grupos" && planG && (
              <div className="space-y-2 rounded border border-[var(--brand-accent)] bg-sky-50 p-3 text-sm">
                {planG.errores.length > 0
                  ? <ul className="list-disc pl-5 text-red-700">{planG.errores.map((e) => <li key={e}>{e}</li>)}</ul>
                  : <>
                      <ul className="list-disc pl-5">
                        {planG.altas.map((g) => <li key={`a${g.nombre}`}>Nuevo grupo «{g.nombre.trim()}»: {textoDias(g.dias)}.</li>)}
                        {planG.cambios.map((g) => <li key={`c${g.id}`}>«{g.nombre.trim()}» queda con {textoDias(g.dias)}.</li>)}
                      </ul>
                      <p className="text-xs text-gray-600">Los grupos quedan inactivos: hoy la vigencia se sigue vendiendo igual.</p>
                      <div className="flex gap-2"><Button type="button" onClick={() => void confirmarGrupos()} disabled={ocupado}>Confirmar grupos</Button><Button type="button" variant="outline" onClick={() => setRevision(null)}>Volver</Button></div>
                    </>}
              </div>
            )}
            {revision && typeof revision === "object" && (
              <div className="space-y-2 rounded border border-red-300 bg-red-50 p-3 text-sm">
                {textoBorrado(cfg, revision.borrar).map((l) => <p key={l}>{l}</p>)}
                <div className="flex gap-2"><Button type="button" onClick={() => void confirmarBorrado(revision.borrar)} disabled={ocupado}>Confirmar borrado</Button><Button type="button" variant="outline" onClick={() => setRevision(null)}>Cancelar</Button></div>
              </div>
            )}
          </section>
        )}

        {cfg && cfg.grupos.length > 0 && (
          <section aria-label="Propuesta de tarifas" className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-700">Propuesta de tarifas por grupo</h4>
            <p className="text-xs text-gray-500">Importes con coma decimal y punto de miles (123,45 · 120.000). Se muestra la tarifa actual de «todos los días» como sugerencia; solo se guarda si la aceptas o escribes un precio. Una celda vacía significa que esa acomodación no se venderá con ese grupo. Nada se completa ni se copia solo.</p>
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Grupo">
              {cfg.grupos.map((g) => (
                <button key={g.id} type="button" role="tab" aria-selected={g.id === grupoActivo} onClick={() => setGrupoActivo(g.id)}
                  className={`rounded px-3 py-1 text-sm ${g.id === grupoActivo ? "bg-[var(--brand-primary)] text-white" : "bg-gray-100 text-gray-700"}`}>
                  {g.nombre} · {textoDias(g.dias)}
                </button>
              ))}
            </div>
            {grupoActivo && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead><tr className="text-left text-gray-500"><th className="p-1">Categoría / régimen</th>{ACOMS.map((a) => <th key={a.col} className="p-1">{a.etiqueta}</th>)}<th className="p-1">Sugerencia (todos los días)</th></tr></thead>
                  <tbody>
                    {combos.map(({ cat, reg }) => {
                      const k = claveCombo(grupoActivo, cat, reg);
                      const c = celda(k);
                      const s = sugerencia(cfg, cat, reg);
                      const extrasSugeridos = s.fila ? extrasDe(s.fila) : null;
                      return [
                        <tr key={k} className="border-t border-gray-100">
                          <td className="p-1 font-medium text-gray-700">
                            {cat} / {reg}
                            <button type="button" onClick={() => setExtrasAbiertos((m) => ({ ...m, [k]: !m[k] }))} className="ml-2 text-[10px] text-[var(--brand-accent)] hover:underline">
                              Notas y edades{tieneExtras(extrasDe(Object.fromEntries(CAMPOS_EXTRA.map((x) => [x.col, c.extras[x.col] || null])) as Partial<Extras>)) ? " ●" : ""}
                            </button>
                          </td>
                          {ACOMS.map((a) => {
                            const v = leerNeto(c.texto[a.col]);
                            const ayuda = v.ok ? explicarCelda(a.tipo, v.valor).texto : v.error;
                            return (
                              <td key={a.col} className="p-1">
                                <input aria-label={`${cat} ${reg} ${a.etiqueta}`} inputMode="decimal" value={c.texto[a.col]} title={ayuda}
                                  placeholder={s.fila && s.fila[a.col] != null ? formatNeto(Number(s.fila[a.col])) : ""}
                                  onChange={(e) => escribir(k, a.col, e.target.value)}
                                  className={`w-24 rounded border px-1 py-0.5 ${v.ok ? "border-gray-300" : "border-red-400"}`} />
                              </td>
                            );
                          })}
                          <td className="p-1">
                            {s.fila
                              ? <button type="button" onClick={() => usarSugerencia(k, s.fila!, s.fila!.id)} className="text-[var(--brand-accent)] hover:underline">Usar sugerencia</button>
                              : <span className="text-gray-400">{s.duplicada ? "Tarifas duplicadas: escribe el precio" : "Sin tarifa actual"}</span>}
                          </td>
                        </tr>,
                        extrasAbiertos[k] ? (
                          <tr key={`${k}-extras`} className="bg-gray-50">
                            <td colSpan={ACOMS.length + 2} className="p-2">
                              <div className="flex flex-wrap items-end gap-2">
                                {CAMPOS_EXTRA.map((x) => (
                                  <label key={x.col} className="flex flex-col text-[10px] text-gray-600">{x.etiqueta}
                                    <input aria-label={`${cat} ${reg} ${x.etiqueta}`} value={c.extras[x.col]} inputMode={x.tipo === "edad" ? "numeric" : "text"}
                                      onChange={(e) => escribirExtra(k, x.col, e.target.value)} className={`${x.tipo === "edad" ? "w-16" : "w-48"} rounded border border-gray-300 px-1 py-0.5 text-xs`} />
                                  </label>
                                ))}
                                {extrasSugeridos && tieneExtras(extrasSugeridos) && (
                                  <button type="button" onClick={() => usarExtrasSugeridos(k, extrasSugeridos)} className="text-xs text-[var(--brand-accent)] hover:underline">Usar notas y edades de la tarifa actual</button>
                                )}
                                <button type="button" onClick={() => quitarExtras(k)} className="text-xs text-red-600 hover:underline">Quitar notas y edades</button>
                              </div>
                            </td>
                          </tr>
                        ) : null,
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">Modo de guardado</legend>
              {([["actualizar", "Actualizar solo lo que edité"], ["reemplazar_grupo", "Reemplazar este grupo"], ["reemplazar_vigencia", "Reemplazar toda la vigencia"]] as const).map(([m, t]) => (
                <label key={m} className="flex items-center gap-1"><input type="radio" name={`modo-${temporadaId}`} checked={modo === m} onChange={() => { setModo(m); setRevision(null); }} /> {t}</label>
              ))}
            </fieldset>
            <Button type="button" onClick={() => setRevision("propuesta")} disabled={ocupado}>Revisar propuesta</Button>
            {revision === "propuesta" && planP && (
              <div className="space-y-2 rounded border border-[var(--brand-accent)] bg-sky-50 p-3 text-sm" data-revision="propuesta">
                {lectura.errores.length > 0
                  ? <ul className="list-disc pl-5 text-red-700">{lectura.errores.map((e) => <li key={e}>{e}</li>)}</ul>
                  : planP.sinCambios ? <p>No hay cambios para guardar.</p>
                  : <>
                      <p>{planP.nuevas} combinación(es) nueva(s), {planP.cambiadas} cambiada(s) y {planP.quitadas} que se elimina(n).{planP.reescritasSinCambio > 0 ? ` ${planP.reescritasSinCambio} se reescribe(n) sin cambios (el reemplazo guarda la fila completa).` : ""}</p>
                      <ul className="list-disc pl-5" aria-label="Cambios que se guardarán">
                        {planP.lineas.map((l) => <li key={l.texto} data-tipo={l.tipo} className={l.tipo === "quita" ? "text-red-700" : ""}>{l.texto}</li>)}
                      </ul>
                      {cobertura && (
                        <div className="text-xs text-gray-700">
                          <p className="font-medium">Al activar en el futuro (hoy nada cambia):</p>
                          <ul className="list-disc pl-5">
                            {cobertura.diasSinGrupo.length > 0 && <li>Días sin grupo ({cobertura.diasSinGrupo.join(", ")}): pasarían a otra vigencia aplicable o no se venderían.</li>}
                            {cobertura.porGrupo.map((g) => <li key={g.grupo}>{g.grupo}: {g.sinHabitacion} de {g.combinaciones} combinaciones sin precio de habitación (no se venderían).</li>)}
                          </ul>
                        </div>
                      )}
                      {cfg.promociones.length > 0 && <p className="text-xs text-gray-600">Dependencias informativas para la activación: {cfg.promociones.map((p) => p.temporada).join(", ")}. No se tocan.</p>}
                      <div className="flex gap-2"><Button type="button" onClick={() => void confirmarPropuesta()} disabled={ocupado}>Confirmar propuesta</Button><Button type="button" variant="outline" onClick={() => setRevision(null)}>Volver</Button></div>
                    </>}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
