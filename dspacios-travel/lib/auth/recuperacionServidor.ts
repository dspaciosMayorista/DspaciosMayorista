import { evaluarRecuperacion, reclamosDeJwt, type EvaluacionRecuperacion } from "@/lib/auth/recuperacion";
import { createAdminClient } from "@/lib/supabase/admin";

type ClienteAuth = {
  auth: {
    getSession: () => Promise<{ data: { session: { access_token?: string } | null } }>;
    getUser: (jwt?: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
};

const TABLA = "recuperaciones_consumidas";
// Cliente de servicio SIN el tipo generado: la tabla es nueva (316) y el tipo se regenera con el esquema.
const tabla = () => createAdminClient().from(TABLA as never) as unknown as {
  select: (c: string) => { eq: (a: string, b: string) => { eq: (a: string, b: string) => { maybeSingle: () => Promise<{ data: { estado?: string } | null; error: unknown }> } } };
  insert: (v: Record<string, unknown>) => Promise<{ error: { code?: string } | null }>;
  update: (v: Record<string, unknown>) => { eq: (a: string, b: string) => { eq: (a: string, b: string) => Promise<{ error: unknown }> } };
  delete: () => { eq: (a: string, b: string) => { eq: (a: string, b: string) => Promise<{ error: unknown }> } };
};

/** `consumida`: ese evento ya se reclamó. `aplicada` = Auth confirmó el cambio; si es false el resultado quedó INCIERTO (se pide un enlace nuevo). */
export type EvaluacionServidor = EvaluacionRecuperacion | { ok: false; motivo: "consumida"; aplicada: boolean };

/**
 * Autorización de recuperación de la sesión ACTUAL, decidida en el servidor: el token de acceso se verifica con Auth (`getUser(token)` con ESE token, no con
 * lo que diga la cookie), se leen sus reclamos y se consulta en la tabla del servidor si ESE evento ya se reclamó. Cualquier fallo de lectura niega (falla cerrado).
 * Es una LECTURA (la usa la página); la acción además hace el reclamo atómico (`reclamarRecuperacion`).
 */
export async function autorizacionRecuperacion(sb: ClienteAuth, ahoraMs: number = Date.now()): Promise<EvaluacionServidor> {
  let token: string | undefined;
  try {
    token = (await sb.auth.getSession()).data.session?.access_token;
  } catch {
    return { ok: false, motivo: "sin_sesion" };
  }
  if (!token) return { ok: false, motivo: "sin_sesion" };
  let userId: string | null = null;
  try {
    const r = await sb.auth.getUser(token);
    userId = r.error ? null : (r.data.user?.id ?? null);
  } catch {
    return { ok: false, motivo: "sin_sesion" };
  }
  const ev = evaluarRecuperacion({ claims: reclamosDeJwt(token), userId, ahoraMs });
  if (!ev.ok) return ev;
  try {
    const { data, error } = await tabla().select("estado").eq("user_id", ev.usuarioId).eq("evento", ev.evento).maybeSingle();
    if (error) return { ok: false, motivo: "sin_sesion" };
    if (data) return { ok: false, motivo: "consumida", aplicada: data.estado === "aplicada" };
  } catch {
    return { ok: false, motivo: "sin_sesion" };
  }
  return ev;
}

/**
 * Reclamo ATÓMICO de la recuperación: la clave primaria (usuario, evento) deja pasar a UNA sola solicitud; la otra recibe 23505. Un error distinto de 23505
 * (red, permisos) se trata como «no reclamada»: no se actualiza la contraseña (falla cerrado).
 */
export async function reclamarRecuperacion(usuarioId: string, evento: string): Promise<"reclamada" | "ya_reclamada" | "error"> {
  try {
    const { error } = await tabla().insert({ user_id: usuarioId, evento, estado: "reclamada" });
    if (!error) return "reclamada";
    return error.code === "23505" ? "ya_reclamada" : "error";
  } catch {
    return "error";
  }
}

/** Auth confirmó el cambio: el evento queda `aplicada` (la página lo muestra como «contraseña ya actualizada»). Mejor esfuerzo: sigue consumido aunque falle. */
export async function confirmarRecuperacion(usuarioId: string, evento: string): Promise<void> {
  try { await tabla().update({ estado: "aplicada", aplicada_en: new Date().toISOString() }).eq("user_id", usuarioId).eq("evento", evento); } catch { /* sigue reclamada = consumida */ }
}

/** SOLO si Auth RECHAZÓ el cambio sin aplicarlo (4xx definitivo): se libera el reclamo para que la persona corrija y reintente. Si falla, queda consumida (pedir enlace nuevo). */
export async function liberarRecuperacion(usuarioId: string, evento: string): Promise<void> {
  try { await tabla().delete().eq("user_id", usuarioId).eq("evento", evento); } catch { /* queda consumida: el remedio seguro es un enlace nuevo */ }
}
