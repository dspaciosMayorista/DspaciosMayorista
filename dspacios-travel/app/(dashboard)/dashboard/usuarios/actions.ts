"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { RolUsuario } from "@/types/database";
import { ROLES_INTERNOS } from "@/lib/constants";

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
  // Los aliados externos tienen su propio flujo (documento + ficha): crearAliadoB2B.
  if (!(ROLES_INTERNOS as string[]).includes(input.rol))
    return { ok: false, error: "Este formulario solo crea usuarios internos. Para agencia/freelance usa «Crear aliado B2B»." };
  // Solo superadmin puede crear OTRO superadmin (evita que cualquier cuenta con
  // acceso a este módulo se auto-otorgue o le dé a otro el rol más alto).
  if (input.rol === "superadmin" && gate.rol !== "superadmin")
    return { ok: false, error: "Solo superadmin puede asignar el rol superadmin." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return { ok: false, error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor (Vercel)." };
  if (!input.email.trim() || input.password.length < 6)
    return { ok: false, error: "Email válido y contraseña de mínimo 6 caracteres." };

  const admin = createAdminClient();

  // El rol NO viaja en la metadata: desde la migración 193 el trigger ignora
  // cualquier rol que no sea agencia/freelance y crea TODO perfil inactivo
  // (la metadata la puede escribir cualquiera que se registre). El rol y el
  // estado los fija esta acción, autorizada arriba, con service-role.
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email.trim(),
    password: input.password,
    email_confirm: true,
    user_metadata: { nombre: input.nombre.trim() },
  });
  if (error || !data.user) return { ok: false, error: error?.message ?? "No se pudo crear la cuenta." };

  const { data: perfil, error: pe } = await admin.from("usuarios").upsert({
    id: data.user.id,
    email: input.email.trim(),
    nombre: input.nombre.trim(),
    rol: input.rol,
    activo: true,
  }).select("id");
  if (pe || perfil?.length !== 1) {
    // Sin perfil confirmado no se deja una cuenta a medias.
    await admin.auth.admin.deleteUser(data.user.id);
    return { ok: false, error: "No se pudo guardar el perfil del usuario. No se creó la cuenta." };
  }
  revalidatePath("/dashboard/usuarios");
  return { ok: true };
}

export type FichaAliado = { id: number; nombre: string; nit: string | null; tipo_documento: string | null; email: string | null };

// Búsqueda SOLO por número de documento exacto (nunca por nombre). Devuelve
// todas las coincidencias: con más de una, el interno elige; aquí no se decide.
export async function buscarFichasAliado(documento: string): Promise<{ ok: true; fichas: FichaAliado[] } | { ok: false; error: string }> {
  const gate = await requireGestionUsuarios();
  if (!gate.ok) return gate;
  const doc = documento.trim();
  if (!doc) return { ok: false, error: "Escribe el número de documento." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY." };
  const { data, error } = await createAdminClient()
    .from("aliados").select("id, nombre, nit, tipo_documento, email").eq("nit", doc).limit(20);
  if (error) return { ok: false, error: "No se pudo buscar la ficha del aliado." };
  return { ok: true, fichas: (data ?? []) as FichaAliado[] };
}

export type EnlaceAliado = { modo: "ficha"; aliadoId: number } | { modo: "nueva" };

export async function crearAliadoB2B(input: {
  tipo: "agencia" | "freelance";
  nombre: string;
  email: string;
  password: string;
  tipoDocumento: string;
  documento: string;
  contacto: string;
  telefono: string;
  enlace: EnlaceAliado | null; // null = el interno aún no confirmó
}): Promise<Result> {
  const gate = await requireGestionUsuarios();
  if (!gate.ok) return gate;
  if (input.tipo !== "agencia" && input.tipo !== "freelance")
    return { ok: false, error: "El aliado debe ser agencia o freelance." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return { ok: false, error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor (Vercel)." };
  const nombre = input.nombre.trim();
  const email = input.email.trim().toLowerCase();
  const documento = input.documento.trim();
  const tipoDocumento = input.tipoDocumento.trim() || (input.tipo === "agencia" ? "NIT" : "CC");
  if (!nombre) return { ok: false, error: "El nombre / razón social del aliado es obligatorio." };
  if (!email || input.password.length < 6)
    return { ok: false, error: "Email válido y contraseña de mínimo 6 caracteres." };
  if (!documento) return { ok: false, error: "El número de documento del aliado es obligatorio." };
  if (!input.enlace)
    return { ok: false, error: "Confirma si enlazas una ficha existente o creas una ficha nueva." };

  const admin = createAdminClient();

  // Anti-suplantación: el portal aún respalda contratos viejos por nombre.
  const { data: dup, error: dupError } = await admin
    .from("usuarios").select("id").in("rol", ["agencia", "freelance"]).ilike("nombre", nombre).limit(1).maybeSingle();
  // Si no se puede verificar el duplicado, NO se sigue: se perdería el candado anti-suplantación.
  if (dupError) return { ok: false, error: "No se pudo verificar si ya existe un aliado con ese nombre. No se creó nada; intenta de nuevo." };
  if (dup) return { ok: false, error: "Ya existe un aliado (agencia/freelance) con ese nombre." };

  // Enlazar una ficha existente solo vale si tiene ESE documento (se re-verifica
  // en servidor; el id que manda el cliente no se acepta a ciegas).
  let aliadoId: number | null = null;
  if (input.enlace.modo === "ficha") {
    const { data: f } = await admin.from("aliados").select("id").eq("nit", documento).eq("id", input.enlace.aliadoId).limit(1);
    if (f?.length !== 1) return { ok: false, error: "La ficha elegida no coincide con ese número de documento." };
    aliadoId = input.enlace.aliadoId;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email, password: input.password, email_confirm: true, user_metadata: { nombre },
  });
  if (error || !data.user) return { ok: false, error: error?.message ?? "No se pudo crear la cuenta." };
  // Limpieza: cada borrado se intenta POR SEPARADO y se confirma. Solo se borra una
  // ficha creada en esta misma llamada (nunca una preexistente). Si algo no se pudo
  // borrar, se dice cuál recurso quedó pendiente en vez de afirmar que se limpió.
  const fallar = async (motivo: string, fichaCreada: number | null): Promise<Result> => {
    const pendientes: string[] = [];
    if (fichaCreada) {
      try {
        const { error: de } = await admin.from("aliados").delete().eq("id", fichaCreada);
        if (de) throw de;
      } catch (e) {
        console.error("crearAliadoB2B: limpieza pendiente — ficha aliados", fichaCreada, e);
        pendientes.push(`ficha de aliado #${fichaCreada}`);
      }
    }
    try {
      const { error: ae } = await admin.auth.admin.deleteUser(data.user.id);
      if (ae) throw ae;
    } catch (e) {
      console.error("crearAliadoB2B: limpieza pendiente — cuenta Auth", data.user.id, e);
      pendientes.push(`cuenta Auth ${data.user.id} (${email})`);
    }
    return pendientes.length === 0
      ? { ok: false, error: `${motivo} No se creó la cuenta.` }
      : { ok: false, error: `${motivo} La limpieza NO terminó: un administrador debe borrar a mano → ${pendientes.join("; ")}.` };
  };

  let fichaNueva: number | null = null;
  if (input.enlace.modo === "nueva") {
    const { data: n, error: ne } = await admin.from("aliados").insert({
      nombre, nit: documento, tipo_documento: tipoDocumento, tipo: input.tipo,
      email, telefono: input.telefono.trim() || null, contacto: input.contacto.trim() || null,
    }).select("id");
    if (ne || n?.length !== 1) {
      return fallar("No se pudo crear la ficha del aliado.", null);
    }
    fichaNueva = aliadoId = n[0].id as number;
  }

  const { data: perfil, error: pe } = await admin.from("usuarios").upsert({
    id: data.user.id, email, nombre, rol: input.tipo, activo: true,
    aliado_id: aliadoId, acceso_legacy_nombre: false,
    pct_comision: input.tipo === "agencia" ? 0.12 : 0.11,
  }).select("id");
  if (pe || perfil?.length !== 1) {
    return fallar("No se pudo guardar el perfil del aliado.", fichaNueva);
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
