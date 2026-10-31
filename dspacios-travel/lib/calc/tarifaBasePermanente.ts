// ─────────────────────────────────────────────────────────────────────────
// Tarifa base PERMANENTE de la asistencia médica — módulo PURO.
//
// Regla del dueño: un servicio clasificado como asistencia médica (`servicios_adicionales.categoria = 'asistencia'`) que NO tiene NINGUNA vigencia
// (cero filas en `servicio_temporadas`) cobra su tarifa base (precio_persona / rangos GENERAL) en cualquier fecha. Si tiene vigencias —aunque estén
// vencidas, invertidas o sin fechas— se respetan SOLAS: la base nunca rellena un hueco. Traslados, tours y demás categorías siguen exigiendo vigencia.
//
// Se materializa como UNA vigencia sintética «GENERAL» sin límites de fecha: así publicación, reserva, carrito, conversión, costo y CxP —que ya resuelven
// todo contra la lista de vigencias— aplican la misma regla sin ramas propias y el precio nunca diverge del costo. Si la base no es válida, la vigencia
// sintética se crea igual con el precio vacío y cada ruta rechaza con el mensaje de «sin precio / sin rangos en su vigencia «GENERAL»» (nunca inventa).
// ─────────────────────────────────────────────────────────────────────────
export const NOMBRE_TARIFA_BASE = "GENERAL";
const SIN_LIMITE_INICIO = "1900-01-01";
const SIN_LIMITE_FIN = "2999-12-31";

export type BaseServicioCatalogo = {
  id: number; categoria: string | null; precio_persona: number | null; precio_infante: number | null; recargo_individual: number | null;
};

export type VigenciaBasePermanente = {
  servicio_id: number; nombre: string; fecha_inicio: string; fecha_fin: string; compra_inicio: null; compra_fin: null; prioridad: number;
  precio_persona: number | null; precio_infante: number | null; recargo_individual: number | null; servicio_suplementos_franja: [];
};

/** ¿Este servicio es asistencia médica? (única categoría con tarifa permanente). */
export const esAsistenciaMedica = (categoria: string | null | undefined): boolean => categoria === "asistencia";

const numeroOnull = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));

/**
 * Vigencia sintética de la tarifa base, o null si el servicio no es asistencia. El llamador solo la usa cuando el servicio NO tiene filas en
 * `servicio_temporadas` (con una sola fila, aunque inválida, la base no aplica).
 */
export function vigenciaBasePermanente(b: BaseServicioCatalogo): VigenciaBasePermanente | null {
  if (!esAsistenciaMedica(b.categoria)) return null;
  return {
    servicio_id: b.id, nombre: NOMBRE_TARIFA_BASE, fecha_inicio: SIN_LIMITE_INICIO, fecha_fin: SIN_LIMITE_FIN, compra_inicio: null, compra_fin: null, prioridad: 0,
    precio_persona: numeroOnull(b.precio_persona), precio_infante: numeroOnull(b.precio_infante), recargo_individual: numeroOnull(b.recargo_individual),
    servicio_suplementos_franja: [],
  };
}

/** Marca para auditoría/UI: ¿esta vigencia es la sintética de la tarifa base? */
export const esVigenciaBasePermanente = (nombre: string, fechaInicio: string | null): boolean => nombre === NOMBRE_TARIFA_BASE && fechaInicio === SIN_LIMITE_INICIO;
