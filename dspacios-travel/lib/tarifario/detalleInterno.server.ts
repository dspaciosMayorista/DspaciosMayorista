import "server-only";
import { createClient } from "@/lib/supabase/server";
import { tieneDetalleInterno } from "@/lib/tarifario/detalleInterno";

/**
 * O-1: ¿quien hace esta petición es personal interno activo? Una lectura de Auth y una de su propia fila de `usuarios` POR BÚSQUEDA (nunca por hotel);
 * un visitante anónimo no cuesta ninguna consulta (no hay sesión). Cualquier fallo se resuelve como externo (falla cerrado).
 */
export async function peticionConDetalleInterno(): Promise<boolean> {
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return false;
    const { data } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
    return tieneDetalleInterno(data?.rol, data?.activo);
  } catch {
    return false;
  }
}
