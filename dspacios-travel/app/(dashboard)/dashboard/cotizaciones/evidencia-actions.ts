"use server";

// O-3 — apertura por el PERSONAL INTERNO de la evidencia previa que el aliado adjuntó a su cotización. La autorización es la RLS de `cotizacion_evidencias`
// (migración 325): la fila se lee con la sesión de quien pregunta; si no es visible, no hay URL. Solo después se firma (2 min) con service-role.
// Abrir un archivo no registra ni aprueba nada.
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "evidencias-cotizacion";

// identidad:n/a — solo lectura: firma una URL, no escribe tablas de contrato
export async function urlEvidenciaInterna(id: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "No tienes acceso a ese comprobante." };
  const sb = await createClient(); // identidad:n/a — solo lectura
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Inicia sesión para continuar." };
  const { data } = await (sb as unknown as { from: (t: string) => { select: (c: string) => { eq: (a: string, b: number) => { maybeSingle: () => PromiseLike<{ data: { path: string } | null }> } } } })
    .from("cotizacion_evidencias").select("path").eq("id", n).maybeSingle();
  if (!data) return { ok: false, error: "No tienes acceso a ese comprobante." };
  const { data: firmado, error } = await createAdminClient(/* identidad:n/a — solo lectura */).storage.from(BUCKET).createSignedUrl(data.path, 120);
  if (error || !firmado) return { ok: false, error: "No se pudo abrir el archivo." };
  return { ok: true, url: firmado.signedUrl };
}
