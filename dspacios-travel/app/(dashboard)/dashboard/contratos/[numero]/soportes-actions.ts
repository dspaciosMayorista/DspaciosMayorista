"use server";

// Soportes de pago (#86) — apertura por el PERSONAL INTERNO. La autorización es la RLS de `contrato_soportes_pago` (migración 281): la fila se lee con
// la sesión de quien pregunta; si no es visible, no hay URL. Solo después se firma con service-role. Mismo alcance que los archivos del bucket
// `contratos` (150): superadmin; gerencia/administración/operaciones de la misma agencia; venta solo en sus propios contratos.
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "soportes-pago";

export async function urlSoporteInterno(id: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "No tienes acceso a ese soporte." };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Inicia sesión para continuar." };
  const { data } = await sb.from("contrato_soportes_pago").select("path").eq("id", n).maybeSingle();
  if (!data) return { ok: false, error: "No tienes acceso a ese soporte." };
  const { data: firmado, error } = await createAdminClient().storage.from(BUCKET).createSignedUrl(data.path, 120);
  if (error || !firmado) return { ok: false, error: "No se pudo abrir el archivo." };
  return { ok: true, url: firmado.signedUrl };
}
