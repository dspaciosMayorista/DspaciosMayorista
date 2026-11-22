import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { contextoCotizacion, autorizaTenant } from "@/lib/cotizacion/acceso";
import { respuestaLogoDeCotizacion, type AdminLogo } from "@/lib/aliados/logoServidor";

export const dynamic = "force-dynamic";

// #32 — Logo del aliado de una cotización INTERNA: misma regla de acceso que la página `/cotizacion/[id]` (sesión + tenant de la cotización).
// El aliado sale de la propia cotización, nunca de la URL. Sin acceso o sin logo ⇒ 404 idéntico (no revela si la cotización existe).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  const nf = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!Number.isInteger(n) || n <= 0) return nf();
  const sb = await createClient();
  const { data: cot } = await sb.from("cotizaciones").select("id, aliado_id, b2b_aliado:payload->b2bAsistido->>aliado_id, tenant").eq("id", n).maybeSingle();
  if (!cot || !autorizaTenant(await contextoCotizacion(), cot.tenant)) return nf();
  return respuestaLogoDeCotizacion(createAdminClient() as unknown as AdminLogo, cot as unknown as { id: number; aliado_id?: unknown; b2b_aliado?: unknown });
}
