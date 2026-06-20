"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Database } from "@/types/database";
import type { PaginaConSecciones, PaginaNodo } from "./tipos";
import { PaginasTree } from "./editors/PaginasTree";
import { PaginaEditor } from "./editors/PaginaEditor";
import { LienzoVivo } from "./editors/LienzoVivo";
import { TestimoniosEditor } from "./editors/TestimoniosEditor";
import { BlogEditor } from "./editors/BlogEditor";
import { ConfigEditor } from "./editors/ConfigEditor";

type Testimonio = Database["public"]["Tables"]["web_testimonios"]["Row"];
type Blog = Database["public"]["Tables"]["web_blog"]["Row"];
type Config = Database["public"]["Tables"]["web_config"]["Row"];

// Datos del sitio (forma inglesa de lib/sitio/cms) para renderizar las secciones reales.
export type SitioData = {
  config: unknown;
  testimonios: unknown[];
  blog: unknown[];
  destinos: unknown[];
};

type Tab = "paginas" | "blog" | "testimonios" | "config";

const TABS: { key: Tab; label: string }[] = [
  { key: "paginas", label: "Páginas" },
  { key: "blog", label: "Blog" },
  { key: "testimonios", label: "Testimonios" },
  { key: "config", label: "Configuración" },
];

// Construye el árbol (padres → hijos) a partir de la lista plana.
function construirArbol(paginas: PaginaConSecciones[]): PaginaNodo[] {
  const byId = new Map<number, PaginaNodo>();
  for (const p of paginas) byId.set(p.id, { ...p, hijos: [] });
  const raiz: PaginaNodo[] = [];
  for (const p of paginas) {
    const nodo = byId.get(p.id)!;
    if (p.parent_id && byId.has(p.parent_id)) {
      byId.get(p.parent_id)!.hijos.push(nodo);
    } else {
      raiz.push(nodo);
    }
  }
  const ordenar = (l: PaginaNodo[]) => {
    l.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    l.forEach((n) => ordenar(n.hijos));
  };
  ordenar(raiz);
  return raiz;
}

export function CmsClient({
  paginas,
  testimonios,
  blog,
  config,
  sitio,
}: {
  paginas: PaginaConSecciones[];
  testimonios: Testimonio[];
  blog: Blog[];
  config: Config | null;
  sitio: SitioData;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("paginas");
  const [seleccionada, setSeleccionada] = useState<number | null>(
    paginas[0]?.id ?? null
  );

  const arbol = useMemo(() => construirArbol(paginas), [paginas]);
  const paginaSel = useMemo(
    () => paginas.find((p) => p.id === seleccionada) ?? null,
    [paginas, seleccionada]
  );

  // Tras cualquier cambio estructural: recarga datos del server.
  function recargar() {
    router.refresh();
  }

  const previewSrc = paginaSel
    ? paginaSel.slug === "inicio"
      ? "/sitio_web"
      : `/sitio_web/${paginaSel.slug}`
    : "/sitio_web";

  return (
    <div className="space-y-4">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-2">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="rounded-t-lg px-4 py-2 text-sm font-medium transition-colors"
              style={
                tab === t.key
                  ? {
                      color: "var(--brand-primary)",
                      borderBottom: "2px solid var(--brand-primary)",
                      fontWeight: 600,
                    }
                  : { color: "#6b7280" }
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <a
          href={previewSrc}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-[var(--brand-primary)] hover:bg-gray-50"
        >
          Ver página web ↗
        </a>
      </div>

      {tab === "paginas" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          {/* Izquierda — árbol */}
          <aside className="xl:col-span-3">
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <PaginasTree
                arbol={arbol}
                seleccionada={seleccionada}
                onSelect={setSeleccionada}
                onChanged={recargar}
              />
            </div>
          </aside>

          {/* Derecha — edición in-situ sobre la página real */}
          <section className="space-y-4 xl:col-span-9">
            {paginaSel ? (
              <>
                <details className="rounded-xl border border-gray-200 bg-white">
                  <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-gray-700">
                    ⚙ Ajustes de la página (slug, menú, SEO)
                  </summary>
                  <div className="border-t border-gray-100 p-4">
                    <PaginaEditor pagina={paginaSel} onChanged={recargar} />
                  </div>
                </details>

                <LienzoVivo
                  pagina={paginaSel}
                  paginas={paginas}
                  sitio={sitio}
                  onChanged={recargar}
                />
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
                Selecciona o crea una página para editarla.
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "blog" && <BlogEditor blog={blog} />}
      {tab === "testimonios" && <TestimoniosEditor testimonios={testimonios} />}
      {tab === "config" && <ConfigEditor config={config} />}
    </div>
  );
}
