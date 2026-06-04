import Image from "next/image";

// Logo de la empresa. Se usa como IMAGEN, no como fuente. Tres variantes según
// el fondo:
//   - "full":  full color  → fondos claros (sidebar, login, tarjetas blancas)
//   - "white": monocromo blanco → fondos de color / degradado de marca
//   - "black": monocromo negro → impresión / fondos muy claros sin color
//
// Marca blanca: si se pasa `src` (URL del logo configurado en "Información de la
// empresa"), se usa ese; si no, cae al logo por defecto del proyecto.
const SRC = {
  full: "/marca/logo-full.png",
  white: "/marca/logo-white.png",
  black: "/marca/logo-black.png",
} as const;

// Relación de aspecto real de los PNG por defecto (1400 × 725).
const RATIO = 1400 / 725;

export function Logo({
  variant = "full",
  height = 40,
  className,
  priority = false,
  src,
  alt = "Agencia de Viajes",
}: {
  variant?: keyof typeof SRC;
  height?: number;
  className?: string;
  priority?: boolean;
  /** Logo configurado (URL o SVG). Si se pasa, tiene prioridad. */
  src?: string | null;
  alt?: string;
}) {
  // Logo configurado: puede ser SVG o una URL externa (Supabase Storage) → <img>
  // simple, sin optimización de next/image (evita configurar dominios).
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} style={{ height }} className={className} />
    );
  }
  const width = Math.round(height * RATIO);
  return (
    <Image
      src={SRC[variant]}
      alt={alt}
      width={width}
      height={height}
      className={className}
      priority={priority}
    />
  );
}
