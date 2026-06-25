// Liquidación de la facturación de un contrato (módulo Contabilidad).
//
// Configurada MANUALMENTE por contrato. Se parte el PVP en:
//   · irt            = Ingreso Recibido para Terceros (hoteles/aerolíneas). No
//                      provisiona ni genera IVA: la empresa solo intermedia.
//   · ingreso propio = lo que factura la empresa por su intermediación, y se
//                      subdivide en:
//        - base gravable  (lleva IVA, incluido) = PVP − IRT − ingreso_exento
//        - ingreso_exento (NO lleva IVA: exento o excluido)
//     ⇒ ingreso propio = base gravable + ingreso_exento = PVP − IRT.
//
// El IVA se liquida sobre la base gravable (IVA incluido): iva = bg − bg/(1+iva).
// Las provisiones de rentabilidad se calculan sobre el ingreso propio.

export type FacturacionInput = {
  pvp: number;
  irt: number;
  ingresoExento: number;
};

export type FacturacionLiquidada = {
  irt: number;
  ingresoExento: number;
  baseGravable: number;  // porción gravable (IVA incluido) = PVP − IRT − exento
  ingresoPropio: number; // base gravable + exento = PVP − IRT
  baseNeta: number;      // base gravable sin IVA = baseGravable/(1+iva)
  ivaGenerado: number;   // IVA de la base gravable
};

export function liquidarFacturacion(i: FacturacionInput, ivaPct = 0.19): FacturacionLiquidada {
  const pvp = Math.max(0, Number(i.pvp) || 0);
  const irt = Math.max(0, Number(i.irt) || 0);
  const ingresoExento = Math.max(0, Number(i.ingresoExento) || 0);
  const baseGravable = Math.max(0, pvp - irt - ingresoExento);
  const ingresoPropio = baseGravable + ingresoExento; // = PVP − IRT
  const baseNeta = baseGravable / (1 + ivaPct);
  const ivaGenerado = baseGravable - baseNeta;
  return { irt, ingresoExento, baseGravable, ingresoPropio, baseNeta, ivaGenerado };
}
