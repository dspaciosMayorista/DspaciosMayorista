// Estado y resumen de la fila de pasajero en las pantallas de conversión del personal (carrito y ordinaria). PURO, sin red.
// Una fila se PUEDE compactar solo si no tiene problemas que bloqueen la generación; lo que falta pero no bloquea se dice igual («Faltan: …»).
import { documentoPasajeroAdmitido } from "@/lib/personas/tiposDocumento";

export type FilaConversion = { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; fechaNacimiento: string; responsableIndex?: number | null };
export type ContextoFila = { edad: number | null; esInfante: boolean };

export function estadoFilaConversion(p: FilaConversion, c: ContextoFila): { problemas: string[]; faltan: string[] } {
  const problemas: string[] = [];
  if (!p.nombres.trim() || !p.apellidos.trim()) problemas.push("nombres y apellidos");
  if (!documentoPasajeroAdmitido(p.tipoDoc, p.numeroDoc)) problemas.push("documento inválido");
  if (c.edad != null && c.edad < 18 && p.tipoDoc === "CC") problemas.push("un menor no puede tener CC");
  if (c.esInfante && p.responsableIndex == null) problemas.push("adulto responsable");
  const faltan: string[] = [];
  if (!p.numeroDoc.trim()) faltan.push("documento");
  if (!p.fechaNacimiento) faltan.push("nacimiento");
  return { problemas, faltan };
}

export function claseDePasajero(c: ContextoFila): string {
  if (c.edad == null) return "—";
  return `${c.esInfante ? "Infante" : c.edad < 12 ? "Niño" : "Adulto"} · ${c.edad}a`;
}

/** Línea legible de la fila compacta: nombre, documento, nacimiento, clase por edad y (infante) el responsable elegido. */
export function resumenFilaConversion(p: FilaConversion, c: ContextoFila, nombreResponsable: string | null): { titulo: string; detalle: string } {
  const nombre = `${p.nombres.trim()} ${p.apellidos.trim()}`.trim() || "Sin nombre";
  const doc = p.numeroDoc.trim() ? `${p.tipoDoc} ${p.numeroDoc.trim()}` : "";
  const partes = [doc, p.fechaNacimiento ? `nac. ${p.fechaNacimiento}` : "", claseDePasajero(c) !== "—" ? claseDePasajero(c) : "", c.esInfante && nombreResponsable ? `responsable: ${nombreResponsable}` : ""];
  return { titulo: nombre, detalle: partes.filter(Boolean).join(" · ") };
}
