// Stub de "./busquedaUnidadActions" (relativo a app/tarifario/) para las
// pruebas de interacción React — mismo motivo que reservarActionsStub.mjs: el
// archivo real es "use server" e importa `next/headers` transitivamente.
//
// CONFIGURABLE (`__setBuscarAlojamientosUnidadPorFechas`) — mismo criterio que
// `buscarHoteles` en reservarActionsStub.mjs: por defecto lanza (nadie debería
// llamarla sin que la prueba lo espere); una prueba que SÍ ejercita el botón
// "Buscar hoteles" del formulario instala antes una implementación real.
let implBuscarAlojamientosUnidadPorFechas = null;
export function __setBuscarAlojamientosUnidadPorFechas(fn) {
  implBuscarAlojamientosUnidadPorFechas = fn;
}
export async function buscarAlojamientosUnidadPorFechas(input) {
  if (implBuscarAlojamientosUnidadPorFechas) return implBuscarAlojamientosUnidadPorFechas(input);
  throw new Error("buscarAlojamientosUnidadPorFechas: no implementado en el stub de pruebas — instala una implementación con __setBuscarAlojamientosUnidadPorFechas si tu prueba SÍ ejercita el buscador");
}
