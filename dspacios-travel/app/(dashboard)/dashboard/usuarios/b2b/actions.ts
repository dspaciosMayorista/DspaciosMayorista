"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { miRol, puedeEscribir } from "@/lib/roles";

type Result = { ok: true } | { ok: false; error: string };

async function puedeAprobar(): Promise<{ ok: boolean; quien: string | null }> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, quien: null };
  const rol = await miRol();
  const { data: perfil } = await sb.from("usuarios").select("nombre").eq("id", user.id).maybeSingle();
  return { ok: puedeEscribir("b2b", rol), quien: perfil?.nombre ?? user.email ?? null };
}

// Aprueba el registro y, en el mismo paso, ENLAZA el login con su ficha del
// catálogo `aliados` (migración 143). Ese enlace es lo que hace que el aliado
// vea los contratos que un asesor interno le montó ("contratos asistidos"), sin
// depender de que el nombre esté escrito idéntico.
//
// `aliadoId` lo decide QUIEN APRUEBA (aprobación manual, decisión del dueño):
// el registro solo deja una sugerencia por coincidencia de documento. Enlazar
// automáticamente permitiría que alguien viera contratos ajenos con solo
// conocer o adivinar un NIT.
//   · aliadoId: number → enlaza con esa ficha
//   · aliadoId: "nueva" → crea la ficha en el catálogo con los datos de la
//     solicitud y enlaza con ella (caso del freelance que aún no existía)
//   · aliadoId: null   → aprueba sin enlazar (queda el respaldo por nombre)
export async function aprobarSolicitudB2B(
  id: number,
  aliadoId?: number | "nueva" | null
): Promise<Result> {
  const { ok, quien } = await puedeAprobar();
  if (!ok) return { ok: false, error: "No tienes permiso para aprobar registros B2B." };
  const admin = createAdminClient();

  const { data: sol } = await admin
    .from("b2b_solicitudes")
    .select("email, tipo, nombre, nit, tipo_documento, telefono, contacto, aliado_sugerido_id")
    .eq("id", id)
    .maybeSingle();
  if (!sol) return { ok: false, error: "Solicitud no encontrada." };

  // Ficha del catálogo a enlazar. Si no se indicó nada, se respeta la
  // sugerencia que dejó el registro (que ya se le muestra a quien aprueba).
  let aliadoFinal: number | null = null;
  if (aliadoId === "nueva") {
    const { data: creado, error: ae } = await admin
      .from("aliados")
      .insert({
        nombre: sol.nombre,
        nit: sol.nit,
        tipo_documento: sol.tipo_documento ?? (sol.tipo === "agencia" ? "NIT" : "CC"),
        email: sol.email,
        telefono: sol.telefono,
        contacto: sol.contacto,
      })
      .select("id")
      .single();
    if (ae || !creado) return { ok: false, error: ae?.message ?? "No se pudo crear el aliado en el catálogo." };
    aliadoFinal = creado.id;
  } else if (typeof aliadoId === "number") {
    aliadoFinal = aliadoId;
  } else if (aliadoId === undefined) {
    aliadoFinal = sol.aliado_sugerido_id ?? null;
  }

  // Si ya existe un usuario con ese correo, se le asigna el rol y se activa.
  let usuarioId: string | null = null;
  const { data: usr } = await admin.from("usuarios").select("id").eq("email", sol.email).maybeSingle();
  if (usr) {
    usuarioId = usr.id;
    await admin.from("usuarios").update({
      rol: sol.tipo === "freelance" ? "freelance" : "agencia",
      activo: true,
      ...(aliadoFinal != null ? { aliado_id: aliadoFinal } : {}),
    }).eq("id", usr.id);
  }

  const { error } = await admin.from("b2b_solicitudes").update({
    estado: "aprobada", revisado_por: quien, revisado_at: new Date().toISOString(), usuario_id: usuarioId,
    aliado_sugerido_id: aliadoFinal ?? sol.aliado_sugerido_id,
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
