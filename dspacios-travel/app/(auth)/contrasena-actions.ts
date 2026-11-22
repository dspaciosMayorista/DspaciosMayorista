"use server";

import { createClient } from "@/lib/supabase/server";
import { createClienteSinSesion } from "@/lib/supabase/sinSesion";
import { validarContrasenaNueva, mensajeErrorContrasena, MENSAJE_SESIONES_SIN_CERRAR, MENSAJE_RESULTADO_INCIERTO } from "@/lib/auth/contrasena";
import { autorizacionRecuperacion, reclamarRecuperacion, confirmarRecuperacion, liberarRecuperacion } from "@/lib/auth/recuperacionServidor";

/**
 * `parcial` = la contraseña SÍ cambió, pero no se pudo confirmar el cierre de las demás sesiones. No es éxito completo y repetir el cambio de contraseña
 * no es el remedio: la persona reintenta SOLO el cierre (`cerrarSesionesAbiertas`) o sale de esta sesión.
 * Cerrar sesiones revoca los tokens de REFRESCO; un token de ACCESO ya emitido sigue siendo válido hasta que expire (Supabase: signOut).
 */
export type ResultadoContrasena =
  | { ok: true }
  | { ok: false; error: string; enlaceVencido?: boolean; usarCambio?: boolean; incierto?: boolean }
  | { ok: "parcial"; alcance: "global" | "others"; mensaje: string };

type Alcance = "global" | "others";

/** Auth contestó con un 4xx: rechazó el cambio sin aplicarlo. Cualquier otra cosa (5xx, sin estado, excepción) es resultado INCIERTO. */
const rechazoDefinitivo = (e: { status?: number }) => typeof e.status === "number" && e.status >= 400 && e.status < 500;

/** Intenta revocar sesiones; los errores DEVUELTOS y los LANZADOS se tratan igual (nunca se asume que se cerraron). */
async function revocarSesiones(sb: Awaited<ReturnType<typeof createClient>>, alcance: Alcance): Promise<boolean> {
  try {
    const { error } = await sb.auth.signOut({ scope: alcance });
    return !error;
  } catch {
    return false;
  }
}

// identidad:n/a — cuenta de acceso (Supabase Auth); no escribe tablas de contrato
/**
 * #62 · Fija la contraseña nueva SIN pedir la actual, y por eso exige una sesión de RECUPERACIÓN verificada en el servidor (token verificado con Auth,
 * método de recuperación reciente, mismo usuario, reclamo atómico en servidor; ver lib/auth/recuperacion.ts). Una sesión ordinaria no la autoriza: debe usar «Cambiar contraseña».
 */
export async function restablecerContrasena(nueva: string, confirmacion: string): Promise<ResultadoContrasena> {
  const msg = validarContrasenaNueva(nueva, confirmacion);
  if (msg) return { ok: false, error: msg };
  const sb = await createClient();
  const aut = await autorizacionRecuperacion(sb);
  if (!aut.ok) {
    if (aut.motivo === "sin_recuperacion") {
      return { ok: false, usarCambio: true, error: "Para cambiar tu contraseña con la sesión iniciada usa «Cambiar contraseña»: pide tu contraseña actual. El restablecimiento solo funciona desde el enlace del correo." };
    }
    return { ok: false, enlaceVencido: true, error: "Tu enlace venció, ya se usó o no corresponde a esta sesión. Solicita uno nuevo." };
  }
  // B4: el reclamo es ATÓMICO y vive en el servidor (clave primaria usuario+evento): de varias solicitudes simultáneas solo UNA llega a updateUser.
  const reclamo = await reclamarRecuperacion(aut.usuarioId, aut.evento);
  if (reclamo === "ya_reclamada") return { ok: false, enlaceVencido: true, error: "Tu enlace venció, ya se usó o no corresponde a esta sesión. Solicita uno nuevo." };
  if (reclamo === "error") return { ok: false, error: "No pudimos verificar tu enlace en este momento. Inténtalo de nuevo en unos minutos." };
  try {
    const { error } = await sb.auth.updateUser({ password: nueva });
    if (error) {
      // Rechazo DEFINITIVO de Auth (4xx: contraseña débil/igual a la actual/límite): no se aplicó nada → se libera el reclamo para corregir y reintentar.
      if (rechazoDefinitivo(error)) {
        await liberarRecuperacion(aut.usuarioId, aut.evento);
        return { ok: false, error: mensajeErrorContrasena(error) };
      }
      // Error sin estado o de servidor (5xx): NO sabemos si se aplicó. El reclamo queda consumido; el remedio seguro es un enlace nuevo.
      return { ok: false, incierto: true, error: MENSAJE_RESULTADO_INCIERTO };
    }
  } catch {
    return { ok: false, incierto: true, error: MENSAJE_RESULTADO_INCIERTO };
  }
  await confirmarRecuperacion(aut.usuarioId, aut.evento);
  if (!(await revocarSesiones(sb, "global"))) return { ok: "parcial", alcance: "global", mensaje: MENSAJE_SESIONES_SIN_CERRAR };
  return { ok: true };
}

// identidad:n/a — cuenta de acceso (Supabase Auth); no escribe tablas de contrato
/**
 * #62 · Cambia la contraseña de la persona AUTENTICADA (cualquier rol). Exige la contraseña ACTUAL, comprobada con un cliente sin sesión (no rota la sesión
 * en curso). Tras el cambio cierra las DEMÁS sesiones; si no puede confirmarlo devuelve `parcial` (la contraseña ya cambió).
 */
export async function cambiarContrasena(actual: string, nueva: string, confirmacion: string): Promise<ResultadoContrasena> {
  if (typeof actual !== "string" || !actual) return { ok: false, error: "Escribe tu contraseña actual." };
  const msg = validarContrasenaNueva(nueva, confirmacion, actual);
  if (msg) return { ok: false, error: msg };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email) return { ok: false, error: "Tu sesión venció. Ingresa de nuevo.", enlaceVencido: true };

  const { error: errActual } = await createClienteSinSesion().auth.signInWithPassword({ email: user.email, password: actual });
  if (errActual) {
    return { ok: false, error: errActual.status === 429 ? mensajeErrorContrasena(errActual) : "La contraseña actual no es correcta." };
  }
  try {
    const { error } = await sb.auth.updateUser({ password: nueva });
    if (error) return { ok: false, error: mensajeErrorContrasena(error) };
  } catch {
    return { ok: false, error: "No pudimos confirmar el cambio. Intenta ingresar con la contraseña nueva; si no funciona, vuelve a intentarlo." };
  }
  if (!(await revocarSesiones(sb, "others"))) return { ok: "parcial", alcance: "others", mensaje: MENSAJE_SESIONES_SIN_CERRAR };
  return { ok: true };
}

// identidad:n/a — cuenta de acceso (Supabase Auth); no escribe tablas de contrato
/**
 * #62 · Reintenta SOLO el cierre de sesiones tras un resultado `parcial` (no toca la contraseña). Cualquier sesión autenticada puede pedir el cierre de
 * sus propias sesiones: no concede ningún permiso nuevo.
 */
export async function cerrarSesionesAbiertas(alcance: Alcance): Promise<{ ok: true } | { ok: false; error: string }> {
  if (alcance !== "global" && alcance !== "others") return { ok: false, error: "Alcance inválido." };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión venció. Ingresa de nuevo." };
  return (await revocarSesiones(sb, alcance)) ? { ok: true } : { ok: false, error: "Todavía no pudimos cerrar las demás sesiones. Inténtalo otra vez en unos minutos o sal de esta sesión." };
}
