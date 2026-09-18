// Motor puro de "hoteles recomendados" — decide QUÉ ofertas (hotel+paquete)
// se muestran como recomendadas y en qué orden, en los dos estados del motor
// global (VistaBooking):
//   A) estado global inicial (sin búsqueda por destino): top 2 por paquete;
//   B) después de buscar por destino: top 1-6 por paquete coincidente.
//
// La recomendación pertenece a la OFERTA hotel+paquete (`armado_hoteles.
// prioridad`, migración 183), NUNCA al hotel físico global — por eso la
// identidad que se usa en todo este módulo es SIEMPRE el par
// (hotelId, paqueteId), nunca hotelId solo. El mismo hotel_id puede aparecer
// más de una vez en el resultado si pertenece a paquetes distintos — eso es
// el comportamiento correcto (dos ofertas), nunca un duplicado a deduplicar.
//
// Funciones PURAS — sin Supabase, sin React — para poder probarse con datos
// sintéticos sin infraestructura.

export type OfertaPrioridad = {
  hotelId: number;
  paqueteId: number;
  /** 1 (más alta) .. 6 (más baja). Solo ofertas YA marcadas recomendadas
   * (armado_hoteles.prioridad no nulo) deben construirse con este tipo —
   * quien arma la lista de entrada filtra las no recomendadas antes. */
  prioridad: number;
};

/** Identidad compuesta de una oferta hotel+paquete — la clave a usar en
 * mapas/Sets/deduplicación siempre que se trate de UNA OFERTA (nunca de un
 * hotel físico global). `hotelId` primero por legibilidad, sin significado
 * especial en el orden de los componentes. */
export function claveOferta(hotelId: number, paqueteId: number): string {
  return `${hotelId}:${paqueteId}`;
}

/** Una oferta UNIDAD agrupada por su identidad (hotelId, paqueteId): trae
 * EXCLUSIVAMENTE las opciones confirmadas que pertenecen a ese paquete —
 * nunca las de otro paquete del mismo hotel. `opciones` conserva el orden de
 * entrada (el motor ya las entrega ordenadas por precio). */
export type GrupoOfertaUnidad<T> = {
  hotelId: number;
  paqueteId: number;
  opciones: T[];
};

/**
 * Agrupa opciones confirmadas de hotel unidad por (hotelId, paqueteId).
 *
 * Por qué existe: `buscarAlojamientosUnidadPorFechas` entrega UNA entrada por
 * hotelId con TODAS sus combinaciones confirmadas, y esas combinaciones
 * pueden pertenecer a paquetes DISTINTOS (el mismo hotel unidad está vinculado
 * a varios paquetes activos). Una tarjeta que juntara las opciones de dos
 * paquetes mostraría categorías/alimentaciones —y con ellas precios y add-ons—
 * de una oferta que no es la que el usuario está mirando. Agrupar acá deja esa
 * separación en una función pura y testeable, en vez de inline en el
 * componente.
 *
 * No descarta ninguna opción: la suma de `opciones` de todos los grupos es
 * siempre igual a la entrada (solo se reparte).
 */
export function agruparOpcionesUnidadPorOferta<T extends { hotelId: number; paqueteId: number }>(
  opciones: readonly T[]
): GrupoOfertaUnidad<T>[] {
  const grupos = new Map<string, GrupoOfertaUnidad<T>>();
  for (const o of opciones) {
    const clave = claveOferta(o.hotelId, o.paqueteId);
    let g = grupos.get(clave);
    if (!g) {
      g = { hotelId: o.hotelId, paqueteId: o.paqueteId, opciones: [] };
      grupos.set(clave, g);
    }
    g.opciones.push(o);
  }
  return [...grupos.values()];
}

/**
 * De un conjunto de ofertas candidatas (resultados reales de una búsqueda,
 * cards de exploración, grupos unidad) se queda SOLO con las que tienen
 * prioridad configurada en `prioridades`, ya como `OfertaPrioridad` lista para
 * el selector.
 *
 * `paqueteId` es opcional/nullable a propósito: las cards de exploración
 * (`HotelCard`) lo llevan opcional, y una card sin paquete no es una oferta
 * identificable (jamás se le puede asignar una recomendación) — se descarta
 * acá en vez de obligar a cada llamador a estrechar el tipo antes.
 */
export function ofertasConPrioridad<T extends { hotelId: number; paqueteId?: number | null }>(
  items: readonly T[],
  prioridades: Readonly<Record<string, number>>
): OfertaPrioridad[] {
  const ofertas: OfertaPrioridad[] = [];
  for (const it of items) {
    if (it.paqueteId == null) continue;
    const prioridad = prioridades[claveOferta(it.hotelId, it.paqueteId)];
    if (prioridad != null) ofertas.push({ hotelId: it.hotelId, paqueteId: it.paqueteId, prioridad });
  }
  return ofertas;
}

/**
 * Texto de la etiqueta compacta de una OFERTA (hotel+paquete):
 *   · recomendada    → "Recomendado · <paquete>"
 *   · no recomendada → "<paquete>"
 * `null` cuando no hay nombre de paquete: la tarjeta no pinta nada (nunca un
 * badge vacío, nunca un texto inventado). Función pura y sin React para poder
 * probar la REGLA de la etiqueta con ejecución real (`EtiquetaOferta` solo la
 * pinta) — el nombre sale del paquete de ESA oferta, jamás de `hotelId`.
 */
export function textoEtiquetaOferta(paqueteNombre: string | null | undefined, recomendada: boolean): string | null {
  const nombre = paqueteNombre?.trim();
  if (!nombre) return null;
  return recomendada ? `Recomendado · ${nombre}` : nombre;
}

function agruparPorPaquete(ofertas: readonly OfertaPrioridad[]): Map<number, OfertaPrioridad[]> {
  const porPaquete = new Map<number, OfertaPrioridad[]>();
  for (const o of ofertas) {
    const arr = porPaquete.get(o.paqueteId);
    if (arr) arr.push(o);
    else porPaquete.set(o.paqueteId, [o]);
  }
  // Desempate determinista: dentro de cada paquete, por prioridad ascendente
  // (1 antes que 2); si dos ofertas tuvieran la MISMA prioridad (no debería
  // pasar — la base lo impide por paquete — pero un dataset inconsistente no
  // debe producir un orden aleatorio), por hotelId ascendente. Este orden es
  // el que decide QUÉ ofertas entran en los cupos por paquete (top 2 / top 6).
  for (const arr of porPaquete.values()) {
    arr.sort((a, b) => a.prioridad - b.prioridad || a.hotelId - b.hotelId);
  }
  return porPaquete;
}

/**
 * Orden VISIBLE global de las ofertas ya seleccionadas (defecto 3).
 *
 * La numeración es del NEGOCIO, no del paquete: "prioridad 1" significa
 * "primero" para el cliente, y antes el resultado se concatenaba paquete por
 * paquete (A/1, A/2, B/1, …), así que un A/2 podía verse ANTES que un B/1.
 * Ahora, después de aplicar los cupos por paquete, el orden es:
 *   1. prioridad ascendente (1 → 6);
 *   2. desempate determinista: `paqueteId` ascendente;
 *   3. y luego `hotelId` ascendente.
 * El desempate por `paqueteId`/`hotelId` es lo único que hace el orden estable
 * y reproducible cuando dos ofertas comparten prioridad (legítimo: la unicidad
 * es POR paquete).
 */
function ordenarGlobalmente(ofertas: readonly OfertaPrioridad[]): OfertaPrioridad[] {
  return [...ofertas].sort(
    (a, b) => a.prioridad - b.prioridad || a.paqueteId - b.paqueteId || a.hotelId - b.hotelId
  );
}

/**
 * Estado global inicial (sin búsqueda por destino): como máximo los 2
 * PRIMEROS recomendados de CADA paquete (prioridad 1 antes que 2). Un
 * paquete con un solo recomendado muestra uno; sin recomendados, no aparece.
 * Nunca se muestran las prioridades 3-6 en este estado.
 *
 * El CUPO es por paquete (2), pero el ORDEN VISIBLE es global por prioridad
 * (ver `ordenarGlobalmente`): A/prioridad 2 nunca queda antes que B/prioridad 1.
 */
export function seleccionarRecomendadosGlobalInicial(ofertas: readonly OfertaPrioridad[]): OfertaPrioridad[] {
  const porPaquete = agruparPorPaquete(ofertas);
  const paqueteIds = [...porPaquete.keys()].sort((a, b) => a - b);
  const seleccion: OfertaPrioridad[] = [];
  for (const pid of paqueteIds) {
    seleccion.push(...(porPaquete.get(pid) as OfertaPrioridad[]).slice(0, 2));
  }
  return ordenarGlobalmente(seleccion);
}

/**
 * Después de ejecutar una búsqueda por destino: para cada paquete
 * coincidente con el destino (`paqueteIdsCoincidentes`), TODOS sus
 * recomendados configurados, hasta 6 — el cupo sigue siendo POR PAQUETE.
 * Paquetes fuera de `paqueteIdsCoincidentes` no aportan ninguna oferta
 * (ni siquiera si tienen recomendados) — el destino ya filtró el universo.
 *
 * Igual que el estado global inicial, el ORDEN VISIBLE es global por
 * prioridad (ver `ordenarGlobalmente`): un A/prioridad 6 no puede quedar antes
 * que un B/prioridad 1.
 */
export function seleccionarRecomendadosPorDestino(
  ofertas: readonly OfertaPrioridad[],
  paqueteIdsCoincidentes: ReadonlySet<number>
): OfertaPrioridad[] {
  const porPaquete = agruparPorPaquete(ofertas.filter((o) => paqueteIdsCoincidentes.has(o.paqueteId)));
  const paqueteIds = [...porPaquete.keys()].sort((a, b) => a - b);
  const seleccion: OfertaPrioridad[] = [];
  for (const pid of paqueteIds) {
    seleccion.push(...(porPaquete.get(pid) as OfertaPrioridad[]).slice(0, 6));
  }
  return ordenarGlobalmente(seleccion);
}

/**
 * Excluye de `items` cualquier elemento cuya oferta (hotelId, paqueteId) ya
 * esté en `recomendadas` — para que el "resto del inventario" nunca repita
 * una oferta ya mostrada como recomendada. `items` puede traer `hotelId`
 * nulo (filas sin hotel, ej. servicios) — esas nunca se excluyen por esta
 * función (no son ofertas de hotel).
 */
export function excluirOfertasRecomendadas<T extends { hotelId: number | null; paqueteId: number }>(
  items: readonly T[],
  recomendadas: readonly OfertaPrioridad[]
): T[] {
  const claves = new Set(recomendadas.map((o) => claveOferta(o.hotelId, o.paqueteId)));
  return items.filter((it) => it.hotelId == null || !claves.has(claveOferta(it.hotelId, it.paqueteId)));
}
