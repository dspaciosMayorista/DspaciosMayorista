"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

// Solo el TITULAR de la agencia (rol agencia, agencia_id NULL) gestiona agentes.
async function titularAgencia(): Promise<{ id: string } | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: p } = await sb.from("usuarios").select("rol, agencia_id, activo").eq("id", user.id).maybeSingle();
  if (p?.rol === "agencia" && !p.agencia_id && p.activo) return { id: user.id };
  return null;
}

export async function crearAgente(input: { nombre: string; email: string; password: string }): Promise<Result> {
  const titular = await titularAgencia();
  if (!titular) return { ok: false, error: "Solo el titular de la agencia puede crear agentes." };
  const email = input.email.trim().toLowerCase();
  if (!input.nombre.trim() || !email) return { ok: false, error: "Nombre y correo son obligatorios." };
  if (input.password.length < 6) return { ok: false, error: "La contraseña debe tener al menos 6 caracteres." };

  const admin = createAdminClient();
  const { data: created, error: ce } = await admin.auth.admin.createUser({
    email, password: input.password, email_confirm: true,
    user_metadata: { nombre: input.nombre.trim(), rol: "agencia" },
  });
  if (ce || !created?.user) {
    const m = (ce?.message ?? "").toLowerCase();
    if (m.includes("already") || m.includes("registered") || m.includes("exists"))
      return { ok: false, error: "Ya existe una cuenta con ese correo." };
    return { ok: false, error: ce?.message ?? "No se pudo crear el agente." };
  }
  // Agente: rol agencia, activo, vinculado a la agencia titular.
  await admin.from("usuarios").update({ rol: "agencia", activo: true, nombre: input.nombre.trim(), agencia_id: titular.id }).eq("id", created.user.id);
  revalidatePath("/portal/b2b/agentes");
  return { ok: true };
}

export async function cambiarEstadoAgente(agenteId: string, activo: boolean): Promise<Result> {
  const titular = await titularAgencia();
  if (!titular) return { ok: false, error: "No autorizado." };
  const admin = createAdminClient();
  // Solo agentes de ESTA agencia.
  const { data: ag } = await admin.from("usuarios").select("agencia_id").eq("id", agenteId).maybeSingle();
  if (ag?.agencia_id !== titular.id) return { ok: false, error: "Ese agente no es de tu agencia." };
  const { error } = await admin.from("usuarios").update({ activo }).eq("id", agenteId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/portal/b2b/agentes");
  return { ok: true };
}
