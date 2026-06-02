"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { RolUsuario } from "@/types/database";

type Result = { ok: true } | { ok: false; error: string };

export async function crearUsuario(input: {
  email: string;
  password: string;
  nombre: string;
  rol: RolUsuario;
}): Promise<Result> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return { ok: false, error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor (Vercel)." };
  if (!input.email.trim() || input.password.length < 6)
    return { ok: false, error: "Email válido y contraseña de mínimo 6 caracteres." };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email.trim(),
    password: input.password,
    email_confirm: true,
    user_metadata: { nombre: input.nombre.trim(), rol: input.rol },
  });
  if (error) return { ok: false, error: error.message };

  // Asegurar el perfil con su rol (por si el trigger no tomó el metadato)
  if (data.user) {
    await admin.from("usuarios").upsert({
      id: data.user.id,
      email: input.email.trim(),
      nombre: input.nombre.trim(),
      rol: input.rol,
    });
  }
  revalidatePath("/dashboard/usuarios");
  return { ok: true };
}

export async function cambiarRol(id: string, rol: RolUsuario): Promise<Result> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY." };
  const admin = createAdminClient();
  const { error } = await admin.from("usuarios").update({ rol }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/usuarios");
  return { ok: true };
}

export async function cambiarActivo(id: string, activo: boolean): Promise<Result> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY." };
  const admin = createAdminClient();
  const { error } = await admin.from("usuarios").update({ activo }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/usuarios");
  return { ok: true };
}
