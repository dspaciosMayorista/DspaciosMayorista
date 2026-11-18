// #102 — Desglose COMPACTO adulto / menores / total de un resultado de la búsqueda general (tarjeta de Vista
// Booking y filas de la Vista tabla). No calcula nada: pinta las líneas que el servidor ya armó con los mismos
// números que forman el total (`ComboBusqueda.desglose`), así lo mostrado es lo que se cobra al reservar.
import { ACOM_ROOM_LABEL } from "@/lib/acomodaciones";
import type { LineaDesglose } from "@/lib/reservar/asignacionHabitacionesBusqueda";
import type { ComboBusqueda } from "@/lib/reservar/cotizar";
import { formatMoneda } from "@/lib/utils";

const CLASE: Record<"infante" | "nino" | "nino2", string> = { infante: "Infante", nino: "Niño 1", nino2: "Niño 2" };

function textoEdades(edades?: number[]): string {
  if (!edades?.length) return "";
  const u = [...edades].sort((a, b) => a - b);
  const lista = u.length === 1 ? String(u[0]) : `${u.slice(0, -1).join(", ")} y ${u[u.length - 1]}`;
  return ` · ${lista} ${u.length === 1 && u[0] === 1 ? "año" : "años"}`;
}

/** Etiqueta de una línea del desglose (puro: se prueba sin DOM). */
export function etiquetaLinea(l: LineaDesglose): string {
  if (l.clase === "adulto") {
    const acom = l.acomodaciones?.length ? ` (${l.acomodaciones.map((a) => ACOM_ROOM_LABEL[a]).join(" + ")})` : "";
    return `${l.cantidad === 1 ? "Adulto" : "Adultos"}${acom}`;
  }
  if (l.clase === "servicio_grupo") return "Servicios incluidos por grupo";
  const m2 = l.menorDeDos && l.clase !== "infante" ? " (menor de 2 años)" : "";
  return `${CLASE[l.clase]}${m2}${textoEdades(l.edades)}`;
}

/**
 * #125 × #102: lo que el visitante necesita saber de un niño con beneficio (puro). `tarifa` de la línea ya es lo que se PAGA; la tarifa regular es la
 * de la clase sin promoción (`tarifa + condonado`). Un beneficio sin importe condonado no se anuncia (promoción que no aplica a esa estadía/noche).
 * «Niño gratis» solo cuando de verdad no paga nada; si aún paga (noches fuera de la promoción, servicios o cargos retenidos) se dice que solo el alojamiento promocionado es gratis.
 */
export function beneficioNino(l: LineaDesglose): { regular: number; gratisTotal: boolean; promociones: string[] } | null {
  if (!l.gratis || !(l.gratis.condonado > 0.005)) return null;
  return {
    regular: Math.round((l.tarifa + l.gratis.condonado) * 100) / 100,
    gratisTotal: l.tarifa < 0.005,
    promociones: l.gratis.promociones.filter((p) => p && p.trim()),
  };
}

/** Texto explicativo (sin aritmética): «Niño gratis» o la aclaración del beneficio parcial. */
export function textoNinoGratis(l: LineaDesglose): string | null {
  const b = beneficioNino(l);
  if (!b) return null;
  const promo = b.promociones.length ? ` · ${b.promociones.join(", ")}` : "";
  return b.gratisTotal
    ? `Niño gratis${promo}`
    : `Alojamiento gratis solo en las noches de la promoción${promo}; las demás noches y los servicios o cargos retenidos se pagan`;
}

/** Nota bajo la línea del niño: «Tarifa regular» tachada + explicación. La tarifa a pagar la muestra la propia línea. */
export function NotaNinoGratis({ l, moneda, className = "" }: { l: LineaDesglose; moneda: string; className?: string }) {
  const b = beneficioNino(l);
  if (!b) return null;
  return (
    <p className={`text-[10px] leading-snug text-emerald-700 ${className}`} data-nino-gratis>
      Tarifa regular <s className="tabular-nums text-slate-500" data-tarifa-regular>{formatMoneda(b.regular, moneda)}</s> · {textoNinoGratis(l)}
    </p>
  );
}

export function DesgloseTarifas({ combo, moneda, noches, etiquetaBase, compacto = true }: {
  combo: Pick<ComboBusqueda, "desglose" | "total" | "resumenHabitaciones" | "edadesComoAdulto">;
  moneda: string;
  noches: number;
  /** Base de precio mostrada sobre el desglose; por defecto «por persona · estadía de N noches». */
  etiquetaBase?: string;
  compacto?: boolean;
}) {
  const lineas = combo.desglose ?? [];
  if (!lineas.length) return null;
  return (
    <div className={`rounded-lg border border-slate-100 bg-slate-50 ${compacto ? "px-2.5 py-2" : "px-3 py-2.5"}`} data-testid="desglose-tarifas">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {etiquetaBase ?? `Tarifa por persona · estadía de ${noches} noche${noches === 1 ? "" : "s"}`}
      </p>
      <dl className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
        {lineas.map((l, i) => (
          <div key={i} className="contents" data-clase={l.clase}>
            <dt className="min-w-0 truncate" title={etiquetaLinea(l)}>
              {l.clase !== "servicio_grupo" && <span className="tabular-nums text-slate-400">{l.cantidad}× </span>}{etiquetaLinea(l)}
            </dt>
            <dd className="text-right tabular-nums text-slate-500">{l.clase === "servicio_grupo" ? "" : `${formatMoneda(l.tarifa, moneda)} c/u`}</dd>
            <dd className="text-right font-medium tabular-nums text-slate-700">{formatMoneda(l.subtotal, moneda)}</dd>
            {beneficioNino(l) && <dd className="col-span-3 -mt-0.5"><NotaNinoGratis l={l} moneda={moneda} /></dd>}
          </div>
        ))}
        <dt className="col-span-2 border-t border-slate-200 pt-1 font-semibold text-slate-800">Total de la reserva</dt>
        <dd className="border-t border-slate-200 pt-1 text-right font-bold tabular-nums" style={{ color: "var(--brand-primary)" }}>{formatMoneda(combo.total, moneda)}</dd>
      </dl>
      {(combo.resumenHabitaciones || combo.edadesComoAdulto?.length) ? (
        <p className="mt-1 text-[10px] leading-snug text-slate-500">
          {combo.resumenHabitaciones ? <>Habitaciones evaluadas: <b>{combo.resumenHabitaciones}</b>. </> : null}
          {combo.edadesComoAdulto?.length ? <>Este hotel cobra como adulto a quien tiene {textoEdades(combo.edadesComoAdulto).replace(" · ", "")}; su edad real se conserva.</> : null}
        </p>
      ) : null}
    </div>
  );
}
