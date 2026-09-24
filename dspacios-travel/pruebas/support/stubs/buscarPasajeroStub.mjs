// Stub de "@/lib/reservar/buscarPasajero" para las pruebas de interacción
// React (cargadas por pruebas/support/reactLoader.mjs). El archivo real es
// "use server" y termina importando "@/lib/supabase/server" -> "next/headers"
// (contexto de request de Next) — fuera de un servidor Next real eso no
// resuelve.
//
// CONFIGURABLE (`__setBuscarPasajeroPorDocumento`), mismo criterio que
// `buscarHoteles`/`buscarReceptivos` en reservarActionsStub.mjs: por defecto
// lanza (si algo la invocara sin instalar una implementación, se nota en vez
// de resolver en silencio con datos inventados).
let impl = null;
export function __setBuscarPasajeroPorDocumento(fn) {
  impl = fn;
}
export async function buscarPasajeroPorDocumento(tipoId, identificacion) {
  if (impl) return impl(tipoId, identificacion);
  throw new Error("buscarPasajeroPorDocumento: no implementado en el stub de pruebas — instala una implementación con __setBuscarPasajeroPorDocumento");
}
