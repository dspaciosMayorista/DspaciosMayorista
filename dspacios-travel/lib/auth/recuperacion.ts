// #62 (B1+B4) — autorización de «restablecer contraseña» SIN contraseña actual: solo con una sesión de RECUPERACIÓN verificada por el servidor.
// Una sesión ordinaria (password, OAuth, enlace mágico…) nunca la autoriza: para esa existe «Cambiar contraseña» (que exige la contraseña actual).
// Prueba de recuperación = el JWT de acceso, VERIFICADO por Auth (getUser(token)), trae en `amr` una entrada de método «recuperación» reciente, del mismo usuario.
// «Una sola vez» (B4) NO se decide aquí ni con `user_metadata` (el usuario puede editarlo): lo decide el reclamo ATÓMICO en una tabla del servidor
// (`recuperaciones_consumidas`, migración 316), atado al EVENTO = usuario + sesión de recuperación + instante (`eventoRecuperacion`). Función pura: sin red ni cookies.
// Límite honesto: es la puerta de ESTA app; quien tuviera una sesión de recuperación viva también podría llamar a Auth directamente (eso lo limita Auth: expiración
// del enlace, revocación de sesiones y, si se activa en el proyecto, `secure_password_change`). La app no puede cerrar la API del proveedor.

/** El enlace de recuperación solo sirve para fijar la clave dentro de esta ventana desde que se canjeó (segundos). */
export const VENTANA_RECUPERACION_SEGUNDOS = 15 * 60;

export type ReclamosJwt = { sub?: unknown; amr?: unknown; session_id?: unknown; [k: string]: unknown };

export type MotivoRecuperacion = "sin_sesion" | "sin_recuperacion" | "sesion_distinta" | "vencida";
/** `evento` identifica ESTA recuperación (usuario + sesión + instante); es la clave del reclamo atómico. */
export type EvaluacionRecuperacion = { ok: true; instante: number; usuarioId: string; evento: string } | { ok: false; motivo: MotivoRecuperacion };

/** Decodifica el payload SIN verificar la firma. Solo es de fiar tras `getUser(token)` con ese mismo token. */
export function reclamosDeJwt(token: unknown): ReclamosJwt | null {
  if (typeof token !== "string") return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const json = Buffer.from(partes[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const r = JSON.parse(json);
    return r && typeof r === "object" ? (r as ReclamosJwt) : null;
  } catch {
    return null;
  }
}

/** Instante (segundos) de la entrada de recuperación más reciente del `amr`, o null si no hay ninguna. */
export function instanteRecuperacion(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null;
  let mejor: number | null = null;
  for (const e of amr) {
    const m = e as { method?: unknown; timestamp?: unknown };
    if (m && m.method === "recovery" && typeof m.timestamp === "number" && Number.isFinite(m.timestamp)) {
      if (mejor === null || m.timestamp > mejor) mejor = m.timestamp;
    }
  }
  return mejor;
}

/** Clave del evento de recuperación: la sesión (única por canje del enlace) + el instante de su entrada `recovery`. Un enlace nuevo = evento nuevo. */
export function eventoRecuperacion(sessionId: string, instante: number): string {
  return `${sessionId}:${instante}`;
}

/**
 * `userId` es el que devolvió Auth para ESE token (getUser(token)); `claims` son los del mismo token.
 * El orden de las comprobaciones es el orden en que se explica al usuario: sin recuperación → otra sesión → vencida. Sin `session_id` no hay evento: se niega.
 * El estado «ya consumida» NO sale de aquí: lo da el reclamo en la tabla del servidor.
 */
export function evaluarRecuperacion(i: { claims: ReclamosJwt | null; userId: string | null; ahoraMs: number }): EvaluacionRecuperacion {
  if (!i.claims || !i.userId) return { ok: false, motivo: "sin_sesion" };
  const ts = instanteRecuperacion(i.claims.amr);
  if (ts === null) return { ok: false, motivo: "sin_recuperacion" };
  if (typeof i.claims.sub !== "string" || i.claims.sub !== i.userId) return { ok: false, motivo: "sesion_distinta" };
  if (i.ahoraMs > (ts + VENTANA_RECUPERACION_SEGUNDOS) * 1000) return { ok: false, motivo: "vencida" };
  const sid = i.claims.session_id;
  if (typeof sid !== "string" || !sid) return { ok: false, motivo: "sin_sesion" };
  return { ok: true, instante: ts, usuarioId: i.userId, evento: eventoRecuperacion(sid, ts) };
}

/** `true` si la sesión recién canjeada es de recuperación (el callback decide el destino con ESTO, nunca con `next`). */
export function esSesionDeRecuperacion(accessToken: unknown): boolean {
  const c = reclamosDeJwt(accessToken);
  return !!c && instanteRecuperacion(c.amr) !== null;
}
