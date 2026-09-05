// ─────────────────────────────────────────────────────────────────────────
// Operaciones PURAS sobre la asignación pasajero↔ítem del checkout de
// carrito (`convertirCotizacionCarrito`, `ConvertirCarritoBtn.tsx`) —
// revisión de alto riesgo, ronda 5 (B12/B13/B14).
//
// El carrito (`lib/cart/CartContext.tsx`) agrega cada ítem de forma
// INDEPENDIENTE — cada uno con su propio `pax`, sin ningún vínculo entre
// ítems. Dos ítems pueden representar el MISMO grupo de viajeros, grupos
// PARCIALMENTE solapados, o grupos COMPLETAMENTE distintos. La asignación
// (`opts.asignaciones`, B11) ya resuelve "quién viaja en cada ítem" de forma
// explícita — estas funciones resuelven lo que viene DESPUÉS: cada contrato
// generado (uno por "grupo" — todo el carrito, o un destino) debe persistir
// ÚNICAMENTE la unión de pasajeros de SUS ítems, reindexados a posiciones
// LOCALES de ese contrato (nunca el universo completo del carrito, que
// puede incluir personas que ni siquiera viajan en ese grupo).
// ─────────────────────────────────────────────────────────────────────────

/** Fila con vínculo de responsable — misma convención que pasajerosFilas.ts (0-based, GLOBAL). */
export type FilaConResponsableGlobal = {
  responsableIndex?: number | null;
};

/**
 * Agrupa índices de ítems (0-based, en el orden original del carrito) según
 * el modo de conversión — replica EXACTAMENTE el criterio de agrupación de
 * `convertirCotizacionCarrito`: "todo" (o un solo ítem) = un solo grupo con
 * todos los índices; "por_destino" = un grupo por destino distinto,
 * preservando el orden de PRIMERA aparición de cada destino (mismo criterio
 * que el `Map` usado en el servidor). Null se trata como "—" (un destino
 * más, no se descarta).
 */
export function agruparIndicesPorDestino(
  destinos: readonly (string | null)[],
  modo: "todo" | "por_destino"
): number[][] {
  if (modo === "todo" || destinos.length <= 1) {
    return [destinos.map((_, i) => i)];
  }
  const porDestino = new Map<string, number[]>();
  destinos.forEach((d, i) => {
    const k = d ?? "—";
    porDestino.set(k, [...(porDestino.get(k) ?? []), i]);
  });
  return [...porDestino.values()];
}

/**
 * Unión ÚNICA de posiciones (1-based) asignadas a un subconjunto de ítems
 * (por índice) — el universo LOCAL de un grupo/contrato. Ordenada
 * ascendente para que el reindexado local sea determinista.
 */
export function posicionesUnicasDeGrupo(
  asignacionesPorItem: readonly (readonly number[])[],
  indicesItemsDelGrupo: readonly number[]
): number[] {
  const vistos = new Set<number>();
  for (const idx of indicesItemsDelGrupo) {
    for (const pos of asignacionesPorItem[idx] ?? []) vistos.add(pos);
  }
  return [...vistos].sort((a, b) => a - b);
}

/**
 * Unión de TODAS las posiciones asignadas a CUALQUIER ítem (sin importar el
 * grupo) — el universo que realmente "participa" en el carrito. Se usa para
 * detectar pasajeros declarados en el universo (B12) que no quedaron
 * asignados a ningún ítem (B12: "ningún pasajero sobrante").
 */
export function posicionesAsignadasEnAlgunItem(asignacionesPorItem: readonly (readonly number[])[]): Set<number> {
  const vistos = new Set<number>();
  for (const posiciones of asignacionesPorItem) for (const pos of posiciones) vistos.add(pos);
  return vistos;
}

/**
 * Posiciones (1-based) del universo declarado (`1..totalUniverso`) que no
 * aparecen en NINGÚN ítem — deben rechazarse (B12), salvo una razón
 * explícita que hoy no existe en este flujo.
 */
export function posicionesSinAsignar(asignacionesPorItem: readonly (readonly number[])[], totalUniverso: number): number[] {
  const asignadas = posicionesAsignadasEnAlgunItem(asignacionesPorItem);
  const faltantes: number[] = [];
  for (let pos = 1; pos <= totalUniverso; pos++) if (!asignadas.has(pos)) faltantes.push(pos);
  return faltantes;
}

export type ResultadoReindexadoGrupo<T> = {
  /** Pasajeros del grupo, en el MISMO orden que `posicionesGlobales` — `responsableIndex` ya reindexado a LOCAL (0-based, dentro de este mismo arreglo). */
  pasajerosLocal: T[];
  /**
   * Posiciones GLOBALES (1-based) cuyo `responsableIndex` original apuntaba
   * a alguien que NO está en este grupo — el infante y su responsable
   * quedarían en CONTRATOS DISTINTOS, algo que la FK de la migración 167
   * nunca permite (responsable_id exige mismo numero_contrato). Se detecta
   * ANTES de llamar al RPC para dar un mensaje claro, no un error crudo de
   * Postgres.
   */
  posicionesInvalidas: number[];
  /** Posición GLOBAL (1-based) → índice LOCAL (0-based) — reutilizable para remapear posiciones de sillas del mismo grupo. */
  mapaGlobalALocal: Map<number, number>;
};

/**
 * Reindexa el universo GLOBAL de pasajeros a las posiciones LOCALES de UN
 * grupo/contrato — B13 (ronda 5). `posicionesGlobales` debe venir de
 * `posicionesUnicasDeGrupo` (ya ordenada, ya deduplicada).
 *
 * Decisión de diseño investigada y documentada (B13 punto 5): el adulto
 * responsable de un infante debe pertenecer al MISMO CONTRATO (misma
 * `numero_contrato` — así lo exige la FK `responsable_id` de la migración
 * 167), pero NO necesariamente al mismo ítem/bloqueo — `responsable_id`
 * modela una relación de responsabilidad real/legal ("quién responde por
 * este menor"), no una restricción de asiento físico, y no existe en el
 * resto del código ninguna validación que exija "mismo ítem" (solo "mismo
 * contrato", ya enforced por la FK). Por eso esta función valida contra el
 * universo COMPLETO del grupo (todas las posiciones de todos los ítems de
 * ese contrato), no contra el ítem puntual del infante.
 */
export function reindexarGrupoLocal<T extends FilaConResponsableGlobal>(
  pasajerosGlobales: readonly T[],
  posicionesGlobales: readonly number[]
): ResultadoReindexadoGrupo<T> {
  const mapaGlobalALocal = new Map<number, number>();
  posicionesGlobales.forEach((posGlobal, idxLocal) => mapaGlobalALocal.set(posGlobal, idxLocal));

  const posicionesInvalidas: number[] = [];
  const pasajerosLocal = posicionesGlobales.map((posGlobal) => {
    const original = pasajerosGlobales[posGlobal - 1];
    const respGlobalIdx = original.responsableIndex;
    if (respGlobalIdx == null) return original;
    const respLocalIdx = mapaGlobalALocal.get(respGlobalIdx + 1);
    if (respLocalIdx == null) {
      posicionesInvalidas.push(posGlobal);
      return { ...original, responsableIndex: null };
    }
    return { ...original, responsableIndex: respLocalIdx };
  });

  return { pasajerosLocal, posicionesInvalidas, mapaGlobalALocal };
}

export type ReservaSillasPorBloqueo = { bloqueoId: number; holdersMin: number; posiciones: number[] };

/**
 * Consolida las reservas de sillas de un grupo por `bloqueoId` — B14 (ronda
 * 5). `CartContext.add` permite agregar libremente varios ítems con el
 * mismo `bloqueoId` (ej. dos paquetes de hotel distintos que comparten el
 * mismo vuelo negociado); antes de esta función cada ítem generaba su
 * PROPIA entrada en `p_reservas_sillas`, y el RPC (migración 167) rechaza
 * un `bloqueoId` repetido dentro del mismo payload — la conversión fallaba
 * siempre que el carrito tuviera 2+ ítems sobre el mismo bloqueo.
 *
 * - `posiciones` se une (nunca se duplica: dos ítems con el mismo viajero
 *   en el mismo bloqueo reservan UNA sola silla para esa persona, nunca dos).
 * - `holdersMin` se SUMA entre ítems que comparten bloqueo: cada ítem
 *   declaró su propio piso de sillas a partir de SU composición de
 *   habitaciones (una reserva de hotel independiente), y esa necesidad no
 *   desaparece porque otro ítem comparta el mismo vuelo — sumar nunca
 *   sub-reserva (el peor caso, solapamiento total, sobre-reserva el piso
 *   declarado, pero el conteo REAL de personas — `posiciones`, sin
 *   duplicados — sigue siendo la fuente de verdad que aplica el RPC vía
 *   `greatest(holdersMin, holders_reales)`).
 *
 * Cada entrada de `itemsBloqueo` ya debe traer sus posiciones en el sistema
 * de referencia que se vaya a enviar al RPC (local o global, según llame el
 * caller) — esta función es agnóstica a eso.
 */
export function consolidarReservasSillasPorBloqueo(
  itemsBloqueo: readonly { bloqueoId: number; holdersMin: number; posiciones: readonly number[] }[]
): ReservaSillasPorBloqueo[] {
  const porBloqueo = new Map<number, { holdersMin: number; posiciones: Set<number> }>();
  for (const it of itemsBloqueo) {
    const entrada = porBloqueo.get(it.bloqueoId) ?? { holdersMin: 0, posiciones: new Set<number>() };
    entrada.holdersMin += it.holdersMin;
    for (const pos of it.posiciones) entrada.posiciones.add(pos);
    porBloqueo.set(it.bloqueoId, entrada);
  }
  return [...porBloqueo.entries()].map(([bloqueoId, v]) => ({
    bloqueoId,
    holdersMin: v.holdersMin,
    posiciones: [...v.posiciones].sort((a, b) => a - b),
  }));
}

/**
 * Fecha de referencia para clasificar la edad de UN pasajero en la UI —
 * revisión de B10 bajo el modelo de B13 (ronda 5): antes se usaba la fecha
 * más temprana de TODO el carrito, una aproximación conservadora necesaria
 * porque todos los pasajeros se insertaban en TODOS los contratos. Con B13
 * cada contrato solo recibe la unión de SUS ítems — así que la referencia
 * correcta para un pasajero es la fecha más temprana ENTRE LOS ÍTEMS A LOS
 * QUE ESTÁ REALMENTE ASIGNADO (nunca un ítem donde no viaja, que podría
 * bloquear injustamente una clasificación válida). Sin ninguna asignación
 * todavía (edición a mitad de camino), cae al `fallback` (fecha más
 * temprana global) — solo para no romper la UI antes de que la asignación
 * esté completa; la validación real exige que todo pasajero esté asignado.
 */
export function fechaReferenciaPorPasajero(
  posicion: number,
  asignacionesPorItem: readonly (readonly number[])[],
  fechasItems: readonly (string | null)[],
  fallback: string | null
): string | null {
  const fechas = asignacionesPorItem
    .map((posiciones, idx) => (posiciones.includes(posicion) ? fechasItems[idx] : null))
    .filter((f): f is string => !!f)
    .sort();
  return fechas[0] ?? fallback;
}

/**
 * Universo EDITABLE de pasajeros del carrito — B12 (ronda 5). `page.tsx`
 * antes calculaba `paxCarrito` como `Math.max(...item.pax)`, que no puede
 * representar subconjuntos independientes (ítem A pax=2 + ítem B pax=2 con
 * viajeros distintos necesita 4 filas, no 2) ni solapamientos parciales.
 * En vez de adivinar con una suma (otro supuesto silencioso, que sobra
 * cuando SÍ hay solapamiento), el total es un número editable en la UI —
 * estas dos funciones agregan/quitan UNA posición del universo manteniendo
 * `asignacionesPorItem` (la matriz booleana ítem×pasajero) y los vínculos de
 * responsable consistentes, para que ningún botón +/- deje el estado roto.
 */
export function agregarPosicionAUniverso<T>(filas: readonly T[], asignacionesPorItem: readonly (readonly boolean[])[], filaNueva: T): { filas: T[]; asignacionesPorItem: boolean[][] } {
  return {
    filas: [...filas, filaNueva],
    asignacionesPorItem: asignacionesPorItem.map((fila) => [...fila, false]),
  };
}

export function quitarPosicionDeUniverso<T extends FilaConResponsableGlobal>(
  filas: readonly T[],
  asignacionesPorItem: readonly (readonly boolean[])[],
  indiceAQuitar: number
): { filas: T[]; asignacionesPorItem: boolean[][] } {
  const filasNuevas = filas
    .filter((_, i) => i !== indiceAQuitar)
    .map((f) => {
      const r = f.responsableIndex;
      if (r == null) return f;
      if (r === indiceAQuitar) return { ...f, responsableIndex: null };
      return r > indiceAQuitar ? { ...f, responsableIndex: r - 1 } : f;
    });
  const asignacionesNuevas = asignacionesPorItem.map((fila) => fila.filter((_, i) => i !== indiceAQuitar));
  return { filas: filasNuevas, asignacionesPorItem: asignacionesNuevas };
}

/**
 * ¿Comparten `posicionA` y `posicionB` al menos UN grupo/contrato resultante
 * (según el modo de agrupación vigente)? Un adulto solo puede ser
 * responsable de un infante si ambos terminan en el MISMO contrato — ver el
 * comentario de diseño en `reindexarGrupoLocal` (B13 punto 5: mismo
 * contrato, no necesariamente mismo ítem/bloqueo). Se usa para filtrar la
 * lista de candidatos a responsable en la UI (validación real: servidor).
 */
export function comparteGrupo(
  posicionA: number,
  posicionB: number,
  gruposIndicesItems: readonly (readonly number[])[],
  asignacionesPorItem: readonly (readonly number[])[]
): boolean {
  for (const grupo of gruposIndicesItems) {
    const posicionesGrupo = posicionesUnicasDeGrupo(asignacionesPorItem, grupo);
    if (posicionesGrupo.includes(posicionA) && posicionesGrupo.includes(posicionB)) return true;
  }
  return false;
}
