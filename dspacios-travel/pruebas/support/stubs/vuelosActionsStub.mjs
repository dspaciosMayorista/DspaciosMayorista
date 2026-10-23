// Stub de "app/(dashboard)/dashboard/vuelos/actions" para las pruebas de
// interacción React (cargadas por pruebas/support/reactLoader.mjs). El archivo
// real es "use server" y termina importando "@/lib/supabase/server" ->
// "next/headers".
//
// CONFIGURABLE (`__setImpls`), mismo criterio que los demás stubs de Server
// Actions del proyecto. Lo usan EditarBloqueoForm.tsx y PasajeroAcciones.tsx.
let impls = {};
export function __setImpls(next) {
  impls = { ...impls, ...next };
}
function llamar(nombre, args) {
  if (impls[nombre]) return impls[nombre](...args);
  throw new Error(`${nombre}: no implementado en el stub de pruebas — usa __setImpls({ ${nombre} })`);
}
export async function actualizarBloqueo(...args) { return llamar("actualizarBloqueo", args); }
export async function editarPasajeroSilla(...args) { return llamar("editarPasajeroSilla", args); }
export async function borrarPasajeroSilla(...args) { return llamar("borrarPasajeroSilla", args); }
export async function moverPasajeroSilla(...args) { return llamar("moverPasajeroSilla", args); }
export async function guardarInfanteVuelo(...args) { return llamar("guardarInfanteVuelo", args); }
