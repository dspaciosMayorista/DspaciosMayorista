"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { permisosDelUsuario } from "@/lib/permisos";

type Result = { ok: true } | { ok: false; error: string };

async function puedeAprobar(): Promise<{ ok: boolean; quien: string | null }> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, quien: null };
  const { permisos } = await permisosDelUsuario();
  const { data: perfil } = await sb.from("usuarios").select("nombre").eq("id", user.id).maybeSingle();
  return { ok: !!permisos["b2b"]?.modificar, quien: perfil?.nombre ?? user.email ?? null };
}

export async function aprobarSolicitudB2B(id: number): Promise<Result> {
  const { ok, quien } = await puedeAprobar();
  if (!ok) return { ok: false, error: "No tienes permiso para aprobar registros B2B." };
  const admin = createAdminClient();

  const { data: sol } = await admin.from("b2b_solicitudes").select("email, tipo").eq("id", id).maybeSingle();
  if (!sol) return { ok: false, error: "Solicitud no encontrada." };

  // Si ya existe un usuario con ese correo, se le asigna el rol y se activa.
  let usuarioId: string | null = null;
  const { data: usr } = await admin.from("usuarios").select("id").eq("email", sol.email).maybeSingle();
  if (usr) {
    usuarioId = usr.id;
    await admin.from("usuarios").update({ rol: sol.tipo === "freelance" ? "freelance" : "agencia", activo: true }).eq("id", usr.id);
  }

  const { error } = await admin.from("b2b_solicitudes").update({
    estado: "aprobada", revisado_por: quien, revisado_at: new Date().toISOString(), usuario_id: usuarioId,
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/usuarios/b2b");
  return { ok: true };
}

export async function rechazarSolicitudB2B(id: number): Promise<Result> {
  const { ok, quien } = await puedeAprobar();
  if (!ok) return { ok: false, error: "No tienes permiso para gestionar registros B2B." };
  const admin = createAdminClient();
  const { error } = await admin.from("b2b_solicitudes").update({
    estado: "rechazada", revisado_por: quien, revisado_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/usuarios/b2b");
  return { ok: true };
}
