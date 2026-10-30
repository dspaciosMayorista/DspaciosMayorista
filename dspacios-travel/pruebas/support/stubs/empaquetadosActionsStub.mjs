// Stub de "app/(dashboard)/dashboard/vuelos/empaquetados-actions" para las pruebas de interacción React (cargadas por
// pruebas/support/reactLoader.mjs). El archivo real es "use server" y termina importando "@/lib/supabase/server" -> next/headers.
// CONFIGURABLE (`__setImpls`), mismo criterio que los demás stubs de Server Actions del proyecto.
// Lo usan NuevoEmpaquetadoForm.tsx y EditarEmpaquetadoForm.tsx (pruebas/empaquetadosUsd230Formularios.react.ts).
let impls = {};
export function __setImpls(next) {
  impls = { ...impls, ...next };
}
function llamar(nombre, args) {
  if (impls[nombre]) return impls[nombre](...args);
  throw new Error(`${nombre}: no implementado en el stub de pruebas — usa __setImpls({ ${nombre} })`);
}
export async function crearEmpaquetado(...args) { return llamar("crearEmpaquetado", args); }
export async function actualizarEmpaquetado(...args) { return llamar("actualizarEmpaquetado", args); }
export async function eliminarEmpaquetado(...args) { return llamar("eliminarEmpaquetado", args); }
