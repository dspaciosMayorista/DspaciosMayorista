import { youtubeBgEmbed } from "@/lib/youtube";

/**
 * Video de YouTube como fondo a pantalla completa del contenedor padre.
 * El padre debe ser `relative` y `overflow-hidden`. El iframe se escala para
 * cubrir el área (object-fit: cover simulado con un wrapper 16:9 gigante).
 * Si la URL no es válida, no renderiza nada (cae al fondo de siempre).
 */
export function BackgroundVideo({ url, overlay = 0.35 }: { url: string | null | undefined; overlay?: number }) {
  const src = youtubeBgEmbed(url);
  if (!src) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Wrapper que mantiene 16:9 y se agranda para cubrir el contenedor */}
      <div className="absolute left-1/2 top-1/2 h-[max(100%,56.25vw)] w-[max(100%,177.78vh)] -translate-x-1/2 -translate-y-1/2">
        <iframe
          src={src}
          title="Video de fondo"
          allow="autoplay; encrypted-media; picture-in-picture"
          className="h-full w-full"
          frameBorder={0}
        />
      </div>
      {overlay > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: overlay }} />}
    </div>
  );
}
