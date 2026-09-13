// ─────────────────────────────────────────────────────────────────────────
// Helper PURO compartido: valida un producto cartesiano categorías×
// alimentaciones CONFIGURADO (`armado_hoteles.categorias/regimenes`) contra
// los pares REALES publicados de un hotel `modelo_tarifario = "unidad"`
// (`hotel_tarifas_unidad`, columnas espejo `categoria`/`alimentacion`,
// `estado = "publicada"`).
//
// Antes de este archivo, la regla vivía SOLO dentro de `setHotelFiltros`
// (`app/(dashboard)/dashboard/paquetes/actions.ts`) — validar categorías y
// alimentaciones POR SEPARADO permitía combinaciones que nunca se
// publicaron juntas (ej. "Estándar/FULL" y "Suite/PC" publicadas no
// implican que "Estándar/PC" tenga tarifa). Este módulo extrae esa regla
// para reutilizarla también en el descubrimiento público
// (`lib/tarifario/datosBernalo.ts`) y en el aviso administrativo de
// `generarTarifario` — la MISMA función decide "¿esta combinación está
// realmente publicada?" en los tres lugares, nunca una copia que pueda
// divergir.
//
// Puro: sin I/O, sin Supabase — recibe filas ya leídas.
// ─────────────────────────────────────────────────────────────────────────

export type ParPublicadoUnidad = { categoria: string | null; alimentacion: string | null };

/**
 * Set de pares REALES publicados, codificados como `JSON.stringify([categoria, alimentacion])`
 * — nunca un separador de texto plano (colisionaría si una categoría o
 * alimentación contuviera ese separador). Filas con categoría o
 * alimentación vacía/null se descartan: un par publicado sin clasificación
 * completa no identifica ninguna combinación configurable.
 */
export function construirSetParesPublicados(filas: readonly ParPublicadoUnidad[]): Set<string> {
  return new Set(
    filas
      .filter((f): f is { categoria: string; alimentacion: string } => !!f.categoria && !!f.alimentacion)
      .map((f) => JSON.stringify([f.categoria, f.alimentacion]))
  );
}

/**
 * `true` solo si HAY al menos una categoría y una alimentación configuradas
 * Y el producto cartesiano COMPLETO (todas las combinaciones categoría×
 * alimentación configuradas) tiene una tarifa publicada — nunca "alguna"
 * combinación, nunca con arreglos vacíos (arreglo vacío nunca significa
 * "todas" para este modelo, a diferencia de persona).
 */
export function todosLosParesConfiguradosPublicados(
  categorias: readonly string[],
  regimenes: readonly string[],
  paresPublicados: ReadonlySet<string>
): boolean {
  if (!categorias.length || !regimenes.length) return false;
  for (const c of categorias) {
    for (const r of regimenes) {
      if (!paresPublicados.has(JSON.stringify([c, r]))) return false;
    }
  }
  return true;
}

/** Primera combinación configurada SIN tarifa publicada — para mensajes de error específicos. */
export function primerParConfiguradoSinPublicar(
  categorias: readonly string[],
  regimenes: readonly string[],
  paresPublicados: ReadonlySet<string>
): { categoria: string; alimentacion: string } | null {
  for (const c of categorias) {
    for (const r of regimenes) {
      if (!paresPublicados.has(JSON.stringify([c, r]))) return { categoria: c, alimentacion: r };
    }
  }
  return null;
}
