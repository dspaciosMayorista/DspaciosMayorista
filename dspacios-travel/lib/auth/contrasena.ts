// #62 — reglas puras de contraseña para recuperar y cambiar (sin red ni cookies).
// Mínimo = el del registro B2B (`portal/registro/actions.ts`: 6). Es una política de seguridad: subirla es cambiar SOLO esta constante
// (la regla de Supabase Auth del proyecto remoto es independiente y no se modifica desde el código).
export const MIN_CONTRASENA = 6;
// bcrypt (GoTrue) solo usa los primeros 72 bytes: rechazar más evita una contraseña que parece más larga de lo que es.
export const MAX_BYTES_CONTRASENA = 72;

/** Devuelve el mensaje de error (en español) o `null` si la contraseña nueva es aceptable. `actual` solo se pasa al CAMBIAR desde una sesión. */
export function validarContrasenaNueva(nueva: unknown, confirmacion: unknown, actual?: unknown): string | null {
  if (typeof nueva !== "string" || typeof confirmacion !== "string") return "Escribe la nueva contraseña y su confirmación.";
  if (nueva.length < MIN_CONTRASENA) return `La contraseña debe tener al menos ${MIN_CONTRASENA} caracteres.`;
  if (new TextEncoder().encode(nueva).length > MAX_BYTES_CONTRASENA) return `La contraseña es demasiado larga (máximo ${MAX_BYTES_CONTRASENA} bytes).`;
  if (nueva !== confirmacion) return "La confirmación no coincide con la nueva contraseña.";
  if (typeof actual === "string" && nueva === actual) return "La nueva contraseña debe ser distinta de la actual.";
  return null;
}

/**
 * Mensaje del resultado PARCIAL: la contraseña cambió pero no se confirmó el cierre de las demás sesiones. No pide repetir el cambio. Revocar sesiones invalida los
 * tokens de REFRESCO; un token de ACCESO ya emitido sigue siendo válido hasta que expire (Supabase: signOut), de ahí la salvedad.
 */
export const MENSAJE_SESIONES_SIN_CERRAR =
  "Tu contraseña SÍ se actualizó, pero no pudimos confirmar el cierre de tus otras sesiones. No hace falta repetir el cambio: reintenta el cierre de sesiones. Un dispositivo con la sesión abierta puede seguir activo hasta que venza su acceso actual (normalmente, hasta una hora).";

/** Resultado de restablecer cuando NO se sabe si Auth aplicó el cambio: la recuperación queda consumida y el remedio seguro es un enlace nuevo. */
export const MENSAJE_RESULTADO_INCIERTO =
  "No pudimos confirmar si tu contraseña cambió. Intenta ingresar con la contraseña nueva; si no entra, usa la anterior o solicita un enlace nuevo (este enlace ya no se puede reutilizar).";

/** Correo para pedir el enlace: recortado y en minúsculas; `null` si no parece un correo (la comprobación real la hace el servidor de correo). */
export function correoRecuperacion(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const c = valor.trim().toLowerCase();
  return c.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) ? c : null;
}

/** Traduce los errores de GoTrue al mensaje que ve la persona, sin filtrar nada de la cuenta. */
export function mensajeErrorContrasena(error: { code?: string; message?: string; status?: number } | null | undefined): string {
  const c = error?.code ?? "";
  if (c === "same_password") return "La nueva contraseña debe ser distinta de la actual.";
  if (c === "weak_password") return "La contraseña es demasiado débil. Usa una más larga o más variada.";
  if (c === "over_request_rate_limit" || c === "over_email_send_rate_limit" || error?.status === 429) return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
  if (c === "reauthentication_needed" || c === "session_not_found" || c === "refresh_token_not_found") return "Tu enlace o sesión venció. Solicita un enlace nuevo.";
  return "No se pudo actualizar la contraseña. Inténtalo de nuevo.";
}
