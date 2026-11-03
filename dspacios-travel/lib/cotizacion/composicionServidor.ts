import type { SupabaseClient } from "@supabase/supabase-js";
import type { Composicion, ComposicionCotizacion } from "./composicionPrecio.ts";
import { leerComposicionCotizacion } from "./composicionPrecio.ts";

type Hotel = { ref: string | null; nombre: string | null; composicion: Composicion | null };

/**
 * Guarda la composición PRIVADA de una cotización recién creada (tabla de la migración 272, solo service-role).
 * Mejor esfuerzo: la cotización ya existe y su precio no depende de esto; si la tabla aún no existe o falla, se registra el fallo (sin datos) y la ficha dirá que no se conservó.
 */
export async function guardarComposicion(admin: SupabaseClient, a: { cotizacionId: number; tenant: string; hoteles: Hotel[] }): Promise<void> {
  const hoteles = a.hoteles.filter((h): h is Hotel & { composicion: Composicion } => h.composicion !== null);
  if (!hoteles.length) return;
  const composicion: ComposicionCotizacion = { version: 1, hoteles };
  try {
    // El tenant es el de la cotización PERSISTIDA, nunca el de la agencia activa de quien valora (un superadmin puede estar en la otra). Si no coincide, no se guarda.
    const { data: cot, error: eCot } = await admin.from("cotizaciones").select("tenant").eq("id", a.cotizacionId).maybeSingle();
    const tenant = (cot as { tenant?: string | null } | null)?.tenant;
    if (eCot || !tenant || tenant !== a.tenant) { console.error(`composicion_cotizacion: no se guardó (cotización ${a.cotizacionId}): tenant no corresponde`); return; }
    const { error } = await admin.from("cotizacion_composicion").insert({ cotizacion_id: a.cotizacionId, tenant, composicion: composicion as never });
    // Duplicado solo si es la PK de cotizacion_id (un reintento ni duplica ni reemplaza); cualquier otro 23505 es un fallo real.
    if (error?.code === "23505" && /cotizacion_composicion_pkey|\(cotizacion_id\)/.test(`${error.message ?? ""} ${(error as { details?: string }).details ?? ""}`)) return;
    if (error) console.error(`composicion_cotizacion: no se guardó (cotización ${a.cotizacionId}): ${error.code ?? ""}`);
  } catch {
    console.error(`composicion_cotizacion: no se guardó (cotización ${a.cotizacionId})`); // dato interno: nunca bloquea la cotización
  }
}

/** Mejor esfuerzo total: sin service role, o si crear el cliente falla, no guarda y la cotización sigue (la ficha dirá que no se conservó). */
export async function guardarComposicionMejorEsfuerzo(crearAdmin: () => SupabaseClient, a: { cotizacionId: number; tenant: string; hoteles: Hotel[] }): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  let admin: SupabaseClient;
  try { admin = crearAdmin(); } catch { return; }
  await guardarComposicion(admin, a);
}

/** Lee la composición guardada con service-role. El llamador debe haber comprobado ya tenant y rol. null = no se conservó (o ilegible). */
export async function leerComposicionGuardada(admin: SupabaseClient, cotizacionId: number): Promise<ComposicionCotizacion | null> {
  const { data, error } = await admin.from("cotizacion_composicion").select("composicion").eq("cotizacion_id", cotizacionId).maybeSingle();
  if (error || !data) return null;
  return leerComposicionCotizacion((data as { composicion: unknown }).composicion);
}
