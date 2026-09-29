// Stub de "@/lib/contabilidad/asientos" para la prueba de la action real de
// pagos: la action lo importa pero la función bajo prueba
// (asignarProveedorCuentaPorPagar) jamás postea asientos. El real arrastra
// "next/headers"/"next/cache", "server-only" y el cliente admin — no cargable
// en este entorno. Se devuelve ok para que un uso inesperado no lance.
export async function postearAsientoPago() {
  return { ok: true };
}
export async function eliminarAsientoPago() {
  return { ok: true };
}
// gestion-actions.ts (completarProveedores) también los importa; no se invocan
// en esa prueba.
export async function postearAsientoCxP() {
  return { ok: true };
}
export async function eliminarAsientoCxP() {
  return { ok: true };
}
