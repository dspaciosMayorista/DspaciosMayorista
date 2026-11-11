import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cabecerasIdentidad, type IdentidadContrato } from "@/lib/contrato/identidad";
import { fetchMantenimiento, usuarioDeSesion } from "@/lib/supabase/mantenimiento";

/**
 * Cliente con la llave `service_role` — SOLO para uso en servidor.
 * Salta RLS, así que jamás debe importarse en componentes de cliente.
 * Se usa para servir el contrato público por token (link compartible),
 * donde el visitante no tiene sesión.
 *
 * `identidad` (#75): contratos que la pantalla (o el flujo de creación) abrió ({numero: uid}). La llave de servicio NO exime de la guarda de identidad
 * de la base: una escritura sobre un contrato nacido de un número reutilizado sin identidad correcta se rechaza igual. Fábrica por llamada.
 */
export function createAdminClient(identidad?: IdentidadContrato) {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    // 294: con service_role la excepción de mantenimiento exige además el usuario VERIFICADO de la sesión (operador autorizado); sin ventana, fetch de siempre
    { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: cabecerasIdentidad(identidad), fetch: fetchMantenimiento(usuarioDeSesion) } }
  );
}
