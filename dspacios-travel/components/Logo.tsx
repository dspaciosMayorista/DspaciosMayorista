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

// Minorista tiene un solo archivo (full-color, fondo transparente — se lee
// bien tanto en fondos claros como oscuros porque las letras ya son de
// color, no blancas) — se usa sin importar el `variant` pedido.
const LOGO_MINORISTA = "/marca/logo-minorista-white.png";
const RATIO_MINORISTA = 2485 / 890;

export function Logo({
  variant = "full",
  height = 40,
  className,
  priority = false,
  tenant,
}: {
  variant?: keyof typeof SRC;
  height?: number;
  className?: string;
  priority?: boolean;
  // Tenant dueño del documento/pantalla — si es "minorista", usa su propio
  // logo en vez del de mayorista (default cuando no se pasa: mayorista).
  tenant?: "mayorista" | "minorista";
}) {
  const esMinorista = tenant === "minorista";
  const src = esMinorista ? LOGO_MINORISTA : SRC[variant];
  const ratio = esMinorista ? RATIO_MINORISTA : RATIO;
  const width = Math.round(height * ratio);
  return (
    <Image
      src={src}
      alt={esMinorista ? "D'spacios Travel" : "D'spacios Travel — Mayorista de Turismo"}
      width={width}
      height={height}
      className={["brand-logo", className].filter(Boolean).join(" ")}
      priority={priority}
    />
  );
}
