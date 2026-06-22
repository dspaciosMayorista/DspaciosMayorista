import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ─────────────────────────────────────────────────────────────────────────
// SaaS multi-tenant — resolución de la ORGANIZACIÓN (tenant) en el servidor.
//
// Los inserts CON SESIÓN (anon key + JWT) ya reciben el `org_id` automáticamente
// por el DEFAULT de la columna = `coalesce(mi_org(), org#1)` (migración 102). Este
// helper es para los inserts con **service-role** (sillas/costos al reservar, CxP,
// crons), donde `auth.uid()` no existe y por tanto `mi_org()` es null: ahí HAY que
// pasar el `org_id` explícito, y se obtiene con `orgActual()`.
// ─────────────────────────────────────────────────────────────────────────

/** org_id de la organización del usuario autenticado (o null si no hay sesión). */
export async function orgActual(): Promise<string | null> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb
    .from("usuarios")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();
  return (data?.org_id as string | null) ?? null;
}

export type OrgPublica = {
  id: string; slug: string; nombre: string;
  logo_url: string | null; logo_white_url: string | null;
  color_primario: string | null; color_acento: string | null;
};

// ── Resolución del tenant por el SLUG del path (`/o/<slug>/...`) ────────────
// Para páginas PÚBLICAS (tarifario/sitio sin sesión): el org sale del slug, no de
// `mi_org()`. Se lee con service-role (bypasea RLS) y se cachea por request.
const _cacheSlug = new Map<string, OrgPublica | null>();

export async function orgPorSlug(slug: string): Promise<OrgPublica | null> {
  const s = (slug || "").trim().toLowerCase();
  if (!s || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  if (_cacheSlug.has(s)) return _cacheSlug.get(s) ?? null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("organizaciones")
    .select("id, slug, nombre, logo_url, logo_white_url, color_primario, color_acento, estado")
    .eq("slug", s)
    .maybeSingle();
  const org = data && data.estado !== "cancelada" ? {
    id: data.id, slug: data.slug, nombre: data.nombre,
    logo_url: data.logo_url, logo_white_url: data.logo_white_url,
    color_primario: data.color_primario, color_acento: data.color_acento,
  } : null;
  _cacheSlug.set(s, org);
  return org;
}

// Slug de la primera organización (D'spacios): DEFAULT cuando una página pública
// se abre SIN `/o/<slug>` (así el mono-tenant sigue funcionando).
const ORG_SLUG_DEFAULT = "dspacios";

// Organización de la petición PÚBLICA: del header `x-org-slug` (lo pone `proxy.ts`
// al reescribir `/o/<slug>/...`) o, si no hay, la org por defecto. Las páginas
// públicas (tarifario/sitio) filtran sus consultas por `org.id`.
export async function orgDelRequest(): Promise<OrgPublica | null> {
  const h = await headers();
  const slug = h.get("x-org-slug") || ORG_SLUG_DEFAULT;
  return orgPorSlug(slug);
}
