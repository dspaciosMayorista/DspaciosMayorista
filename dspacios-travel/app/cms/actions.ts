"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Json } from "@/types/database";

type Result = { ok: true } | { ok: false; error: string };
type ResultId = { ok: true; id: number } | { ok: false; error: string };

const oNull = (s: string | null | undefined) =>
  s && s.trim() !== "" ? s.trim() : null;

// Tipos de página/sección válidos (espejo de la migración 079).
const TIPOS_PAGINA = [
  "home",
  "destinos_nacionales",
  "destinos_internacionales",
  "destino",
  "experiencias",
  "nosotros",
  "contacto",
  "blog",
  "generica",
] as const;
const TIPOS_SECCION = [
  "hero",
  "texto",
  "galeria",
  "destinos_grid",
  "experiencias",
  "testimonios",
  "blog_grid",
  "cta",
  "contacto",
  "actividades",
  "plan",
  "flyers",
  "consulta_disponibilidad",
] as const;

// Revalida el sitio público (home + slug afectado) y el propio CMS.
function revalidarSitio(slug?: string | null) {
  revalidatePath("/sitio_web", "layout");
  if (slug && slug !== "inicio") revalidatePath(`/sitio_web/${slug}`);
  revalidatePath("/cms");
}

// Re-valida el rol superadmin del lado server. No confiamos en la UI.
async function exigirSuperadmin(): Promise<
  | { ok: true; sb: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; error: string }
> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado." };
  const { data: perfil } = await sb
    .from("usuarios")
    .select("rol")
    .eq("id", user.id)
    .maybeSingle();
  if (perfil?.rol !== "superadmin")
    return { ok: false, error: "Solo el superadmin puede editar el sitio web." };
  return { ok: true, sb };
}

// Normaliza un slug: minúsculas, sin espacios ni caracteres raros. NO se permite
// "/" porque el sitio enruta cada página en un solo segmento (app/sitio_web/[slug]);
// un slug con "/" daría 404.
function normalizarSlug(raw: string): string {
  return (raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ───────────────────────── PÁGINAS ─────────────────────────
export type WebPaginaInput = {
  parent_id: number | null;
  slug: string;
  titulo: string;
  etiqueta_menu: string;
  tipo: string;
  es_grupo_menu: boolean;
  en_menu: boolean;
  seo_titulo: string;
  seo_descripcion: string;
  imagen_portada: string;
};

function paginaToRow(input: WebPaginaInput) {
  const tipo = (TIPOS_PAGINA as readonly string[]).includes(input.tipo)
    ? input.tipo
    : "generica";
  return {
    parent_id: input.parent_id ?? null,
    slug: normalizarSlug(input.slug),
    titulo: input.titulo.trim(),
    etiqueta_menu: oNull(input.etiqueta_menu),
    tipo,
    es_grupo_menu: !!input.es_grupo_menu,
    en_menu: !!input.en_menu,
    seo_titulo: oNull(input.seo_titulo),
    seo_descripcion: oNull(input.seo_descripcion),
    imagen_portada: oNull(input.imagen_portada),
  };
}

export async function crearPagina(input: WebPaginaInput): Promise<ResultId> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  if (!input.titulo.trim()) return { ok: false, error: "El título es obligatorio." };
  const row = paginaToRow(input);
  if (!row.slug) return { ok: false, error: "El slug es obligatorio." };

  // Próximo orden dentro del mismo padre.
  const q = auth.sb.from("web_paginas").select("orden");
  const { data: hermanos } = row.parent_id
    ? await q.eq("parent_id", row.parent_id)
    : await q.is("parent_id", null);
  const maxOrden = (hermanos ?? []).reduce(
    (m, r) => Math.max(m, r.orden ?? 0),
    -1
  );

  const { data, error } = await auth.sb
    .from("web_paginas")
    .insert({ ...row, orden: maxOrden + 1, activo: true })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidarSitio(row.slug);
  return { ok: true, id: data.id };
}

export async function actualizarPagina(
  id: number,
  input: WebPaginaInput
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const row = paginaToRow(input);
  if (!row.slug) return { ok: false, error: "El slug es obligatorio." };
  // No permitir que una página sea su propio padre.
  if (row.parent_id === id)
    return { ok: false, error: "Una página no puede ser su propia subpágina." };
  const { error } = await auth.sb
    .from("web_paginas")
    .update(row)
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio(row.slug);
  return { ok: true };
}

export async function eliminarPagina(id: number): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  // ON DELETE CASCADE borra subpáginas y secciones.
  const { error } = await auth.sb.from("web_paginas").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function togglePaginaActivo(
  id: number,
  activo: boolean
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb
    .from("web_paginas")
    .update({ activo })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function togglePaginaEnMenu(
  id: number,
  en_menu: boolean
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb
    .from("web_paginas")
    .update({ en_menu })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

// Mueve una página arriba/abajo dentro de sus hermanos (mismo parent).
export async function moverPagina(
  id: number,
  dir: "up" | "down"
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;

  const { data: actual } = await auth.sb
    .from("web_paginas")
    .select("id, parent_id, orden")
    .eq("id", id)
    .maybeSingle();
  if (!actual) return { ok: false, error: "Página no encontrada." };

  const base = auth.sb
    .from("web_paginas")
    .select("id, orden")
    .order("orden", { ascending: true });
  const { data: hermanos } = actual.parent_id
    ? await base.eq("parent_id", actual.parent_id)
    : await base.is("parent_id", null);
  const lista = hermanos ?? [];
  const idx = lista.findIndex((p) => p.id === id);
  const swapIdx = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= lista.length) return { ok: true };

  const a = lista[idx];
  const b = lista[swapIdx];
  const { error: e1 } = await auth.sb
    .from("web_paginas")
    .update({ orden: b.orden })
    .eq("id", a.id);
  if (e1) return { ok: false, error: e1.message };
  const { error: e2 } = await auth.sb
    .from("web_paginas")
    .update({ orden: a.orden })
    .eq("id", b.id);
  if (e2) {
    // Revierte el primer update para no dejar el orden inconsistente.
    await auth.sb.from("web_paginas").update({ orden: a.orden }).eq("id", a.id);
    return { ok: false, error: e2.message };
  }
  revalidarSitio();
  return { ok: true };
}

// ───────────────────────── SECCIONES ─────────────────────────
export async function crearSeccion(
  pagina_id: number,
  tipo: string
): Promise<ResultId> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  if (!(TIPOS_SECCION as readonly string[]).includes(tipo))
    return { ok: false, error: "Tipo de sección inválido." };

  const { data: hermanas } = await auth.sb
    .from("web_secciones")
    .select("orden")
    .eq("pagina_id", pagina_id);
  const maxOrden = (hermanas ?? []).reduce(
    (m, r) => Math.max(m, r.orden ?? 0),
    -1
  );

  const { data, error } = await auth.sb
    .from("web_secciones")
    .insert({ pagina_id, tipo, orden: maxOrden + 1, datos: {}, visible: true })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true, id: data.id };
}

export async function actualizarSeccion(
  id: number,
  datos: Record<string, unknown>
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb
    .from("web_secciones")
    .update({ datos: datos as Json })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function eliminarSeccion(id: number): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb.from("web_secciones").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function toggleSeccionVisible(
  id: number,
  visible: boolean
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb
    .from("web_secciones")
    .update({ visible })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

// Reordena TODAS las secciones de una página según el arreglo de ids recibido
// (page builder: drag-and-drop). Asigna orden = índice. Valida que los ids
// pertenezcan a la página.
export async function reordenarSecciones(
  pagina_id: number,
  ids: number[]
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;

  const { data: actuales } = await auth.sb
    .from("web_secciones")
    .select("id")
    .eq("pagina_id", pagina_id);
  const validos = new Set((actuales ?? []).map((s) => s.id));
  const orden = ids.filter((id) => validos.has(id));
  if (orden.length !== validos.size)
    return { ok: false, error: "La lista de secciones no coincide con la página." };

  for (let i = 0; i < orden.length; i++) {
    const { error } = await auth.sb
      .from("web_secciones")
      .update({ orden: i })
      .eq("id", orden[i])
      .eq("pagina_id", pagina_id);
    if (error) return { ok: false, error: error.message };
  }
  revalidarSitio();
  return { ok: true };
}

// Duplica una sección (mismo tipo y datos) al final de su página.
export async function duplicarSeccion(id: number): Promise<ResultId> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;

  const { data: orig } = await auth.sb
    .from("web_secciones")
    .select("pagina_id, tipo, datos, visible")
    .eq("id", id)
    .maybeSingle();
  if (!orig) return { ok: false, error: "Sección no encontrada." };

  const { data: hermanas } = await auth.sb
    .from("web_secciones")
    .select("orden")
    .eq("pagina_id", orig.pagina_id);
  const maxOrden = (hermanas ?? []).reduce((m, r) => Math.max(m, r.orden ?? 0), -1);

  const { data, error } = await auth.sb
    .from("web_secciones")
    .insert({
      pagina_id: orig.pagina_id,
      tipo: orig.tipo,
      datos: (orig.datos ?? {}) as Json,
      visible: orig.visible,
      orden: maxOrden + 1,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true, id: data.id };
}

export async function moverSeccion(
  id: number,
  dir: "up" | "down"
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;

  const { data: actual } = await auth.sb
    .from("web_secciones")
    .select("id, pagina_id, orden")
    .eq("id", id)
    .maybeSingle();
  if (!actual) return { ok: false, error: "Sección no encontrada." };

  const { data: hermanas } = await auth.sb
    .from("web_secciones")
    .select("id, orden")
    .eq("pagina_id", actual.pagina_id)
    .order("orden", { ascending: true });
  const lista = hermanas ?? [];
  const idx = lista.findIndex((s) => s.id === id);
  const swapIdx = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= lista.length) return { ok: true };

  const a = lista[idx];
  const b = lista[swapIdx];
  const { error: e1 } = await auth.sb
    .from("web_secciones")
    .update({ orden: b.orden })
    .eq("id", a.id);
  if (e1) return { ok: false, error: e1.message };
  const { error: e2 } = await auth.sb
    .from("web_secciones")
    .update({ orden: a.orden })
    .eq("id", b.id);
  if (e2) {
    // Revierte el primer update para no dejar el orden inconsistente.
    await auth.sb.from("web_secciones").update({ orden: a.orden }).eq("id", a.id);
    return { ok: false, error: e2.message };
  }
  revalidarSitio();
  return { ok: true };
}

// ───────────────────────── TESTIMONIOS ─────────────────────────
export type WebTestimonioInput = {
  nombre: string;
  ubicacion: string;
  rating: number;
  comentario: string;
  imagen_url: string;
  orden: number;
  activo: boolean;
};

function testimonioToRow(input: WebTestimonioInput) {
  const rating = Math.min(5, Math.max(1, Number(input.rating) || 5));
  return {
    nombre: input.nombre.trim(),
    ubicacion: oNull(input.ubicacion),
    rating,
    comentario: input.comentario.trim(),
    imagen_url: oNull(input.imagen_url),
    orden: Number(input.orden) || 0,
    activo: !!input.activo,
  };
}

export async function crearTestimonio(
  input: WebTestimonioInput
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  if (!input.comentario.trim())
    return { ok: false, error: "El comentario es obligatorio." };
  const { error } = await auth.sb
    .from("web_testimonios")
    .insert(testimonioToRow(input));
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function actualizarTestimonio(
  id: number,
  input: WebTestimonioInput
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb
    .from("web_testimonios")
    .update(testimonioToRow(input))
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function eliminarTestimonio(id: number): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb.from("web_testimonios").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function toggleActivoTestimonio(
  id: number,
  activo: boolean
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb
    .from("web_testimonios")
    .update({ activo })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

// ───────────────────────── BLOG ─────────────────────────
export type WebBlogInput = {
  titulo: string;
  slug: string;
  categoria: string;
  fecha: string;
  resumen: string;
  contenido: string;
  imagen_url: string;
  orden: number;
  activo: boolean;
};

function blogToRow(input: WebBlogInput) {
  return {
    titulo: input.titulo.trim(),
    slug: oNull(input.slug),
    categoria: oNull(input.categoria),
    fecha: oNull(input.fecha),
    resumen: oNull(input.resumen),
    contenido: oNull(input.contenido),
    imagen_url: oNull(input.imagen_url),
    orden: Number(input.orden) || 0,
    activo: !!input.activo,
  };
}

export async function crearBlog(input: WebBlogInput): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  if (!input.titulo.trim()) return { ok: false, error: "El título es obligatorio." };
  const { error } = await auth.sb.from("web_blog").insert(blogToRow(input));
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function actualizarBlog(
  id: number,
  input: WebBlogInput
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb
    .from("web_blog")
    .update(blogToRow(input))
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function eliminarBlog(id: number): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb.from("web_blog").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function toggleActivoBlog(
  id: number,
  activo: boolean
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb.from("web_blog").update({ activo }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

// ───────────────────────── CONFIG GLOBAL (fila única id=1) ─────────────────────────
export type WebConfigInput = {
  contacto_email: string;
  contacto_telefono: string;
  whatsapp_numero: string;
  whatsapp_mensaje: string;
  direccion: string;
  instagram_url: string;
  facebook_url: string;
  tiktok_url: string;
  youtube_url: string; // se guarda dentro de extra
};

export async function guardarConfig(input: WebConfigInput): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;

  // Preservar el resto de `extra` y guardar youtube allí.
  const { data: previo } = await auth.sb
    .from("web_config")
    .select("extra")
    .eq("id", 1)
    .maybeSingle();
  const extraBase =
    previo?.extra && typeof previo.extra === "object" && !Array.isArray(previo.extra)
      ? (previo.extra as Record<string, unknown>)
      : {};
  const extra = { ...extraBase, youtube_url: oNull(input.youtube_url) };

  const { error } = await auth.sb.from("web_config").upsert(
    {
      id: 1,
      contacto_email: oNull(input.contacto_email),
      contacto_telefono: oNull(input.contacto_telefono),
      whatsapp_numero: oNull(input.whatsapp_numero),
      whatsapp_mensaje: oNull(input.whatsapp_mensaje),
      direccion: oNull(input.direccion),
      instagram_url: oNull(input.instagram_url),
      facebook_url: oNull(input.facebook_url),
      tiktok_url: oNull(input.tiktok_url),
      extra: extra as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}
