// #30 — Qué total, qué saldo y qué valores por ítem muestra el documento del
// contrato (`ContratoDocumento`).
//
// Incidencia vigente desde #38: el documento sumaba los ítems (que se guardan a
// PVP) como "Total del contrato" y calculaba el saldo contra esa suma. En un
// contrato NETO el comprador B2B debe `ventas.precio_venta` (PVP − su comisión),
// así que el documento le mostraba —y le cobraba— el PVP completo, contra el
// estado de cuenta, que sí usa `precio_venta`.
//
// Regla:
//   · Contrato NETO → total y saldo salen del TOTAL EXIGIBLE (`precio_venta`).
//     Los valores originales por ítem (a PVP) no se imprimen: junto al total
//     neto revelarían la comisión del aliado. El documento distribuye el total
//     exigible entre los ítems por separado (`valoresNetosDocumento`); este
//     helper conserva la señal para distinguir ambas fuentes.
//   · Cualquier otro contrato → EXACTAMENTE lo de siempre (suma de ítems): no
//     se cambia la presentación de contratos históricos ni de venta directa.

export type PresentacionValoresContrato = {
  total: number;
  saldo: number;
  mostrarValoresItems: boolean;
};

export function presentacionValoresContrato(args: {
  totalItems: number;
  totalPagado: number;
  /** null/undefined = no es un contrato NETO (o no se sabe: modo cotización). */
  netoTotalExigible?: number | null;
}): PresentacionValoresContrato {
  const pagado = Number(args.totalPagado) || 0;
  const neto = args.netoTotalExigible;
  if (neto == null || !Number.isFinite(Number(neto))) {
    const total = Number(args.totalItems) || 0;
    return { total, saldo: Math.max(total - pagado, 0), mostrarValoresItems: true };
  }
  const total = Math.max(0, Number(neto));
  return { total, saldo: Math.max(total - pagado, 0), mostrarValoresItems: false };
}
