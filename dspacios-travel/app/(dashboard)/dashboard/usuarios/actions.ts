"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { RolUsuario } from "@/types/database";

type Result = { ok: true } | { ok: false; error: string };

// Estas Server Actions usan el cliente service-role (bypassa RLS) para poder
// crear/editar usuarios de auth.admin. Por eso NO pueden confiar en la RLS de
// la tabla `usuarios` — hay que validar el rol de quien invoca aquí mismo antes
// de tocar nada, igual que hace la página (superadmin/administración gestionan).
async function requireGestionUsuarios(): Promise<{ ok: true; rol: string } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado." };
  const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).single();
  if (!perfil || !["superadmin", "administracion"].includes(perfil.rol))
    return { ok: false, error: "Solo superadmin / administración pueden gestionar usuarios." };
  return { ok: true, rol: perfil.rol };
}

export async function crearUsuario(input: {
  email: string;
  password: string;
  nombre: string;
  rol: RolUsuario;
}): Promise<Result> {
  const gate = await requireGestionUsuarios();
  if (!gate.ok) return gate;
  // Solo superadmin puede crear OTRO superadmin (evita que cualquier cuenta con
  // acceso a este módulo se auto-otorgue o le dé a otro el rol más alto).
  if (input.rol === "superadmin" && gate.rol !== "superadmin")
    return { ok: false, error: "Solo superadmin puede asignar el rol superadmin." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return { ok: false, error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor (Vercel)." };
  if (!input.email.trim() || input.password.length < 6)
    return { ok: false, error: "Email válido y contraseña de mínimo 6 caracteres." };

  const admin = createAdminClient();

  // Mismo candado anti-suplantación que el auto-registro B2B: dos aliados
  // (agencia/freelance) no pueden compartir nombre, porque el vínculo con sus
  // contratos también se resuelve por nombre en texto libre.
  if (input.rol === "agencia" || input.rol === "freelance") {
    const { data: dup } = await admin
      .from("usuarios")
      .select("id")
      .in("rol", ["agencia", "freelance"])
      .ilike("nombre", input.nombre.trim())
      .limit(1)
      .maybeSingle();
    if (dup) return { ok: false, error: "Ya existe un aliado (agencia/freelance) con ese nombre." };
  }

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
  const gate = await requireGestionUsuarios();
  if (!gate.ok) return gate;
  if (rol === "superadmin" && gate.rol !== "superadmin")
    return { ok: false, error: "Solo superadmin puede asignar el rol superadmin." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY." };
  const admin = createAdminClient();
  const { error } = await admin.from("usuarios").update({ rol }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/usuarios");
  return { ok: true };
}

// Comisión por agencia (%). El superadmin la ajusta por usuario aliado.
export async function setComisionUsuario(id: string, pct: number): Promise<Result> {
  const gate = await requireGestionUsuarios();
  if (!gate.ok) return gate;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY." };
  const valor = Number.isFinite(pct) && pct >= 0 && pct <= 1 ? pct : null;
  const admin = createAdminClient();
  const { error } = await admin.from("usuarios").update({ pct_comision: valor }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/usuarios");
  return { ok: true };
}

export async function cambiarActivo(id: string, activo: boolean): Promise<Result> {
  const gate = await requireGestionUsuarios();
  if (!gate.ok) return gate;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY." };
  const admin = createAdminClient();
  const { error } = await admin.from("usuarios").update({ activo }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/usuarios");
  return { ok: true };
}
