// Utilidades para incrustar videos de YouTube por URL (no consumen Supabase).

/** Extrae el ID de video de las formas comunes de URL de YouTube. */
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  // Patrones: youtu.be/ID · watch?v=ID · /embed/ID · /shorts/ID · /live/ID
  const m =
    u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/) ||
    u.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // Si pegaron solo el ID de 11 caracteres.
  if (/^[A-Za-z0-9_-]{11}$/.test(u)) return u;
  return null;
}

/**
 * URL de embed para usar el video como FONDO: autoplay, silenciado, en bucle,
 * sin controles ni info. Devuelve null si la URL no es un YouTube válido.
 */
export function youtubeBgEmbed(url: string | null | undefined): string | null {
  const id = youtubeId(url);
  if (!id) return null;
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: "0",
    loop: "1",
    playlist: id, // necesario para que loop funcione con un solo video
    playsinline: "1",
    modestbranding: "1",
    rel: "0",
    showinfo: "0",
    iv_load_policy: "3",
    disablekb: "1",
  });
  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}
