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
 * 5), con el piso corregido por B15 (ronda 6). `CartContext.add` permite
 * agregar libremente varios ítems con el mismo `bloqueoId` (ej. dos paquetes
 * de hotel distintos que comparten el mismo vuelo negociado); antes de esta
 * función cada ítem generaba su PROPIA entrada en `p_reservas_sillas`, y el
 * RPC (migración 167) rechaza un `bloqueoId` repetido dentro del mismo
 * payload — la conversión fallaba siempre que el carrito tuviera 2+ ítems
 * sobre el mismo bloqueo.
 *
 * El piso de sillas (`holdersMin`) se define como el número de PERSONAS
 * ÚNICAS QUE OCUPAN SILLA en el bloqueo — la unión de las posiciones con
 * silla de todos los ítems que lo comparten (`posicionesConSilla`), nunca la
 * SUMA de los pisos por ítem (B15): sumar duplicaba a cualquier viajero que
 * apareciera en 2+ ítems del mismo bloqueo (dos ítems [1,2]+[1,2] daban
 * `holdersMin=4` para 2 personas, y como el RPC aplica `greatest(holdersMin,
 * holders_reales)` reservaba 4 sillas). El MÁXIMO tampoco sirve: sub-reserva
 * grupos disjuntos ([1,2]+[3,4] daría 2 en vez de 4). La unión da el piso
 * correcto en los cuatro casos:
 *   1. mismos pasajeros [1,2]+[1,2] → {1,2} → 2 sillas;
 *   2. solapamiento     [1,2]+[2,3] → {1,2,3} → 3 sillas;
 *   3. disjuntos        [1,2]+[3,4] → {1,2,3,4} → 4 sillas;
 *   4. si un INF está en las posiciones, NO va en `posicionesConSilla`, así
 *      que no cuenta para el piso (el infante no ocupa silla).
 * Como el caller clasifica `posicionesConSilla` con la MISMA fecha real del
 * grupo (`ventas.fecha_salida`) que usa el RPC para recalcular es_infante,
 * este piso coincide EXACTAMENTE con `holders_reales` del RPC — `greatest`
 * nunca lo infla.
 *
 * `posiciones` es la unión de TODAS las posiciones (con o sin silla) — el RPC
 * las necesita para recalcular él mismo `holders_reales` (autoridad final).
 * Cada entrada ya debe traer sus posiciones en el sistema de referencia que
 * se vaya a enviar al RPC (local o global, según llame el caller) — esta
 * función es agnóstica a eso.
 */
export function consolidarReservasSillasPorBloqueo(
  itemsBloqueo: readonly { bloqueoId: number; posiciones: readonly number[]; posicionesConSilla: readonly number[] }[]
): ReservaSillasPorBloqueo[] {
  const porBloqueo = new Map<number, { posiciones: Set<number>; conSilla: Set<number> }>();
  for (const it of itemsBloqueo) {
    const entrada = porBloqueo.get(it.bloqueoId) ?? { posiciones: new Set<number>(), conSilla: new Set<number>() };
    for (const pos of it.posiciones) entrada.posiciones.add(pos);
    for (const pos of it.posicionesConSilla) entrada.conSilla.add(pos);
    porBloqueo.set(it.bloqueoId, entrada);
  }
  return [...porBloqueo.entries()].map(([bloqueoId, v]) => ({
    bloqueoId,
    holdersMin: v.conSilla.size,
    posiciones: [...v.posiciones].sort((a, b) => a - b),
  }));
}

/**
 * Fecha de referencia para clasificar la edad de UN pasajero en la UI —
 * revisión de B16 (ronda 6), que corrige la de B13 (ronda 5). El servidor
 * (`convertirCotizacionCarrito`) escribe `ventas.fecha_salida = fechasIda[0]`
 * = la fecha más temprana de TODAS las unidades (hoteles/bloqueos/tours) del
 * GRUPO/contrato, y el RPC recalcula es_infante de TODOS los pasajeros contra
 * ESA única fecha contractual. La ronda 5 clasificaba en la UI contra la
 * fecha más temprana de los ÍTEMS ASIGNADOS al pasajero — que puede ser
 * POSTERIOR a la del contrato cuando el pasajero no viaja en la unidad más
 * temprana del grupo (ej. contrato con ítem A en enero e ítem B en diciembre,
 * pasajero solo en B: la UI usaba diciembre, el servidor enero) → la UI y
 * PostgreSQL llegaban a clasificaciones DISTINTAS.
 *
 * Autoridad única: la fecha del CONTRATO. Cada pasajero se evalúa contra la
 * fecha más temprana de los grupos/contratos en los que realmente queda
 * (`gruposIndicesUnidades` según el modo de agrupación vigente). Un pasajero
 * en varios contratos usa la MÁS TEMPRANA de ellos — la más conservadora
 * (edad mínima): si es infante contra esa, lo será en el contrato más
 * temprano y la UI captura su responsable; para los contratos posteriores
 * donde ya no lo sea, la normalización por grupo del servidor limpia el
 * vínculo sobrante. Nunca usa una fecha de ítem individual, porque el RPC no
 * modela edad por servicio: una sola `fecha_salida` por contrato.
 *
 * Sin ninguna asignación todavía (edición a mitad de camino) cae al
 * `fallback` (fecha más temprana global del carrito) — solo para no romper la
 * UI antes de que la asignación esté completa; la validación real exige que
 * todo pasajero quede asignado a alguna unidad.
 */
export function fechaContratoDePasajero(
  posicion: number,
  gruposIndicesUnidades: readonly (readonly number[])[],
  asignacionesPorUnidad: readonly (readonly number[])[],
  fechasUnidades: readonly (string | null)[],
  fallback: string | null
): string | null {
  const fechasContrato: string[] = [];
  for (const grupo of gruposIndicesUnidades) {
    const enGrupo = grupo.some((u) => (asignacionesPorUnidad[u] ?? []).includes(posicion));
    if (!enGrupo) continue;
    // Fecha del contrato = la más temprana de TODAS las unidades del grupo
    // (no solo las del pasajero) — idéntico a `fechasIda[0]` del servidor.
    const fechasGrupo = grupo.map((u) => fechasUnidades[u]).filter((f): f is string => !!f).sort();
    if (fechasGrupo.length) fechasContrato.push(fechasGrupo[0]);
  }
  fechasContrato.sort();
  return fechasContrato[0] ?? fallback;
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
