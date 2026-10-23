// Stub de app/tarifario/detalle-actions.ts ("use server" -> next/headers) para montar
// TarifarioPublic en pruebas. Por defecto nunca debe invocarse; una prueba que SÍ necesite el
// detalle (p. ej. el modal de un Dinámico) registra su doble en `globalThis.__detalleActionsFake`.
const nunca = (n) => async (...args) => {
  const f = globalThis.__detalleActionsFake?.[n];
  if (f) return f(...args);
  throw new Error(`${n}: no implementado en el stub de pruebas`);
};
export const obtenerDetalleSalida = nunca("obtenerDetalleSalida");
export const obtenerDetallePaquete = nunca("obtenerDetallePaquete");
export const obtenerDetalleServicios = nunca("obtenerDetalleServicios");
export const obtenerDetalleHotel = nunca("obtenerDetalleHotel");
