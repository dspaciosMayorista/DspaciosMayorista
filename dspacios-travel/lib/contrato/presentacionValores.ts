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
//   · ÚNICA excepción (#53, hallazgo reproducido con el importador de histórico de
//     Minorista, que guarda ventas/abonos/CxP pero NINGÚN ítem): un contrato SIN
//     NINGUNA línea de ítem y con precio de venta registrado. Sumar cero ítems
//     imprimía «Total $0» y «Saldo $0» aunque el contrato valiera, p. ej.,
//     $3.000.000 con $1.000.000 pagados. Ahí el total es el precio registrado y
//     el documento lo DICE; nunca se inventa un desglose por ítem.

export type PresentacionValoresContrato = {
  total: number;
  saldo: number;
  mostrarValoresItems: boolean;
  /** true = no hay ninguna línea de ítem y el total es el precio de venta registrado (el documento debe decirlo). */
  sinDetalleItems: boolean;
};

export function presentacionValoresContrato(args: {
  totalItems: number;
  totalPagado: number;
  /** Cantidad de líneas de ítem del contrato (no su suma). Solo si es 0 junto con un `precioRegistrado` > 0 se usa el precio registrado. */
  cantidadItems?: number;
  /** `ventas.precio_venta` en la moneda del documento. */
  precioRegistrado?: number | null;
  /** null/undefined = no es un contrato NETO (o no se sabe: modo cotización). */
  netoTotalExigible?: number | null;
}): PresentacionValoresContrato {
  const pagado = Number(args.totalPagado) || 0;
  const neto = args.netoTotalExigible;
  if (neto == null || !Number.isFinite(Number(neto))) {
    const sinDetalleItems = args.cantidadItems === 0 && Number(args.precioRegistrado) > 0;
    const total = sinDetalleItems ? Number(args.precioRegistrado) : Number(args.totalItems) || 0;
    return { total, saldo: Math.max(total - pagado, 0), mostrarValoresItems: true, sinDetalleItems };
  }
  const total = Math.max(0, Number(neto));
  return { total, saldo: Math.max(total - pagado, 0), mostrarValoresItems: false, sinDetalleItems: false };
}
