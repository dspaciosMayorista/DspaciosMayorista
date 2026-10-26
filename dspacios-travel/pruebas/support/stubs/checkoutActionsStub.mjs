// Stub de app/tarifario/checkout/actions.ts para las pruebas de interacción
// React del checkout (pruebas/carritoMonedaCheckout.react.ts). Las Server
// Actions reales usan Supabase/next/headers; aquí cada prueba instala lo que
// necesita. `crearSolicitudReserva` registra cada solicitud en `__solicitudes`.
let contexto = { esB2B: false, pctComision: 0, agencia: null };
export function __setContextoB2B(ctx) {
  contexto = ctx;
}
export const __solicitudes = [];
let implCrear = null;
export function __setCrearSolicitudReserva(fn) {
  implCrear = fn;
}
export async function getContextoB2B() {
  return contexto;
}
// #102: contexto de la venta B2B ASISTIDA por personal interno (por defecto, sin permiso: la sección no se muestra).
let contextoAsistencia = { puede: false };
export function __setContextoAsistencia(ctx) {
  contextoAsistencia = ctx;
}
export async function getContextoAsistenciaB2B() {
  return contextoAsistencia;
}
export async function fotosPortada() {
  return {};
}
export async function crearSolicitudReserva(input) {
  __solicitudes.push(input);
  if (implCrear) return implCrear(input);
  return { ok: false, error: "crearSolicitudReserva: no implementado en el stub de pruebas" };
}
