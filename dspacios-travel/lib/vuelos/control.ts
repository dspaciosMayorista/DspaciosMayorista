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
// MODALIDAD (migración 155): el valor de dato 'individual' se renombró a
// 'serie' — un bloqueo negociado se emite en SERIE (silla por silla) o en
// GRUPO, nunca es "Sistema" (esa es la tercera modalidad de negocio, pero
// vive en la tabla `empaquetados`, migración 156, NO como un tercer valor
// de `bloqueos_vuelo.modalidad_emision`). `ModalidadEmision` sigue siendo el
// tipo de la COLUMNA real (serie/grupo); `ModalidadControl` es un superset
// SOLO para la vista fusionada de Control Vuelos, que también muestra filas
// de `empaquetados` con modalidad fija "Sistema" (nunca almacenada, se
// deriva de la tabla de origen — ver ControlVuelosTabla).
//
// Tono del badge — helpers PUROS y CENTRALIZADOS, usados por ControlVuelosTabla
// y por ControlBadges (detalle del record) para que lista y detalle se vean
// siempre iguales. Nunca se dejan al `inferir()` de EstadoBadge: ese infiere
// por texto y clasificaba "Por confirmar" como verde (`ok`) solo por contener
// "confirm" — visualmente indistinguible de Emitido/Pagado, que SÍ son un
// éxito real. Reglas (pedidas explícitamente por el dueño):
//   Modalidad     — serie/null/inválido → neutral (gris); grupo → warn
//                    (amarillo); sistema → info (azul/teal, informativo).
//   Emisión y pago — pendiente → warn (amarillo); emitido/pagado → ok
//                    (verde); CUALQUIER OTRA cosa (null, inválido, "Por
//                    confirmar") → orange (naranja), para no confundir "no
//                    se sabe" con "ya está resuelto".
// ─────────────────────────────────────────────────────────────────────────

import type { Tono } from "@/components/EstadoBadge";

export type ModalidadEmision = "serie" | "grupo";
export type ModalidadControl = ModalidadEmision | "sistema";
export type EstadoEmision = "pendiente" | "emitido";
export type EstadoPago = "pendiente" | "pagado";

export const MODALIDADES_EMISION: ModalidadEmision[] = ["serie", "grupo"];
export const ESTADOS_EMISION: EstadoEmision[] = ["pendiente", "emitido"];
export const ESTADOS_PAGO: EstadoPago[] = ["pendiente", "pagado"];

export const MODALIDAD_LABEL: Record<ModalidadEmision, string> = { serie: "Serie", grupo: "Grupo" };
export const MODALIDAD_CONTROL_LABEL: Record<ModalidadControl, string> = { ...MODALIDAD_LABEL, sistema: "Sistema" };
export const ESTADO_EMISION_LABEL: Record<EstadoEmision, string> = { pendiente: "Pendiente", emitido: "Emitido" };
export const ESTADO_PAGO_LABEL: Record<EstadoPago, string> = { pendiente: "Pendiente", pagado: "Pagado" };

export const SIN_DEFINIR = "Sin definir";
export const POR_CONFIRMAR = "Por confirmar";

export function esModalidadEmision(v: unknown): v is ModalidadEmision {
  return v === "serie" || v === "grupo";
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
// Para la vista fusionada de Control Vuelos: "sistema" siempre se conoce de
// antemano (fila de `empaquetados`, nunca ambigua) — no pasa por SIN_DEFINIR.
export function labelModalidadControl(v: ModalidadControl | null): string {
  return v === "sistema" ? MODALIDAD_CONTROL_LABEL.sistema : labelModalidad(v);
}
export function labelEstadoEmision(v: string | null): string {
  return esEstadoEmision(v) ? ESTADO_EMISION_LABEL[v] : POR_CONFIRMAR;
}
export function labelEstadoPago(v: string | null): string {
  return esEstadoPago(v) ? ESTADO_PAGO_LABEL[v] : POR_CONFIRMAR;
}

export function tonoModalidad(v: string | null): Tono {
  return v === "grupo" ? "warn" : "neutral"; // serie, null o inválido → neutral
}
export function tonoModalidadControl(v: ModalidadControl | null): Tono {
  if (v === "sistema") return "info";
  return tonoModalidad(v);
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
