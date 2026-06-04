"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { EmpresaConfig } from "@/lib/empresa";

const ROLES = ["superadmin", "gerencia", "administracion"];

export async function guardarEmpresa(
  datos: Partial<EmpresaConfig>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return { ok: false, error: "No tienes permisos para editar la información de la empresa." };
  }

  // Asegura que exista la fila única (id = 1) y la actualiza.
  const { error } = await sb
    .from("empresa_config")
    .upsert({ id: 1, ...datos, updated_at: new Date().toISOString() }, { onConflict: "id" });

  if (error) return { ok: false, error: error.message };

  // La marca/contrato se ven en muchas vistas: refresca las principales.
  revalidatePath("/", "layout");
  return { ok: true };
}
