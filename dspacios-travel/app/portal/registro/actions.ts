"use server";

import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

export type SolicitudB2BInput = {
  tipo: string; nombre: string; nit: string; contacto: string; email: string;
  telefono: string; ciudad: string; notas: string; aceptaNotificaciones: boolean;
};

export async function enviarSolicitudB2B(input: SolicitudB2BInput): Promise<Result> {
  if (!input.nombre.trim()) return { ok: false, error: "El nombre / razón social es obligatorio." };
  if (!input.email.trim()) return { ok: false, error: "El correo es obligatorio." };
  const sb = await createClient();
  const { error } = await sb.from("b2b_solicitudes").insert({
    tipo: input.tipo === "freelance" ? "freelance" : "agencia",
    nombre: input.nombre.trim(),
    nit: input.nit.trim() || null,
    contacto: input.contacto.trim() || null,
    email: input.email.trim().toLowerCase(),
    telefono: input.telefono.trim() || null,
    ciudad: input.ciudad.trim() || null,
    notas: input.notas.trim() || null,
    acepta_notificaciones: input.aceptaNotificaciones,
    estado: "pendiente",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
