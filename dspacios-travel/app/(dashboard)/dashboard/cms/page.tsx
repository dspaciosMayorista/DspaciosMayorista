import { createClient } from "@/lib/supabase/server";
import { CmsClient } from "./CmsClient";
import type { PaginaConSecciones, SeccionRow } from "./tipos";

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

  // Cargamos TODAS las páginas (incl. inactivas) y TODAS las secciones (incl. ocultas).
  const [
    { data: paginasRaw },
    { data: seccionesRaw },
    { data: testimonios },
    { data: blog },
    { data: config },
  ] = await Promise.all([
    sb.from("web_paginas").select("*").order("orden", { ascending: true }),
    sb.from("web_secciones").select("*").order("orden", { ascending: true }),
    sb.from("web_testimonios").select("*").order("orden", { ascending: true }),
    sb.from("web_blog").select("*").order("orden", { ascending: true }),
    sb.from("web_config").select("*").eq("id", 1).maybeSingle(),
  ]);

  // Agrupa secciones por página.
  const seccionesPorPagina = new Map<number, SeccionRow[]>();
  for (const s of (seccionesRaw ?? []) as SeccionRow[]) {
    const lista = seccionesPorPagina.get(s.pagina_id) ?? [];
    lista.push(s);
    seccionesPorPagina.set(s.pagina_id, lista);
  }

  const paginas: PaginaConSecciones[] = (paginasRaw ?? []).map((p) => ({
    ...p,
    secciones: (seccionesPorPagina.get(p.id) ?? []).sort(
      (a, b) => (a.orden ?? 0) - (b.orden ?? 0)
    ),
  }));

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Sitio web (CMS)</h1>
        <p className="mt-1 text-sm text-gray-500">
          Crea y organiza las páginas del sitio público y sus secciones. Los cambios
          se reflejan en el sitio tras guardar.
        </p>
      </div>
      <CmsClient
        paginas={paginas}
        testimonios={testimonios ?? []}
        blog={blog ?? []}
        config={config ?? null}
      />
    </div>
  );
}
