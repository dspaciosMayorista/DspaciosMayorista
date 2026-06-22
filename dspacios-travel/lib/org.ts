import { createClient } from "@/lib/supabase/server";

// ─────────────────────────────────────────────────────────────────────────
// SaaS multi-tenant — resolución de la ORGANIZACIÓN (tenant) en el servidor.
//
// Los inserts CON SESIÓN (anon key + JWT) ya reciben el `org_id` automáticamente
// por el DEFAULT de la columna = `coalesce(mi_org(), org#1)` (migración 102). Este
// helper es para los inserts con **service-role** (sillas/costos al reservar, CxP,
// crons), donde `auth.uid()` no existe y por tanto `mi_org()` es null: ahí HAY que
// pasar el `org_id` explícito, y se obtiene con `orgActual()`.
// ─────────────────────────────────────────────────────────────────────────

/** org_id de la organización del usuario autenticado (o null si no hay sesión). */
export async function orgActual(): Promise<string | null> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb
    .from("usuarios")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();
  return (data?.org_id as string | null) ?? null;
}
