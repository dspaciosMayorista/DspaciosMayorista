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
export async function usoDestino(id) {
  if (impls.usoDestino) return impls.usoDestino(id);
  throw new Error("usoDestino: no implementado en el stub de pruebas — usa __setImpls({ usoDestino })");
}

// Acciones de la cabecera de Producto → Destinos (NuevoDestinoDialog,
// CargarDestinosSugeridos): solo se importan al renderizar la página; ninguna
// prueba las invoca — si alguna lo hiciera sin configurarlas, falla claro.
export async function crearDestino(...args) {
  if (impls.crearDestino) return impls.crearDestino(...args);
  throw new Error("crearDestino: no implementado en el stub de pruebas — usa __setImpls({ crearDestino })");
}
export async function cargarDestinosSugeridos(...args) {
  if (impls.cargarDestinosSugeridos) return impls.cargarDestinosSugeridos(...args);
  throw new Error("cargarDestinosSugeridos: no implementado en el stub de pruebas — usa __setImpls({ cargarDestinosSugeridos })");
}
