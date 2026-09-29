// Stub de "@/lib/reservar/asegurarCuentasPorPagar" para la prueba de la action
// real completarProveedores (contratos/[numero]/gestion-actions.ts). La función
// real escribe con service-role; aquí solo se REGISTRA si se llegó a invocar,
// que es justo lo que las pruebas negativas deben descartar.
let llamadas = [];
let respuesta = { ok: true, creadas: 2 };

export function __llamadasAsegurar() {
  return [...llamadas];
}
/** @param {{ ok: boolean; creadas: number; error?: string }} [r] */
export function __resetAsegurar(r = { ok: true, creadas: 2 }) {
  llamadas = [];
  respuesta = r;
}
export async function asegurarCuentasPorPagar(numeroContrato) {
  llamadas.push(numeroContrato);
  return respuesta;
}
