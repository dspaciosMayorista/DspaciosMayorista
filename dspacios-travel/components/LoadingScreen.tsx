import Image from "next/image";
import styles from "./LoadingScreen.module.css";

// Isotipo D'spacios Travel (avión + espiral) — NO existe como archivo de
// marca aparte: se extrajo por selección de píxeles (no se redibujó) desde
// cada logo oficial completo en `public/marca/logo-*.png`, aislando el
// grupo avión+espiral y excluyendo las letras vecinas ("I"/"S" de
// D'SPACIOS). Ver `docs/marca/README.md` para el detalle del proceso y
// cómo regenerar estos PNG si el logo oficial cambia.
const ISOTIPO_SRC = {
  full: "/marca/isotipo-full.png",
  black: "/marca/isotipo-black.png",
  white: "/marca/isotipo-white.png",
} as const;

type Props = {
  /** Color del isotipo. "full" (degradado de marca) sirve para fondos
   *  claros; "white" para fondos oscuros/de color; "black" para fondos muy
   *  claros sin color. Default: "full". */
  variant?: keyof typeof ISOTIPO_SRC;
  /** Texto anunciado a lectores de pantalla (visualmente oculto). */
  label?: string;
  /** true (default) = cubre el viewport completo (pensado para usarse como
   *  contenido de un `loading.tsx` de ruta, o mientras se resuelve una
   *  transición de pantalla completa). false = cubre el contenedor padre
   *  más cercano con `position: relative` (una sección/tarjeta, no toda la
   *  pantalla) — para eso el padre debe tener `position: relative`. */
  fullScreen?: boolean;
  className?: string;
};

/**
 * Indicador de carga de marca — SOLO para pantalla/vista completa (una ruta
 * entera, una sección que reemplaza todo su contenido). No usar para
 * botones, inputs o consultas puntuales: para eso un spinner inline pequeño
 * (ej. `Loader2` de lucide-react) sigue siendo lo correcto.
 *
 * Se retira solo con dejar de renderizarla: no tiene temporizador ni estado
 * propio, así que desaparece igual si la carga termina bien o si falla (el
 * padre deja de montarla al resolver o al mostrar su propio estado de
 * error) — nunca queda visible "pegada".
 */
export function LoadingScreen({ variant = "full", label = "Cargando…", fullScreen = true, className }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={[styles.wrap, fullScreen ? styles.fullScreen : styles.contained, className].filter(Boolean).join(" ")}
    >
      <div className={styles.markBox}>
        <Image src={ISOTIPO_SRC[variant]} alt="" aria-hidden fill sizes="96px" priority className={styles.mark} />
      </div>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
