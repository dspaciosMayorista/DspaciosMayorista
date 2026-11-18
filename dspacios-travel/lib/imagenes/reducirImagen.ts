// Client-side size reduction for catalog photos (Programas covers, Receptivo photos) BEFORE they reach Storage.
// No dependency and no paid service: canvas + WebP. Only new uploads are affected; stored originals are untouched.
// Anything that cannot be decoded/re-encoded safely (GIF/SVG/HEIC, decode errors, no gain) is uploaded as-is,
// i.e. exactly the previous behaviour.

export const LADO_MAX_PX = 1920;          // longest side; covers render <= ~1400 css px wide (hero) or ~420 px (cards)
export const UMBRAL_BYTES = 600 * 1024;   // a file already this small and within LADO_MAX_PX is left alone
const CALIDAD_WEBP = 0.82;

export function dimensionesReducidas(ancho: number, alto: number, maxLado = LADO_MAX_PX): { w: number; h: number } {
  const lado = Math.max(ancho, alto);
  if (!(lado > maxLado)) return { w: ancho, h: alto };
  const k = maxLado / lado;
  return { w: Math.max(1, Math.round(ancho * k)), h: Math.max(1, Math.round(alto * k)) };
}

/** Tope del ORIGINAL que el navegador acepta decodificar (acota memoria y CPU: una foto de cámara pesada cabe, un archivo de cientos de MB no se intenta abrir). */
export const TOPE_ORIGINAL_BYTES = 40 * 1024 * 1024;

export type PreparacionSubida = { ok: true; archivo: File; reducida: boolean } | { ok: false; error: string };
const enMb = (bytes: number) => (bytes / 1048576).toFixed(1).replace(".", ",");

/**
 * O2 · Prepara una imagen para subirla: PRIMERO se reduce (si el cargador la reduce y el formato lo permite) y SOLO DESPUÉS se aplica el tope de tamaño FINAL.
 * Así un original de cámara de 9 MB entra por su versión reducida, el límite de Storage no cambia y el formato se sigue validando.
 * Si no se puede reducir (GIF/SVG/HEIC, error de decodificación, sin ganancia) y sigue pasando el tope, el error lo dice con claridad.
 * El único trabajo del navegador es UNA decodificación del archivo, y solo si pesa hasta TOPE_ORIGINAL_BYTES.
 */
export async function prepararSubidaImagen(
  file: File,
  opciones: { maxMb: number; reducir: boolean; errorTipo: string },
  reductor: (f: File) => Promise<File> = reducirImagen,
): Promise<PreparacionSubida> {
  if (!file.type.startsWith("image/")) return { ok: false, error: opciones.errorTipo };
  if (file.size > TOPE_ORIGINAL_BYTES) {
    return { ok: false, error: `La imagen original pesa ${enMb(file.size)} MB: es demasiado grande para procesarla aquí (máximo ${enMb(TOPE_ORIGINAL_BYTES)} MB). Usa una versión más liviana.` };
  }
  const maxBytes = opciones.maxMb * 1024 * 1024;
  const archivo = opciones.reducir ? await reductor(file) : file;
  const reducida = archivo !== file;
  if (archivo.size > maxBytes) {
    if (reducida) return { ok: false, error: `Aun reducida, la imagen pesa ${enMb(archivo.size)} MB y el máximo es ${opciones.maxMb} MB. Usa una imagen de menor resolución.` };
    if (opciones.reducir) {
      return { ok: false, error: `La imagen pesa ${enMb(file.size)} MB y supera el máximo de ${opciones.maxMb} MB; este formato (${file.type || "desconocido"}) no se puede reducir automáticamente. Exporta una versión JPG o WebP más liviana.` };
    }
    return { ok: false, error: `La imagen supera ${opciones.maxMb} MB.` };
  }
  return { ok: true, archivo, reducida };
}

export async function reducirImagen(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file); // applies EXIF orientation by default
    const { w, h } = dimensionesReducidas(bmp.width, bmp.height);
    if (w === bmp.width && h === bmp.height && file.size <= UMBRAL_BYTES) { bmp.close(); return file; }
    const lienzo = document.createElement("canvas");
    lienzo.width = w; lienzo.height = h;
    const ctx = lienzo.getContext("2d");
    if (!ctx) { bmp.close(); return file; }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, "image/webp", CALIDAD_WEBP));
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "foto"}.webp`, { type: "image/webp" });
  } catch {
    return file;
  }
}
