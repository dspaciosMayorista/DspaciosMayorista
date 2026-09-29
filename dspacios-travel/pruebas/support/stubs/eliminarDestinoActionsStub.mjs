// Stub de "app/(dashboard)/dashboard/tarifario/actions" para las pruebas de
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
export async function eliminarDestino(id, reasignarA) {
  if (impls.eliminarDestino) return impls.eliminarDestino(id, reasignarA);
  throw new Error("eliminarDestino: no implementado en el stub de pruebas — usa __setImpls({ eliminarDestino })");
}