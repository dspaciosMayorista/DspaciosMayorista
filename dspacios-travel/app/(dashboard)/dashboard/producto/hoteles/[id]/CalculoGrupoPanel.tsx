"use client";

// #43/#60 entrega 3b — Revisión y confirmación del cálculo de UN grupo de días (dentro de la calculadora).
// Solicitudes: editar = 0 (todo en memoria) · «Revisar» = 1 lectura (grupos_dias_config) · «Confirmar» =
// 1 RPC atómica (propuesta + bases + parámetros de la fórmula del grupo, 297 + 298). Sin sondeos, sin reintentos, sin revalidar ni regenerar: la
// propuesta no cambia precios ni lo que hoy se vende. Nada se activa (3c).
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Check, CircleSlash, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNetoTarifa } from "@/lib/hoteles/tarifasVista";
import type { CalcTipo } from "@/lib/calc/calculadoras";
import { textoDias, type ConfigGrupos } from "@/lib/hoteles/alcanceGrupos";
import {
  basesDeParams, calcularGrupo, cambiosGenerales, claveBases as textoBases, decidirTodas, generalesEfectivos, revisarCalculo, DECISIONES_VACIAS,
  type BasesGuardadasGrupo, type Decisiones, type GeneralesGrupo, type ParamsCalculadora,
} from "@/lib/hoteles/calculadoraGrupos";
import { leerConfigGrupos, guardarCalculoGrupo } from "./grupos-actions";

const CAMPO: Record<string, string> = { edades: "Edades", notas: "Condición (notas)", nota_infante: "Nota de infante" };

export function CalculoGrupoPanel({
  tipo, general, params, temporadaId, vigencia, grupo, adultsOnly, calcVersion, basesGuardadas, onGuardado, moneda = "COP", compraCerrada = false,
  generales = null,
}: {
  /** Parámetros de la fórmula PROPIOS del grupo tal como están en pantalla; null = usa los generales del hotel. */
  generales?: GeneralesGrupo | null;
  /** Vigencia con la compra cerrada (regla de «Generar»): ni se calcula ni se guarda por este recorrido. */
  compraCerrada?: boolean;
  tipo: CalcTipo; general: ParamsCalculadora; params: ParamsCalculadora; temporadaId: number; vigencia: string;
  grupo: { id: string; nombre: string; dias: number[] }; adultsOnly: boolean; calcVersion: number;
  basesGuardadas: BasesGuardadasGrupo | null; onGuardado: (b: BasesGuardadasGrupo) => void; moneda?: string;
}) {
  const [pending, start] = useTransition();
  const [cfg, setCfg] = useState<ConfigGrupos | null>(null);
  const [revisadas, setRevisadas] = useState<string | null>(null);   // bases con las que se abrió la revisión
  const [decisiones, setDecisiones] = useState<Decisiones>(DECISIONES_VACIAS);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string; recargar?: boolean } | null>(null);
  const fmt = (v: number | null | undefined) => formatNetoTarifa(v, moneda);

  // Todo en memoria: mismas fórmulas que la calculadora, con los generales del hotel o los propios del grupo
  // (elegidos explicitamente) y las bases del grupo. Nunca promociones (generalesEfectivos las quita).
  const bases = useMemo(() => basesDeParams(tipo, params), [tipo, params]);
  const efectivos = useMemo(() => generalesEfectivos(tipo, general, generales), [tipo, general, generales]);
  // Lo que se revisa y se guarda: bases + parámetros del grupo. Editar cualquiera después de revisar cierra la revisión.
  const claveBases = textoBases({ bases, generales });
  const calculadas = useMemo(() => (compraCerrada ? [] : calcularGrupo(tipo, efectivos, vigencia, bases, adultsOnly)), [compraCerrada, tipo, efectivos, vigencia, bases, adultsOnly]);
  const vigente = cfg !== null && revisadas === claveBases;   // editar después de revisar cierra la revisión
  const rev = useMemo(() => (vigente && cfg ? revisarCalculo(cfg, grupo.id, tipo, calculadas, decisiones) : null), [vigente, cfg, grupo.id, tipo, calculadas, decisiones]);
  const basesCambian = claveBases !== textoBases({ bases: basesGuardadas?.bases ?? (tipo === "mixta" ? {} : []), generales: basesGuardadas?.generales ?? null });
  const lineasGenerales = useMemo(() => cambiosGenerales(tipo, general, basesGuardadas?.generales ?? null, generales), [tipo, general, basesGuardadas, generales]);
  const hayCambios = !!rev && (!rev.plan.sinCambios || basesCambian);
  const puedeConfirmar = !!rev && rev.pendientes.length === 0 && hayCambios && !pending;

  function revisar() {
    if (compraCerrada) return;
    setMsg(null);
    start(async () => {
      const r = await leerConfigGrupos(temporadaId);
      if (!r.ok) { setMsg({ ok: false, texto: r.error }); return; }
      setCfg(r.config); setRevisadas(claveBases); setDecisiones(DECISIONES_VACIAS);
    });
  }
  function confirmar() {
    if (!rev || !cfg || compraCerrada) return;
    setMsg(null);
    start(async () => {
      const r = await guardarCalculoGrupo(temporadaId, cfg.huella, grupo.id, tipo, calcVersion, basesGuardadas?.version ?? null, bases, generales, rev.filas);
      if (!r.ok) { setMsg({ ok: false, texto: r.error, recargar: r.desactualizada }); return; }
      onGuardado({ tipo, bases, version: r.basesVersion, generales });
      setCfg(r.config); setRevisadas(claveBases); setDecisiones(DECISIONES_VACIAS);
      setMsg({ ok: true, texto: `Propuesta del grupo, sus bases y sus parámetros guardados (${r.nuevas} nueva(s), ${r.actualizadas} actualizada(s)). Queda en el borrador: nada cambia en lo que hoy se vende hasta «Aplicar a la venta» en Grupos de días.` });
    });
  }
  const decidir = (clave: string, d: "habilitar" | "sin_venta") => setDecisiones((s) => ({ ...s, celdas: { ...s.celdas, [clave]: d } }));
  const aplicar = (clave: string) => setDecisiones((s) => ({ ...s, aplicar: { ...s.aplicar, [clave]: !s.aplicar[clave] } }));
  const habilitaciones = rev?.combos.reduce((n, c) => n + c.habilitaciones.length, 0) ?? 0;

  return (
    <section aria-label={`Cálculo del grupo ${grupo.nombre}`} className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
      <p className="flex items-start gap-1.5 text-gray-600">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Se calcula <b>solo el grupo «{grupo.nombre}» ({textoDias(grupo.dias)})</b> de la vigencia <b>{vigencia}</b> y va a su
          <b> propuesta</b>: no se vende hasta activar los grupos. Otros grupos no se tocan. Las promociones por grupo llegan en una entrega posterior (4).
        </span>
      </p>

      {compraCerrada && (
        <p role="alert" className="flex items-start gap-1.5 text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          La vigencia {vigencia} tiene la compra cerrada: no se calcula ni se guarda por grupo (misma regla que «Generar»; sus tarifas se conservan como histórico).
        </p>
      )}
      {compraCerrada ? null : calculadas.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-[560px] text-[11px]">
            <thead><tr className="text-left text-gray-400">
              <th className="px-1.5 py-1">Categoría / régimen</th><th className="px-1.5 py-1 text-right">Sencilla</th><th className="px-1.5 py-1 text-right">Doble</th>
              <th className="px-1.5 py-1 text-right">Triple</th><th className="px-1.5 py-1 text-right">Múltiple</th>
              {!adultsOnly && <><th className="px-1.5 py-1 text-right">Niño 1</th><th className="px-1.5 py-1 text-right">Niño 2</th><th className="px-1.5 py-1 text-right">Infante</th></>}
            </tr></thead>
            <tbody>
              {calculadas.map((f) => (
                <tr key={`${f.tipo_habitacion}|${f.alimentacion}`} className="border-t border-gray-200">
                  <td className="px-1.5 py-1 text-gray-700">{f.tipo_habitacion} / {f.alimentacion}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(f.neto_sencilla)}</td><td className="px-1.5 py-1 text-right tabular-nums">{fmt(f.neto_doble)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmt(f.neto_triple)}</td><td className="px-1.5 py-1 text-right tabular-nums">{fmt(f.neto_multiple)}</td>
                  {!adultsOnly && <><td className="px-1.5 py-1 text-right tabular-nums">{fmt(f.neto_nino)}</td><td className="px-1.5 py-1 text-right tabular-nums">{fmt(f.neto_nino2)}</td><td className="px-1.5 py-1 text-right tabular-nums">{fmt(f.neto_infante)}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-gray-500">Carga al menos una base para este grupo.</p>}

      {cfg && !vigente && <p className="text-amber-700">Cambiaste las bases después de revisar: vuelve a revisar antes de confirmar.</p>}
      {!compraCerrada && <Button type="button" variant="outline" onClick={revisar} disabled={pending || calculadas.length === 0}>
        {pending && !vigente ? "Leyendo…" : "Revisar propuesta del grupo"}
      </Button>}

      {rev && (
        <div className="space-y-3">
          {rev.avisos.length > 0 && (
            <ul className="space-y-0.5 text-gray-500">{rev.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
          )}
          {rev.combos.filter((c) => c.conflictos.length || c.habilitaciones.length).map((c) => (
            <div key={c.combo} className="space-y-1.5 rounded border border-gray-200 bg-white p-2">
              <p className="font-medium text-gray-700">{c.categoria} / {c.regimen}
                <span className="ml-1 font-normal text-gray-400">
                  (se compara con {c.referencia === "propuesta" ? "la propuesta guardada" : c.referencia === "tarifa_actual" ? "la tarifa actual de la vigencia" : "nada: hoy no se vende esta combinación"})
                </span>
              </p>
              {c.omitida && <p className="text-gray-500">Ninguna habitación queda a la venta: esta combinación no se lleva a la propuesta.</p>}
              {c.conflictos.map((k) => (
                <div key={k.clave} className="flex flex-wrap items-center gap-2">
                  <span className={k.obligatorio && !k.aplicado ? "text-amber-700" : "text-gray-600"}>
                    {CAMPO[k.campo]}: {k.antes} → {k.nuevo}{k.obligatorio ? "" : " (opcional)"}
                  </span>
                  <button type="button" aria-pressed={k.aplicado} onClick={() => aplicar(k.clave)}
                    className={`rounded border px-1.5 py-0.5 ${k.aplicado ? "border-[var(--brand-success)] text-[var(--brand-success)]" : "border-gray-300 text-gray-600"}`}>
                    {k.aplicado ? "Se aplicará" : k.campo === "edades" ? "Aplicar edades del cálculo" : k.campo === "notas" ? "Aplicar condición del cálculo" : "Usar nota de infante del cálculo"}
                  </button>
                </div>
              ))}
              {c.habilitaciones.map((h) => (
                <div key={h.clave} className="flex flex-wrap items-center gap-2" role="group" aria-label={`${c.categoria} / ${c.regimen} ${h.etiqueta}`}>
                  <span className={h.decision ? "text-gray-600" : "text-amber-700"}>{h.etiqueta}: hoy {h.antes == null ? "sin precio" : fmt(h.antes)} (no se vende) → {fmt(h.nuevo)}</span>
                  <button type="button" aria-pressed={h.decision === "sin_venta"} onClick={() => decidir(h.clave, "sin_venta")}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${h.decision === "sin_venta" ? "border-gray-500 text-gray-800" : "border-gray-300 text-gray-500"}`}>
                    <CircleSlash className="h-3 w-3" aria-hidden />Mantener sin venta
                  </button>
                  <button type="button" aria-pressed={h.decision === "habilitar"} onClick={() => decidir(h.clave, "habilitar")}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${h.decision === "habilitar" ? "border-[var(--brand-success)] text-[var(--brand-success)]" : "border-gray-300 text-gray-500"}`}>
                    <Check className="h-3 w-3" aria-hidden />Habilitar a {fmt(h.nuevo)}
                  </button>
                </div>
              ))}
            </div>
          ))}
          {habilitaciones > 1 && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setDecisiones((s) => decidirTodas(rev, s, "sin_venta"))} className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-600">Mantener todas sin venta</button>
              <button type="button" onClick={() => setDecisiones((s) => decidirTodas(rev, s, "habilitar"))} className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-600">Habilitar todas</button>
            </div>
          )}
          {lineasGenerales.length > 0 && (
            <div data-revision="generales">
              <p className="font-medium text-gray-700">Parámetros de la fórmula de este grupo (no cambian los del hotel ni los de otros grupos)</p>
              <ul className="mt-1 space-y-0.5 text-gray-600">{lineasGenerales.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          )}
          <div>
            <p className="font-medium text-gray-700">Qué cambia en la propuesta del grupo</p>
            {rev.plan.lineas.length === 0
              ? <p className="text-gray-500">La propuesta queda igual.{basesCambian ? " Solo se guardan las bases y los parámetros del grupo." : ""}</p>
              : <ul className="mt-1 space-y-0.5 text-gray-600">{rev.plan.lineas.map((l, i) => <li key={i}>{l.texto}</li>)}</ul>}
          </div>
          {rev.pendientes.length > 0 && (
            <ul className="space-y-0.5 text-amber-700" aria-label="Pendientes antes de confirmar">
              {rev.pendientes.map((p) => <li key={p} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />{p}</li>)}
            </ul>
          )}
          <Button type="button" onClick={confirmar} disabled={!puedeConfirmar} style={{ backgroundColor: "var(--brand-primary)" }}>
            {pending ? "Guardando…" : "Confirmar propuesta y bases del grupo"}
          </Button>
        </div>
      )}

      {msg && (
        <p role="status" className={msg.ok ? "text-[var(--brand-success)]" : "text-red-600"}>
          {msg.texto}
          {msg.recargar && <button type="button" onClick={() => window.location.reload()} className="ml-2 underline">Recargar</button>}
        </p>
      )}
    </section>
  );
}
