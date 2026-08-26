// Un contrato DTM- (mayorista, migración 159) nunca recicla su consecutivo:
// esa numeración usa una secuencia dedicada (contrato_seq_mayorista) que
// nunca lee de numeros_contrato_liberados. eliminar_contrato() ya lo
// rechaza en el servidor (candado real) — esta función pura solo decide si
// la UI debe SIQUIERA ofrecer la opción de reciclar.
export function esNumeroReciclable(numero: string): boolean {
  return !numero.startsWith("DTM-");
}
