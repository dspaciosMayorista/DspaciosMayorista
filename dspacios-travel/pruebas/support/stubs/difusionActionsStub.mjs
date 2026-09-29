// Stub de "app/(crm)/crm/difusion/actions" para las pruebas de interacción
// React (cargadas por pruebas/support/reactLoader.mjs). El archivo real es
// "use server" y termina importando "@/lib/supabase/server" -> "next/headers".
//
// CONFIGURABLE (`__setImpls`), mismo criterio que los demás stubs de Server
// Actions del proyecto.
let impls = {};
export function __setImpls(next) {
  impls = { ...impls, ...next };
}
export async function crearMaterial(input) {
  if (impls.crearMaterial) return impls.crearMaterial(input);
  throw new Error("crearMaterial: no implementado en el stub de pruebas — usa __setImpls({ crearMaterial })");
}
export async function actualizarMaterial(id, input) {
  if (impls.actualizarMaterial) return impls.actualizarMaterial(id, input);
  throw new Error("actualizarMaterial: no implementado en el stub de pruebas — usa __setImpls({ actualizarMaterial })");
}
export async function eliminarMaterial(id) {
  if (impls.eliminarMaterial) return impls.eliminarMaterial(id);
  throw new Error("eliminarMaterial: no implementado en el stub de pruebas — usa __setImpls({ eliminarMaterial })");
}
export async function registrarEnvio(input) {
  if (impls.registrarEnvio) return impls.registrarEnvio(input);
  throw new Error("registrarEnvio: no implementado en el stub de pruebas — usa __setImpls({ registrarEnvio })");
}
export async function eliminarEnvio(id) {
  if (impls.eliminarEnvio) return impls.eliminarEnvio(id);
  throw new Error("eliminarEnvio: no implementado en el stub de pruebas — usa __setImpls({ eliminarEnvio })");
}
export async function crearPlan(input) {
  if (impls.crearPlan) return impls.crearPlan(input);
  throw new Error("crearPlan: no implementado en el stub de pruebas — usa __setImpls({ crearPlan })");
}
export async function actualizarPlan(id, input) {
  if (impls.actualizarPlan) return impls.actualizarPlan(id, input);
  throw new Error("actualizarPlan: no implementado en el stub de pruebas — usa __setImpls({ actualizarPlan })");
}
export async function cambiarEstadoPlan(id, estado) {
  if (impls.cambiarEstadoPlan) return impls.cambiarEstadoPlan(id, estado);
  throw new Error("cambiarEstadoPlan: no implementado en el stub de pruebas — usa __setImpls({ cambiarEstadoPlan })");
}
export async function eliminarPlan(id) {
  if (impls.eliminarPlan) return impls.eliminarPlan(id);
  throw new Error("eliminarPlan: no implementado en el stub de pruebas — usa __setImpls({ eliminarPlan })");
}
export async function marcarPlanEnviado(id) {
  if (impls.marcarPlanEnviado) return impls.marcarPlanEnviado(id);
  throw new Error("marcarPlanEnviado: no implementado en el stub de pruebas — usa __setImpls({ marcarPlanEnviado })");
}