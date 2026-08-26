import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tenant } from "@/lib/tenant";
import { interpretarRespuestaNumeroContrato, type SiguienteNumeroResult } from "./numeracionPuro";

export type { SiguienteNumeroResult };

/**
 * ÚNICO punto de generación de numero_contrato — migración 159. Devuelve el
 * número YA COMPLETO (con su prefijo de tenant aplicado: DTM-0001 para
 * mayorista, MIN-00-#### para minorista). El caller NUNCA debe volver a
 * anteponerle un prefijo (nada de numeroConTenant() en los caminos que usan
 * este helper — eso quedó solo para el importador histórico de minorista).
 *
 * SIEMPRE con el cliente service_role: el RPC
 * `siguiente_numero_contrato_para_tenant` revoca EXECUTE de `authenticated`
 * (revisión posterior al PR #274 — con el cliente de sesión, cualquier
 * usuario autenticado, de cualquier tenant o rol, podía invocarlo directo y
 * gastar consecutivos DTM/MIN sin pasar por ninguna validación de la
 * aplicación). Por eso ya NO recibe `sb`: el único cliente válido para esta
 * llamada es el admin, nunca el de sesión del navegador.
 *
 * `tenant` debe llegar YA resuelto por el caller desde una fuente de
 * confianza del servidor (contexto fail-closed: sesión + activo=true + rol/
 * propiedad autorizados — ver `lib/contrato/contexto.ts` y
 * `lib/cotizacion/acceso.ts`) — nunca desde un campo que el navegador mande
 * directo en el body de la Server Action. Como el RPC ahora corre con
 * privilegios de service_role (bypassa RLS), ESTE es el único punto de
 * autorización real antes de gastar un consecutivo — de ahí que cada
 * llamador deba validar todo lo anterior ANTES de invocar esta función, no
 * solo por prolijidad sino porque aquí ya no hay ninguna otra barrera.
 */
export async function siguienteNumeroContrato(tenant: Tenant): Promise<SiguienteNumeroResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[siguienteNumeroContrato] SUPABASE_SERVICE_ROLE_KEY no configurada — no se puede generar el número de contrato.");
    return { ok: false, error: "No se pudo generar el número de contrato. Intenta de nuevo o contacta a soporte." };
  }
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("siguiente_numero_contrato_para_tenant", { p_tenant: tenant });
  // El detalle técnico (nombre de función/secuencia, SQLSTATE, motivo exacto
  // del rechazo) solo se registra server-side — nunca se propaga a la Server
  // Action ni, por lo tanto, al navegador (ver numeracionPuro.ts).
  if (error) {
    console.error(`[siguienteNumeroContrato] RPC siguiente_numero_contrato_para_tenant(${tenant}) falló:`, error.message, error);
  }
  return interpretarRespuestaNumeroContrato(data, error);
}
