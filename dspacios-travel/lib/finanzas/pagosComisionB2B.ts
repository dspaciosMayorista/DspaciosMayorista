// Abonos/pagos parciales a comisiones B2B — reemplaza el modelo viejo de
// `aliados_b2b.estado`/`fecha_pago` (todo o nada) por un log ilimitado
// (`comision_b2b_pagos`, migración 131). Mismo patrón que `pagosCxp.ts`.

export type PagoComisionB2B = {
  id: number;
  aliado_b2b_id: number;
  fecha: string;
  valor: number;
};

export function sumarPagosPorAliado(
  pagos: { aliado_b2b_id: number; valor: number }[]
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const p of pagos) {
    out[p.aliado_b2b_id] = (out[p.aliado_b2b_id] ?? 0) + (Number(p.valor) || 0);
  }
  return out;
}

// Estado derivado (pendiente/parcial/pagada) de una comisión, comparando lo
// pagado contra el total a pagar. Tolerancia de 1 peso para no quedar en
// "parcial" por redondeo de porcentajes.
export function estadoComisionB2B(totalPagar: number, pagado: number): "pendiente" | "parcial" | "pagada" {
  if (totalPagar > 0 && pagado >= totalPagar - 1) return "pagada";
  if (pagado > 0) return "parcial";
  return "pendiente";
}
