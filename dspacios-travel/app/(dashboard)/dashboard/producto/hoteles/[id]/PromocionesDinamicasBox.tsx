"use client";
// #43/#60 — «Tarifas generadas»: promociones dinámicas por grupo explicadas, SOLO LECTURA. Los importes los calcula
// `promocionesDinamicasHotel` en el servidor con la misma cuenta del motor; aquí solo se reorganizan (patrón del tarifario: una
// tarjeta por categoría y «Ver tarifas» con el detalle por alimentación y acomodación). Abrir el detalle no consulta nada.
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { agruparPromoPorCategoria, formatNetoTarifa, textoCuentaPromo, type CategoriaPromo } from "@/lib/hoteles/tarifasVista";
import { ETIQUETA_UNIDAD } from "@/lib/calc/promocionesGrupo";
import type { LineaPromoDinamica, PromoDinamica } from "@/lib/hoteles/promocionesDinamicas";

type Detalle = { promo: PromoDinamica; vigencia: string; categoria: CategoriaPromo<LineaPromoDinamica> };

const textoTipo = (p: PromoDinamica) => (p.tipo === "descuento_pct" ? "descuento %" : `descuento ${p.unidad ? ETIQUETA_UNIDAD[p.unidad].toLowerCase() : "en monto"}`);

export function PromocionesDinamicasBox({ promos, moneda }: { promos: PromoDinamica[] | null; moneda: string }) {
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  if (promos === null) {
    return <p className="text-xs text-gray-500" data-promos-dinamicas="sin-permiso">Las promociones dinámicas se explican con netos (costo del proveedor): se muestran solo a los roles que ven costos.</p>;
  }
  if (!promos.length) return null;
  const fmt = (n: number) => formatNetoTarifa(n, moneda);
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4" data-promos-dinamicas="lista" aria-labelledby="titulo-promos-dinamicas">
      <h3 id="titulo-promos-dinamicas" className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-primary)]">
        <Sparkles className="h-4 w-4" aria-hidden /> Promociones dinámicas por grupo
      </h3>
      <p className="mt-1 text-xs text-gray-500">
        Solo lectura. Estas promociones no tienen tarifa propia: el neto se calcula al cotizar desde la tarifa base de su grupo, así
        que cambiar la base cambia el resultado. Son <b>netos</b> (costo del proveedor); el PVP depende del markup de cada paquete y se ve en el tarifario.
      </p>
      <div className="mt-3 space-y-5">
        {promos.map((p) => (
          <div key={p.id} data-promo-dinamica={p.nombre}>
            <p className="text-sm font-medium text-gray-800">
              {p.nombre} <span className="text-xs font-normal text-gray-500">· prioridad {p.prioridad} · {textoTipo(p)}</span>
              {p.estado === "no_vende" && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">No se vende</span>}
            </p>
            {p.motivo && <p className="text-xs text-amber-700">{p.motivo}</p>}
            {p.lineas.length === 0 ? (
              <p className="text-xs text-gray-500">Su base todavía no tiene tarifa en los grupos con regla: no hay nada que calcular.</p>
            ) : agruparPromoPorCategoria(p.lineas).map((b) => {
              const vigencia = `${b.base} · ${b.grupo}${b.dias ? ` (${b.dias})` : ""}`;
              return (
                <div key={b.clave} className="mt-2" data-bloque-promo={vigencia}>
                  <p className="text-xs font-medium text-gray-600">Vigencia base y grupo: {vigencia}</p>
                  <ul className="mt-1 grid gap-2 sm:grid-cols-2">
                    {b.categorias.map((c) => (
                      <li key={c.categoria} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 p-3" data-categoria-promo={c.categoria}>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-800">{c.categoria}</p>
                          <p className="text-[11px] text-gray-500">{c.regimenes.map((r) => r.regimen).join(" · ")} · {c.tarifas} tarifa{c.tarifas === 1 ? "" : "s"}</p>
                          {c.desdePorPersona != null && (
                            <p className="text-xs text-gray-700">desde <b className="text-[var(--brand-primary)]">{fmt(c.desdePorPersona)}</b> por persona</p>
                          )}
                        </div>
                        <button type="button" onClick={() => setDetalle({ promo: p, vigencia, categoria: c })}
                          aria-label={`Ver tarifas de ${c.categoria} · ${p.nombre}`}
                          className="shrink-0 rounded-lg border border-[var(--brand-accent)] px-3 py-1.5 text-xs font-medium text-[var(--brand-primary)] hover:bg-[var(--brand-accent)]/10">
                          Ver tarifas
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Modal compartido (base-ui): cierra con la X y con Escape, atrapa el foco y lo devuelve al botón. */}
      <Dialog open={detalle != null} onOpenChange={(o) => { if (!o) setDetalle(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" data-detalle-promo>
          {detalle && (
            <>
              <DialogHeader>
                <DialogTitle>{detalle.promo.nombre} · {detalle.categoria.categoria}</DialogTitle>
                <DialogDescription>
                  {detalle.vigencia} · {textoTipo(detalle.promo)}{detalle.promo.estado === "no_vende" ? " · no se vende" : ""}. Netos (costo del proveedor).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {detalle.categoria.regimenes.map((r) => (
                  <section key={r.regimen} data-regimen-promo={r.regimen}>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Alimentación {r.regimen}</h4>
                    <ul className="mt-1 divide-y divide-gray-100">
                      {r.lineas.map((l) => (
                        <li key={l.acomodacion} className="py-1.5 text-xs text-gray-700" data-linea-promo>
                          <b>{l.acomodacion}:</b>{" "}
                          <span className={l.netoResultante != null ? "text-gray-800" : "text-gray-500"}>{textoCuentaPromo(l, detalle.promo.tipo, detalle.promo.unidad, fmt)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
