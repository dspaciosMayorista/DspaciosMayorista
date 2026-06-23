"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";

type OrgUpdate = Database["public"]["Tables"]["organizaciones"]["Update"];

// ─────────────────────────────────────────────────────────────────────────
// SaaS · administración de ORGANIZACIONES (tenants).
//
// Es función de PLATAFORMA: crear/editar cualquier organización cruza el
// aislamiento por org, así que va por SERVICE-ROLE (bypasea RLS) y SIEMPRE
// gateada a `superadmin`. La RLS normal de `organizaciones` solo deja a cada
// org ver/editar la suya; aquí el dueño de la plataforma administra todas.
// ─────────────────────────────────────────────────────────────────────────

type Result = { ok: true; mensaje?: string } | { ok: false; error: string };
const oNull = (s?: string) => (s && s.trim() !== "" ? s.trim() : null);

async function exigirSuperadmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado." };
  const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
  if (perfil?.rol !== "superadmin") return { ok: false, error: "Solo un superadmin puede administrar organizaciones." };
  return { ok: true };
}

// slug: minúsculas, sin espacios ni símbolos (a-z 0-9 -). Es la llave del path /o/<slug>.
function normSlug(s: string): string {
  return (s || "")
    .toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export type OrgInput = {
  slug: string; nombre: string; nit?: string; ciudad?: string; email?: string; telefono?: string;
  colorPrimario?: string; colorAcento?: string; logoUrl?: string; logoWhiteUrl?: string;
  plan?: string; estado?: string;
  // Opcional: crear el primer usuario superadmin de la org (queda usable de una).
  adminEmail?: string; adminNombre?: string;
};

function tempPassword(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export async function crearOrganizacion(input: OrgInput): Promise<Result> {
  const guard = await exigirSuperadmin();
  if (!guard.ok) return guard;

  const slug = normSlug(input.slug || input.nombre);
  if (!slug) return { ok: false, error: "El slug es obligatorio (ej. 'mi-agencia')." };
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };

  const admin = createAdminClient();
  const { data: org, error } = await admin.from("organizaciones").insert({
    slug,
    nombre: input.nombre.trim(),
    nit: oNull(input.nit), ciudad: oNull(input.ciudad),
    email: oNull(input.email), telefono: oNull(input.telefono),
    color_primario: oNull(input.colorPrimario) ?? "#1D7C9A",
    color_acento: oNull(input.colorAcento) ?? "#26BBD9",
    logo_url: oNull(input.logoUrl), logo_white_url: oNull(input.logoWhiteUrl),
    plan: oNull(input.plan) ?? "trial",
    estado: oNull(input.estado) ?? "activa",
  }).select("id, slug").single();

  if (error || !org) {
    const dup = (error?.message ?? "").toLowerCase().includes("duplicate") || (error?.code === "23505");
    return { ok: false, error: dup ? `Ya existe una organización con el slug "${slug}".` : (error?.message ?? "No se pudo crear.") };
  }

  let mensaje = `Organización "${input.nombre.trim()}" creada · tarifario en /o/${slug}/tarifario`;

  // Primer superadmin de la org (opcional) — la deja usable de inmediato.
  const adminEmail = oNull(input.adminEmail)?.toLowerCase();
  if (adminEmail) {
    const pass = tempPassword();
    const { data: created, error: ce } = await admin.auth.admin.createUser({
      email: adminEmail, password: pass, email_confirm: true,
      user_metadata: { nombre: input.adminNombre?.trim() || input.nombre.trim(), rol: "superadmin" },
    });
    if (ce || !created?.user) {
      mensaje += ` · ⚠️ no se creó el usuario admin (${ce?.message ?? "error"}).`;
    } else {
      await admin.from("usuarios").update({
        rol: "superadmin", activo: true, org_id: org.id,
        nombre: input.adminNombre?.trim() || input.nombre.trim(),
      }).eq("id", created.user.id);
      mensaje += ` · admin ${adminEmail} · contraseña temporal: ${pass}`;
    }
  }

  revalidatePath("/dashboard/organizaciones");
  return { ok: true, mensaje };
}

export async function actualizarOrganizacion(id: string, input: Partial<OrgInput>): Promise<Result> {
  const guard = await exigirSuperadmin();
  if (!guard.ok) return guard;

  const admin = createAdminClient();
  const patch: OrgUpdate = { updated_at: new Date().toISOString() };
  if (input.nombre !== undefined) patch.nombre = input.nombre.trim();
  if (input.nit !== undefined) patch.nit = oNull(input.nit);
  if (input.ciudad !== undefined) patch.ciudad = oNull(input.ciudad);
  if (input.email !== undefined) patch.email = oNull(input.email);
  if (input.telefono !== undefined) patch.telefono = oNull(input.telefono);
  if (input.colorPrimario !== undefined) patch.color_primario = oNull(input.colorPrimario) ?? "#1D7C9A";
  if (input.colorAcento !== undefined) patch.color_acento = oNull(input.colorAcento) ?? "#26BBD9";
  if (input.logoUrl !== undefined) patch.logo_url = oNull(input.logoUrl);
  if (input.logoWhiteUrl !== undefined) patch.logo_white_url = oNull(input.logoWhiteUrl);
  if (input.plan !== undefined) patch.plan = oNull(input.plan) ?? "trial";
  if (input.estado !== undefined) patch.estado = oNull(input.estado) ?? "activa";

  const { error } = await admin.from("organizaciones").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/organizaciones");
  return { ok: true };
}
