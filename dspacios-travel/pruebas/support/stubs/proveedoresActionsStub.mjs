// Stub de "app/(dashboard)/dashboard/producto/proveedores/actions" para las
// pruebas de interacción React (cargadas por pruebas/support/reactLoader.mjs).
// El archivo real es "use server" y termina importando "@/lib/supabase/server"
// -> "next/headers".
//
// CONFIGURABLE (`__setImpls`), mismo criterio que los demás stubs de Server
// Actions del proyecto.
let impls = {};
export function __setImpls(next) {
  impls = { ...impls, ...next };
}
export async function crearProveedor(input) {
  if (impls.crearProveedor) return impls.crearProveedor(input);
  throw new Error("crearProveedor: no implementado en el stub de pruebas — usa __setImpls({ crearProveedor })");
}
export async function actualizarProveedor(id, input) {
  if (impls.actualizarProveedor) return impls.actualizarProveedor(id, input);
  throw new Error("actualizarProveedor: no implementado en el stub de pruebas — usa __setImpls({ actualizarProveedor })");
}
export async function eliminarProveedor(id) {
  if (impls.eliminarProveedor) return impls.eliminarProveedor(id);
  throw new Error("eliminarProveedor: no implementado en el stub de pruebas — usa __setImpls({ eliminarProveedor })");
}