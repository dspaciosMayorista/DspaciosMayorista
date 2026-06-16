// Helper PURO para flyers. Convierte URLs (de Google Drive o de nuestro Storage)
// en una URL embebible dentro de un <img>/<iframe> en la página.

export type FlyerTipo = "imagen" | "pdf";

// Extrae el id de un archivo de Google Drive desde los formatos habituales:
//   https://drive.google.com/file/d/<id>/view?...
//   https://drive.google.com/open?id=<id>
//   https://drive.google.com/uc?id=<id>&export=download
//   https://drive.google.com/uc?export=view&id=<id>
// Devuelve null si no se reconoce un id de Drive.
export function extraerDriveId(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  if (!/drive\.google\.com|docs\.google\.com/i.test(url)) return null;

  // /file/d/<id>/
  const mFile = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (mFile) return mFile[1];

  // ?id=<id> u &id=<id>  (open?id=, uc?id=, etc.)
  const mId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (mId) return mId[1];

  return null;
}

export function esDrive(url: string): boolean {
  return extraerDriveId(url) !== null;
}

// Devuelve la URL lista para embeber.
// - Drive (imagen o pdf) → vista "preview" embebible en <iframe>.
// - No-Drive (p. ej. Storage) → la propia URL (se muestra en <img> si imagen,
//   en <iframe> si pdf — eso lo decide el componente según `tipo`).
export function urlEmbebible(url: string, _tipo: FlyerTipo = "imagen"): string {
  const u = (url || "").trim();
  if (!u) return "";
  const id = extraerDriveId(u);
  if (id) return `https://drive.google.com/file/d/${id}/preview`;
  return u;
}

// ¿La url embebible debe ir en un <iframe>? (Drive siempre; pdf siempre).
export function requiereIframe(url: string, tipo: FlyerTipo): boolean {
  return esDrive(url) || tipo === "pdf";
}
