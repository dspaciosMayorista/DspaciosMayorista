"use client";

// #43/#60 incremento 3 — Editor de grupos de días y de su PROPUESTA de tarifas (preparación inactiva).
// Solicitudes: abrir = 1 lectura; editar y revisar = 0 (todo en memoria, lib/hoteles/alcanceGrupos.ts);
// confirmar = 1 RPC, que devuelve la configuración nueva (no hay recarga de la página ni sondeos).
// 299 (entrega 3c): la propuesta es el BORRADOR de cada grupo; «Aplicar a la venta» la pone a la venta en una
// transacción, tras revisar el alcance (1 lectura) y confirmar UNA POR UNA las acomodaciones que hoy no se venden.
// Mientras tanto lo vigente se sigue vendiendo. «Volver a todos los días» exige elegir qué tarifa se conserva.
// Importes: se muestran y se leen con UN solo formato (coma decimal, punto de miles: formatNeto/leerNeto).
// Notas y edades: si no se tocan se OMITEN (se conservan); «Quitar notas y edades» es un borrado explícito.
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Plus, RefreshCw, ShoppingCart, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEscapeCerrar } from "@/components/ui/useEscapeCerrar";
import {
  ACOMS, CAMPOS_EXTRA, DIAS, EXTRAS_VACIOS, NETOS_VACIOS, claveCombo, coberturaPrevista, explicarCelda, extrasDe, formatNeto,
  leerEdad, leerNeto, planGrupos, planPropuesta, sugerencia, textoBorrado, textoDias, tieneExtras, validarEdades, basesRevisadasDe,
  type ColExtra, type ColNeto, type ConfigGrupos, type Extras, type FilaPropuesta, type GrupoCfg, type GrupoEditado, type ModoPropuesta,
} from "@/lib/hoteles/alcanceGrupos";
import {
  claveComboVolver, payloadHabilitaciones, payloadVolver, planActivacion, planVolver, puedeAplicar, textoRegeneracion, type AlcanceGrupos,
} from "@/lib/hoteles/activacionGrupos";
import {
  aplicarGruposVenta, borrarGrupoDias, descartarBorradorGrupos, guardarGruposVigencia, guardarPropuestaGrupos, leerAlcanceGrupos,
  leerConfigGrupos, volverATodosLosDias,
} from "./grupos-actions";

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
  useEscapeCerrar(true, onCerrar, ocupado); // Escape = la X; no corta una confirmación en curso
  const [grupos, setGrupos] = useState<GrupoEditado[]>([]);
  const [celdas, setCeldas] = useState<Record<string, Celda>>({});
  const [grupoActivo, setGrupoActivo] = useState<string | null>(null);
  const [modo, setModo] = useState<ModoPropuesta>("actualizar");
  const [revision, setRevision] = useState<null | "grupos" | "propuesta" | "venta" | "volver" | "descartar" | { borrar: string }>(null);
  const [alcance, setAlcance] = useState<AlcanceGrupos | null>(null);
  const [confirmadas, setConfirmadas] = useState<Set<string>>(new Set());
  const [elecciones, setElecciones] = useState<Record<string, string | null>>({});
  const [extrasAbiertos, setExtrasAbiertos] = useState<Record<string, boolean>>({});
  const leido = useRef(false);

  function aplicar(nueva: ConfigGrupos) {
    // Guardar grupos o la propuesta no toca las bases: si la respuesta no las trae, se conservan las leídas.
    const c = nueva.bases ? nueva : { ...nueva, bases: cfg?.bases };
    setCfg(c); setGrupos(gruposDe(c)); setCeldas(celdasDe(c)); setRevision(null); setDesactualizada(false);
    setAlcance(null); setConfirmadas(new Set()); setElecciones({});
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
    setAviso(`Grupos guardados: ${r.altas} nuevo(s), ${r.cambios} cambiado(s). ${r.config.estado === "activo" ? "Los grupos nuevos no se venden hasta «Aplicar a la venta»." : "No se vende nada todavía."}`);
  }
  async function confirmarBorrado(grupoId: string) {
    if (!cfg) return;
    setOcupado(true);
    const r = await borrarGrupoDias(grupoId, cfg.huella, basesRevisadasDe(cfg, grupoId));
    setOcupado(false);
    if (!r.ok) return falloEscritura(r);
    aplicar(r.config); onGruposCambiados(r.config.grupos);
    const seVendia = cfg.grupos.find((g) => g.id === grupoId)?.activo;
    const reg = r.regeneracion ? textoRegeneracion(r.regeneracion) : null;
    setAviso(`Grupo borrado con ${r.propuestasEliminadas} propuesta(s)${r.basesEliminadas ? ` y sus bases de calculadora` : ""}. ${seVendia ? `Sus tarifas salieron de la venta (quedan en el historial). ${reg?.texto ?? ""}` : "Nada de lo que se vende cambió."}`);
    if (reg && !reg.ok) setError(reg.texto);
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
    setAviso(`Propuesta guardada: ${r.nuevas} nueva(s), ${r.actualizadas} actualizada(s), ${r.eliminadas} quitada(s). Lo que se vende no cambió: revisa y aplica a la venta cuando esté lista.`);
  }

  // ── Venta (299) ──
  const seVende = cfg?.estado === "activo";
  async function revisarVenta() {
    setOcupado(true); setError(null); setAviso(null);
    const r = await leerAlcanceGrupos(temporadaId);   // UNA lectura; revisar no vuelve a leer
    setOcupado(false);
    if (!r.ok) return setError(r.error);
    setAlcance(r.alcance); setConfirmadas(new Set()); setRevision("venta");
  }
  const planA = useMemo(() => (alcance ? planActivacion(alcance) : null), [alcance]);
  async function confirmarVenta() {
    if (!alcance || !planA || !puedeAplicar(planA, confirmadas)) return;
    setOcupado(true);
    const r = await aplicarGruposVenta(temporadaId, alcance.huella, payloadHabilitaciones(planA, confirmadas));
    setOcupado(false);
    if (!r.ok) return falloEscritura(r);
    aplicar(r.config); onGruposCambiados(r.config.grupos);
    const reg = textoRegeneracion(r.regeneracion);
    setAviso(`Aplicado a la venta: desde ahora cada noche se vende con la tarifa de su grupo. ${reg.texto}`);
    if (!reg.ok) setError(reg.texto);
  }
  async function confirmarDescartar() {
    if (!cfg) return;
    setOcupado(true);
    const r = await descartarBorradorGrupos(temporadaId, cfg.huella);
    setOcupado(false);
    if (!r.ok) return falloEscritura(r);
    aplicar(r.config);
    setAviso("Borrador descartado: la propuesta de los grupos que se venden vuelve a ser exactamente lo vigente.");
  }
  const planV = useMemo(() => (cfg && seVende ? planVolver(cfg) : null), [cfg, seVende]);
  const payloadV = useMemo(() => (planV ? payloadVolver(planV, elecciones) : null), [planV, elecciones]);
  async function confirmarVolver() {
    if (!cfg || !payloadV) return;
    setOcupado(true);
    const r = await volverATodosLosDias(temporadaId, cfg.huella, payloadV);
    setOcupado(false);
    if (!r.ok) return falloEscritura(r);
    aplicar(r.config); onGruposCambiados(r.config.grupos);
    const reg = textoRegeneracion(r.regeneracion);
    setAviso(`${cfg.vigencia.nombre} vuelve a venderse con tarifas de todos los días (${r.nuevas} conservada(s), ${r.quitadas} tarifa(s) por grupo fuera de la venta). Los grupos quedan preparados. ${reg.texto}`);
    if (!reg.ok) setError(reg.texto);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Grupos de días de ${nombreVigencia}`}>
      <div className="w-full max-w-5xl space-y-5 rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--brand-primary)]"><CalendarDays className="h-5 w-5" aria-hidden /> Grupos de días · {nombreVigencia}</h3>
            <p className="text-xs text-gray-500" data-estado={cfg?.estado ?? "preparado"}>{seVende
              ? "Se vende por grupos de días. Lo que edites aquí es un borrador: lo vigente se sigue vendiendo hasta «Aplicar cambios a la venta»."
              : "Preparado — no se vende todavía. Lo que configures aquí no cambia lo que hoy se vende hasta «Aplicar a la venta»."}</p>
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
                    const seVendeGrupo = !!g.id && !!cfg.grupos.find((x) => x.id === g.id)?.activo;
                    const bloqueado = seVendeGrupo || (!activo && diaUsadoPorOtro(i, d.n));
                    return (
                      <button key={d.n} type="button" aria-pressed={activo} disabled={bloqueado}
                        title={seVendeGrupo ? "Los días de un grupo que se vende no se cambian (vuelve a «todos los días» o borra el grupo y crea otro)" : bloqueado ? `El ${d.nombre} ya está en otro grupo` : d.nombre}
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
                      <p className="text-xs text-gray-600">{seVende ? "Los grupos nuevos no se venden hasta «Aplicar a la venta»; los que ya se venden no cambian." : "Los grupos quedan preparados: hoy la vigencia se sigue vendiendo igual."}</p>
                      <div className="flex gap-2"><Button type="button" onClick={() => void confirmarGrupos()} disabled={ocupado}>Confirmar grupos</Button><Button type="button" variant="outline" onClick={() => setRevision(null)}>Volver</Button></div>
                    </>}
              </div>
            )}
            {revision && typeof revision === "object" && (
              <div className="space-y-2 rounded border border-red-300 bg-red-50 p-3 text-sm">
                {textoBorrado(cfg, revision.borrar).map((l) => <p key={l}>{l}</p>)}
                <div className="flex gap-2"><Button type="button" onClick={() => void confirmarBorrado(revision.borrar)}
                  disabled={ocupado || (!!cfg.grupos.find((x) => x.id === revision.borrar)?.activo && cfg.grupos.filter((x) => x.activo).length < 2)}>Confirmar borrado</Button><Button type="button" variant="outline" onClick={() => setRevision(null)}>Cancelar</Button></div>
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
                  <thead><tr className="text-left text-gray-500"><th className="p-1">Categoría / régimen</th>{ACOMS.map((a) => <th key={a.col} className="p-1">{a.etiqueta}</th>)}<th className="p-1">{cfg.grupos.find((x) => x.id === grupoActivo)?.activo ? "Se vende hoy" : "Sugerencia (todos los días)"}</th></tr></thead>
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
                            {cfg.grupos.find((x) => x.id === grupoActivo)?.activo
                              ? (() => {
                                  const v = (cfg.vigentes ?? []).find((x) => x.grupo_id === grupoActivo && x.tipo_habitacion === cat && x.alimentacion === reg);
                                  return <span className="text-gray-600" data-vigente>{v ? ACOMS.filter((a) => v[a.col] != null).map((a) => `${a.etiqueta} ${formatNeto(Number(v[a.col]))}`).join(" · ") || "sin netos" : "No se vende"}</span>;
                                })()
                              : s.fila
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

        {cfg && cfg.grupos.length > 0 && (
          <section aria-label="Venta" className="space-y-3 rounded border border-gray-200 p-3">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-700"><ShoppingCart className="h-4 w-4" aria-hidden /> Venta</h4>
            <p className="text-xs text-gray-600">{seVende
              ? "Esta vigencia se vende por grupos. Revisa los cambios del borrador antes de aplicarlos; nada cambia hasta que confirmes."
              : "Esta vigencia se vende hoy con tarifas de todos los días. Al aplicar, cada noche pasa a venderse con la tarifa de su grupo."}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void revisarVenta()} disabled={ocupado}>{seVende ? "Revisar cambios para aplicar a la venta" : "Revisar aplicación a la venta"}</Button>
              {seVende && <Button type="button" variant="outline" onClick={() => setRevision("descartar")} disabled={ocupado}>Descartar borrador</Button>}
              {seVende && <Button type="button" variant="outline" onClick={() => { setElecciones({}); setRevision("volver"); }} disabled={ocupado}><Undo2 className="mr-1 h-4 w-4" aria-hidden /> Volver a todos los días</Button>}
            </div>

            {revision === "venta" && planA && alcance && (
              <div className="space-y-2 rounded border border-[var(--brand-accent)] bg-sky-50 p-3 text-sm" data-revision="venta">
                <p className="font-medium">{planA.confirmacion}</p>
                {planA.bloqueos.length > 0 && (
                  <div role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-red-700">
                    <p className="font-medium">No se puede aplicar todavía:</p>
                    <ul className="list-disc pl-5">{planA.bloqueos.map((b) => <li key={b}>{b}</li>)}</ul>
                  </div>
                )}
                {planA.lineas.length > 0 && <ul className="list-disc pl-5" aria-label="Cambios en la venta">{planA.lineas.map((l) => <li key={l.texto} data-tipo={l.tipo} className={l.tipo === "quita" ? "text-red-700" : ""}>{l.texto}</li>)}</ul>}
                {planA.habilitaciones.length > 0 && (
                  <fieldset className="space-y-1 rounded border border-amber-300 bg-amber-50 p-2" aria-label="Acomodaciones que pasan a venderse">
                    <legend className="px-1 text-xs font-medium text-amber-800">Acomodaciones que HOY no se venden y pasarían a venderse: confírmalas una por una</legend>
                    {planA.habilitaciones.map((h) => (
                      <label key={h.clave} className="flex items-start gap-2 text-xs">
                        <input type="checkbox" checked={confirmadas.has(h.clave)} onChange={(e) => setConfirmadas((s) => { const n = new Set(s); if (e.target.checked) n.add(h.clave); else n.delete(h.clave); return n; })} />
                        <span>{h.texto}</span>
                      </label>
                    ))}
                    <button type="button" className="text-xs text-[var(--brand-accent)] hover:underline" onClick={() => setConfirmadas(new Set(planA.habilitaciones.map((h) => h.clave)))}>Confirmar todas (acción explícita)</button>
                  </fieldset>
                )}
                <ul className="list-disc pl-5 text-xs text-gray-700" aria-label="Efectos">{planA.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
                <div className="flex gap-2">
                  <Button type="button" onClick={() => void confirmarVenta()} disabled={ocupado || !puedeAplicar(planA, confirmadas)}>{planA.primera ? "Aplicar a la venta" : "Aplicar cambios a la venta"}</Button>
                  <Button type="button" variant="outline" onClick={() => { setRevision(null); setAlcance(null); }}>Cancelar (no cambia nada)</Button>
                </div>
              </div>
            )}

            {revision === "descartar" && (
              <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm" data-revision="descartar">
                <p>Se descartan los cambios del borrador de los grupos que se venden: su propuesta vuelve a ser exactamente lo vigente. Lo que se vende no cambia. Los grupos que aún no se venden conservan su propuesta.</p>
                <div className="flex gap-2"><Button type="button" onClick={() => void confirmarDescartar()} disabled={ocupado}>Confirmar descarte</Button><Button type="button" variant="outline" onClick={() => setRevision(null)}>Cancelar</Button></div>
              </div>
            )}

            {revision === "volver" && planV && (
              <div className="space-y-2 rounded border border-red-300 bg-red-50 p-3 text-sm" data-revision="volver">
                <p className="font-medium">Volver a «todos los días» en {cfg.vigencia.nombre}: elige, para cada combinación, qué tarifa se conserva.</p>
                {planV.combos.map((c) => {
                  const k = claveComboVolver(c);
                  return (
                    <fieldset key={k} className="rounded border border-gray-200 bg-white p-2" aria-label={`${c.tipo_habitacion} / ${c.alimentacion}`}>
                      <legend className="px-1 text-xs font-medium">{c.tipo_habitacion} / {c.alimentacion}</legend>
                      {c.opciones.map((o) => (
                        <label key={o.grupo_id} className="flex items-center gap-2 text-xs"><input type="radio" name={`volver-${k}`} checked={elecciones[k] === o.grupo_id} onChange={() => setElecciones((m) => ({ ...m, [k]: o.grupo_id }))} /> {o.texto}</label>
                      ))}
                      <label className="flex items-center gap-2 text-xs"><input type="radio" name={`volver-${k}`} checked={k in elecciones && elecciones[k] === null} onChange={() => setElecciones((m) => ({ ...m, [k]: null }))} /> No conservar (deja de venderse)</label>
                    </fieldset>
                  );
                })}
                <ul className="list-disc pl-5 text-xs text-gray-700">{planV.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
                <div className="flex gap-2"><Button type="button" onClick={() => void confirmarVolver()} disabled={ocupado || !payloadV}>Confirmar volver a todos los días</Button><Button type="button" variant="outline" onClick={() => setRevision(null)}>Cancelar</Button></div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

