// #43/#60 3c — Regeneración ACOTADA de los tarifarios de un hotel (puro, sin lecturas).
// `ejecutarAcotado`: como mucho `limite` tareas a la vez, en orden, sin lanzar (cada resultado como allSettled).
// `clasificarRegeneracion`: qué se puede afirmar después — publicados, en publicación por lotes o fallidos.

/** Paquetes que se regeneran A LA VEZ tras un cambio de hotel, bloqueo o servicio. Cada generación ya está acotada (incluido el «desde»
 *  por estadía real: 4 s por generación), así que el peor caso simultáneo es este número × ese presupuesto, no N paquetes × presupuesto. */
export const CONCURRENCIA_REGENERACION = 2;

export async function ejecutarAcotado<T, R>(items: readonly T[], limite: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      try { out[i] = { status: "fulfilled", value: await fn(items[i]) }; }
      catch (reason) { out[i] = { status: "rejected", reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(Math.floor(limite) || 1, items.length)) }, trabajador));
  return out;
}

export type ResultadoRegeneracionHotel = {
  /** Paquetes activos que usan el hotel (null = no se pudo consultar: no se sabe si hay que regenerar algo). */
  paquetes: number | null;
  actualizados: number;
  /** Publicación por lotes que continúa sola en la base (aún no publicada del todo). */
  enCurso: number;
  fallidos: { paqueteId: number; error: string }[];
};
type ResultadoGenerar = { ok: true; pendiente?: unknown } | { ok: false; error: string };

export function clasificarRegeneracion(ids: readonly number[], resultados: readonly PromiseSettledResult<ResultadoGenerar>[]): ResultadoRegeneracionHotel {
  const r: ResultadoRegeneracionHotel = { paquetes: ids.length, actualizados: 0, enCurso: 0, fallidos: [] };
  resultados.forEach((x, i) => {
    if (x.status === "rejected") r.fallidos.push({ paqueteId: ids[i], error: "fallo técnico al regenerar" });
    else if (!x.value.ok) r.fallidos.push({ paqueteId: ids[i], error: x.value.error });
    else if (x.value.pendiente) r.enCurso++;
    else r.actualizados++;
  });
  return r;
}
