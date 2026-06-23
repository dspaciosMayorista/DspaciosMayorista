import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OrganizacionesClient, type OrgRow } from "./OrganizacionesClient";

export const dynamic = "force-dynamic";

export default async function OrganizacionesPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
  if (perfil?.rol !== "superadmin") {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-xl font-semibold text-gray-900">Organizaciones</h1>
        <p className="mt-2 text-sm text-gray-500">Solo un superadmin puede administrar las organizaciones del SaaS.</p>
      </div>
    );
  }

  // Plataforma: se listan TODAS las orgs con service-role (la RLS solo deja ver la propia).
  let orgs: OrgRow[] = [];
  let conteoUsuarios: Record<string, number> = {};
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("organizaciones")
      .select("id, slug, nombre, nit, ciudad, email, telefono, color_primario, color_acento, logo_url, logo_white_url, plan, estado, created_at")
      .order("created_at", { ascending: true });
    orgs = (data ?? []) as OrgRow[];
    const { data: us } = await admin.from("usuarios").select("org_id");
    for (const u of us ?? []) {
      const k = (u.org_id as string | null) ?? "";
      if (k) conteoUsuarios[k] = (conteoUsuarios[k] ?? 0) + 1;
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600">← Panel</Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">Organizaciones</h1>
      <p className="mb-6 text-sm text-gray-500">
        Agencias clientes del SaaS (tenants). Cada una tiene su tarifario público en
        <code className="mx-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs">/o/&lt;slug&gt;/tarifario</code>
        y sus datos aislados por organización.
      </p>
      {!process.env.SUPABASE_SERVICE_ROLE_KEY && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Falta <code>SUPABASE_SERVICE_ROLE_KEY</code> en el entorno: sin ella no se pueden crear ni listar todas las organizaciones.
        </p>
      )}
      <OrganizacionesClient orgs={orgs} conteoUsuarios={conteoUsuarios} />
    </div>
  );
}
