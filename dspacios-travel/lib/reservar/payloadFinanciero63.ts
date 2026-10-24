// ─────────────────────────────────────────────────────────────────────────
// #63 — composición del payload financiero (costos + CxP) de una reserva en
// modo `cop_trm_63`. Módulo PURO (sin I/O): `reservarDesdeTarifarioInterno` lo
// usa para que `ventas.costo_*` (COP) y las CxP (moneda de origen + equivalente
// COP congelado) salgan de UNA sola definición.
//
//   · `ventas.costo_hotel`/`costo_receptivo` = Σ de los equivalentes en la moneda de la OFERTA (COP o USD, la del contrato).
//   · `ventas.costo_aereo` (N × pax con silla + F × menores de 2 años) se expresa en esa misma moneda desde el origen.
//   · Cada CxP conserva su valor y su moneda de ORIGEN (USD o COP) y lleva
//     `valor_cop` + `trm` (los escribe `registrar_financiero_contrato`, 227).
// ─────────────────────────────────────────────────────────────────────────

import { equivalenteCop63, equivalenteOferta63 } from "./importeObligacion63.ts";
import { redondearCentavos63 } from "./ofertaDinamica63.ts";

export type ObligacionOrigen63 = {
  /** Valor en la moneda de origen del proveedor (no el equivalente). */
  valor: number;
  moneda: "COP" | "USD";
};

/** Campos extra de una CxP del modo 63 (se suman a los de siempre). */
export function camposCxP63(o: ObligacionOrigen63, trm: number | null): { moneda: "COP" | "USD"; valor_cop: number | null; trm: number | null } {
  // Oferta en USD cotizada SIN TRM (todas sus fuentes en USD): la obligación en USD aún no tiene equivalente COP. La aceptación (234) congela la
  // TRM provisional y la base completa trm/valor_cop; hasta entonces no se inventa ninguna (ni 1 ni el nominal como pesos).
  if (o.moneda === "USD" && trm == null) return { moneda: o.moneda, valor_cop: null, trm: null };
  return { moneda: o.moneda, valor_cop: equivalenteCop63(o.valor, o.moneda, trm), trm };
}

/** Suma de equivalentes COP de varias obligaciones de origen. */
export function sumaEquivalentesCop63(obligaciones: readonly ObligacionOrigen63[], trm: number | null): number {
  let total = 0;
  for (const o of obligaciones) total += equivalenteCop63(o.valor, o.moneda, trm);
  return redondearCentavos63(total);
}

/**
 * Suma de varias obligaciones de origen expresada en la moneda de la OFERTA (`ventas.costo_hotel`/`costo_receptivo` del contrato): lo que
 * está en esa moneda entra exacto y lo demás se convierte con la TRM. Es la misma cifra que la suma de las CxP de ese tipo.
 */
export function sumaEquivalentesOferta63(obligaciones: readonly ObligacionOrigen63[], monedaOferta: unknown, trm: number | null): number {
  let total = 0;
  for (const o of obligaciones) total += equivalenteOferta63(o.valor, o.moneda, monedaOferta, trm);
  return redondearCentavos63(total);
}
