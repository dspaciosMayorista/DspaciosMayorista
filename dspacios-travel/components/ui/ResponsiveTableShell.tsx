"use client";

import type { ReactNode } from "react";
import { useStackTabla } from "./useStackTabla";
import styles from "./ResponsiveTable.module.css";

// Envoltorio genérico para CUALQUIER tabla del Dashboard que deba apilarse
// en tarjetas cuando su contenedor no tiene el ancho real para mostrarse
// como tabla — ver el comentario largo en ResponsiveTable.module.css sobre
// por qué esto reemplazó el `@media` de viewport. `minWidth` es el mismo
// número que ya lleva `min-w-[Npx]` en el <table> hijo.
//
// Es un componente "use client" real (no una función auxiliar invocada a
// mano): eso es a propósito — `useStackTabla` usa hooks, y montarlo como
// <ResponsiveTableShell> en JSX (en vez de llamarlo como función) es lo que
// le da a React una identidad de componente propia por instancia, así dos
// tablas en la misma página (ej. "activas"/"históricas") miden su ancho de
// forma independiente sin violar las reglas de hooks.
//
// Sirve tanto desde un componente cliente como desde un Server Component
// (Next.js permite pasarle JSX ya renderizado en el servidor como children
// a un límite de cliente) — así una page.tsx server-only también puede usar
// este wrapper sin volverse "use client" completa.
export function ResponsiveTableShell({
  minWidth,
  className = "",
  children,
}: {
  minWidth: number;
  className?: string;
  children: ReactNode;
}) {
  const { ref, stack } = useStackTabla(minWidth);
  return (
    <div ref={ref} className={`${stack ? styles.stacked : ""} ${className}`}>
      {children}
    </div>
  );
}
