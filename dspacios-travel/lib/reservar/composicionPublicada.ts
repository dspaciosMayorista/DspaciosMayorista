// ─────────────────────────────────────────────────────────────────────────
// Evidencia de la composición PUBLICADA — módulo PURO (migración 258).
//
// En bloqueo/dinámico el PVP sale de la fila publicada y el costo/CxP de la composición VIVA de servicios incluidos. Antes de cotizar o numerar se acredita que la fila
// publicada corresponde a la regla vigente:
//   1. hay evidencia registrada para la fecha de ida de la salida,
//   2. fue escrita por la generación hoy PUBLICADA del paquete (no por una anterior),
//   3. con la versión vigente de la regla de composición, y
//   4. los servicios horneados son EXACTAMENTE los que la composición viva incluye en esa fecha.
// Sin evidencia (toda fila anterior a la 258, o cuya escritura falló) o con cualquier discrepancia se RECHAZA: «regenera el tarifario». Nunca se vende un precio que no
// se pueda acreditar.
// ─────────────────────────────────────────────────────────────────────────

/** Versión de la regla de composición (qué se hornea y qué se omite). Subirla invalida toda evidencia anterior. */
export const REGLA_COMPOSICION_PUBLICADA = 1;

export const MENSAJE_FILA_ANTIGUA =
  "El tarifario publicado de este paquete es anterior a la regla vigente de servicios incluidos y no acredita qué servicios respaldan su precio: regenera el tarifario del paquete antes de cotizar o reservar.";
export const MENSAJE_COMPOSICION_DISTINTA =
  "Los servicios incluidos de esta fecha ya no coinciden con los que respaldan el precio publicado: regenera el tarifario del paquete antes de cotizar o reservar.";
export const MENSAJE_EVIDENCIA_NO_DISPONIBLE =
  "No se puede verificar la composición del tarifario publicado (falta la migración 258 o falló la lectura): no se cotiza ni se reserva. Regenera el tarifario cuando la verificación esté disponible.";

export type EvidenciaComposicion = { generacion: number | null; regla: number | null; servicios: readonly number[] };

/** Ids de un jsonb leído de la base: solo enteros; cualquier otro contenido invalida la evidencia (null). */
export function idsDeJson(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const out: number[] = [];
  for (const x of v) {
    const n = typeof x === "number" ? x : typeof x === "string" && /^\d+$/.test(x) ? Number(x) : NaN;
    if (!Number.isInteger(n) || n < 0) return null;
    out.push(n);
  }
  return out;
}

export function verificarComposicionPublicada(i: {
  /** `armado_paquetes.tarifario_generacion_publicada` hoy. */
  generacionPublicada: number | null;
  /** Evidencia de la salida (null = no hay fila). */
  evidencia: EvidenciaComposicion | null;
  /** Incluidos que la composición VIVA incluye y cobra en esa fecha. */
  idsVivos: readonly number[];
}): { ok: true } | { ok: false; error: string } {
  const e = i.evidencia;
  if (!e || e.generacion == null || i.generacionPublicada == null || e.generacion !== i.generacionPublicada || e.regla !== REGLA_COMPOSICION_PUBLICADA) {
    return { ok: false, error: MENSAJE_FILA_ANTIGUA };
  }
  const horneados = new Set(e.servicios);
  const vivos = new Set(i.idsVivos);
  const iguales = horneados.size === vivos.size && [...vivos].every((id) => horneados.has(id));
  return iguales ? { ok: true } : { ok: false, error: MENSAJE_COMPOSICION_DISTINTA };
}
