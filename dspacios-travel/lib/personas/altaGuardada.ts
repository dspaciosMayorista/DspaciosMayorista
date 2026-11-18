// Alta o reparación de las personas de una cotización YA guardada (#1). Vive aparte de consulta.ts porque lee la fila de la cotización: `consulta.ts` solo envuelve RPC.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { COLUMNAS_COTIZACION_PERSONAS, type FilaCotizacionPersonas } from "@/lib/personas/cotizacion";
import { altaPersonasCotizacion } from "@/lib/personas/consulta";

type ClienteServicio = SupabaseClient<Database>;

/** Fila real de la cotización con las columnas que decide el alta. `paquete_din_id` (migración 275) aún no está en types/database.ts: se tipa aquí, una sola vez. */
export async function leerFilaCotizacionPersonas(admin: ClienteServicio, cotizacionId: number): Promise<FilaCotizacionPersonas | null> {
  const { data } = await admin.from("cotizaciones").select(COLUMNAS_COTIZACION_PERSONAS as string).eq("id", cotizacionId).maybeSingle();
  return (data as unknown as FilaCotizacionPersonas | null) ?? null;
}

/**
 * Alta (o reparación) de las personas de una cotización YA guardada: lee la fila real y reutiliza el mismo camino de alta. Se usa cuando se repite una
 * solicitud ya atendida (reintento, doble clic, pestaña repetida): si la primera vez el registro falló, el reintento lo completa en vez de devolver
 * éxito sin haberlo hecho. Es idempotente: un puesto ya registrado no se duplica.
 */
export async function altaPersonasDeCotizacionGuardada(
  admin: ClienteServicio,
  cotizacionId: number,
  usuarioId: string | null,
  sellar = false
): Promise<{ ok: true } | { ok: false; etapa: "sello" | "registro"; codigo: string | null }> {
  try {
    const fila = await leerFilaCotizacionPersonas(admin, cotizacionId);
    if (!fila) return { ok: false, etapa: "registro", codigo: "cotizacion_inexistente" };
    // El sello solo se recupera si falta: la base lo concede únicamente al mismo autor (su correo = creado_por), dentro de 15 minutos y sin sello previo.
    // Un tercero que repite la solicitud no lo obtiene (sello_no_admitido / sello_ajeno), y una cotización ya sellada no gasta la llamada.
    return await altaPersonasCotizacion(admin, { fila, usuarioId, sellar: sellar && fila.creado_por_id == null });
  } catch {
    return { ok: false, etapa: "registro", codigo: null };
  }
}
