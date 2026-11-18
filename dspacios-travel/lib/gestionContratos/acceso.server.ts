// #106 · Autorización de la pantalla y de sus acciones: superadmin ACTIVO. `miRol()` no mira `usuarios.activo` (lo cubren el proxy y mi_rol() en la base), pero aquí se
// comprueba también en la aplicación para no pedir nada con una cuenta desactivada. Una sola consulta de perfil; la base vuelve a exigirlo (42501) en cada RPC.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function esSuperadminActivo(sb: SupabaseClient): Promise<boolean> {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return false;
  const { data } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  return data?.rol === "superadmin" && data.activo !== false;
}
