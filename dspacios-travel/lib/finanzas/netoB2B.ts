// #30 — Contratos B2B en NETO: una sola lectura de "PVP original / descuento
// de comisión / total exigible".
//
// En NETO el comprador B2B (agencia o freelance) paga el PVP MENOS su comisión,
// ya descontada: `ventas.precio_venta` guarda el TOTAL EXIGIBLE (lo que cobra
// D'spacios), `ventas.comision_b2b` el descuento y `ventas.comision_estado` =
// 'descontada' (mismo marcador que usan #38 y la migración 205 para impedir
// una segunda comisión). El PVP original no se guarda aparte en `ventas`: es
// total exigible + descuento, y además queda congelado en la fila de
// `aliados_b2b` que crea la base (`precio_venta` = bruto, `descontada_en_precio`).
//
// Quién usa qué: los documentos externos (contrato, estado de cuenta) y la
// facturación usan el total exigible (`precio_venta`), nunca el PVP ni la
// comisión del aliado; el desglose completo solo lo ven roles internos
// autorizados (editor de contenido del contrato, superadmin).
//
// Solo lectura: nada aquí recalcula ni reescribe contratos. Un contrato que no
// esté en NETO no tiene desglose (null) y se trata exactamente como siempre.

export type VentaNetoCampos = {
  precio_venta?: number | string | null;
  impuesto?: number | string | null;
  comision_b2b?: number | string | null;
  comision_estado?: string | null;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** ¿La comisión B2B ya se descontó del precio (contrato NETO)? */
export function esVentaNetoDescontada(v: Pick<VentaNetoCampos, "comision_estado"> | null | undefined): boolean {
  return v?.comision_estado === "descontada";
}

export type DesgloseNetoB2B = {
  /** PVP antes del descuento (= total exigible + descuento). */
  pvpOriginal: number;
  /** Comisión del aliado descontada del precio. */
  descuentoComision: number;
  /** Lo que se le cobra al comprador (ventas.precio_venta). */
  totalExigible: number;
};

/** Desglose de un contrato NETO; null si el contrato no está en NETO. */
export function desgloseNetoB2B(v: VentaNetoCampos | null | undefined): DesgloseNetoB2B | null {
  if (!v || !esVentaNetoDescontada(v)) return null;
  const totalExigible = Math.max(0, num(v.precio_venta));
  const descuentoComision = Math.max(0, num(v.comision_b2b));
  return { pvpOriginal: totalExigible + descuentoComision, descuentoComision, totalExigible };
}
