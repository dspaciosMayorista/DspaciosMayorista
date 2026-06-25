// Liquidación de la facturación de un contrato (módulo Contabilidad).
//
// Dos naturalezas de ingreso configuradas MANUALMENTE por contrato:
//   · irt            = Ingreso Recibido para Terceros (hoteles/aerolíneas). No
//                      provisiona ni genera IVA propio: la empresa solo intermedia.
//   · ingreso_propio = ingreso por intermediación. Si "lleva IVA", el valor trae
//                      el IVA incluido → base = valor/(1+iva), iva = valor − base.
//
// Las provisiones de rentabilidad se calculan sobre el INGRESO PROPIO (base
// gravable + iva), nunca sobre el IRT.

export type FacturacionConfig = {
  irt: number;
  ingreso_propio: number;
  lleva_iva: boolean;
};

export type FacturacionLiquidada = {
  irt: number;
  ingresoPropio: number;
  baseGravable: number; // ingreso propio sin IVA
  ivaGenerado: number;  // IVA del ingreso propio (0 si no lleva IVA)
  total: number;        // irt + ingreso propio
};

export function liquidarFacturacion(c: FacturacionConfig, ivaPct = 0.19): FacturacionLiquidada {
  const irt = Math.max(0, Number(c.irt) || 0);
  const ingresoPropio = Math.max(0, Number(c.ingreso_propio) || 0);
  const baseGravable = c.lleva_iva ? ingresoPropio / (1 + ivaPct) : ingresoPropio;
  const ivaGenerado = c.lleva_iva ? ingresoPropio - baseGravable : 0;
  return { irt, ingresoPropio, baseGravable, ivaGenerado, total: irt + ingresoPropio };
}
