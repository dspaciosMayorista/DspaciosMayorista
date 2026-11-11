// Identidad de una fila de LISTADO (#75): el uid sale del embed `ventas(contrato_uid)` / `ventas!inner(contrato_uid)` de la MISMA consulta que trajo
// la fila (nunca de una consulta posterior por número). PostgREST devuelve el embed como objeto (FK a una fila) o como arreglo de un elemento.
export function uidEmbebido(v: unknown): string | null {
  const o = Array.isArray(v) ? v[0] : v;
  const uid = o && typeof o === "object" ? (o as { contrato_uid?: unknown }).contrato_uid : null;
  return typeof uid === "string" ? uid : null;
}
