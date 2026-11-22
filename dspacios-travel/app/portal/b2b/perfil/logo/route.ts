import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aliadoQueVeLogo } from "@/lib/aliados/logoAcceso";
import { respuestaLogoDeAliado, type AdminLogo } from "@/lib/aliados/logoServidor";

export const dynamic = "force-dynamic";

// #32 — Vista previa del logo PROPIO en «Mi perfil». La ficha sale de la sesión; `/portal` no pasa por el filtro del proxy, así que la sesión se exige aquí.
export async function GET() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  const admin = createAdminClient();
  const a = await aliadoQueVeLogo(admin as never, user?.id);
  return respuestaLogoDeAliado(admin as unknown as AdminLogo, a.ok ? a.aliadoId : null);
}
