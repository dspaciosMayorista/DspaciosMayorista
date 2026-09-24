"use client";

import { useEffect, useRef, useState } from "react";

// Decide si una tabla debe apilarse en tarjetas midiendo el ancho REAL
// disponible de su contenedor (ResizeObserver), no el viewport — un
// `@media` nunca sabe cuánto ancho le queda de verdad a un hijo de un
// layout con sidebar/grid/flex (ver el comentario largo en
// ResponsiveTable.module.css). `minWidth` es el mismo número que ya lleva
// `min-w-[Npx]` en el <table> — la tabla se apila cuando el contenedor
// mide MENOS que eso.
//
// Arranca en `stack: true` (conservador: nunca se muestra una tabla que
// pueda desbordar) hasta la primera medición real; en SSR/primer render de
// cliente ambos coinciden (sin mismatch de hidratación), y el
// ResizeObserver corrige el estado apenas el layout real está disponible.
export function useStackTabla(minWidth: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [stack, setStack] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setStack(el.clientWidth < minWidth);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [minWidth]);

  return { ref, stack };
}
