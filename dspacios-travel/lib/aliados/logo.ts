// #32 (ADL-039) — Logo del aliado: reglas PURAS (sin I/O). El logo es PRESENTACIÓN de las cotizaciones del aliado; nunca cambia el emisor legal.

export const MAX_LOGO_BYTES = 1_048_576;
export const BUCKET_LOGOS = "aliado-logos";
export type MimeLogo = "image/png" | "image/jpeg";
/** Lo que un documento necesita para pintar la marca del aliado: la ruta autorizada del archivo y el nombre (texto alternativo). */
export type LogoAliadoDoc = { src: string; nombre: string };

/** Tipo REAL por los primeros bytes (no por la extensión ni el `type` del navegador). SVG, GIF, WebP, PDF… → null. */
export function detectarMimeLogo(b: Uint8Array): MimeLogo | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

export type LogoValido = { ok: true; mime: MimeLogo; ext: "png" | "jpg"; size: number } | { ok: false; error: string };

export function validarLogo(b: Uint8Array | null | undefined): LogoValido {
  if (!b || b.length === 0) return { ok: false, error: "Elige una imagen." };
  if (b.length > MAX_LOGO_BYTES) return { ok: false, error: "El logo no puede superar 1 MB." };
  const mime = detectarMimeLogo(b);
  if (!mime) return { ok: false, error: "El logo debe ser una imagen PNG o JPG." };
  return { ok: true, mime, ext: mime === "image/png" ? "png" : "jpg", size: b.length };
}

/** Ruta direccionada por contenido: un logo nuevo nunca pisa el archivo del anterior. */
export function rutaLogo(aliadoId: number, sha256: string, ext: string): string {
  return `${aliadoId}/${sha256}.${ext}`;
}

const entero = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Aliado dueño de una cotización, SOLO de lo que la propia cotización guardó (nunca de la URL ni de un nombre). Orden de autoridad:
 *   1) `cotizaciones.aliado_id` (comparativas #35 y NETO manual #48) · 2) `payload.b2bAsistido.aliado_id` (carrito asistido #102) ·
 *   3) `comision_plan.aliado_id` de la cotización (manual PVP #97). Ninguno ⇒ null (B2C o histórica): sin logo, documento igual que siempre.
 */
export function aliadoIdDeCotizacion(c: { aliado_id?: unknown; b2b_aliado?: unknown; plan_aliado?: unknown }): number | null {
  return entero(c.aliado_id) ?? entero(c.b2b_aliado) ?? entero(c.plan_aliado);
}

/** Cabeceras de una respuesta con un archivo PRIVADO: nada de caché compartida y el navegador no reinterpreta el contenido. */
export function cabecerasLogoPrivado(mime: string): Record<string, string> {
  return {
    "Content-Type": mime,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": 'inline; filename="logo"',
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}
