"use server";

import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true } | { ok: false; error: string };

export type SolicitudB2BInput = {
  tipo: string; nombre: string; nit: string; contacto: string; email: string;
  telefono: string; ciudad: string; notas: string; aceptaNotificaciones: boolean;
  password: string; passwordConfirm: string;
};

export async function enviarSolicitudB2B(input: SolicitudB2BInput): Promise<Result> {
  if (!input.nombre.trim()) return { ok: false, error: "El nombre / razón social es obligatorio." };
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "El correo es obligatorio." };
  if (input.password.length < 6) return { ok: false, error: "La contraseña debe tener al menos 6 caracteres." };
  if (input.password !== input.passwordConfirm) return { ok: false, error: "Las contraseñas no coinciden." };

  const tipo = input.tipo === "freelance" ? "freelance" : "agencia";
  const admin = createAdminClient();

  // Crea la cuenta (queda PENDIENTE: inactiva hasta que la apruebe un admin).
  const { data: created, error: ce } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { nombre: input.nombre.trim(), rol: tipo },
  });
  if (ce || !created?.user) {
    const m = (ce?.message ?? "").toLowerCase();
    if (m.includes("already") || m.includes("registered") || m.includes("exists"))
      return { ok: false, error: "Ya existe una cuenta con ese correo. Inicia sesión." };
    return { ok: false, error: ce?.message ?? "No se pudo crear la cuenta." };
  }
  const uid = created.user.id;

  // El trigger crea el perfil; lo dejamos como aliado pendiente (inactivo).
  await admin.from("usuarios").update({ rol: tipo, activo: false, nombre: input.nombre.trim() }).eq("id", uid);

  const { error } = await admin.from("b2b_solicitudes").insert({
    tipo,
    nombre: input.nombre.trim(),
    nit: input.nit.trim() || null,
    contacto: input.contacto.trim() || null,
    email,
    telefono: input.telefono.trim() || null,
    ciudad: input.ciudad.trim() || null,
    notas: input.notas.trim() || null,
    acepta_notificaciones: input.aceptaNotificaciones,
    estado: "pendiente",
    usuario_id: uid,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
