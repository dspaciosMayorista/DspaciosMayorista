// ─────────────────────────────────────────────────────────────────────────
// Motor puro de orden/filtro del inventario de Vista Booking. NUNCA decide
// qué es recomendado (eso sigue siendo exclusivo de `lib/tarifario/
// recomendados.ts`) — pero los FILTROS (zona/estrellas/pet/adults/condición/
// política) sí se aplican a TODAS las ofertas visibles, recomendadas o no:
// un recomendado que ya no cumple los filtros del usuario desaparece, sin
// alterar el orden de los demás recomendados que sí sobreviven. El ORDEN
// elegido en el panel ("Ordenar por") es exclusivo del resto — los
// recomendados que sobreviven al filtro conservan su prioridad/bloque tal
// cual la resolvió `recomendados.ts`, nunca pasan por `ordenarYFiltrarResto`.
//
// Identidad SIEMPRE (hotelId, paqueteId) — nunca hotelId a secas: el mismo
// hotel en dos paquetes es DOS ofertas independientes, cada una con su propio
// precio/estrellas/zona/condición/política.
//
// Bloques por paquete: `ordenarYFiltrarResto` agrupa por `paqueteId` (orden
// ascendente, mismo criterio que `recomendados.ts`) y aplica filtro+orden
// DENTRO de cada bloque — el orden/filtro nunca mezcla ofertas de paquetes
// distintos en una sola lista plana ni rompe el bloque.
// ─────────────────────────────────────────────────────────────────────────

export type ItemResto = {
  hotelId: number;
  paqueteId: number;
  nombre: string;
  /** null = precio desconocido. Un valor no finito o <= 0 se trata IGUAL
   *  que null en cualquier comparador (`precioEfectivo`) — nunca se asume
   *  "gratis" ni "el más barato". */
  precio: number | null;
  /** null = sin estrellas configuradas ("Sin clasificar"). */
  estrellas: number | null;
  /** Texto libre de `hoteles.zona`, sin normalizar — la normalización para
   *  comparar/agrupar la hace `normalizarZonaClave`. null = sin zona. */
  zona: string | null;
  petFriendly: boolean;
  adultsOnly: boolean;
  /** "desconocido" = la fuente no permite determinarlo (nunca se inventa). */
  condicion: "con" | "sin" | "desconocido";
  politica: "flexible" | "no_reembolsable" | "desconocido";
};

export type OrdenResto =
  | "predeterminado"
  | "precio_asc"
  | "precio_desc"
  | "estrellas_desc"
  | "estrellas_asc"
  | "nombre_asc"
  | "nombre_desc";

export type FiltrosResto = {
  /** Claves normalizadas (ver `normalizarZonaClave`), selección múltiple, OR interno. */
  zonas: ReadonlySet<string>;
  /** `"sin_clasificar"` representa estrellas null. Selección múltiple, OR interno. */
  estrellas: ReadonlySet<number | "sin_clasificar">;
  petFriendly: boolean;
  adultsOnly: boolean;
  condicion: "todas" | "con" | "sin";
  politica: "todas" | "flexible" | "no_reembolsable";
};

export function filtrosVacios(): FiltrosResto {
  return {
    zonas: new Set(),
    estrellas: new Set(),
    petFriendly: false,
    adultsOnly: false,
    condicion: "todas",
    politica: "todas",
  };
}

export function hayFiltrosActivos(f: FiltrosResto): boolean {
  return (
    f.zonas.size > 0 ||
    f.estrellas.size > 0 ||
    f.petFriendly ||
    f.adultsOnly ||
    f.condicion !== "todas" ||
    f.politica !== "todas"
  );
}

/** Cuenta CATEGORÍAS con al menos un valor activo (no la cantidad de checks
 *  individuales) — es lo que se muestra como "N filtros activos". El
 *  llamador debe pasar `f` ya "efectivizado" (`zonas`/`estrellas`
 *  intersectadas contra lo disponible ahora — ver `zonasEfectivas`/
 *  `estrellasEfectivas`) para que el contador nunca cuente un filtro
 *  fantasma que ya no tiene ningún efecto. */
export function contarFiltrosActivos(f: FiltrosResto): number {
  let n = 0;
  if (f.zonas.size > 0) n++;
  if (f.estrellas.size > 0) n++;
  if (f.petFriendly) n++;
  if (f.adultsOnly) n++;
  if (f.condicion !== "todas") n++;
  if (f.politica !== "todas") n++;
  return n;
}

// Locale explícito y determinista para TODA comparación alfabética de este
// módulo — nunca `localeCompare()` sin argumentos (su resultado depende del
// locale del entorno de ejecución, que puede variar entre servidor/build/CI).
const LOCALE_ES = "es";
const OPTS_COMPARACION: Intl.CollatorOptions = { sensitivity: "base", numeric: true };
function compararEs(a: string, b: string): number {
  return a.localeCompare(b, LOCALE_ES, OPTS_COMPARACION);
}

/** Normaliza espacios y mayúsculas para comparar/deduplicar zonas — nunca
 *  para mostrar (la etiqueta visible conserva el texto original). */
export function normalizarZonaClave(zona: string | null | undefined): string | null {
  const t = zona?.trim().replace(/\s+/g, " ");
  return t ? t.toLowerCase() : null;
}

export type ZonaDisponible = { clave: string; etiqueta: string };

/** Zonas presentes en `items` (nunca una lista global inventada) — una por
 *  clave normalizada, con la primera etiqueta vista como texto visible,
 *  ordenadas alfabéticamente (locale es) por etiqueta. */
export function zonasDisponibles(items: readonly { zona: string | null }[]): ZonaDisponible[] {
  const mapa = new Map<string, string>();
  for (const it of items) {
    const clave = normalizarZonaClave(it.zona);
    if (!clave) continue;
    if (!mapa.has(clave)) mapa.set(clave, (it.zona as string).trim().replace(/\s+/g, " "));
  }
  return [...mapa.entries()]
    .map(([clave, etiqueta]) => ({ clave, etiqueta }))
    .sort((a, b) => compararEs(a.etiqueta, b.etiqueta));
}

/** Estrellas presentes en `items` ("sin_clasificar" al final), descendente. */
export function estrellasDisponibles(items: readonly { estrellas: number | null }[]): (number | "sin_clasificar")[] {
  const set = new Set<number | "sin_clasificar">();
  for (const it of items) set.add(it.estrellas ?? "sin_clasificar");
  return [...set].sort((a, b) => {
    if (a === "sin_clasificar") return 1;
    if (b === "sin_clasificar") return -1;
    return b - a;
  });
}

/** Intersección de una selección de zonas contra las zonas realmente
 *  disponibles ahora mismo — una zona elegida antes de cambiar de destino que
 *  ya no exista en el universo actual deja de tener efecto (nunca filtra por
 *  una clave que ya no aporta ningún resultado). El llamador usa el
 *  resultado tanto para filtrar como para mostrar el estado real de los
 *  checkboxes/contador — nunca hace falta "limpiar" el estado guardado: si
 *  la misma zona vuelve a existir en un destino posterior, la selección
 *  original (nunca borrada) vuelve a tener efecto sola. */
export function zonasEfectivas(seleccion: ReadonlySet<string>, disponibles: readonly ZonaDisponible[]): Set<string> {
  const claves = new Set(disponibles.map((z) => z.clave));
  return new Set([...seleccion].filter((c) => claves.has(c)));
}

/** Mismo criterio que `zonasEfectivas`, para estrellas. */
export function estrellasEfectivas(
  seleccion: ReadonlySet<number | "sin_clasificar">,
  disponibles: readonly (number | "sin_clasificar")[]
): Set<number | "sin_clasificar"> {
  const valores = new Set(disponibles);
  return new Set([...seleccion].filter((v) => valores.has(v)));
}

/** Aplica `zonasEfectivas`/`estrellasEfectivas` a la vez — el resultado es
 *  el `FiltrosResto` que se debe USAR para filtrar/contar/mostrar. El
 *  llamador (`VistaBooking`) además PODA de verdad el estado guardado con
 *  este mismo resultado en los handlers que confirman/limpian destino/
 *  búsqueda/pestaña (`podarZonasEstrellas`) — esta función sirve igual como
 *  defensa de lectura (nunca hace daño recomputarla) y como la poda misma. */
export function filtrosEfectivos(
  filtros: FiltrosResto,
  zonasDisp: readonly ZonaDisponible[],
  estrellasDisp: readonly (number | "sin_clasificar")[]
): FiltrosResto {
  return {
    ...filtros,
    zonas: zonasEfectivas(filtros.zonas, zonasDisp),
    estrellas: estrellasEfectivas(filtros.estrellas, estrellasDisp),
  };
}

/**
 * Restablece zona/estrellas/condición/política a su valor vacío — para el
 * estado GLOBAL (sin destino/búsqueda activo), donde esos cuatro controles
 * ni siquiera se muestran (`mostrarControlesResto` en falso en VistaBooking):
 * un filtro "escondido" no puede seguir activo en silencio hasta que el
 * panel vuelva a mostrarlo. Pet friendly/Adults Only NUNCA se tocan aquí —
 * viven fuera de `FiltrosResto` (estado propio `soloPetFriendly`/
 * `soloAdultsOnly` en VistaBooking) precisamente porque sus controles SÍ
 * están siempre visibles, incluso en global.
 */
export function restablecerFiltrosOcultos(filtros: FiltrosResto): FiltrosResto {
  return { ...filtros, zonas: new Set(), estrellas: new Set(), condicion: "todas", politica: "todas" };
}

/** Predicado de filtro — `f` debe venir ya "efectivizado" (ver
 *  `filtrosEfectivos`); esta función no intersecta nada por sí misma para
 *  mantenerse determinista sobre su propia entrada. */
export function pasaFiltrosResto(item: ItemResto, f: FiltrosResto): boolean {
  if (f.zonas.size > 0) {
    const clave = normalizarZonaClave(item.zona);
    if (!clave || !f.zonas.has(clave)) return false;
  }
  if (f.estrellas.size > 0) {
    const valor = item.estrellas ?? "sin_clasificar";
    if (!f.estrellas.has(valor)) return false;
  }
  if (f.petFriendly && !item.petFriendly) return false;
  if (f.adultsOnly && !item.adultsOnly) return false;
  if (f.condicion === "con" && item.condicion !== "con") return false;
  if (f.condicion === "sin" && item.condicion !== "sin") return false;
  if (f.politica === "flexible" && item.politica !== "flexible") return false;
  if (f.politica === "no_reembolsable" && item.politica !== "no_reembolsable") return false;
  return true;
}

/**
 * Filtra SIN reordenar — conserva el orden de entrada. Es lo que se usa
 * sobre los RECOMENDADOS: un recomendado que ya no cumple los filtros
 * desaparece, pero los que sobreviven mantienen exactamente su prioridad y
 * bloque por paquete (el orden lo decidió `recomendados.ts`, nunca este
 * módulo). `filtros` debe venir ya "efectivizado" (ver `filtrosEfectivos`).
 */
export function filtrarPorFiltros<T extends ItemResto>(items: readonly T[], filtros: FiltrosResto): T[] {
  return items.filter((it) => pasaFiltrosResto(it, filtros));
}

function cmpNombre(a: ItemResto, b: ItemResto): number {
  return compararEs(a.nombre, b.nombre);
}
function cmpHotelId(a: ItemResto, b: ItemResto): number {
  return a.hotelId - b.hotelId;
}
/** Precio inválido (null, no finito, o <= 0) → `null`: nunca se trata como
 *  "gratis" ni participa en la comparación numérica. Un precio real es
 *  siempre estrictamente positivo (`minRoomPvp` ya lo garantiza en el
 *  productor; este comparador es defensivo por su cuenta). */
function precioEfectivo(p: number | null): number | null {
  if (p == null || !Number.isFinite(p) || p <= 0) return null;
  return p;
}
/** Precio: desconocido (null/no finito/<=0) SIEMPRE al final, en cualquier dirección. */
function cmpPrecio(a: ItemResto, b: ItemResto, asc: boolean): number {
  const pa = precioEfectivo(a.precio), pb = precioEfectivo(b.precio);
  if (pa == null && pb == null) return 0;
  if (pa == null) return 1;
  if (pb == null) return -1;
  return asc ? pa - pb : pb - pa;
}
/** Estrellas: "sin clasificar" (null) SIEMPRE después de lo clasificado. */
function cmpEstrellas(a: ItemResto, b: ItemResto, desc: boolean): number {
  const ea = a.estrellas, eb = b.estrellas;
  if (ea == null && eb == null) return 0;
  if (ea == null) return 1;
  if (eb == null) return -1;
  return desc ? eb - ea : ea - eb;
}
function cmpZona(a: ItemResto, b: ItemResto): number {
  const za = normalizarZonaClave(a.zona), zb = normalizarZonaClave(b.zona);
  if (za == null && zb == null) return 0;
  if (za == null) return 1;
  if (zb == null) return -1;
  return compararEs(za, zb);
}

/** Orden predeterminado del resto DENTRO de un paquete (regla cerrada):
 *  precio válido menor → estrellas descendentes → zona normalizada → nombre
 *  → hotelId como desempate final. */
function cmpPredeterminado(a: ItemResto, b: ItemResto): number {
  return (
    cmpPrecio(a, b, true) ||
    cmpEstrellas(a, b, true) ||
    cmpZona(a, b) ||
    cmpNombre(a, b) ||
    cmpHotelId(a, b)
  );
}

function comparadorDe(orden: OrdenResto): (a: ItemResto, b: ItemResto) => number {
  switch (orden) {
    case "precio_asc":
      return (a, b) => cmpPrecio(a, b, true) || cmpNombre(a, b) || cmpHotelId(a, b);
    case "precio_desc":
      return (a, b) => cmpPrecio(a, b, false) || cmpNombre(a, b) || cmpHotelId(a, b);
    case "estrellas_desc":
      return (a, b) => cmpEstrellas(a, b, true) || cmpNombre(a, b) || cmpHotelId(a, b);
    case "estrellas_asc":
      return (a, b) => cmpEstrellas(a, b, false) || cmpNombre(a, b) || cmpHotelId(a, b);
    case "nombre_asc":
      return (a, b) => cmpNombre(a, b) || cmpHotelId(a, b);
    case "nombre_desc":
      return (a, b) => -cmpNombre(a, b) || cmpHotelId(a, b);
    case "predeterminado":
    default:
      return cmpPredeterminado;
  }
}

/**
 * Filtra y ordena el resto (ya excluidos los recomendados) EN BLOQUES por
 * paquete (paqueteId ascendente, mismo criterio que `recomendados.ts`) — el
 * orden/filtro nunca aplana los bloques ni mezcla ofertas de paquetes
 * distintos. `filtros` debe venir ya "efectivizado" (ver `filtrosEfectivos`).
 */
export function ordenarYFiltrarResto(
  items: readonly ItemResto[],
  opts: { orden: OrdenResto; filtros: FiltrosResto }
): ItemResto[] {
  const filtrados = filtrarPorFiltros(items, opts.filtros);
  const porPaquete = new Map<number, ItemResto[]>();
  for (const it of filtrados) {
    const arr = porPaquete.get(it.paqueteId);
    if (arr) arr.push(it);
    else porPaquete.set(it.paqueteId, [it]);
  }
  const cmp = comparadorDe(opts.orden);
  const resultado: ItemResto[] = [];
  for (const pid of [...porPaquete.keys()].sort((a, b) => a - b)) {
    const arr = [...(porPaquete.get(pid) as ItemResto[])].sort(cmp);
    resultado.push(...arr);
  }
  return resultado;
}
