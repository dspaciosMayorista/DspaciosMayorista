import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aliadoIdValido, esPersonalLogo } from "@/lib/aliados/logoAcceso";
import { respuestaLogoDeAliado, type AdminLogo } from "@/lib/aliados/logoServidor";

export const dynamic = "force-dynamic";

// #32 — Vista previa del logo de un aliado en Aliados (interno): superadmin/gerencia activos. Cualquier otro caso responde 404 igual (no revela si el aliado existe).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const aliadoId = aliadoIdValido((await params).id);
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle() : { data: null };
  return respuestaLogoDeAliado(createAdminClient() as unknown as AdminLogo, esPersonalLogo(perfil) ? aliadoId : null);
}
