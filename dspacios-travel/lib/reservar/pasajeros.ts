// ─────────────────────────────────────────────────────────────────────────
// Fuente de verdad ÚNICA para clasificar pasajeros de un CONTRATO (no de
// tarifa de hotel — eso es `lib/reservar/edadesMenores.ts`, otro concepto
// con otros umbrales `hoteles.edad_infante_max/edad_nino_max`) frente al
// inventario de SILLAS de vuelo (bloqueos/records).
//
// Regla de negocio confirmada por el dueño:
// - ADT y CHD consumen 1 silla cada uno.
// - INF (0 años hasta ANTES de cumplir 2 — umbral estrictamente < 2, mismo
//   criterio que ya usaba `actualizarPasajerosContrato`,
//   app/(dashboard)/dashboard/contratos/[numero]/editar-contrato-actions.ts)
//   NO consume silla, pero debe seguir apareciendo en pasajeros/manifiestos/
//   listados/documentos.
//
// Auditoría previa (retomando el pendiente): antes de este módulo existían
// TRES criterios distintos y no sincronizados para decidir "es infante" en
// pasajeros de contrato/vuelo, ninguno reutilizado por los otros dos:
//   1. Posicional/por conteo — `ReservaForm.tsx`/`ProgramaReservaForm.tsx`:
//      `esInfante: idx >= cortePax` (los últimos N pasajeros del formulario
//      son "infante" porque el asesor tecleó N en el campo Infantes) — NUNCA
//      mira la fecha de nacimiento capturada en la misma fila.
//   2. Manual — `NuevoContratoForm.tsx`: checkbox "Es infante" que el asesor
//      marca a mano, sin relación con ninguna fecha.
//   3. Por edad real — `editar-contrato-actions.ts` (`actualizarPasajerosContrato`):
//      `calcularEdad(fechaNacimiento, ventas.fecha_salida) < 2`, calculado en
//      el servidor. Es el ÚNICO de los tres que aplica la regla de negocio
//      tal cual está definida (edad real, no una cuenta ni un checkbox).
// La fecha de referencia en sí NO es ambigua una vez que se sigue el rastro:
// es siempre "fecha de salida del viaje" — conocida ANTES de crear el
// contrato como `meta.fecha_ida`/`input.fechaIda` (motor tarifario) o
// `input.fechaSalida` (motor manual), y ya persistida como
// `ventas.fecha_salida` una vez el contrato existe (`reservar/actions.ts`
// inserta `fecha_salida: meta.fecha_ida` textualmente — mismo valor, no dos
// fuentes). Lo inconsistente era el MÉTODO (1 y 2 nunca usan esa fecha para
// clasificar), no la fecha. Por eso este módulo no inventa una fecha nueva:
// exige la fecha de salida como parámetro y dejar de confiar en checkboxes o
// conteos para decidir qué pasajero es infante.
import { calcularEdad } from "../utils.ts";

/** Edad (años cumplidos) por debajo de la cual un pasajero es INFANTE — no consume silla. */
export const EDAD_INFANTE_MAX_VUELO = 2;

/**
 * ¿Este pasajero es infante para efectos de inventario de vuelo? Recalcula
 * SIEMPRE desde la fecha de nacimiento real contra la fecha de salida del
 * viaje — nunca confía en un checkbox ni en una posición dentro de un
 * arreglo. `null`/fecha inválida ⇒ `false` (fail-safe hacia el lado de
 * CONSUMIR silla: si no se puede confirmar que es infante, nunca se debe
 * sub-contar el inventario disponible).
 */
export function esInfantePorEdad(
  fechaNacimiento: string | null | undefined,
  fechaReferencia: string | null | undefined
): boolean {
  const edad = calcularEdad(fechaNacimiento, fechaReferencia);
  return edad != null && edad < EDAD_INFANTE_MAX_VUELO;
}

/**
 * Fuente de verdad ÚNICA de "¿este pasajero ocupa una silla?" — TODO el
 * inventario (asignación, conteo de holders, liberación, reconciliación al
 * editar) debe decidir por acá, nunca reimplementar `!esInfante` inline en
 * cada archivo (que es exactamente el defecto que tenía el código antes de
 * este cambio: la misma condición repetida y potencialmente divergente en
 * `lib/reservar/actions.ts` y `contratos/actions.ts`).
 */
export function pasajeroConsumeSilla(esInfante: boolean): boolean {
  return !esInfante;
}

/** Cuenta cuántos pasajeros de una lista consumen silla (ADT+CHD). */
export function contarConsumenSilla(esInfanteLista: readonly boolean[]): number {
  return esInfanteLista.reduce((n, esInfante) => n + (pasajeroConsumeSilla(esInfante) ? 1 : 0), 0);
}
