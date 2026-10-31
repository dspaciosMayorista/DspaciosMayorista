// Cuando el tarifario de un paquete NO se pudo publicar (generación fallida, p. ej. un traslado por alcance incluido en el hotel), la tarifa no existe para la venta. En vez del
// genérico «No se encontró la tarifa seleccionada», quien cotiza ve el motivo real: el CLIENTE un aviso neutro (sin detalle de configuración) y el OPERADOR, además, el aviso
// que dejó la generación (`tarifario_error`: mensajes de negocio escritos por el sistema, nunca texto de la base). Módulo puro: se importa directo desde `node --test`.
export const MENSAJE_PAQUETE_NO_DISPONIBLE_CLIENTE =
  "Este paquete no está disponible por ahora: su tarifario está pendiente de corrección. Elige otra opción o contacta a la agencia.";

export type EstadoTarifarioPaquete = { tarifario_estado?: string | null; tarifario_error?: string | null } | null | undefined;

/** ¿La generación del tarifario de este paquete falló? (entonces la ausencia de tarifa no es «no existe», es «no se pudo publicar»). */
export const tarifarioFallido = (p: EstadoTarifarioPaquete): boolean => p?.tarifario_estado === "fallido";

/** Texto para el operador (pantallas internas): aviso neutro + el motivo exacto de la generación. */
export function mensajePaqueteNoDisponibleOperador(p: EstadoTarifarioPaquete): string {
  const motivo = (p?.tarifario_error ?? "").trim();
  return motivo
    ? `El tarifario de este paquete no se pudo publicar y no se puede vender hasta corregirlo. Motivo: ${motivo}`
    : "El tarifario de este paquete no se pudo publicar y no se puede vender hasta corregirlo. Revisa el aviso del paquete en Producto → Paquetes.";
}
