// Documento público por token (/cot/[token]) de una cotización MANUAL (#82). PURO.
// El snapshot de una manual (incluida la de un paquete dinámico) guarda ítems `{descripcion, cantidad, tarifa_unit, valor}`; el documento del
// tarifario (`ContratoDocumento`) espera `{adultos, tarifa_adulto, …}` y con los de la manual mostraba «$ NaN». Se distinguen por la forma.

export type ItemSnapshot = Record<string, unknown>;
export type ItemManual = { descripcion: string; cantidad?: number; tarifa_unit?: number; valor: number };

/** true si TODOS los ítems tienen la forma de la cotización manual (y hay al menos uno). */
export function esSnapshotManual(items: readonly ItemSnapshot[] | null | undefined): boolean {
  const l = items ?? [];
  return l.length > 0 && l.every((it) => it.tarifa_unit != null && it.tarifa_adulto == null);
}

/** Ítems del documento de la manual, sin NaN: un valor ausente o inválido cuenta 0. */
export function itemsDeManual(items: readonly ItemSnapshot[] | null | undefined): ItemManual[] {
  const n = (v: unknown): number | undefined => (v == null || !Number.isFinite(Number(v)) ? undefined : Number(v));
  return (items ?? []).map((it) => ({ descripcion: String(it.descripcion ?? ""), cantidad: n(it.cantidad), tarifa_unit: n(it.tarifa_unit), valor: n(it.valor) ?? 0 }));
}
