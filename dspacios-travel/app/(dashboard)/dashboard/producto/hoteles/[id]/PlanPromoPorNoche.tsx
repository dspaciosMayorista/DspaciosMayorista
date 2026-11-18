"use client";
// #125 — Vista previa FECHADA de una promoción por noche: qué base gana en cada tramo de noches, el % aplicable, la tarifa de adulto (por persona) con y sin
// promoción y, si la promoción incluye «un niño gratis por habitación», qué paga cada niño. Solo presenta lo que calculó `planPromoPorNoche`
// (lib/calc/promoCalculadora.ts, acotado a 60 tramos): no calcula precios ni hace solicitudes.
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { formatNetoTarifa } from "@/lib/hoteles/tarifasVista";
import { formatFechaLarga } from "@/lib/utils";
import type { EstadoTramoPlan, PlanPromoPorNoche as Plan } from "@/lib/calc/promoCalculadora";

const ESTADO: Record<EstadoTramoPlan, string> = {
  ok: "Aplica",
  sin_base: "Sin temporada base",
  base_empatada: "Empate de prioridad entre bases",
  prioridad_insuficiente: "La promoción no supera la prioridad de la base",
  sin_valor_base: "La base no tiene tarifa",
};

const rangoNoches = (d: string, h: string) => (d === h ? formatFechaLarga(d) : `${formatFechaLarga(d)} → ${formatFechaLarga(h)}`);

export function PlanPromoPorNoche({ plan, moneda, titulo, baseUnica, conPrecios = true }: {
  plan: Plan; moneda?: string | null; titulo?: string;
  /** Promoción vinculada a UNA base: las noches de otra base se muestran sin promoción. */
  baseUnica?: string | null;
  /** false = la base se vende por grupos de días: se muestran base y % sin importes. */
  conPrecios?: boolean;
}) {
  if (!plan.tramos.length) {
    return <p className="rounded-md bg-gray-50 p-2 text-xs text-gray-500" data-plan-promo="vacio">La promoción no tiene noches de viaje cargadas para este régimen.</p>;
  }
  const conNino = plan.tramos.some((t) => t.ninoGratis);
  return (
    <div className="space-y-2" data-plan-promo={plan.todoOk ? "ok" : "revisar"}>
      {titulo && <h4 className="text-xs font-semibold text-gray-600">{titulo}</h4>}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 text-xs">
        {plan.tramos.map((t) => {
          const ajena = !!baseUnica && t.estado === "ok" && t.base !== baseUnica;
          const aplica = t.estado === "ok" && !ajena;
          return (
            <li key={`${t.desde}-${t.estado}-${t.base ?? ""}`} className="space-y-0.5 p-2" data-tramo-plan={t.estado} data-ajena={ajena || undefined}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {aplica
                  ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--brand-success)]" aria-hidden />
                  : ajena ? <Info className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />}
                <b className="text-gray-700">{rangoNoches(t.desde, t.hasta)}</b>
                <span className="text-gray-400">({t.noches} {t.noches === 1 ? "noche" : "noches"})</span>
                {t.base && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">Base {t.base}</span>}
              </div>
              {aplica && (
                <p className="text-gray-600">
                  <span className="font-medium text-[var(--brand-success)]">−{t.pct}%</span>
                  {conPrecios && t.netoBase != null && t.netoPromo != null && (
                    <> · Adulto por persona y noche: {formatNetoTarifa(t.netoBase, moneda)} → <b>{formatNetoTarifa(t.netoPromo, moneda)}</b></>
                  )}
                  {t.ninoGratis && <span className="ml-1 rounded-full bg-[var(--brand-highlight)]/25 px-2 py-0.5 text-[10px] text-gray-700">1 niño gratis por habitación</span>}
                </p>
              )}
              {aplica && t.ninoGratis && conPrecios && t.netoNinoBase != null && t.netoNinoPromo != null && (
                <p className="text-gray-500">Niño adicional (el segundo en la habitación): {formatNetoTarifa(t.netoNinoBase, moneda)} → {formatNetoTarifa(t.netoNinoPromo, moneda)} por noche; el primero no paga alojamiento.</p>
              )}
              {ajena && <p className="text-gray-500">La promoción solo actúa sobre su base vinculada: esta noche se vende a la tarifa de {t.base}.</p>}
              {!aplica && !ajena && <p className="text-amber-700">{ESTADO[t.estado]}{t.detalle ? ` — ${t.detalle}` : ""}</p>}
            </li>
          );
        })}
      </ul>
      {plan.truncado && <p className="text-[11px] text-amber-700">Hay más tramos de los que se muestran; revisa las fechas de la promoción.</p>}
      {conNino && <p className="text-[11px] text-gray-500">Un niño gratis por habitación aplica solo a habitaciones con al menos 2 adultos; el infante conserva su tarifa base. El importe real se calcula al cotizar, habitación por habitación.</p>}
    </div>
  );
}
