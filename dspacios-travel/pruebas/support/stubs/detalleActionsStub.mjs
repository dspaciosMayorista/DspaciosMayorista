// Stub de app/tarifario/detalle-actions.ts ("use server" -> next/headers) para montar
// TarifarioPublic en pruebas. Nunca debe invocarse en ellas.
const nunca = (n) => async () => { throw new Error(`${n}: no implementado en el stub de pruebas`); };
export const obtenerDetalleSalida = nunca("obtenerDetalleSalida");
export const obtenerDetallePaquete = nunca("obtenerDetallePaquete");
export const obtenerDetalleServicios = nunca("obtenerDetalleServicios");
export const obtenerDetalleHotel = nunca("obtenerDetalleHotel");
