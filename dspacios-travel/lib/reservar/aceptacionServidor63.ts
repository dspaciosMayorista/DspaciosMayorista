// ─────────────────────────────────────────────────────────────────────────
// #63 (E/F/G) — llamadas del SERVIDOR a las RPC de la aceptación (migración 227). Adaptadores finos sobre un cliente de
// servicio INYECTADO (sin `server-only` ni Supabase global), para poder ejecutar de verdad su manejo de errores en las pruebas.
//
// IMPORTANTE: estas RPC son SOLO service_role y NO autorizan por sí mismas la sesión/rol/tenant del navegador: el llamador
// (`crearCotizacion` / `convertirCotizacion`) ya comprobó sesión activa, rol y acceso a la cotización ANTES de llamar. Aquí
// nunca viaja un neto, un proveedor ni un costo desde el navegador: el snapshot lo arma el servidor.
// ─────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  leerAceptacion63,
  mapearErrorRpc63,
  MENSAJE_TECNICO_63,
  type ResultadoAceptacion63,
  type Revisiones63,
  type Snapshot63,
} from "./aceptacion63.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any, any, any>;

const MENSAJE_LECTURA_REVISIONES = "No se pudo leer la configuración del paquete. Intenta nuevamente.";

/**
 * Revisiones de T0 del paquete: se leen ANTES de calcular nada. La base las compara de nuevo al guardar la cotización y al
 * aceptarla; cualquier cambio entre medias (tarifa, fuente, TRM, proveedor, retención…) sube el contador y rechaza.
 */
export async function leerRevisiones63(admin: Cliente, paqueteId: number): Promise<{ ok: true; revisiones: Revisiones63 } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("armado_paquetes")
    .select("tarifario_revision_fuente, tarifario_revision_publicada, tarifario_generacion_publicada, p63_rev_costos")
    .eq("id", paqueteId)
    .maybeSingle();
  if (error || !data) return { ok: false, error: MENSAJE_LECTURA_REVISIONES };
  const d = data as Record<string, unknown>;
  const num = (v: unknown) => (v == null ? null : Number(v));
  const revFuente = num(d.tarifario_revision_fuente);
  const revCostos = num(d.p63_rev_costos);
  if (revFuente == null || revCostos == null || !Number.isFinite(revFuente) || !Number.isFinite(revCostos)) return { ok: false, error: MENSAJE_LECTURA_REVISIONES };
  return {
    ok: true,
    revisiones: { rev_fuente: revFuente, rev_publicada: num(d.tarifario_revision_publicada), gen_publicada: num(d.tarifario_generacion_publicada), rev_costos: revCostos },
  };
}

/** Cotización + oferta + snapshot privado en UNA transacción (RPC `crear_cotizacion_oferta_63`). */
export async function crearCotizacionOferta63(
  admin: Cliente,
  a: {
    usuarioId: string;
    tenant: string;
    cotizacion: Record<string, unknown>;
    snapshot: Snapshot63;
    huella: string;
    huellaFinanciera: string;
    revisiones: Revisiones63;
  }
): Promise<{ ok: true; id: number } | { ok: false; error: string; cambio: boolean }> {
  try {
    const { data, error } = await admin.rpc("crear_cotizacion_oferta_63", {
      p_usuario: a.usuarioId,
      p_tenant: a.tenant,
      p_cotizacion: a.cotizacion,
      p_snapshot: a.snapshot,
      p_huella: a.huella,
      p_huella_financiera: a.huellaFinanciera,
      p_t0: a.revisiones,
    });
    if (error) {
      const m = mapearErrorRpc63(error.message);
      return { ok: false, error: m.cambio ? "La configuración del paquete cambió mientras se cotizaba. Intenta de nuevo." : "No fue posible guardar la cotización. Intenta nuevamente o contacta a soporte.", cambio: m.cambio };
    }
    const id = Number(data);
    if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "No fue posible guardar la cotización. Intenta nuevamente o contacta a soporte.", cambio: false };
    return { ok: true, id };
  } catch {
    return { ok: false, error: "No fue posible guardar la cotización. Intenta nuevamente o contacta a soporte.", cambio: false };
  }
}

/** Aceptación atómica (RPC `aceptar_oferta_63`): revalida AHORA bajo candado, reserva el número y congela el snapshot. */
export async function aceptarOferta63(
  admin: Cliente,
  a: {
    cotizacionId: number; tenant: string; usuarioId: string; huella: string; huellaFinanciera: string; trmProvisional?: number | null;
    /** 235: moneda de COBRO elegida (null = la de la oferta) y su TRM (solo si difiere de la oferta). */
    monedaCobro?: "COP" | "USD" | null; trmCobro?: number | null;
  }
): Promise<ResultadoAceptacion63> {
  try {
    const { data, error } = await admin.rpc("aceptar_oferta_63", {
      p_cotizacion: a.cotizacionId,
      p_tenant: a.tenant,
      p_usuario: a.usuarioId,
      p_huella: a.huella,
      p_huella_financiera: a.huellaFinanciera,
      // 234: tasa INGRESADA al convertir a contrato; OBLIGATORIA en una oferta USD sin TRM (null → la base la rechaza antes de numerar).
      p_trm_provisional: a.trmProvisional ?? null,
      // 235: la base convierte el total UNA vez con esta tasa y congela la elección; un reintento con otra elección se rechaza.
      p_moneda_cobro: a.monedaCobro ?? null,
      p_trm_cobro: a.trmCobro ?? null,
    });
    if (error) {
      const m = mapearErrorRpc63(error.message);
      return { ok: false, error: m.error, cambio: m.cambio };
    }
    return leerAceptacion63(data);
  } catch {
    return { ok: false, error: MENSAJE_TECNICO_63, cambio: false };
  }
}

/**
 * ¿Existe la venta de un intento ya 'completa'? Una conversión que respondió `completa` se reconoce como ÉXITO solo si el
 * contrato sigue existiendo (si se eliminó, la oferta convertida es terminal y se pide una cotización nueva).
 */
export async function ventaExiste63(admin: Cliente, numero: string): Promise<{ ok: true; existe: boolean } | { ok: false }> {
  const { data, error } = await admin.from("ventas").select("numero_contrato").eq("numero_contrato", numero).maybeSingle();
  if (error) return { ok: false };
  return { ok: true, existe: data != null };
}
