// ─────────────────────────────────────────────────────────────────────────
// Fase 3F-4B — helper PURO compartido para leer el valor visible de una fila
// de `contrato_items` (migración 176: `modo_precio`/`valor_total`).
//
// ÚNICA fuente de esta fórmula — antes cada consumidor (`ContratoDocumento.tsx`,
// `ContenidoContratoEditor.tsx`) reimplementaba inline `adultos * tarifa_adulto
// + ninos * tarifa_nino`, que es CORRECTO solo para `modo_precio = "por_persona"`
// (el único que existía hasta esta fase). Una fila `modo_precio = "total"`
// (Bernalo — tarifa por habitación, comisión aplicada una sola vez al total,
// nunca por columna) tiene esas 4 columnas per-cápita en su default (0), así
// que la fórmula vieja sumaría $0 para esa línea — este helper es el único
// punto que decide cuál de las dos fórmulas aplica.
// ─────────────────────────────────────────────────────────────────────────

export type ContratoItemValor = {
  modo_precio: string;
  valor_total: number | null;
  adultos: number;
  ninos: number;
  tarifa_adulto: number;
  tarifa_nino: number;
};

/**
 * Valor visible de UNA fila de `contrato_items`:
 *   · `modo_precio === "total"` → `valor_total` (nunca se recompone desde
 *     adultos/ninos/tarifa_adulto/tarifa_nino, que en este modo NO son
 *     autoridad — ver el CHECK de la migración 176).
 *   · cualquier otro valor (el default histórico `"por_persona"`, o un dato
 *     legado sin la columna) → `adultos × tarifa_adulto + ninos × tarifa_nino`,
 *     EXACTAMENTE la fórmula de siempre — cero cambio de comportamiento para
 *     toda fila existente.
 */
export function valorVisibleContratoItem(item: ContratoItemValor): number {
  if (item.modo_precio === "total") return Number(item.valor_total) || 0;
  return item.adultos * item.tarifa_adulto + item.ninos * item.tarifa_nino;
}

/** Suma el valor visible de varias filas — mismo criterio que `valorVisibleContratoItem`. */
export function totalVisibleContratoItems(items: readonly ContratoItemValor[]): number {
  return items.reduce((s, it) => s + valorVisibleContratoItem(it), 0);
}
