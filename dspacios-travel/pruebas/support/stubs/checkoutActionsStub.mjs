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
// Auditoría Preview #403: vista previa del desglose B2B (el servidor real corre el mismo cálculo que la cotización). Cada prueba instala lo que necesita.
export const __previas = [];
let implPrevia = null;
export function __setPrevisualizar(fn) {
  implPrevia = fn;
}
export async function previsualizarTerminosB2BAsistido(input) {
  __previas.push(input);
  if (implPrevia) return implPrevia(input);
  return { ok: false, error: "previsualizarTerminosB2BAsistido: no implementado en el stub de pruebas" };
}
// #64: comparativa del carrito — registra lo que la página envía al servidor.
export const __comparativas = [];
let implComparativa = null;
export function __setCrearComparativaCarrito(fn) {
  implComparativa = fn;
}
export async function crearComparativaCarrito(input) {
  __comparativas.push(input);
  if (implComparativa) return implComparativa(input);
  return { ok: false, error: "crearComparativaCarrito: no implementado en el stub de pruebas" };
}
// #64: catálogo IATA de los destinos (el servidor real consulta destinos.codigo_iata y el catálogo de ciudades).
import { codigoIataDeCiudad } from "../../../lib/iata.ts";
let implIata = null;
export function __setCodigosIata(fn) {
  implIata = fn;
}
export async function codigosIataDestinos(nombres) {
  if (implIata) return implIata(nombres);
  return Object.fromEntries((Array.isArray(nombres) ? nombres : []).map((n) => [n, codigoIataDeCiudad(n)]));
}
// #64/#102: vista previa B2B de la comparativa (términos por opción).
export const __previasComparativa = [];
let implPreviaCmp = null;
export function __setPrevisualizarComparativa(fn) {
  implPreviaCmp = fn;
}
export async function previsualizarComparativaB2B(input) {
  __previasComparativa.push(input);
  if (implPreviaCmp) return implPreviaCmp(input);
  return { ok: false, error: "previsualizarComparativaB2B: no implementado en el stub de pruebas" };
}
