// Utilidades de SERVIDOR de las comparativas (#35): usan node:crypto y no deben
// importarse desde componentes de cliente.
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { madreElegiblePorVisitante } from "@/lib/cotizacion/comparativa";

/**
 * Huella de una IP para limitar la tasa de solicitudes públicas. HMAC-SHA256 con
 * una llave derivada del secreto de servicio: la base nunca guarda la IP, solo
 * este valor, que no se puede invertir ni recalcular sin el secreto. Se anula a
 * las 24 h (ver `f211_priv.purgar_ip_huella`). Sin llave o sin IP confiable
 * devuelve null (la base usa entonces el cupo estricto «sin-ip»).
 */
export function huellaIp(ip: string | null, llaveServicio: string | undefined): string | null {
  if (!ip || !llaveServicio) return null;
  return createHmac("sha256", llaveServicio).update(`comparativa-ip:v1:${ip}`).digest("base64url");
}

/**
 * ¿Puede un VISITANTE continuar esta comparativa? Misma regla que la base (`f211_priv.madre_anonima`): para una comparativa marcada para compartir se relee al creador
 * (activo y con rol interno permitido); una anónima no consulta nada. Lo usan el enlace público (camino «Continuar» o «solicitud») y la acción de elegir.
 */
export async function visitantePuedeContinuar(
  sb: SupabaseClient<any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  m: Parameters<typeof madreElegiblePorVisitante>[0],
): Promise<boolean> {
  if (m.creado_por_id == null) return madreElegiblePorVisitante(m, null);
  const { data } = await sb.from("usuarios").select("rol, activo").eq("id", m.creado_por_id).maybeSingle();
  return madreElegiblePorVisitante(m, data as { rol: string | null; activo: boolean | null } | null);
}
