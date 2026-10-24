// ─────────────────────────────────────────────────────────────────────────
// #63 — composición del payload financiero (costos + CxP) de una reserva en
// modo `cop_trm_63`. Módulo PURO (sin I/O): `reservarDesdeTarifarioInterno` lo
// usa para que `ventas.costo_*` (COP) y las CxP (moneda de origen + equivalente
// COP congelado) salgan de UNA sola definición.
//
//   · `ventas.costo_hotel`/`costo_receptivo` = Σ de los equivalentes en COP.
//   · `ventas.costo_aereo` (N × pax con silla + F × menores de 2 años) ya sale en COP del origen.
//   · Cada CxP conserva su valor y su moneda de ORIGEN (USD o COP) y lleva
//     `valor_cop` + `trm` (los escribe `registrar_financiero_contrato`, 227).
// ─────────────────────────────────────────────────────────────────────────

import { equivalenteCop63 } from "./importeObligacion63.ts";
import { redondearCentavos63 } from "./ofertaDinamica63.ts";

export type ObligacionOrigen63 = {
  /** Valor en la moneda de origen del proveedor (no el equivalente). */
  valor: number;
  moneda: "COP" | "USD";
};

/** Campos extra de una CxP del modo 63 (se suman a los de siempre). */
export function camposCxP63(o: ObligacionOrigen63, trm: number | null): { moneda: "COP" | "USD"; valor_cop: number; trm: number | null } {
  return { moneda: o.moneda, valor_cop: equivalenteCop63(o.valor, o.moneda, trm), trm };
}

/** Suma de equivalentes COP de varias obligaciones de origen. */
export function sumaEquivalentesCop63(obligaciones: readonly ObligacionOrigen63[], trm: number | null): number {
  let total = 0;
  for (const o of obligaciones) total += equivalenteCop63(o.valor, o.moneda, trm);
  return redondearCentavos63(total);
}
