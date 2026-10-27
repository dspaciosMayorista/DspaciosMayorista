// PR #409 — Blackouts de un programa: alcance («Solo fecha de entrada» | «Cualquier día del viaje»), rango del viaje con las noches adicionales y
// validación de ambos extremos al guardar. Módulo PURO (sin Supabase): lo comparten el editor, la calculadora, la reserva y las pruebas.
//
// Reglas:
//   · alcance 'entrada' (el comportamiento de siempre, y el de TODO blackout existente): bloquea si la fecha de ENTRADA cae dentro del rango.
//   · alcance 'viaje': bloquea si el rango del blackout se TRASLAPA con algún día del viaje, desde la entrada hasta el regreso, ambos incluidos.
//     En un programa por hotel el viaje incluye las noches adicionales (regreso = entrada + noches incluidas + adicionales).
//   · los extremos del blackout son inclusivos. Una fila sin alguno de sus extremos no bloquea nada (compatibilidad con lo cargado antes de la 246),
//     pero ya no se puede guardar.
import { esFechaIso, fechaLegible, sumarDiasIso } from "./estanciaHotel88.ts";

export type AlcanceBlackout = "entrada" | "viaje";
export const ALCANCES_BLACKOUT: readonly AlcanceBlackout[] = ["entrada", "viaje"];
export const ETIQUETA_ALCANCE: Record<AlcanceBlackout, string> = { entrada: "Solo fecha de entrada", viaje: "Cualquier día del viaje" };

export type BlackoutPrograma = { fecha_inicio: string | null; fecha_fin: string | null; motivo?: string | null; alcance?: string | null };

/** Todo valor que no sea 'viaje' (incluido el null de lo cargado antes de la 246) conserva el comportamiento de fecha de entrada. */
export const normalizarAlcance = (a: unknown): AlcanceBlackout => (a === "viaje" ? "viaje" : "entrada");

export type RangoViaje = { desde: string; hasta: string };

/** Rango del viaje: de la entrada al regreso (ambos incluidos). `noches` = noches incluidas + adicionales; sin dato, el viaje es solo la entrada. */
export function rangoViaje(entrada: string, noches: number | null | undefined): RangoViaje {
  const n = Number.isInteger(noches) && (noches as number) > 0 ? (noches as number) : 0;
  return { desde: entrada, hasta: n > 0 ? sumarDiasIso(entrada, n) : entrada };
}

/** ¿Este blackout bloquea el viaje? */
export function bloquea(b: BlackoutPrograma, rango: RangoViaje): boolean {
  if (!b.fecha_inicio || !b.fecha_fin) return false;
  return normalizarAlcance(b.alcance) === "viaje"
    ? b.fecha_inicio <= rango.hasta && b.fecha_fin >= rango.desde
    : rango.desde >= b.fecha_inicio && rango.desde <= b.fecha_fin;
}

/** El primer blackout que bloquea el viaje (opcionalmente solo de un alcance), o null. */
export function blackoutQueAplica(blackouts: readonly BlackoutPrograma[], rango: RangoViaje, solo?: AlcanceBlackout): BlackoutPrograma | null {
  return blackouts.find((b) => (solo == null || normalizarAlcance(b.alcance) === solo) && bloquea(b, rango)) ?? null;
}

/** Mensaje de negocio de un blackout que bloquea. */
export function mensajeBlackout(b: BlackoutPrograma, rango: RangoViaje): string {
  const motivo = b.motivo ? ` (${b.motivo})` : "";
  if (normalizarAlcance(b.alcance) === "entrada") return `La fecha cae en un blackout${motivo}.`;
  return `El viaje del ${fechaLegible(rango.desde)} al ${fechaLegible(rango.hasta)} cae en un blackout${motivo}: no se puede viajar entre el ${fechaLegible(b.fecha_inicio!)} y el ${fechaLegible(b.fecha_fin!)}.`;
}

export type BlackoutEntrada = { fechaInicio: string; fechaFin: string; motivo: string; ciudad: string; alcance: string };

/**
 * Valida los blackouts ANTES de guardarlos: ambos extremos obligatorios y reales, inicio ≤ fin y un alcance conocido. Una fila totalmente vacía se
 * ignora. Mensaje legible o null. (La base repite lo esencial: CHECK y `guardar_programa_blackouts`, migración 246.)
 */
export function filaBlackoutVacia(f: Pick<BlackoutEntrada, "fechaInicio" | "fechaFin" | "motivo"> & { ciudad?: string }): boolean {
  return !f.fechaInicio.trim() && !f.fechaFin.trim() && !f.motivo.trim() && !(f.ciudad ?? "").trim();
}

export function validarBlackoutsParaGuardar(filas: readonly (BlackoutEntrada & { ciudad?: string })[]): string | null {
  let n = 0;
  for (const f of filas) {
    // Solo una fila TOTALMENTE en blanco se ignora: una con solo ciudad (o solo motivo) se rechaza, no se descarta en silencio.
    if (filaBlackoutVacia(f)) continue;
    n++;
    if (!f.fechaInicio.trim() || !f.fechaFin.trim()) return `El blackout ${n} necesita fecha de inicio y de fin (no se guarda con un solo extremo).`;
    if (!esFechaIso(f.fechaInicio) || !esFechaIso(f.fechaFin)) return `El blackout ${n} tiene una fecha que no existe.`;
    if (f.fechaInicio > f.fechaFin) return `El blackout ${n} termina (${fechaLegible(f.fechaFin)}) antes de empezar (${fechaLegible(f.fechaInicio)}).`;
    if (!(ALCANCES_BLACKOUT as readonly string[]).includes(f.alcance)) return `Elige el alcance del blackout ${n}: solo la fecha de entrada o cualquier día del viaje.`;
  }
  return null;
}
