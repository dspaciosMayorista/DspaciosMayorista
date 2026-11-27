"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseIdentidad, type IdentidadContrato } from "@/lib/contrato/identidad";
import { autorizarCuentasPorPagarContrato, mensajeCxpDenegado } from "@/lib/contrato/accesoCuentasPorPagar";
import { rpcFinanciero } from "@/lib/contabilidad/asientos";
import { validarTrmCosto } from "@/lib/finanzas/costoTrmCarrito";

export type ResultadoTrmCosto = { ok: true; cambiadas: number; trmNueva: number } | { ok: false; error: string };

/**
 * NETA-05/06: corrige la TRM de costos PROVISIONAL de las obligaciones PREVISTAS en USD de un contrato PENDIENTE (migración 348).
 * `trmEsperada` NULL = fijar la TRM INICIAL de un servicio en USD agregado desde la edición de servicios que nació sin ella (migración 349). `clave` = una obligación; sin clave, todas las previstas en USD con TRM del contrato. `trmEsperada` = la TRM que la persona veía (compara-y-cambia: si otra
 * edición se adelantó, se rechaza). La autorización se decide AQUÍ con la sesión (mismo criterio que la RLS «cpp: acceso contable») y la base la repite con el actor.
 * Una obligación ya confirmada (cuenta por pagar) NO se edita: su equivalente ya devengó asiento y se corrige con un proceso contable aparte.
 */
export async function corregirTrmCostoPrevista(
  numero: string, identidad: IdentidadContrato, clave: string | null, trmNueva: unknown, trmEsperada: number | null, nota?: string,
): Promise<ResultadoTrmCosto> {
  const v = validarTrmCosto(trmNueva);
  if (!v.ok) return { ok: false, error: v.error };
  const sb = await createClient(parseIdentidad(identidad));
  const { data: auth } = await sb.auth.getUser();
  const userId = auth?.user?.id ?? null;
  const { data: perfil } = userId ? await sb.from("usuarios").select("rol, activo, tenant").eq("id", userId).maybeSingle() : { data: null };
  const { data: contrato } = perfil ? await sb.from("ventas").select("tenant").eq("numero_contrato", numero).maybeSingle() : { data: null };
  const decision = autorizarCuentasPorPagarContrato(perfil ?? null, contrato ?? null);
  if (!decision.permitido) return { ok: false, error: mensajeCxpDenegado(decision.motivo) };
  const r = await rpcFinanciero<{ cambiadas: number; trm_nueva: number }>("prevista_trm_costo_actualizar", {
    p_numero: numero, p_tenant: contrato!.tenant, p_actor: userId, p_clave: clave, p_trm_nueva: v.trm, p_trm_esperada: trmEsperada == null ? null : Number(trmEsperada), p_nota: nota ?? null,
  }, identidad);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true, cambiadas: r.data.cambiadas, trmNueva: Number(r.data.trm_nueva) };
}
