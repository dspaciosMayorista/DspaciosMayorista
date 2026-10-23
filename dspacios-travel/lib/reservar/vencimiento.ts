// Fecha de corte para vencer reservas pendientes (liberarVencidas).
//
// Un contrato pendiente vence cuando su plazo es ESTRICTAMENTE anterior al día
// de negocio (America/Bogota, lib/fechaNegocio.ts). Antes se usaba la fecha
// UTC (`new Date().toISOString().slice(0, 10)`): desde las 7 p. m. de Bogotá
// esa fecha ya es la de mañana, y la liberación que corre al abrir Reservar
// soltaba contratos cuyo plazo vencía ese mismo día en Colombia.
import { fechaNegocio } from "@/lib/fechaNegocio";

export function fechaCorteVencimiento(instante: Date = new Date()): string {
  return fechaNegocio(instante);
}

/** ¿Una reserva con este plazo ya venció al día de corte? Plazo de hoy: no. */
export function plazoVencido(plazo: string | null | undefined, corte: string): boolean {
  return !!plazo && plazo < corte;
}
