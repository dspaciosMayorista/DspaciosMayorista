import { createClient } from "@/lib/supabase/server";
import { CmsClient } from "./CmsClient";

export const dynamic = "force-dynamic";

export default async function CmsPage() {
  const sb = await createClient();

  const {
    data: { user },
  } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).maybeSingle()
    : { data: null };

  if (perfil?.rol !== "superadmin") {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Sitio web</h1>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Solo el superadmin puede administrar el contenido del sitio web público.
        </p>
      </div>
    );
  }

  const [
    { data: paquetes },
    { data: destinos },
    { data: testimonios },
    { data: blog },
    { data: config },
  ] = await Promise.all([
    sb.from("web_paquetes").select("*").order("orden", { ascending: true }),
    sb.from("web_destinos").select("*").order("orden", { ascending: true }),
    sb.from("web_testimonios").select("*").order("orden", { ascending: true }),
    sb.from("web_blog").select("*").order("orden", { ascending: true }),
    sb.from("web_config").select("*").eq("id", 1).maybeSingle(),
  ]);

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Sitio web (CMS)</h1>
        <p className="mt-1 text-sm text-gray-500">
          Administra el contenido del sitio público de marketing. Los cambios se reflejan
          en el sitio tras guardar.
        </p>
      </div>
      <CmsClient
        paquetes={paquetes ?? []}
        destinos={destinos ?? []}
        testimonios={testimonios ?? []}
        blog={blog ?? []}
        config={config ?? null}
      />
    </div>
  );
}
