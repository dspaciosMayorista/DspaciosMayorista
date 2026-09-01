// Helpers PUROS sobre `FilaResumen` compartidos por los componentes cliente
// del tarifario (VistaBooking.tsx) — extraídos a un módulo sin imports de
// React/Next para poder testearlos con ejecución real (`node --test`), mismo
// patrón ya usado en este directorio para lib/acomodaciones.ts,
// lib/reservar/edadesMenores.ts, lib/reservar/distribucionHabitaciones.ts.
import type { FilaResumen } from "./resumen.ts";

/**
 * "Desde" de un hotel a partir de sus filas de RESUMEN: cada fila ya trae
 * `desde_adulto` (el mínimo de sencilla/doble/triple/multiple de ESE combo
 * hotel+categoría+régimen, calculado en SQL — ver migración 162). Tomar el
 * mínimo de esos mínimos por combo es matemáticamente el mismo mínimo que
 * tomarlo directo sobre todas las filas de habitación individuales
 * (equivalencia probada en pruebas/tarifarioResumen.test.ts). Nunca incluye
 * nino/nino2/infante — si no, la tarifa de infante, casi siempre la más baja
 * de todas, terminaba mostrándose como el precio "desde".
 */
export function minRoomPvpResumen(filas: FilaResumen[]): number | null {
  const precios = filas
    .map((f) => f.desde_adulto)
    .filter((v): v is number => v != null && v > 0);
  return precios.length ? Math.min(...precios) : null;
}

// Mapea una clave de acomodación del filtro (sencilla/doble/triple/multiple/
// nino/nino2 — mismas claves que `COLS`/`ACOM_OPCIONES` en TarifarioPublic)
// a su columna agregada en `FilaResumen`.
export const CAMPO_ACOM_RESUMEN: Partial<Record<string, keyof FilaResumen>> = {
  sencilla: "precio_sencilla", doble: "precio_doble", triple: "precio_triple", multiple: "precio_multiple",
  nino: "precio_nino", nino2: "precio_nino2",
};

/**
 * ¿Esta fila de resumen ofrece la acomodación `acom`? Habitaciones: solo
 * cuenta un precio > 0 (0 no es "gratis", es "no configurada"). Niño/niño2:
 * cualquier valor NO nulo cuenta, incluido 0 (gratis, sí se publica) — mismo
 * criterio que ya usa `TablaHorizontal` (TarifarioPublic.tsx) sobre el
 * detalle completo (`esRoom = k !== "nino" && k !== "nino2" && ...`).
 */
export function tieneAcomodacionResumen(f: FilaResumen, acom: string): boolean {
  const campo = CAMPO_ACOM_RESUMEN[acom];
  if (!campo) return false;
  const v = f[campo] as number | null;
  if (acom === "nino" || acom === "nino2") return v != null;
  return v != null && v > 0;
}
