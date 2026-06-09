"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// Solo superadmin. Borra el contrato (y sus hijas) y, si reusar=true, libera su
// consecutivo para que el siguiente contrato lo reutilice.
export async function eliminarContrato(numero: string, reusar: boolean): Promise<{ ok: boolean; error?: string }> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (perfil?.rol !== "superadmin") return { ok: false, error: "Solo un superadmin puede eliminar contratos." };

  const { error } = await sb.rpc("eliminar_contrato", { p_numero: numero, p_reusar: reusar });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contratos");
  return { ok: true };
}
