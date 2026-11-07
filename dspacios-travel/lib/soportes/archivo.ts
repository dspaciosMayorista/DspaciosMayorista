// Soportes de pago (#86): reglas PURAS del archivo. Sin red, sin Supabase, sin next/*: se prueban enteras.
import { createHash } from "node:crypto";

export const TIPOS_SOPORTE = ["application/pdf", "image/jpeg", "image/png"] as const;
export type MimeSoporte = (typeof TIPOS_SOPORTE)[number];

/**
 * Máximo por defecto de un soporte subido a través de una Server Action.
 *
 * ⚠️ NO es un límite remoto demostrado. Vercel Functions rechaza cuerpos de solicitud > 4,5 MB (documentación oficial,
 * «Request body size», 413 FUNCTION_PAYLOAD_TOO_LARGE) y el multipart añade sobrecarga, de modo que 4 MB es el valor
 * conservador. El bucket `soportes-pago` limita a 5 MB como segunda barrera. Se puede bajar o subir con SOPORTES_MAX_BYTES,
 * pero nunca por encima de TOPE_FUNCION_BYTES mientras la subida pase por una función.
 */
export const MAX_BYTES_POR_DEFECTO = 4_000_000;
export const TOPE_FUNCION_BYTES = 4_400_000;
export const MIN_BYTES_CONFIGURABLE = 100_000;

/** Lee el límite configurable. Un valor ausente, no numérico o fuera de rango cae al valor por defecto (nunca amplía el tope). */
export function maxBytesSoporte(valorEnv: string | undefined | null): number {
  const n = Number(valorEnv);
  if (!valorEnv || !Number.isFinite(n) || n < MIN_BYTES_CONFIGURABLE) return MAX_BYTES_POR_DEFECTO;
  return Math.min(Math.floor(n), TOPE_FUNCION_BYTES);
}

export function formatoMaximo(bytes: number): string {
  return `${(bytes / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`;
}

/** Tipo REAL por los primeros bytes (firma). El nombre y el Content-Type que manda el navegador no cuentan. */
export function detectarTipo(bytes: Uint8Array): { mime: MimeSoporte; ext: "pdf" | "jpg" | "png" } | null {
  const b = bytes;
  // %PDF- (puede haber hasta 1024 bytes de basura antes, pero aquí se exige al inicio: es lo que producen los generadores normales)
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return { mime: "application/pdf", ext: "pdf" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: "image/png", ext: "png" };
  return null;
}

export type ArchivoValidado = { ok: true; mime: MimeSoporte; ext: "pdf" | "jpg" | "png"; size: number; sha256: string } | { ok: false; error: string };

/** Valida tamaño REAL (de los bytes leídos, no de `File.size`) y tipo REAL; calcula el hash SOBRE LOS MISMOS BYTES que se guardarán. */
export function validarArchivo(bytes: Uint8Array, maxBytes: number): ArchivoValidado {
  if (bytes.byteLength === 0) return { ok: false, error: "El archivo está vacío." };
  if (bytes.byteLength > maxBytes) return { ok: false, error: `El archivo supera el máximo de ${formatoMaximo(maxBytes)}.` };
  const tipo = detectarTipo(bytes);
  if (!tipo) return { ok: false, error: "Solo se admiten archivos PDF, JPG o PNG." };
  return { ok: true, ...tipo, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** Nombre mostrable: sin rutas ni caracteres de control, máx. 200. No se usa para construir la ruta en Storage. */
export function nombreSeguro(nombre: string | null | undefined): string {
  const limpio = String(nombre ?? "").replace(/[\\/]+/g, "_").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (limpio || "comprobante").slice(0, 200);
}

/** Ruta definitiva en el bucket: la genera SIEMPRE el servidor (contrato + uuid + extensión validada). */
export function rutaSoporte(numeroContrato: string, uuid: string, ext: "pdf" | "jpg" | "png"): string {
  return `${numeroContrato}/${uuid}.${ext}`;
}

/** «Excedido» no se guarda: se calcula. */
export function estaExcedido(vigentes: number, abonos: number): boolean {
  return vigentes > abonos;
}

/** ¿Cabe un soporte NUEVO? (reemplazar y retirar no dependen de esto: no suben el conteo). */
export function cabeUnoNuevo(vigentes: number, abonos: number): boolean {
  return vigentes + 1 <= abonos;
}
