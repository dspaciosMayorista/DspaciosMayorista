// ── Identidad estructural de un "combo" del tarifario — compartida entre el
// resumen (Tier 1, `FilaResumen`) y el detalle bajo demanda (Tier 2,
// `FilaTarifario`) ─────────────────────────────────────────────────────────
//
// Ronda 6, ítem 2 (defecto "el detalle pierde los filtros activos"): al abrir
// un hotel/salida/paquete desde una vista ya filtrada (búsqueda de texto,
// categoría, régimen, o una salida puntual elegida), el detalle bajo demanda
// (Tier 2) volvía a traer TODO lo que ese hotel/salida/paquete tuviera en el
// catálogo — sin importar que el usuario ya hubiera reducido el alcance. Un
// simple `bloqueoIds` (como usaba la ronda anterior, solo para el submódulo
// Bloqueo de Vista Booking) no alcanza: no cubre categoría/régimen/búsqueda,
// ni el submódulo Porción terrestre, ni Vista tabla (Salidas/Paquetes).
//
// La solución: un "combo" es la combinación exacta de las columnas que YA
// identifican unívocamente una fila del resumen (mismo grano que agrupa la
// vista `tarifario_resumen`, migración 162 — ver `lib/tarifario/resumen.ts`),
// MENOS la acomodación (que el resumen ya colapsa, y que el detalle sigue
// desglosando fila por fila — el filtro de acomodación sigue actuando
// DESPUÉS, sobre las filas ya traídas, exactamente como antes). Tanto
// `FilaResumen` como `FilaTarifario` (el tipo de fila completa del detalle,
// `COLUMNAS_DETALLE` en app/tarifario/detalle-actions.ts) traen estos mismos
// 10 campos — así que la MISMA función pura sirve para calcular la clave de
// cualquiera de las dos formas, en cliente o en servidor.
//
// El cliente declara el ALCANCE PERMITIDO como un array de estos combos
// (derivado de las filas de resumen ya visibles bajo los filtros activos); el
// servidor valida ese array como `unknown` (ver lib/tarifario/
// detalleValidacion.ts) y post-filtra las filas de detalle que trajo de
// Supabase contra ese alcance ANTES de devolverlas — el alcance declarado por
// el cliente es la fuente AUTORITATIVA de qué combos son válidos, no solo una
// pista de optimización de consulta.
// Todos los campos OPCIONALES (`?:`) a propósito, no solo nulables: así el
// tipo acepta estructuralmente TANTO `FilaResumen` (campos siempre
// presentes, nunca `undefined`) COMO `FilaTarifario` (varios campos
// `campo?: tipo | null`, es decir puede faltar del todo) sin necesitar un
// adaptador — `claveCombo()` trata `undefined` igual que `null` (ver
// `f[c] == null` abajo).
export type ComboIdentidad = {
  modulo?: string;
  paquete_id?: number | null;
  bloqueo_id?: number | null;
  salida_id?: number | null;
  hotel_id?: number | null;
  categoria?: string | null;
  regimen?: string | null;
  fecha_ida?: string | null;
  fecha_regreso?: string | null;
  moneda?: string | null;
};

const CAMPOS_COMBO: readonly (keyof ComboIdentidad)[] = [
  "modulo", "paquete_id", "bloqueo_id", "salida_id", "hotel_id",
  "categoria", "regimen", "fecha_ida", "fecha_regreso", "moneda",
];

// `∅` como separador de "null" — nunca puede aparecer en un id/fecha/moneda
// reales, así que no hay riesgo de colisión entre, por ejemplo,
// `hotel_id:null` y `hotel_id:"null"` (string literal).
export function claveCombo(f: ComboIdentidad): string {
  return CAMPOS_COMBO.map((c) => (f[c] == null ? "∅" : String(f[c]))).join("|||");
}

/** Conjunto de claves únicas (deduplicado) — para construir el allow-list del servidor. */
export function clavesCombo(combos: ComboIdentidad[]): Set<string> {
  return new Set(combos.map(claveCombo));
}

/**
 * Clave de caché normalizada (orden estable, deduplicada) para un array de
 * combos — usada por lib/tarifario/detalleCliente.ts para que la clave de
 * caché del detalle incorpore el alcance completo, no solo un id estructural.
 */
export function claveComboAlcanceNormalizada(combos: ComboIdentidad[]): string {
  return [...clavesCombo(combos)].sort().join(",");
}

/**
 * El cruce autoritativo en sí: de `filas` (el detalle completo que trajo
 * Supabase, con la granularidad de acomodación intacta), conserva SOLO las
 * que pertenecen a alguno de los `combos` permitidos — comparando por
 * `claveCombo()`, que ignora la acomodación a propósito (ver nota grande
 * arriba), así que TODAS las filas de acomodación de un combo permitido
 * pasan (el filtro de acomodación sigue actuando DESPUÉS, sobre estas
 * filas, exactamente como antes de esta ronda). Genérico sobre `T` para
 * poder usarse tanto con `FilaTarifario` (app/tarifario/detalle-actions.ts,
 * servidor) como con cualquier otra forma de fila que comparta los 10
 * campos de `ComboIdentidad`.
 */
export function filtrarPorCombos<T extends ComboIdentidad>(filas: T[], combos: ComboIdentidad[]): T[] {
  const permitidos = clavesCombo(combos);
  return filas.filter((f) => permitidos.has(claveCombo(f)));
}
