import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Cliente con la llave pública pero SIN sesión ni cookies: sirve para comprobar una credencial (p. ej. la contraseña actual antes de cambiarla)
 * sin rotar ni reemplazar la sesión de la persona. No guarda nada (persistSession/autoRefresh apagados).
 */
export function createClienteSinSesion() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
