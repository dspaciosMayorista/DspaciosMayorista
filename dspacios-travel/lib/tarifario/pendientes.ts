// #103 (H2) — which packages of a hotel still owe a regeneration, derived ONLY from persisted state (never from what a browser or an `after()` callback remembers). PURE.
// The database already records the debt in the same transaction as the save: every change to a season or closure raises `armado_paquetes.tarifario_revision_fuente` (migrations 181/260/315); a publication that
// completes sets `tarifario_revision_publicada` to the revision it computed from. So «revision_fuente > revision_publicada» is the authoritative marker of unfinished work, whatever happened to the process that
// should have done it (never started, killed mid-way, superseded by a newer edit). `recalculando` has no start timestamp, so a package that claims to be recalculating is only trusted while its LATEST pending
// change is younger than the lease (a live worker is then likely); older than that it is treated as orphaned and resumed (a new generation token makes any still-running older computation unable to publish).

export type FilaPendiente = { id: number; estado: string | null; revisionFuente: number | null; revisionPublicada: number | null; ultimoCambioMs: number | null };
export type Clasificacion = { reanudar: number[]; enCursoVivo: number[]; alDia: number[]; fallidos: number[]; masAntiguaMs: number | null };

/** A computation younger than this after the latest change is assumed alive (one package normally takes seconds; the app's own budget per generation is far below this). */
export const ARRENDAMIENTO_REGENERACION_MS = 3 * 60_000;

export function clasificarPendientes(filas: readonly FilaPendiente[], ahoraMs: number, arrendamientoMs = ARRENDAMIENTO_REGENERACION_MS): Clasificacion {
  const out: Clasificacion = { reanudar: [], enCursoVivo: [], alDia: [], fallidos: [], masAntiguaMs: null };
  for (const f of filas) {
    const debe = (f.revisionFuente ?? 0) > (f.revisionPublicada ?? 0) || f.estado === "fallido";
    if (!debe) { out.alDia.push(f.id); continue; }
    if (f.estado === "fallido") out.fallidos.push(f.id);
    if (f.estado === "recalculando" && f.ultimoCambioMs != null && ahoraMs - f.ultimoCambioMs < arrendamientoMs) { out.enCursoVivo.push(f.id); continue; }
    out.reanudar.push(f.id);
    // a debt whose change time is unknown (no `tarifario_cambio_fuente` row for the unpublished revisions) is treated as OLD, never as young: nothing says a computation could be alive for it
    const edad = f.ultimoCambioMs != null ? ahoraMs - f.ultimoCambioMs : Number.POSITIVE_INFINITY;
    out.masAntiguaMs = out.masAntiguaMs == null ? edad : Math.max(out.masAntiguaMs, edad);
  }
  return out;
}

/** A debt must be at least this old before the screen resumes it by itself: the deferred run that the save started normally needs seconds to a couple of minutes, and a package it is working on is `recalculando` (alive). */
export const GRACIA_AUTO_REANUDAR_MS = 120_000;
/** Bounded automatic recovery: resume on its own only when work is owed, NO computation is alive, and the oldest unpublished change is older than the grace. */
export function debeReanudarSolo(c: Clasificacion): boolean {
  // packages already marked `fallido` need a person (a failing computation is not retried on every visit): only the rest is resumed automatically
  return c.reanudar.some((id) => !c.fallidos.includes(id)) && c.enCursoVivo.length === 0 && c.masAntiguaMs != null && c.masAntiguaMs >= GRACIA_AUTO_REANUDAR_MS;
}

/** Spanish status line for the hotel screen, from the classification. Empty when nothing is owed. */
export function textoEstadoTarifarios(c: Clasificacion): string | null {
  const n = c.reanudar.length + c.enCursoVivo.length;
  if (!n) return null;
  const paq = (k: number) => `${k} paquete${k === 1 ? "" : "s"}`;
  if (c.reanudar.length === 0) return `Actualizando los tarifarios de ${paq(c.enCursoVivo.length)}. Las combinaciones afectadas ya no se muestran con el precio anterior.`;
  return `Quedaron ${paq(c.reanudar.length)} sin actualizar${c.fallidos.length ? ` (${c.fallidos.length} con error)` : ""}. Las combinaciones afectadas permanecen ocultas hasta terminar; pulsa «Actualizar ahora» para completarlas.`;
}
