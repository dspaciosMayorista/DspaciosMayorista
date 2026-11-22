// O-3 — preparación OPCIONAL de la solicitud de contrato por el aliado: comprobantes (evidencia, NO un pago) y pasajeros adicionales. Reglas PURAS (sin red).
// El servidor y la base (migración 325) vuelven a validar todo; esto evita viajes inútiles y fija los textos.
import { documentoPasajeroAdmitido, TIPOS_DOC_PASAJERO } from "@/lib/personas/tiposDocumento";
import { LIMITE_CAPTURA_ADICIONALES, universoDeViajeros, type UniversoViajeros } from "@/lib/reservar/universoViajeros";

export const MAX_EVIDENCIAS_COTIZACION = 5;

export type PasajeroAliado = { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string; fechaNacimiento: string; nacionalidad: string };
export type EvidenciaCotizacion = { id: number; cotizacion_id: number; nombre_original: string; mime: string; size_bytes: number; subido_en: string };
/** ¿Esta cotización se convierte por una pantalla que CONSUME la lista de pasajeros del aliado? Si no, se dice antes de guardar (nunca se promete un traspaso que no ocurre). */
export type CapturaPasajeros = { ok: true } | { ok: false; motivo: string };
export type PreparacionCotizacion = { evidencias: EvidenciaCotizacion[]; pasajeros: PasajeroAliado[]; captura: CapturaPasajeros; /** Universo DECLARADO de viajeros (exacto, o ambiguo en un carrito con varias unidades independientes). */ universo: UniversoViajeros };

/** Lo que se le dice al aliado cuando una lista supera el límite técnico de captura (misma frase en la acción y en la base): se explica, no se trunca. */
export const mensajeLimiteCaptura = (): string => `Aquí se pueden dejar hasta ${LIMITE_CAPTURA_ADICIONALES} pasajeros adicionales; el personal de D'spacios completa el resto al convertir la cotización.`;

export const MOTIVO_SIN_CAPTURA = "Esta cotización se convierte con el titular que ya registraste; no admite pasajeros adicionales escritos aquí. Si faltan viajeros, díselo a tu asesor de D'spacios.";
export const MOTIVO_YA_TRAE_PASAJEROS = "Esta cotización ya trae sus pasajeros (los capturó D'spacios); no se reemplazan desde aquí.";

/** Misma regla que la base (migración 325): solo el carrito y el tarifario SIN pasajeros previos consumen la lista; vaciarla siempre se permite. */
export function capturaPasajerosAliado(tipo: string | null | undefined, nPasajerosExistentes: number): CapturaPasajeros {
  if (tipo !== "carrito" && tipo !== "tarifario") return { ok: false, motivo: MOTIVO_SIN_CAPTURA };
  if (nPasajerosExistentes > 0) return { ok: false, motivo: MOTIVO_YA_TRAE_PASAJEROS };
  return { ok: true };
}

export const pasajeroAliadoVacio = (): PasajeroAliado => ({ nombres: "", apellidos: "", tipoDoc: "", numeroDoc: "", fechaNacimiento: "", nacionalidad: "" });

/** Pasajeros adicionales posibles: los viajeros cotizados menos el titular (que ya se captura en el checkout). */
export const maxPasajerosAdicionales = (paxCotizados: number | null | undefined): number => Math.max(0, Math.floor(Number(paxCotizados) || 1) - 1);

/**
 * `primero` = número que se muestra para la PRIMERA fila: el panel del aliado rotula a los adicionales desde «Pasajero 2» (el titular es el 1), así que el mensaje usa el mismo número
 * que ve en pantalla (antes decía «Pasajero 1» sobre la fila rotulada «Pasajero 2»).
 */
/** Mensaje del primer problema de la lista (misma regla que la base: nombres y apellidos obligatorios; documento = regla de la conversión). null = válida. */
export function errorPasajerosAliado(lista: PasajeroAliado[], hoy: string, primero = 1): string | null {
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i], n = i + primero;
    if (!p.nombres.trim() || !p.apellidos.trim()) return `Pasajero ${n}: nombres y apellidos son obligatorios.`;
    if (p.tipoDoc && !(TIPOS_DOC_PASAJERO as readonly string[]).includes(p.tipoDoc)) return `Pasajero ${n}: tipo de documento inválido.`;
    if (p.numeroDoc.trim()) {
      if (!p.tipoDoc) return `Pasajero ${n}: elige el tipo de documento.`;
      if (!documentoPasajeroAdmitido(p.tipoDoc, p.numeroDoc)) return `Pasajero ${n}: el documento debe ser solo números (excepto Pasaporte).`;
    }
    if (p.fechaNacimiento && (!/^\d{4}-\d{2}-\d{2}$/.test(p.fechaNacimiento) || p.fechaNacimiento > hoy)) return `Pasajero ${n}: fecha de nacimiento inválida.`;
  }
  return null;
}

/** Quita lo que la base descartaría de todos modos (filas totalmente vacías). Una fila a medias NO se descarta: se valida y se pide completarla. */
export const sinFilasVacias = (lista: PasajeroAliado[]): PasajeroAliado[] =>
  lista.filter((p) => [p.nombres, p.apellidos, p.numeroDoc, p.fechaNacimiento].some((x) => x.trim() !== ""));

/** Resumen legible de un pasajero para la vista compacta: línea principal + lo que aún falta (documento y nacimiento son opcionales, pero se dicen para que lo incompleto no pase inadvertido). */
export function resumenPasajeroAliado(p: PasajeroAliado): { titulo: string; detalle: string; faltan: string[] } {
  const faltan: string[] = [];
  if (!p.nombres.trim() || !p.apellidos.trim()) faltan.push("nombre y apellido");
  if (!p.numeroDoc.trim()) faltan.push("documento");
  if (!p.fechaNacimiento) faltan.push("nacimiento");
  const nombre = `${p.nombres.trim()} ${p.apellidos.trim()}`.trim();
  const doc = p.numeroDoc.trim() ? `${p.tipoDoc ? `${p.tipoDoc} ` : ""}${p.numeroDoc.trim()}` : "";
  return { titulo: nombre || "Sin nombre", detalle: [doc, p.fechaNacimiento ? `nac. ${p.fechaNacimiento}` : ""].filter(Boolean).join(" · "), faltan };
}

/** Código de la base (F47xx) → mensaje; F4720/F4721 traen su propio texto tras el prefijo. */
export function mensajeErrorPasajeros(code: string | null | undefined, message: string | null | undefined): string {
  if ((code === "F4720" || code === "F4721" || code === "F4722" || code === "F4723") && message) return message.replace(/^F47\d\d:\s*/, "");
  switch (code) {
    case "F4701": return "Tu cuenta no puede hacerlo.";
    case "F4702": return "No encontramos esa cotización entre las tuyas.";
    case "F4703": return "Esa cotización ya es un contrato.";
    case "F4704": return "Esta cotización no admite esta acción.";
    case "F4705": return "La cotización venció. Genera una nueva desde el tarifario.";
    case "F4706": return "La fecha de salida ya pasó. Genera una nueva cotización.";
    default: return "No pudimos guardar los pasajeros. Intenta de nuevo en unos minutos.";
  }
}
