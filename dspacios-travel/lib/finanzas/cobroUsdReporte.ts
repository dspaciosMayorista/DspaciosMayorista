// #126-A — qué contratos en USD tienen su equivalente en pesos todavía PROVISIONAL (saldo en USD sin cobrar). Módulo PURO.
// Un contrato con saldo 0 USD ya tiene su total real en pesos (suma de monto_cop); con saldo > 0 el total en COP mezcla lo cobrado
// con una estimación del saldo y no debe presentarse como cifra final.
import { centavos, TOLERANCIA_USD } from "./pagoUsd.ts";

export type VentaUsdReporte = { numero_contrato: string; moneda?: string | null; precio_venta?: number | string | null; moneda_cobro?: string | null };
export type AbonoReporte = { numero_contrato: string; valor_abono?: number | string | null };

export function contratosUsdProvisionales(ventas: readonly VentaUsdReporte[], abonos: readonly AbonoReporte[]): Set<string> {
  const abonado = new Map<string, number>();
  for (const a of abonos) abonado.set(a.numero_contrato, (abonado.get(a.numero_contrato) ?? 0) + (Number(a.valor_abono) || 0));
  const res = new Set<string>();
  for (const v of ventas) {
    if ((v.moneda ?? "COP").toUpperCase() !== "USD") continue;
    // Oferta USD cobrada en COP con un total congelado (modo #90 F, anterior): su total en pesos está FIJADO por acuerdo; no es provisional.
    if (v.moneda_cobro != null && v.moneda_cobro.toUpperCase() === "COP") continue;
    const saldo = centavos((Number(v.precio_venta) || 0) - (abonado.get(v.numero_contrato) ?? 0));
    if (saldo > TOLERANCIA_USD) res.add(v.numero_contrato);
  }
  return res;
}

export const AVISO_COP_PROVISIONAL =
  "COP provisional: el contrato en USD aún tiene saldo por cobrar; lo ya cobrado está a la TRM de cada pago y el resto se estima. El total en pesos será definitivo cuando el saldo en USD llegue a 0.";
