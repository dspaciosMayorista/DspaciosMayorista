// Stub de "app/(dashboard)/dashboard/producto/destinos/actions" para las
// pruebas de interacción React de DestinosLista.tsx (cargado por
// pruebas/support/reactLoader.mjs). El archivo real es "use server" y
// termina importando "@/lib/supabase/server" -> "next/headers".
//
// CONFIGURABLE (`__setImpls`), mismo criterio que los demás stubs de Server
// Actions del proyecto. Sin implementación configurada falla claro.
let impls = {};
export function __setImpls(next) {
  impls = { ...impls, ...next };
}
export async function listarReceptivosDestino(destinoId) {
  if (impls.listarReceptivosDestino) return impls.listarReceptivosDestino(destinoId);
  throw new Error("listarReceptivosDestino: no implementado en el stub de pruebas — usa __setImpls({ listarReceptivosDestino })");
}
