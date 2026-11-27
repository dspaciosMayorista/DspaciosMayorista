// #78 residual — aviso INTERNO (campana) cuando un visitante SIN sesión genera una cotización pública. Solo servidor.
// La decisión de quién cuenta como «visitante» y quiénes reciben el aviso la toma la FUNCIÓN DE BASE `avisar_cotizacion_publica` (340): aquí solo se llama.
// Es un efecto AUXILIAR, igual que el registro de personas y el contacto de campañas: jamás bloquea ni deshace la cotización, y un fallo deja un log sin datos
// personales. Es idempotente (un aviso por destinatario y cotización), así que un reintento de la misma clave de envío puede repetirlo sin duplicar.
// Costo por cotización pública: 1 RPC. Sin sondeos, temporizadores ni reintentos propios. NO envía nada fuera de la plataforma.
import type { createAdminClient } from "@/lib/supabase/admin";

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;

export type ResultadoAvisoPublico = { ok: true; estado: "avisada" | "no_aplica"; notificados: number } | { ok: false; codigo: string | null };

/** Respuesta de la función → resultado tipado; cualquier forma inesperada es un fallo explícito, nunca un éxito supuesto. */
export function leerRespuestaAvisoPublico(data: unknown): ResultadoAvisoPublico {
  const r = (typeof data === "object" && data !== null ? data : {}) as { estado?: unknown; notificados?: unknown };
  if ((r.estado === "avisada" || r.estado === "no_aplica") && typeof r.notificados === "number" && Number.isInteger(r.notificados) && r.notificados >= 0) {
    return { ok: true, estado: r.estado, notificados: r.notificados };
  }
  return { ok: false, codigo: "respuesta_inesperada" };
}

/** Registra en consola SOLO el código del fallo (nunca el id del cliente, ni nombres, ni documentos). */
export function logAvisoPublico(cotizacionId: number, r: Extract<ResultadoAvisoPublico, { ok: false }>): string {
  return `[aviso_cotizacion_publica] cotizacion=${cotizacionId} codigo=${r.codigo ?? "desconocido"}`;
}

export async function avisarCotizacionPublica(admin: ReturnType<typeof createAdminClient>, cotizacionId: number): Promise<ResultadoAvisoPublico> {
  if (!Number.isInteger(cotizacionId) || cotizacionId <= 0) return { ok: false, codigo: "id_invalido" };
  try {
    // La función es nueva (340) y aún no está en types/database.ts: se llama sin tipo, como las demás de avisos.
    const rpc = (admin as unknown as { rpc: Rpc }).rpc.bind(admin);
    const { data, error } = await rpc("avisar_cotizacion_publica", { p_cotizacion_id: cotizacionId });
    if (error) return { ok: false, codigo: error.code ?? "rpc" };
    return leerRespuestaAvisoPublico(data);
  } catch {
    return { ok: false, codigo: "excepcion" };
  }
}

/** Atajo para los puntos de creación/repetición: llama y registra el fallo (si lo hay). Nunca lanza. */
export async function avisarYRegistrar(admin: ReturnType<typeof createAdminClient>, cotizacionId: number): Promise<void> {
  const r = await avisarCotizacionPublica(admin, cotizacionId);
  if (!r.ok) console.error(logAvisoPublico(cotizacionId, r));
}
