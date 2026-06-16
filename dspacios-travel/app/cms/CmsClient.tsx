"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Database } from "@/types/database";
import type { PaginaConSecciones, PaginaNodo } from "./tipos";
import { PaginasTree } from "./editors/PaginasTree";
import { PaginaEditor } from "./editors/PaginaEditor";
import { TestimoniosEditor } from "./editors/TestimoniosEditor";
import { BlogEditor } from "./editors/BlogEditor";
import { ConfigEditor } from "./editors/ConfigEditor";

type Testimonio = Database["public"]["Tables"]["web_testimonios"]["Row"];
type Blog = Database["public"]["Tables"]["web_blog"]["Row"];
type Config = Database["public"]["Tables"]["web_config"]["Row"];

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
}: {
  paginas: PaginaConSecciones[];
  testimonios: Testimonio[];
  blog: Blog[];
  config: Config | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("paginas");
  const [seleccionada, setSeleccionada] = useState<number | null>(
    paginas[0]?.id ?? null
  );
  const [iframeKey, setIframeKey] = useState(0);

  const arbol = useMemo(() => construirArbol(paginas), [paginas]);
  const paginaSel = useMemo(
    () => paginas.find((p) => p.id === seleccionada) ?? null,
    [paginas, seleccionada]
  );

  // Tras cualquier cambio: recarga datos del server y refresca la vista en vivo.
  function recargar() {
    router.refresh();
    setIframeKey((k) => k + 1);
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

          {/* Centro — editor */}
          <section className="xl:col-span-5">
            {paginaSel ? (
              <PaginaEditor pagina={paginaSel} onChanged={recargar} />
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
                Selecciona o crea una página para editarla.
              </div>
            )}
          </section>

          {/* Derecha — vista en vivo */}
          <aside className="xl:col-span-4">
            <div className="sticky top-4 rounded-xl border border-gray-200 bg-white p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-xs font-semibold text-gray-500">Vista en vivo</p>
                <button
                  type="button"
                  onClick={() => setIframeKey((k) => k + 1)}
                  className="text-xs text-[var(--brand-accent)] hover:underline"
                >
                  Recargar
                </button>
              </div>
              {paginaSel ? (
                <iframe
                  key={iframeKey}
                  src={previewSrc}
                  title="Vista previa del sitio"
                  className="h-[70vh] w-full rounded-lg border border-gray-100"
                />
              ) : (
                <p className="p-6 text-center text-sm text-gray-400">
                  Sin página seleccionada.
                </p>
              )}
              <p className="mt-2 px-1 text-[11px] text-gray-400">
                Muestra la página publicada (lo activo/visible). Guarda los cambios y
                pulsa “Recargar” para verlos reflejados.
              </p>
            </div>
          </aside>
        </div>
      )}

      {tab === "blog" && <BlogEditor blog={blog} />}
      {tab === "testimonios" && <TestimoniosEditor testimonios={testimonios} />}
      {tab === "config" && <ConfigEditor config={config} />}
    </div>
  );
}
