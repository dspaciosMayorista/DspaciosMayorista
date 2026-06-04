import Image from "next/image";

// Logo oficial D'spacios Travel (manual de marca). Se usa como IMAGEN, no como
// fuente. Tres variantes según el fondo:
//   - "full":  full color  → fondos claros (sidebar, login, tarjetas blancas)
//   - "white": monocromo blanco → fondos de color / degradado de marca
//   - "black": monocromo negro → impresión / fondos muy claros sin color
const SRC = {
  full: "/marca/logo-full.png",
  white: "/marca/logo-white.png",
  black: "/marca/logo-black.png",
} as const;

// Relación de aspecto real de los PNG (1400 × 725).
const RATIO = 1400 / 725;

export function Logo({
  variant = "full",
  height = 40,
  className,
  priority = false,
}: {
  variant?: keyof typeof SRC;
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  const width = Math.round(height * RATIO);
  return (
    <Image
      src={SRC[variant]}
      alt="D'spacios Travel — Mayorista de Turismo"
      width={width}
      height={height}
      className={className}
      priority={priority}
    />
  );
}
