// ─────────────────────────────────────────────────────────────────────────
// Capa de lectura del SITIO WEB por PÁGINAS y SECCIONES (modelo migración 079).
//
// Lee el árbol de páginas + sus secciones desde Supabase (web_paginas /
// web_secciones). Si las tablas no existen o están vacías (migración 079 aún
// no corrida), cae al árbol estático centralizado en lib/sitio/paginasFallback.
// El sitio nunca se ve vacío.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@/lib/supabase/server";
import {
  PAGINAS_FALLBACK,
  type PaginaFallback,
  type SeccionTipo,
  type PaginaTipo,
} from "@/lib/sitio/paginasFallback";

export type { SeccionTipo, PaginaTipo };

export type MenuItem = {
  id: number | string;
  slug: string;
  titulo: string;
  etiquetaMenu: string;
  tipo: PaginaTipo;
  esGrupoMenu: boolean;
  hijos: MenuItem[];
};

export type Seccion = {
  id: number | string;
  tipo: SeccionTipo;
  orden: number;
  datos: Record<string, unknown>;
};

export type Pagina = {
  id: number | string;
  slug: string;
  titulo: string;
  tipo: PaginaTipo;
  seoTitulo: string | null;
  seoDescripcion: string | null;
  imagenPortada: string | null;
  secciones: Seccion[];
};

export type PaginaHijo = {
  id: number | string;
  slug: string;
  titulo: string;
  imagenPortada: string | null;
};

// ── datos jsonb → objeto seguro ─────────────────────────────────────────────
function parseDatos(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v))
    return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const o = JSON.parse(v);
      return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

// ── Helpers de fallback ─────────────────────────────────────────────────────
function fbPaginaActiva(slug: string): PaginaFallback | undefined {
  return PAGINAS_FALLBACK.find((p) => p.slug === slug);
}

function fbMenu(): MenuItem[] {
  const tope = PAGINAS_FALLBACK.filter((p) => p.parentSlug === null && p.enMenu)
    .slice()
    .sort((a, b) => a.orden - b.orden);
  return tope.map((p) => ({
    id: p.id,
    slug: p.slug,
    titulo: p.titulo,
    etiquetaMenu: p.etiquetaMenu ?? p.titulo,
    tipo: p.tipo,
    esGrupoMenu: p.esGrupoMenu,
    hijos: PAGINAS_FALLBACK.filter((c) => c.parentSlug === p.slug)
      .slice()
      .sort((a, b) => a.orden - b.orden)
      .map((c) => ({
        id: c.id,
        slug: c.slug,
        titulo: c.titulo,
        etiquetaMenu: c.etiquetaMenu ?? c.titulo,
        tipo: c.tipo,
        esGrupoMenu: c.esGrupoMenu,
        hijos: [],
      })),
  }));
}

function fbPagina(slug: string): Pagina | null {
  const p = fbPaginaActiva(slug);
  if (!p) return null;
  return {
    id: p.id,
    slug: p.slug,
    titulo: p.titulo,
    tipo: p.tipo,
    seoTitulo: null,
    seoDescripcion: null,
    imagenPortada: p.imagenPortada,
    secciones: p.secciones
      .slice()
      .sort((a, b) => a.orden - b.orden)
      .map((s) => ({
        id: s.id,
        tipo: s.tipo,
        orden: s.orden,
        datos: s.datos,
      })),
  };
}

function fbHijos(slug: string): PaginaHijo[] {
  return PAGINAS_FALLBACK.filter((c) => c.parentSlug === slug)
    .slice()
    .sort((a, b) => a.orden - b.orden)
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      titulo: c.titulo,
      imagenPortada: c.imagenPortada,
    }));
}

// ── getMenu: árbol de navegación ────────────────────────────────────────────
export async function getMenu(): Promise<MenuItem[]> {
  try {
    const sb = await createClient();
    const { data, error } = await sb
      .from("web_paginas")
      .select(
        "id, parent_id, slug, titulo, etiqueta_menu, tipo, es_grupo_menu, en_menu, activo, orden"
      )
      .eq("en_menu", true)
      .eq("activo", true)
      .order("orden", { ascending: true });
    if (error || !data || data.length === 0) return fbMenu();

    const byId = new Map<number, MenuItem>();
    for (const r of data) {
      byId.set(r.id, {
        id: r.id,
        slug: r.slug,
        titulo: r.titulo,
        etiquetaMenu: r.etiqueta_menu ?? r.titulo,
        tipo: (r.tipo as PaginaTipo) ?? "generica",
        esGrupoMenu: !!r.es_grupo_menu,
        hijos: [],
      });
    }
    const raiz: MenuItem[] = [];
    for (const r of data) {
      const item = byId.get(r.id)!;
      if (r.parent_id && byId.has(r.parent_id)) {
        byId.get(r.parent_id)!.hijos.push(item);
      } else if (!r.parent_id) {
        raiz.push(item);
      }
      // Si parent_id existe pero el padre no está en el menú, se omite del árbol.
    }
    return raiz;
  } catch {
    return fbMenu();
  }
}

// ── getPagina: página activa + secciones visibles (home = slug 'inicio') ─────
export async function getPagina(slug: string): Promise<Pagina | null> {
  const realSlug = slug === "/" || slug === "" ? "inicio" : slug;
  try {
    const sb = await createClient();
    const { data: pagina, error } = await sb
      .from("web_paginas")
      .select(
        "id, slug, titulo, tipo, seo_titulo, seo_descripcion, imagen_portada, activo"
      )
      .eq("slug", realSlug)
      .eq("activo", true)
      .maybeSingle();
    if (error || !pagina) return fbPagina(realSlug);

    const { data: secciones } = await sb
      .from("web_secciones")
      .select("id, tipo, orden, datos, visible")
      .eq("pagina_id", pagina.id)
      .eq("visible", true)
      .order("orden", { ascending: true });

    return {
      id: pagina.id,
      slug: pagina.slug,
      titulo: pagina.titulo,
      tipo: (pagina.tipo as PaginaTipo) ?? "generica",
      seoTitulo: pagina.seo_titulo,
      seoDescripcion: pagina.seo_descripcion,
      imagenPortada: pagina.imagen_portada,
      secciones: (secciones ?? []).map((s) => ({
        id: s.id,
        tipo: (s.tipo as SeccionTipo) ?? "texto",
        orden: s.orden,
        datos: parseDatos(s.datos),
      })),
    };
  } catch {
    return fbPagina(realSlug);
  }
}

// ── getHijos: subpáginas de un padre (para destinos_grid) ────────────────────
export async function getHijos(slug: string): Promise<PaginaHijo[]> {
  try {
    const sb = await createClient();
    const { data: padre, error } = await sb
      .from("web_paginas")
      .select("id")
      .eq("slug", slug)
      .eq("activo", true)
      .maybeSingle();
    if (error || !padre) return fbHijos(slug);

    const { data: hijos } = await sb
      .from("web_paginas")
      .select("id, slug, titulo, imagen_portada, activo, orden")
      .eq("parent_id", padre.id)
      .eq("activo", true)
      .order("orden", { ascending: true });
    if (!hijos || hijos.length === 0) return fbHijos(slug);
    return hijos.map((c) => ({
      id: c.id,
      slug: c.slug,
      titulo: c.titulo,
      imagenPortada: c.imagen_portada,
    }));
  } catch {
    return fbHijos(slug);
  }
}
