import type { createClient } from "@/lib/supabase/server";
import type { Tenant } from "@/lib/tenant";

export type SiguienteNumeroResult =
  | { ok: true; numero: string }
  | { ok: false; error: string };

/**
 * ÚNICO punto de generación de numero_contrato — migración 159. Devuelve el
 * número YA COMPLETO (con su prefijo de tenant aplicado: DTM-0001 para
 * mayorista, MIN-00-#### para minorista). El caller NUNCA debe volver a
 * anteponerle un prefijo (nada de numeroConTenant() en los caminos que usan
 * este helper — eso quedó solo para el importador histórico de minorista).
 *
 * `tenant` debe llegar YA resuelto por el caller desde una fuente de
 * confianza del servidor (getTenant(), o el tenant ya validado de una
 * cotización/venta existente) — nunca desde un campo que el navegador
 * mande directo en el body de la Server Action.
 */
export async function siguienteNumeroContrato(
  sb: Awaited<ReturnType<typeof createClient>>,
  tenant: Tenant
): Promise<SiguienteNumeroResult> {
  const { data, error } = await sb.rpc("siguiente_numero_contrato_para_tenant", { p_tenant: tenant });
  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? "No se pudo generar el número de contrato.",
    };
  }
  return { ok: true, numero: data };
}
