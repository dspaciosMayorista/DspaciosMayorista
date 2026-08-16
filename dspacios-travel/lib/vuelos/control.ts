// ─────────────────────────────────────────────────────────────────────────
// Control general por record (migración 152): modalidad de emisión, estado
// de emisión y estado de pago al proveedor/aerolínea. Los tres son manuales,
// a nivel de TODO el bloqueo — independientes del estado de cada silla.
//
// `null` no es "pendiente": un registro de antes de esta migración no tiene
// forma de saber si ya se emitió o se pagó, así que se muestra "Sin definir"
// (modalidad) o "Por confirmar" (estados) — nunca se asume 'pendiente' para
// no afirmar algo que no se sabe. Ver la cabecera de la migración 152.
//
// Tono del badge — helpers PUROS y CENTRALIZADOS, usados por ControlVuelosTabla
// y por ControlBadges (detalle del record) para que lista y detalle se vean
// siempre iguales. Nunca se dejan al `inferir()` de EstadoBadge: ese infiere
// por texto y clasificaba "Por confirmar" como verde (`ok`) solo por contener
// "confirm" — visualmente indistinguible de Emitido/Pagado, que SÍ son un
// éxito real. Reglas (pedidas explícitamente por el dueño):
//   Modalidad     — individual/null/inválido → neutral; grupo → warn.
//   Emisión y pago — pendiente → warn; emitido/pagado → ok; CUALQUIER OTRA
//                    cosa (null, inválido, "Por confirmar") → orange, para no
//                    confundir "no se sabe" con "ya está resuelto".
// ─────────────────────────────────────────────────────────────────────────

import type { Tono } from "@/components/EstadoBadge";

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

export function tonoModalidad(v: string | null): Tono {
  return v === "grupo" ? "warn" : "neutral"; // individual, null o inválido → neutral
}
export function tonoEstadoEmision(v: string | null): Tono {
  if (v === "pendiente") return "warn";
  if (v === "emitido") return "ok";
  return "orange"; // null, inválido o "Por confirmar"
}
export function tonoEstadoPago(v: string | null): Tono {
  if (v === "pendiente") return "warn";
  if (v === "pagado") return "ok";
  return "orange"; // null, inválido o "Por confirmar"
}
