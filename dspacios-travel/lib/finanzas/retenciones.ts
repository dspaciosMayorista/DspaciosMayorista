// Retenciones (retefuente) practicadas a proveedores sobre una cuenta por
// pagar — se descuentan del saldo pendiente igual que un abono, pero la
// plata no sale a el proveedor: la agencia la retiene para declararla/
// pagarla a la DIAN en el mes indicado (`mes_declaracion`).

export function sumarRetencionesPorCuenta(
  retenciones: { cuenta_por_pagar_id: number; valor: number }[]
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const r of retenciones) {
    out[r.cuenta_por_pagar_id] = (out[r.cuenta_por_pagar_id] ?? 0) + (Number(r.valor) || 0);
  }
  return out;
}
