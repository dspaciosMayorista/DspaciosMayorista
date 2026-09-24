// Stub de "app/(crm)/crm/pasajeros/actions" para las pruebas de interacción
// React (cargadas por pruebas/support/reactLoader.mjs). El archivo real es
// "use server" y termina importando "@/lib/supabase/server" -> "next/headers".
//
// CONFIGURABLE (`__setBuscarPasajerosContrato`), mismo criterio que los
// demás stubs de Server Actions del proyecto.
let impl = null;
export function __setBuscarPasajerosContrato(fn) {
  impl = fn;
}
export async function buscarPasajerosContrato(busqueda, pagina, tamPagina) {
  if (impl) return impl(busqueda, pagina, tamPagina);
  throw new Error("buscarPasajerosContrato: no implementado en el stub de pruebas — instala una implementación con __setBuscarPasajerosContrato");
}
