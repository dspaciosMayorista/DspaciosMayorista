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