// ─────────────────────────────────────────────────────────────────────────
// Control general por record (migración 151): modalidad de emisión, estado
// de emisión y estado de pago al proveedor/aerolínea. Los tres son manuales,
// a nivel de TODO el bloqueo — independientes del estado de cada silla.
//
// `null` no es "pendiente": un registro de antes de esta migración no tiene
// forma de saber si ya se emitió o se pagó, así que se muestra "Sin definir"
// (modalidad) o "Por confirmar" (estados) — nunca se asume 'pendiente' para
// no afirmar algo que no se sabe. Ver la cabecera de la migración 151.
// ─────────────────────────────────────────────────────────────────────────

export type ModalidadEmision = "individual" | "grupo";
export type EstadoEmision = "pendiente" | "emitido";
export type EstadoPago = "pendiente" | "pagado";

export const MODALIDADES_EMISION: ModalidadEmision[] = ["individual", "grupo"];
export const ESTADOS_EMISION: EstadoEmision[] = ["pendiente", "emitido"];
export const ESTADOS_PAGO: EstadoPago[] = ["pendiente", "pagado"];

export const MODALIDAD_LABEL: Record<ModalidadEmision, string> = { individual: "Individual", grupo: "Grupo" };
export const ESTADO_EMISION_LABEL: Record<EstadoEmision, string> = { pendiente: "Pendiente", emitido: "Emitido" };
export const ESTADO_PAGO_LABEL: Record<EstadoPago, string> = { pendiente: "Pendiente", pagado: "Pagado" };

export const SIN_DEFINIR = "Sin definir";
export const POR_CONFIRMAR = "Por confirmar";

export function esModalidadEmision(v: unknown): v is ModalidadEmision {
  return v === "individual" || v === "grupo";
}
export function esEstadoEmision(v: unknown): v is EstadoEmision {
  return v === "pendiente" || v === "emitido";
}
export function esEstadoPago(v: unknown): v is EstadoPago {
  return v === "pendiente" || v === "pagado";
}

export function labelModalidad(v: string | null): string {
  return esModalidadEmision(v) ? MODALIDAD_LABEL[v] : SIN_DEFINIR;
}
export function labelEstadoEmision(v: string | null): string {
  return esEstadoEmision(v) ? ESTADO_EMISION_LABEL[v] : POR_CONFIRMAR;
}
export function labelEstadoPago(v: string | null): string {
  return esEstadoPago(v) ? ESTADO_PAGO_LABEL[v] : POR_CONFIRMAR;
}
