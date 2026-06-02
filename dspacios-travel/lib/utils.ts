import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formatea un número como moneda colombiana: 1.250.000 */
export function formatCOP(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/** Formatea fecha ISO a texto legible en español */
export function formatFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Formatea una fecha (YYYY-MM-DD) a texto largo: "12 de agosto de 2026" */
export function formatFechaLarga(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Forzamos hora local mediodía para evitar corrimientos por zona horaria
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Etiqueta de destino con su código IATA entre paréntesis: "CARTAGENA (CTG)" */
export function destinoLabel(nombre: string | null | undefined, iata?: string | null): string {
  const n = (nombre ?? "").toUpperCase();
  return iata ? `${n} (${iata})` : n;
}

/** Edad en años cumplidos a una fecha de referencia (def. hoy) */
export function calcularEdad(
  nacimiento: string | null | undefined,
  referencia?: string | null
): number | null {
  if (!nacimiento) return null;
  const nac = new Date(`${nacimiento}T12:00:00`);
  if (isNaN(nac.getTime())) return null;
  const ref = referencia ? new Date(`${referencia}T12:00:00`) : new Date();
  let edad = ref.getFullYear() - nac.getFullYear();
  const m = ref.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < nac.getDate())) edad--;
  return edad >= 0 ? edad : null;
}
