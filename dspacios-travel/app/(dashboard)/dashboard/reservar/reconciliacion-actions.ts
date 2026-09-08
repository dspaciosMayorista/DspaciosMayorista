"use server";

// ─────────────────────────────────────────────────────────────────────────
// Reconciliación de la garantía financiera durable (migración 172, revisión
// B7 del PR #294) — corre en un proceso/momento DISTINTO al de la creación
// del contrato, así que resuelve los `financiero_estado='pendiente'` que
// quedaron así porque el proceso original murió (crash, timeout, pérdida de
// conexión) antes de poder terminar o siquiera intentar la reversión. Ver
// lib/reservar/reconciliacionFinanciera.ts para la lógica pura (reintento
// exacto si hay payload persistido, reversión si no lo hay, nunca una
// tercera opción).
//
// Solo `service_role` — invocada por `/api/cron/reconciliar-financiero`
// (CRON_SECRET) y disponible como acción manual para un superadmin.
// ─────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { postearAsientoCxP, eliminarAsientoCxP } from "@/lib/contabilidad/asientos";
import { reconciliarFinancieroPendiente, type DepsReconciliacion, type ResultadoReconciliacion } from "@/lib/reservar/reconciliacionFinanciera";
import type { CostosContrato, CxPFinanciera, CxPCreada } from "@/lib/reservar/financieroContrato";
import type { Json } from "@/types/database";

async function rpcFinanciero(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
  const admin = createAdminClient();
  if (fn === "registrar_financiero_contrato") {
    const { data, error } = await admin.rpc("registrar_financiero_contrato", {
      p_numero_contrato: String(args.p_numero_contrato ?? ""),
      p_tenant: String(args.p_tenant ?? ""),
      p_costos: (args.p_costos ?? {}) as Json,
      p_cxp: (args.p_cxp ?? []) as Json,
    });
    return { data: data as unknown, error: error ? { message: error.message } : null };
  }
  if (fn === "revertir_contrato_incompleto") {
    const { data, error } = await admin.rpc("revertir_contrato_incompleto", {
      p_numero_contrato: String(args.p_numero_contrato ?? ""),
      p_tenant: String(args.p_tenant ?? ""),
    });
    return { data: data as unknown, error: error ? { message: error.message } : null };
  }
  return { data: null, error: { message: `RPC no soportado: ${fn}` } };
}

function depsReconciliacion(): DepsReconciliacion {
  const admin = createAdminClient();
  // `postearAsientoCxP` necesita numeroContrato/tenant para la descripción y
  // el tercero del asiento — `CxPCreada` (contrato compartido con
  // financieroContrato.ts) no los lleva. `listarCxpSinAsiento` los guarda
  // aquí al vuelo para que `postearAsiento` los recupere por id de CxP.
  const contextoPorCxp = new Map<number, { numeroContrato: string; tenant: string }>();
  return {
    rpc: rpcFinanciero,
    postearAsiento: (c: CxPCreada) => {
      const ctx = contextoPorCxp.get(c.id);
      return postearAsientoCxP({
        cuentaId: c.id, numeroContrato: ctx?.numeroContrato ?? "", tipoProveedor: c.tipo_proveedor, proveedor: c.proveedor,
        servicio: c.servicio, valorTotal: c.valor_total, fecha: new Date().toISOString().slice(0, 10), tenant: ctx?.tenant,
      });
    },
    eliminarAsiento: (cuentaId: number) => eliminarAsientoCxP(cuentaId),
    guardarPendiente: async (p: { numeroContrato: string; tenant: string; costos: CostosContrato; cxp: CxPFinanciera[] }) => {
      const { error } = await admin.from("contrato_financiero_pendiente").upsert({
        numero_contrato: p.numeroContrato, tenant: p.tenant, costos: p.costos as Json, cxp: p.cxp as unknown as Json,
      }, { onConflict: "numero_contrato" });
      return error ? { ok: false, error: error.message } : { ok: true };
    },
    listarPendientesAntiguos: async (umbralMinutos: number) => {
      const corte = new Date(Date.now() - umbralMinutos * 60_000).toISOString();
      const { data } = await admin
        .from("ventas")
        .select("numero_contrato, tenant")
        .eq("financiero_estado", "pendiente")
        .lt("financiero_actualizado_en", corte);
      return (data ?? []).map((v) => ({ numeroContrato: v.numero_contrato, tenant: v.tenant ?? "mayorista" }));
    },
    leerPendiente: async (numeroContrato: string) => {
      const { data } = await admin
        .from("contrato_financiero_pendiente")
        .select("costos, cxp")
        .eq("numero_contrato", numeroContrato)
        .maybeSingle();
      if (!data) return null;
      return { costos: (data.costos ?? {}) as Record<string, number>, cxp: (data.cxp ?? []) as unknown[] };
    },
    marcarIntentoFallido: async (numeroContrato: string, error: string) => {
      // `intentos` es un contador DIAGNÓSTICO, no la garantía en sí (esa es
      // `ultimo_error`/`ultimo_intento_en`, que sí quedan escritos aunque
      // esta lectura previa corra en paralelo con otra pasada de
      // reconciliación — el peor caso es subcontar intentos, nunca perder el
      // rastro del último error real).
      const { data } = await admin
        .from("contrato_financiero_pendiente")
        .select("intentos")
        .eq("numero_contrato", numeroContrato)
        .maybeSingle();
      await admin.from("contrato_financiero_pendiente").update({
        intentos: (data?.intentos ?? 0) + 1,
        ultimo_error: error.slice(0, 2000),
        ultimo_intento_en: new Date().toISOString(),
      }).eq("numero_contrato", numeroContrato);
    },
    listarCxpSinAsiento: async () => {
      const [{ data: cxp }, { data: asientos }] = await Promise.all([
        admin.from("cuentas_por_pagar").select("id, numero_contrato, tenant, tipo_proveedor, proveedor, servicio, valor_total"),
        admin.from("asientos_contables").select("referencia").eq("origen", "cxp"),
      ]);
      const conAsiento = new Set((asientos ?? []).map((a) => a.referencia));
      const faltantes = (cxp ?? []).filter((c) => !conAsiento.has(`cxp:${c.id}`) && (Number(c.valor_total) || 0) > 0);
      for (const c of faltantes) contextoPorCxp.set(c.id, { numeroContrato: c.numero_contrato, tenant: c.tenant ?? "mayorista" });
      return faltantes.map((c) => ({ id: c.id, tipo_proveedor: c.tipo_proveedor, proveedor: c.proveedor, servicio: c.servicio, valor_total: Number(c.valor_total) || 0 }));
    },
  };
}

/**
 * Ejecuta una pasada de reconciliación: contratos financieramente pendientes
 * más antiguos que `umbralMinutos` (default 5 — evita tocar una reserva cuya
 * request original puede seguir en curso) y CxP sin asiento contable.
 * Solo `service_role`.
 */
export async function reconciliarFinancieroPendienteAction(umbralMinutos?: number): Promise<{ ok: true; resultado: ResultadoReconciliacion } | { ok: false; error: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "Configuración del servidor incompleta." };
  try {
    const resultado = await reconciliarFinancieroPendiente(depsReconciliacion(), { umbralMinutos });
    return { ok: true, resultado };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error desconocido" };
  }
}
