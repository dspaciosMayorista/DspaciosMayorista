import { createAdminClient } from "@/lib/supabase/admin";
import { COLUMNAS_ALIADO_COTIZACION, respuestaLogoDeCotizacion, type AdminLogo } from "@/lib/aliados/logoServidor";

export const dynamic = "force-dynamic";

// #32 — Logo del aliado de una cotización PÚBLICA. La autorización es el propio `share_token` (impredecible): resuelve UNA cotización y de ELLA sale el
// aliado; ningún id de aliado viaja en la URL. Token desconocido o cotización sin logo ⇒ 404. Respuesta `private, no-store` (nunca caché compartida).
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient() as unknown as AdminLogo;
  const { data } = await admin.from("cotizaciones").select(COLUMNAS_ALIADO_COTIZACION).eq("share_token", token).maybeSingle();
  return respuestaLogoDeCotizacion(admin, data as { id: number; aliado_id?: unknown; b2b_aliado?: unknown } | null);
}
