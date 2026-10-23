"use client";

import { useMemo, useState, useTransition } from "react";
import { History, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCOP } from "@/lib/utils";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import {
  resumenVigenciaHistorica, ESTADO_VERSION, MOTIVO_HISTORIAL, OPERACION_HISTORIAL,
  type PaginaHistorial, type VersionTarifa,
} from "@/lib/calc/historialTarifas";
import { consultarHistorialTarifas } from "./historial-actions";

// Historial INTERNO de tarifas por persona (migración 203). Búsqueda y
// paginación ocurren en el SERVIDOR (cursor estable), así que se puede recorrer
// todo el historial, no solo una primera tanda. Cada versión muestra la
// vigencia TAL COMO ERA en el momento del cambio (foto guardada por el
// trigger), nunca la de hoy. Solo consulta: no se cotiza, publica ni restaura.

type TarifaActual = {
  tipo_habitacion: string | null; alimentacion: string | null; temporada: string | null;
  neto_sencilla: number | null; neto_doble: number | null;
};

const fechaHoraBogota = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" });

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
const clave = (t: { tipo_habitacion?: unknown; alimentacion?: unknown; temporada?: unknown }) =>
  `${txt(t.tipo_habitacion) ?? ""}|${txt(t.alimentacion) ?? ""}|${txt(t.temporada) ?? ""}`;

const PRECIOS: [string, string][] = [
  ["neto_sencilla", "Sencilla"], ["neto_doble", "Doble"], ["neto_triple", "Triple"], ["neto_multiple", "Múltiple"],
  ["neto_nino", "Niño 1"], ["neto_nino2", "Niño 2"], ["neto_infante", "Infante"],
];

export function TarifasHistorial({
  hotelId, inicial, errorInicial, tarifasActuales, adultsOnly = false,
}: {
  hotelId: number;
  inicial: PaginaHistorial | null;
  errorInicial: string | null;
  tarifasActuales: TarifaActual[];
  adultsOnly?: boolean;
}) {
  const [filas, setFilas] = useState<VersionTarifa[]>(inicial?.filas ?? []);
  const [total, setTotal] = useState(inicial?.total ?? 0);
  const [siguiente, setSiguiente] = useState(inicial?.siguiente ?? null);
  const [busqueda, setBusqueda] = useState("");
  const [aplicada, setAplicada] = useState("");
  const [error, setError] = useState<string | null>(errorInicial);
  const [pending, start] = useTransition();

  const actuales = useMemo(() => {
    const m = new Map<string, TarifaActual>();
    for (const t of tarifasActuales) m.set(clave(t), t);
    return m;
  }, [tarifasActuales]);

  const precios = adultsOnly ? PRECIOS.slice(0, 4) : PRECIOS;

  function buscar(e?: React.FormEvent) {
    e?.preventDefault();
    const q = busqueda;
    start(async () => {
      const r = await consultarHistorialTarifas(hotelId, q, null);
      if (!r.ok) { setError(r.error); return; }
      setError(null);
      setAplicada(q.trim());
      setFilas(r.pagina.filas);
      setTotal(r.pagina.total);
      setSiguiente(r.pagina.siguiente);
    });
  }

  function verMas() {
    if (!siguiente) return;
    start(async () => {
      const r = await consultarHistorialTarifas(hotelId, aplicada, siguiente);
      if (!r.ok) { setError(r.error); return; }
      setError(null);
      setFilas((prev) => [...prev, ...r.pagina.filas]);
      setTotal(r.pagina.total);
      setSiguiente(r.pagina.siguiente);
    });
  }

  const noDisponible = !inicial && !!errorInicial;

  return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white">
      <details>
        <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-semibold text-gray-700">
          <History className="h-4 w-4 text-gray-400" aria-hidden />
          Historial interno de tarifas
          <span className="font-normal text-gray-400">({noDisponible ? "no disponible" : total})</span>
        </summary>
        <div className="space-y-3 border-t border-gray-100 p-4">
          <p className="text-xs text-gray-500">
            Versiones anteriores de las tarifas por persona de este hotel, guardadas antes de cada cambio o borrado. La vigencia,
            sus fechas y su estado son los de ese momento, no los de hoy. Solo consulta interna: nada de aquí se cotiza, se
            publica ni se restaura.
          </p>
          {noDisponible ? (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">{errorInicial}</p>
          ) : (
            <>
              <form onSubmit={buscar} className="flex max-w-xl flex-wrap items-center gap-2">
                <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Categoría, régimen, temporada, origen o autor" className="min-w-0 flex-1" />
                <Button type="submit" variant="outline" disabled={pending}>
                  <Search className="mr-1 h-4 w-4" aria-hidden /> Buscar
                </Button>
              </form>
              {error && <p className="text-xs text-red-600">{error}</p>}
              {aplicada && <p className="text-[11px] text-gray-500">{total} versiones coinciden con “{aplicada}”.</p>}
              {filas.length === 0 ? (
                <p className="text-xs text-gray-400">{aplicada ? "Ninguna versión coincide." : "Todavía no hay versiones guardadas: se registran desde que se activó el historial."}</p>
              ) : (
                <ResponsiveTableShell minWidth={1100} className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full min-w-[1100px] text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-left align-bottom text-gray-400">
                        <th className="px-2 py-1">Cambio</th>
                        <th className="px-2 py-1">Tarifa</th>
                        <th className="px-2 py-1">Vigencia en ese momento</th>
                        {precios.map(([k, l]) => <th key={k} className="px-2 py-1 text-right">{l}</th>)}
                        <th className="px-2 py-1 text-right">Hoy (doble)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((v) => {
                        const d = v.datos;
                        const vig = resumenVigenciaHistorica(v.vigencia, v.vigencia_fuente, v.registrado_en);
                        const actual = actuales.get(clave(d));
                        const promo = d.precio_final_autoritativo === true || (vig.tipo != null && vig.tipo !== "tarifa");
                        return (
                          <tr key={v.id} className="border-t border-gray-50 align-top">
                            <td className="px-2 py-1 text-gray-500" data-label="Cambio">
                              <div className="whitespace-nowrap">{fechaHoraBogota(v.registrado_en)}</div>
                              <div className="font-medium text-gray-700">{OPERACION_HISTORIAL[v.operacion] ?? v.operacion}</div>
                              <div>{MOTIVO_HISTORIAL[v.motivo] ?? v.motivo}</div>
                              {v.autor_email && <div className="text-[10px] text-gray-400">{v.autor_email}</div>}
                            </td>
                            <td className="px-2 py-1 text-gray-700" data-label="Tarifa">
                              <div>{txt(d.tipo_habitacion) ?? "—"} · {txt(d.alimentacion) ?? "—"}</div>
                              <div className="flex flex-wrap items-center gap-1 text-gray-500">
                                {txt(d.temporada) ?? "—"}
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${promo ? "bg-[var(--brand-accent)]/15 text-[var(--brand-accent)]" : "bg-gray-100 text-gray-500"}`}>
                                  {promo ? "Promo" : "Base"}
                                </span>
                              </div>
                              {txt(d.temporada_base) && <div className="text-[10px] text-gray-400">desde {txt(d.temporada_base)}</div>}
                            </td>
                            <td className="px-2 py-1 text-gray-500" data-label="Vigencia en ese momento">
                              <div className="font-medium text-gray-700">{ESTADO_VERSION[vig.estado]}</div>
                              {vig.descuento && <div>Descuento {vig.descuento}</div>}
                              {vig.viaje.length > 0 && <div>Viaje: {vig.viaje.join(" · ")}</div>}
                              {vig.compra.length > 0 && <div>Compra: {vig.compra.join(" · ")}</div>}
                              {(vig.prioridad != null || vig.regimen) && (
                                <div className="text-[10px] text-gray-400">
                                  {vig.prioridad != null ? `P${vig.prioridad}` : ""}{vig.regimen ? ` · solo ${vig.regimen}` : ""}
                                </div>
                              )}
                              {vig.nota && <div className="text-[10px] text-amber-600">{vig.nota}</div>}
                            </td>
                            {precios.map(([k, l]) => {
                              const n = num(d[k]);
                              return <td key={k} className="px-2 py-1 text-right tabular-nums" data-label={l}>{n != null ? formatCOP(n) : "—"}</td>;
                            })}
                            <td className="px-2 py-1 text-right tabular-nums text-gray-500" data-label="Hoy (doble)">
                              {actual ? (actual.neto_doble != null ? formatCOP(Number(actual.neto_doble)) : "—") : <span className="text-gray-400">sin fila actual</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ResponsiveTableShell>
              )}
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
                <span>Mostrando {filas.length} de {total}.</span>
                {siguiente && (
                  <Button type="button" variant="outline" onClick={verMas} disabled={pending}>
                    {pending ? "Cargando…" : "Ver más"}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </details>
    </section>
  );
}
