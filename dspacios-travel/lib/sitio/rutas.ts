export const SITIO_BASE = "/sitio_web";

export function rutaSitio(slug?: string | null): string {
  if (!slug || slug === "inicio" || slug === "/") return SITIO_BASE;
  return `${SITIO_BASE}/${String(slug).replace(/^\/+/, "")}`;
}
