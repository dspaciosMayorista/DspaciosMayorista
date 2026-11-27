import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

// #40 / Codex F1 — una conversión corriente (sin oferta #63) de una cotización: reclamo previo a numerar (migración 336) y lectura del
// estado de la conversión que ya existe. «Completa» = el contrato lleva `financiero_estado = 'completo'`, que SOLO la transacción
// `registrar_financiero_contrato` escribe, y lo hace como último paso (después de pasajeros, sillas, hoteles, vuelos e ítems).
// Una cabecera `pendiente` es una conversión en curso (o caída y pendiente de la reconciliación): NUNCA se acepta como terminada.

type Admin = ReturnType<typeof createAdminClient>;

export const MENSAJE_CONVERSION_EN_CURSO =
  "Esta cotización ya se está convirtiendo en contrato (otra solicitud la tiene en curso). No se creó nada nuevo ni se gastó otro número; espera unos segundos y vuelve a intentarlo.";

export type EstadoConversion =
  | { ok: true; estado: "ninguna" }
  | { ok: true; estado: "en_curso"; numero: string }
  | { ok: true; estado: "completa"; numero: string; contratoUid: string | null }
  | { ok: false; error: string };

/** Lectura con service-role: la autorización ya la hizo quien llama (tenant de la cotización). Falla cerrada. */
export async function estadoConversionCotizacion(admin: Admin, cotizacionId: number, tenant: string): Promise<EstadoConversion> {
  const { data, error } = await admin.from("ventas").select("numero_contrato, contrato_uid, tenant, financiero_estado").eq("cotizacion_id", cotizacionId).maybeSingle(); // identidad:n/a — lectura del contrato ya existente de esta cotización
  if (error) return { ok: false, error: "No se pudo verificar si la cotización ya se convirtió. Intenta de nuevo." };
  if (!data) return { ok: true, estado: "ninguna" };
  if (data.tenant !== tenant) return { ok: false, error: "La cotización está ligada a un contrato de otra agencia." };
  if (data.financiero_estado === "completo") return { ok: true, estado: "completa", numero: data.numero_contrato, contratoUid: data.contrato_uid ?? null };
  return { ok: true, estado: "en_curso", numero: data.numero_contrato };
}

export type Reclamo = { ok: true; token: string | null } | { ok: false; error: string };

/** `token: null` = otra conversión de esta cotización tiene un reclamo vigente. */
export async function reclamarConversion(admin: Admin, cotizacionId: number): Promise<Reclamo> {
  const { data, error } = await admin.rpc("reclamar_conversion_cotizacion", { p_cotizacion: cotizacionId, p_ttl_segundos: 300 });
  if (error) return { ok: false, error: "No se pudo reservar la conversión de la cotización. Intenta de nuevo." };
  return { ok: true, token: (data as string | null) ?? null };
}

/** Best-effort: si falla, el reclamo vence solo a los 300 s y la llave única de ventas.cotizacion_id sigue protegiendo. */
export async function liberarConversion(admin: Admin, cotizacionId: number, token: string): Promise<void> {
  const { error } = await admin.rpc("liberar_conversion_cotizacion", { p_cotizacion: cotizacionId, p_token: token });
  if (error) console.error(`[liberarConversion] cotización ${cotizacionId}: ${error.message}`);
}

/**
 * Tras un conflicto de `ventas_cotizacion_id_key` (otra conversión de la MISMA cotización ya tiene su cabecera): el resultado que debe devolver esta solicitud, o `null` si en realidad no hay contrato
 * (el conflicto vino de otra causa y el llamador sigue con su error). Solo un contrato COMPLETO es éxito; una cabecera pendiente es «en curso».
 */
export async function resultadoDeConversionExistente(admin: Admin, cotizacionId: number, tenant: string):
  Promise<{ ok: true; numero: string; contratoUid?: string } | { ok: false; error: string } | null> {
  const e = await estadoConversionCotizacion(admin, cotizacionId, tenant);
  if (!e.ok) return { ok: false, error: e.error };
  if (e.estado === "completa") return { ok: true, numero: e.numero, ...(e.contratoUid ? { contratoUid: e.contratoUid } : {}) };
  if (e.estado === "en_curso") return { ok: false, error: MENSAJE_CONVERSION_EN_CURSO };
  return null;
}
