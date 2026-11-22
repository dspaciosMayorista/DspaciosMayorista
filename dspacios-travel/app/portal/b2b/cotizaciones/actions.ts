"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolverContextoPortal } from "@/lib/portal/b2bPortalServidor";
import { mensajeErrorSolicitud, type RespuestaSolicitud } from "@/lib/portal/solicitudContrato";

export type ResultadoSolicitudContrato = ({ ok: true } & RespuestaSolicitud) | { ok: false; error: string };

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

/**
 * #78 — «Solicitar contrato». El aliado se deduce de la SESIÓN (nunca de un argumento) y la función de base de datos re-verifica rol, propiedad de la
 * cotización, vigencia y duplicado bajo bloqueo; aquí solo se valida la forma del id. NO envía nada fuera de la plataforma: el aviso es interno (campana).
 * Llamadas esperadas por acción: 1 lectura de sesión/perfil + 1 RPC. Sin sondeos ni reintentos.
 */
export async function solicitarContratoCotizacion(cotizacionId: number): Promise<ResultadoSolicitudContrato> {
  if (!Number.isInteger(cotizacionId) || cotizacionId <= 0) return { ok: false, error: mensajeErrorSolicitud("F4602") };
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return { ok: false, error: "Inicia sesión con tu cuenta de aliado para solicitar un contrato." };

  // La función es nueva (323) y aún no está en types/database.ts: se llama sin tipo.
  const admin = createAdminClient();
  const rpc = (admin as unknown as { rpc: Rpc }).rpc.bind(admin);
  const { data, error } = await rpc("solicitar_contrato_cotizacion", { p_cotizacion_id: cotizacionId, p_actor: ctx.userId });
  if (error) return { ok: false, error: mensajeErrorSolicitud(error.code) };
  const r = data as { estado?: string; notificados?: number } | null;
  if (!r || (r.estado !== "solicitada" && r.estado !== "reemplazada" && r.estado !== "ya_solicitada")) return { ok: false, error: mensajeErrorSolicitud(null) };
  revalidatePath("/portal/b2b/cotizaciones");
  return { ok: true, estado: r.estado, notificados: typeof r.notificados === "number" ? r.notificados : 0 };
}
