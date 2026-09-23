// Stub de "@/app/(dashboard)/dashboard/reservar/actions" para las pruebas de
// interacción React (cargadas por pruebas/support/reactLoader.mjs). El
// archivo real es "use server" y termina importando `next/headers` (contexto
// de request de Next) — fuera de un servidor Next real eso no resuelve.
//
// `buscarHoteles` es CONFIGURABLE (`__setBuscarHoteles`): la prueba de
// `Resultado` (pruebas/resultadoInteraccion.test.ts) nunca la llama —
// `Resultado` no ejercita el FORMULARIO de búsqueda, solo pinta una tarjeta
// ya liquidada — así que por defecto sigue lanzando (si algo la invocara sin
// querer, se nota). La prueba del formulario en sí
// (pruebas/buscadorBookingDestinoInteraccion.test.ts) SÍ necesita observar
// qué se le manda (destino/adultos/etc.) al hacer clic en "Buscar hoteles",
// así que instala una implementación real (una spy que resuelve con un
// fixture) antes de disparar esa búsqueda.
let implBuscarHoteles = null;
export function __setBuscarHoteles(fn) {
  implBuscarHoteles = fn;
}
export async function buscarHoteles(input) {
  if (implBuscarHoteles) return implBuscarHoteles(input);
  throw new Error("buscarHoteles: no implementado en el stub de pruebas — instala una implementación con __setBuscarHoteles si tu prueba SÍ ejercita el buscador");
}
export async function cotizarPorFechas() {
  throw new Error("cotizarPorFechas: no implementado en el stub de pruebas");
}
export async function buscarReceptivos() {
  throw new Error("buscarReceptivos: no implementado en el stub de pruebas");
}
