import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Cliente con la llave `service_role` — SOLO para uso en servidor.
 * Salta RLS, así que jamás debe importarse en componentes de cliente.
 * Se usa para servir el contrato público por token (link compartible),
 * donde el visitante no tiene sesión.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
