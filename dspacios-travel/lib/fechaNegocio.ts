// ─────────────────────────────────────────────────────────────────────────
// Fecha de NEGOCIO: la regla única de "qué día es hoy" para fechas
// calendario (columnas `date`, campos YYYY-MM-DD) en toda la app.
//
// El día de negocio es el día civil en America/Bogota, sin importar la zona
// del servidor (Vercel corre en UTC) ni la del navegador. Bogotá es UTC−5
// todo el año (sin horario de verano), así que desde las 7 p. m. la fecha UTC
// ya es la del día siguiente: `new Date().toISOString().slice(0, 10)` registra
// un abono de las 19:30 del 30-sep como del 1-oct. Por eso un "hoy" calendario
// NUNCA se calcula con toISOString().
//
// Qué NO es fecha de negocio: los timestamps (`created_at`, `updated_at`,
// columnas `timestamptz`) siguen siendo instantes UTC con `toISOString()`
// completo — no se truncan ni se convierten.
//
// Módulo puro y sin dependencias: lo usan Server Actions, componentes de
// cliente y los motores de cálculo (lib/calc/paquetes.ts, lib/reservar/
// origen.ts, lib/cotizacion/vigencia.ts delegan aquí).
// ─────────────────────────────────────────────────────────────────────────

export const ZONA_NEGOCIO = "America/Bogota";

const FORMATO_DIA = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA_NEGOCIO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Día de negocio (YYYY-MM-DD en America/Bogota) del instante dado — por defecto, ahora. */
export function fechaNegocio(instante: Date = new Date()): string {
  const partes = FORMATO_DIA.formatToParts(instante);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

/**
 * La fecha que el usuario eligió, tal cual; si no eligió ninguna (vacía o
 * ausente), el día de negocio. Nunca reinterpreta ni corre una fecha elegida.
 */
export function fechaElegidaONegocio(elegida: string | null | undefined, instante: Date = new Date()): string {
  const f = (elegida ?? "").trim();
  return f || fechaNegocio(instante);
}
