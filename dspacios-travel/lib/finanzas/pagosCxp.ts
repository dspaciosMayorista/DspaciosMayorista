// Pagos a proveedor sobre una cuenta por pagar — reemplaza el modelo viejo de
// abono1/abono2/abono3 (máximo 3 pagos por cuenta, migración 097) por un log
// ilimitado (`cxp_pagos`, migración 130). Mismo patrón que
// `lib/finanzas/retenciones.ts::sumarRetencionesPorCuenta`.

export type PagoCxP = {
  id: number;
  cuenta_por_pagar_id: number;
  fecha: string;
  valor: number;
  trm: number | null;
};

export function sumarPagosPorCuenta(
  pagos: { cuenta_por_pagar_id: number; valor: number }[]
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const p of pagos) {
    out[p.cuenta_por_pagar_id] = (out[p.cuenta_por_pagar_id] ?? 0) + (Number(p.valor) || 0);
  }
  return out;
}

// Total pagado en PESOS (aplica la TRM de cada pago — útil para flujo de caja/
// estados financieros, donde una CxP en USD igual se pagó en pesos reales).
export function sumarPagosCopPorCuenta(
  pagos: { cuenta_por_pagar_id: number; valor: number; trm: number | null }[]
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const p of pagos) {
    const cop = (Number(p.valor) || 0) * (Number(p.trm) || 1);
    out[p.cuenta_por_pagar_id] = (out[p.cuenta_por_pagar_id] ?? 0) + cop;
  }
  return out;
}
