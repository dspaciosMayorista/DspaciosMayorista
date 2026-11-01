// ─────────────────────────────────────────────────────────────────────────────
// Composición de la 258 que viaja en el MANIFIESTO de la publicación por lotes (módulo puro).
//
// Por fecha de ida de cada salida de bloqueo/dinámico: los ids de los servicios incluidos que están horneados en su precio. Es lo MISMO que la 258 registra tras publicar con `registrar_composicion_publicada`; en el camino por lotes la escribe la activación, en la misma transacción que mueve el
// puntero, a partir de lo que el manifiesto fijó ANTES de cargar. Ver docs/tecnico/publicador-tarifario-lotes.md.
// ─────────────────────────────────────────────────────────────────────────────

// La versión de la regla es `REGLA_COMPOSICION_PUBLICADA` (lib/reservar/composicionPublicada.ts, 258): la acción la pasa tal cual al manifiesto.

export type FilaComposicion = { fecha_ida: string; servicios_incluidos: number[] };

/** Ids (únicos, ascendentes) de los servicios incluidos del paquete, sin los `omitidos` de la estadía (la 256 omite un incluido sin tarifa vigente en esa fecha). */
export function idsIncluidos(servicios: readonly { servicio_id: number; incluido: unknown }[], omitidos: ReadonlySet<number> = new Set()): number[] {
  const ids = new Set<number>();
  for (const s of servicios) if (s.incluido === true && !omitidos.has(s.servicio_id)) ids.add(s.servicio_id);
  return [...ids].sort((a, b) => a - b);
}

/** Filas del manifiesto, ordenadas por fecha: la huella del manifiesto no depende del orden de generación (reanudar recalcula las mismas filas). */
export function composicionDeManifiesto(porFecha: ReadonlyMap<string, readonly number[]>): FilaComposicion[] {
  return [...porFecha]
    .map(([fecha_ida, ids]) => ({ fecha_ida, servicios_incluidos: [...new Set(ids)].sort((a, b) => a - b) }))
    .sort((a, b) => (a.fecha_ida < b.fecha_ida ? -1 : a.fecha_ida > b.fecha_ida ? 1 : 0));
}
