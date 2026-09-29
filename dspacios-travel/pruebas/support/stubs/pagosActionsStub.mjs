// Stub de "app/(dashboard)/dashboard/pagos/actions" para las pruebas de
// interacción React (cargadas por pruebas/support/reactLoader.mjs). El archivo
// real es "use server" y termina importando "@/lib/supabase/server" y
// "@/lib/contabilidad/asientos" -> "next/headers".
//
// CONFIGURABLE (`__setImpls`), mismo criterio que los demás stubs de Server
// Actions del proyecto.
let impls = {};
export function __setImpls(next) {
  impls = { ...impls, ...next };
}
export async function registrarPagoProveedor(id, valor, fecha, trmInput) {
  if (impls.registrarPagoProveedor) return impls.registrarPagoProveedor(id, valor, fecha, trmInput);
  throw new Error("registrarPagoProveedor: no implementado en el stub de pruebas — usa __setImpls({ registrarPagoProveedor })");
}
export async function deshacerUltimoPago(id) {
  if (impls.deshacerUltimoPago) return impls.deshacerUltimoPago(id);
  throw new Error("deshacerUltimoPago: no implementado en el stub de pruebas — usa __setImpls({ deshacerUltimoPago })");
}
export async function asignarProveedorCuentaPorPagar(id, proveedorNombre) {
  if (impls.asignarProveedorCuentaPorPagar) return impls.asignarProveedorCuentaPorPagar(id, proveedorNombre);
  throw new Error("asignarProveedorCuentaPorPagar: no implementado en el stub de pruebas — usa __setImpls({ asignarProveedorCuentaPorPagar })");
}
export async function configurarFacturaProveedor(input) {
  if (impls.configurarFacturaProveedor) return impls.configurarFacturaProveedor(input);
  throw new Error("configurarFacturaProveedor: no implementado en el stub de pruebas — usa __setImpls({ configurarFacturaProveedor })");
}