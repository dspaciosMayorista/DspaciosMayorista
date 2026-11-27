// NETA-05/06 — presentación de costos en USD con su TRM de costos PROVISIONAL. Módulo PURO (sin I/O).
//
// Reglas que fija (dueño, revisión consolidada 2026-11-26):
//   · un costo en USD se muestra SIEMPRE en su moneda de origen («USD $200.00»), nunca como pesos;
//   · su equivalente en pesos es una estimación de costeo mientras el contrato esté pendiente («provisional») y queda congelado al confirmar;
//   · sin TRM de costos se dice «TRM de costos pendiente» (nunca se infiere una);
//   · monedas distintas NUNCA se suman como si fueran una: los totales se dan por moneda, y el equivalente en pesos solo se suma entre los que lo tienen.
// La TRM de costeo es distinta de la TRM del pago real (`cxp_pagos.trm`, #63) y de la de cobro (`ventas.trm_cobro`).
import { formatCOP, formatMonedaDocumento } from "@/lib/utils";

export type CostoOrigen = { moneda: string | null | undefined; valor: number; trm?: number | null; valorCop?: number | null };
export type EstadoCosto = "cop" | "usd_con_trm" | "usd_sin_trm";

const esUsd = (m: string | null | undefined) => (m ?? "COP").toUpperCase() === "USD";

export function estadoCosto(c: CostoOrigen): EstadoCosto {
  if (!esUsd(c.moneda)) return "cop";
  return c.trm != null && c.trm > 0 && c.valorCop != null ? "usd_con_trm" : "usd_sin_trm";
}

/** «USD $200.00» o «$ 780.000»: el importe en la moneda en que se debe. */
export const importeOrigen = (c: Pick<CostoOrigen, "moneda" | "valor">) => formatMonedaDocumento(Number(c.valor) || 0, c.moneda);

export const formatoTrm = (trm: number) => `$${trm.toLocaleString("es-CO", { maximumFractionDigits: 4 })}`;

/** Texto del equivalente: «≈ $ 780.000 a TRM de costos $3.900 (provisional)»; sin TRM, «TRM de costos pendiente». `null` si el costo no está en USD. */
export function textoEquivalente(c: CostoOrigen, fase: "provisional" | "congelada" = "provisional"): string | null {
  const e = estadoCosto(c);
  if (e === "cop") return null;
  if (e === "usd_sin_trm") return "TRM de costos pendiente";
  return `≈ ${formatCOP(Number(c.valorCop))} a TRM de costos ${formatoTrm(Number(c.trm))} (${fase})`;
}

export type TotalMoneda = { moneda: "COP" | "USD"; total: number; filas: number; equivalenteCop: number | null; sinTrm: number };

/** Totales POR MONEDA. El equivalente en pesos de los USD solo existe si TODAS sus filas lo tienen; si falta alguna, queda `null` y `sinTrm` cuenta cuántas. */
export function totalesPorMoneda(filas: readonly CostoOrigen[]): TotalMoneda[] {
  const out = new Map<"COP" | "USD", TotalMoneda>();
  for (const f of filas) {
    const m = esUsd(f.moneda) ? "USD" : "COP";
    const t = out.get(m) ?? { moneda: m, total: 0, filas: 0, equivalenteCop: m === "USD" ? 0 : null, sinTrm: 0 };
    t.total = Math.round((t.total + (Number(f.valor) || 0)) * 100) / 100;
    t.filas += 1;
    if (m === "USD") {
      if (estadoCosto(f) === "usd_con_trm" && t.equivalenteCop != null) t.equivalenteCop = Math.round((t.equivalenteCop + Number(f.valorCop)) * 100) / 100;
      else { t.sinTrm += 1; t.equivalenteCop = null; }
    }
    out.set(m, t);
  }
  return [...out.values()].sort((a, b) => (a.moneda === b.moneda ? 0 : a.moneda === "COP" ? -1 : 1));
}

/** TRM de costos común de un conjunto de obligaciones en USD con TRM, o `null` si no hay ninguna o no coinciden (a 4 decimales). */
export function trmComun(filas: readonly CostoOrigen[]): number | null {
  const trms = filas.filter((f) => estadoCosto(f) === "usd_con_trm").map((f) => Math.round(Number(f.trm) * 10000) / 10000);
  if (!trms.length) return null;
  return trms.every((t) => t === trms[0]) ? trms[0] : null;
}
