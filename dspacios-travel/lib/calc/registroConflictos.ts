// #43/#60 incremento 2 — Registro deduplicado del motivo interno de un empate de prioridad (N4).
//
// ALCANCE: la deduplicación vive en la MEMORIA DE ESTA INSTANCIA/PROCESO. En Vercel cada
// instancia de función tiene la suya y se pierde al reciclarse: no es global. El objetivo es no
// inundar el registro del servidor cuando mil cotizaciones tropiezan con el mismo conflicto, no
// garantizar un único aviso en todo el sistema. Sin escrituras en base, sin reintentos.
//
// Acotado: cada clave caduca a los `TTL_MS` y nunca hay más de `MAX_ENTRADAS` (al llenarse se
// descartan primero las caducadas y luego las más antiguas).

export const TTL_MS = 10 * 60_000;
export const MAX_ENTRADAS = 500;

export type ConflictoEmpate = {
  vigencias: string[];   // nombres de las vigencias empatadas, ordenados
  prioridad: number;
  fecha: string;         // noche (yyyy-mm-dd)
  clave: string;         // contexto estable (p. ej. combinación) para deduplicar
};

const vistos = new Map<string, number>(); // clave -> instante en que se registró

export function claveConflicto(c: ConflictoEmpate): string {
  return JSON.stringify([c.clave, c.prioridad, c.vigencias]);
}

/** Registra el conflicto si no se registró ya dentro del TTL. Devuelve si lo emitió. */
export function registrarConflictoEmpate(
  c: ConflictoEmpate,
  ahora: number = Date.now(),
  emitir: (mensaje: string, detalle: ConflictoEmpate) => void = (m, d) => console.warn(m, d),
): boolean {
  const k = claveConflicto(c);
  const previo = vistos.get(k);
  if (previo !== undefined && ahora - previo < TTL_MS) return false;
  vistos.delete(k);
  if (vistos.size >= MAX_ENTRADAS) {
    for (const [kk, t] of vistos) if (ahora - t >= TTL_MS) vistos.delete(kk);
    while (vistos.size >= MAX_ENTRADAS) vistos.delete(vistos.keys().next().value as string);
  }
  vistos.set(k, ahora);
  emitir(`[#43 empate de prioridad] ${c.vigencias.join(" y ")} (prioridad ${c.prioridad}) el ${c.fecha}: la opción no se muestra`, c);
  return true;
}

/** Solo para pruebas. */
export function _tamanoRegistroConflictos(): number { return vistos.size; }
export function _vaciarRegistroConflictos(): void { vistos.clear(); }
