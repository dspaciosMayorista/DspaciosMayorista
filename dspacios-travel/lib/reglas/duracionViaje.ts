// #43/#60 entrega L (§3.8, historial AA): ESTADÍA MÁXIMA de un viaje, para todos los tipos (bloqueo, empaquetado, dinámico, porción
// terrestre, programas, receptivos y documentos manuales nuevos). Es el único lugar del CÓDIGO; la BASE tiene su propia copia en
// `public._e5_max_noches()` (coincidencias de la 301 y CHECK de la 302) y cambiar este número NO la cambia. Las dos se mantienen iguales
// a propósito: `pruebas/limiteNochesSincronia43L.test.ts` falla si difieren. Para cambiar el límite con la 301 ya aplicada: una migración
// NUEVA que redefina `_e5_max_noches()` con el valor, este número y los dos scripts que lo repiten (postcheck de la 301 y diagnóstico de la
// entrega L), todo en el mismo cambio. La salida no cuenta como noche (1 → 31 = 30 noches, válida).
// Nunca se recorta: una duración mayor se rechaza con el mensaje. No aplica a contratos ni cotizaciones ya guardados (se consultan,
// imprimen y editan como hoy), ni a la anticipación de compra, EBB, Long Stay o noches mínimas.
export const MAX_NOCHES_VIAJE = 30;

export const mensajeNochesViaje = (noches: number) =>
  `La estadía máxima es de ${MAX_NOCHES_VIAJE} noches; elegiste ${noches}. Ajusta las fechas.`;

/** Noches entre dos fechas ISO (AAAA-MM-DD); null si alguna no es una fecha real. */
export function nochesEntre(ida: string, regreso: string): number | null {
  const a = Date.parse(`${ida}T00:00:00Z`), b = Date.parse(`${regreso}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ida) || !/^\d{4}-\d{2}-\d{2}$/.test(regreso) || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** ¿Respeta la estadía máxima? (las noches deben venir ya validadas como entero ≥ 1 por quien llama). */
export function validarNochesViaje(noches: number): { ok: true } | { ok: false; error: string } {
  return noches > MAX_NOCHES_VIAJE ? { ok: false, error: mensajeNochesViaje(noches) } : { ok: true };
}

/** Igual, desde las fechas de ida y regreso. Fechas ausentes o inválidas: no decide (las valida quien llama con su regla de siempre). */
export function validarFechasViaje(ida: string | null | undefined, regreso: string | null | undefined): { ok: true } | { ok: false; error: string } {
  if (!ida || !regreso) return { ok: true };
  const n = nochesEntre(ida.slice(0, 10), regreso.slice(0, 10));
  return n == null ? { ok: true } : validarNochesViaje(n);
}

/**
 * Al EDITAR un producto que ya existía: si su duración no cambia, se conserva tal cual (un producto antiguo de más de 30 noches lo
 * decide el dueño tras el diagnóstico `supabase/scripts/diagnostico_L_productos_mas_30_noches.sql`, nunca este guardado); si cambia,
 * la nueva debe respetar el máximo.
 */
export function validarNochesAlEditar(nuevas: number | null | undefined, anteriores: number | null | undefined): { ok: true } | { ok: false; error: string } {
  if (nuevas == null || !Number.isFinite(nuevas) || (anteriores != null && nuevas === anteriores)) return { ok: true };
  return validarNochesViaje(nuevas);
}

/** Igual, con fechas (ida y regreso nuevas frente a las guardadas). */
export function validarFechasAlEditar(ida: string | null | undefined, regreso: string | null | undefined, idaPrev: string | null | undefined, regresoPrev: string | null | undefined): { ok: true } | { ok: false; error: string } {
  const n = ida && regreso ? nochesEntre(ida.slice(0, 10), regreso.slice(0, 10)) : null;
  const p = idaPrev && regresoPrev ? nochesEntre(idaPrev.slice(0, 10), regresoPrev.slice(0, 10)) : null;
  return validarNochesAlEditar(n, p);
}
