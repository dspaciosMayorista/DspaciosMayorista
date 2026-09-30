// Stub de "app/(dashboard)/dashboard/vuelos/actions" para las pruebas de
// interacción React (cargadas por pruebas/support/reactLoader.mjs). El archivo
// real es "use server" y termina importando "@/lib/supabase/server" ->
// "next/headers".
//
// CONFIGURABLE (`__setImpls`), mismo criterio que los demás stubs de Server
// Actions del proyecto.
let impls = {};
export function __setImpls(next) {
  impls = { ...impls, ...next };
}
export async function actualizarBloqueo(id, input) {
  if (impls.actualizarBloqueo) return impls.actualizarBloqueo(id, input);
  throw new Error("actualizarBloqueo: no implementado en el stub de pruebas — usa __setImpls({ actualizarBloqueo })");
}
