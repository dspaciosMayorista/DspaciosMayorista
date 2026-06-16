// ─────────────────────────────────────────────────────────────────────────
// Capa de lectura del SITIO WEB público.
//
// Lee el contenido editable desde Supabase (tablas web_*) y lo devuelve en la
// MISMA FORMA EN INGLÉS que ya consumen los componentes de components/sitio/
// (mapea columnas español → inglés). Así no hay que tocar los campos que leen.
//
// Robustez: si la consulta falla o devuelve 0 filas (p. ej. la migración 078
// aún no se corrió), hace FALLBACK a los arrays estáticos de lib/sitio/data.js.
// El sitio nunca se ve vacío.
// ─────────────────────────────────────────────────────────────────────────
import { createClient } from "@/lib/supabase/server";
import {
  packages as estPackages,
  destinations as estDestinations,
  testimonials as estTestimonials,
  blogPosts as estBlogPosts,
} from "@/lib/sitio/data";

// ── Tipos de salida (forma EN inglés que consumen los componentes) ──────────
export type SitioPaquete = {
  id: number | string;
  title: string;
  region: string;
  destination: string;
  duration: string;
  people: string;
  priceFrom: string;
  description: string;
  longDescription: string;
  includes: string[];
  notIncludes: string[];
  image: string;
  gallery: string[];
  featured: boolean;
  ctaUrl: string;
};

export type SitioDestino = {
  id: number | string;
  name: string;
  region: string;
  image: string;
  tips: string[];
};

export type SitioTestimonio = {
  id: number | string;
  name: string;
  location: string;
  rating: number;
  comment: string;
  image: string;
};

export type SitioBlog = {
  id: number | string;
  title: string;
  slug: string | null;
  category: string;
  date: string;
  summary: string;
  content: string;
  image: string;
};

export type SitioConfig = {
  heroTitulo: string | null;
  heroSubtitulo: string | null;
  heroImagenUrl: string | null;
  heroCtaTexto: string | null;
  heroCtaUrl: string | null;
  nosotrosTitulo: string | null;
  nosotrosTexto: string | null;
  nosotrosImagenUrl: string | null;
  contactoEmail: string | null;
  contactoTelefono: string | null;
  whatsappNumero: string | null;
  whatsappMensaje: string | null;
  direccion: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
  // Campos extra guardados dentro de web_config.extra (jsonb) — sin migración nueva.
  youtubeUrl: string | null;
  telefonoFijo: string | null;
  lineasAtencion: string[]; // teléfonos para la barra superior de "Líneas de Atención"
};

// ── Mapeo estático → forma inglesa (fallback) ───────────────────────────────
function fbPaquetes(): SitioPaquete[] {
  return estPackages.map((p) => ({
    id: p.id,
    title: p.title,
    region: p.region,
    destination: p.destination,
    duration: p.duration,
    people: p.people,
    priceFrom: p.priceFrom,
    description: p.description,
    longDescription: p.longDescription,
    includes: p.includes ?? [],
    notIncludes: p.notIncludes ?? [],
    image: p.image,
    gallery: p.gallery ?? [],
    featured: !!p.featured,
    ctaUrl: "/tarifario",
  }));
}

function fbDestinos(): SitioDestino[] {
  return estDestinations.map((d) => ({
    id: d.id,
    name: d.name,
    region: d.region,
    image: d.image,
    tips: d.tips ?? [],
  }));
}

function fbTestimonios(): SitioTestimonio[] {
  return estTestimonials.map((t) => ({
    id: t.id,
    name: t.name,
    location: t.location,
    rating: t.rating,
    comment: t.comment,
    image: t.image,
  }));
}

function fbBlog(): SitioBlog[] {
  return estBlogPosts.map((b) => ({
    id: b.id,
    title: b.title,
    slug: null,
    category: b.category,
    date: b.date,
    summary: b.summary,
    content: b.content,
    image: b.image,
  }));
}

const CONFIG_FALLBACK: SitioConfig = {
  heroTitulo: null,
  heroSubtitulo: null,
  heroImagenUrl: null,
  heroCtaTexto: null,
  heroCtaUrl: null,
  nosotrosTitulo: null,
  nosotrosTexto: null,
  nosotrosImagenUrl: null,
  contactoEmail: null,
  contactoTelefono: null,
  whatsappNumero: null,
  whatsappMensaje: null,
  direccion: null,
  instagramUrl: null,
  facebookUrl: null,
  tiktokUrl: null,
  youtubeUrl: null,
  telefonoFijo: null,
  lineasAtencion: [],
};

// Normaliza el valor de extra.lineas_atencion (acepta array o texto con saltos/comas).
function parseLineasAtencion(v: unknown): string[] {
  if (Array.isArray(v))
    return v.map((x) => String(x).trim()).filter((x) => x.length > 0);
  if (typeof v === "string")
    return v
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  return [];
}

// ── Lectura desde Supabase con fallback centralizado ────────────────────────
export async function getPaquetes(): Promise<SitioPaquete[]> {
  try {
    const sb = await createClient();
    const { data, error } = await sb
      .from("web_paquetes")
      .select("*")
      .eq("activo", true)
      .order("orden", { ascending: true });
    if (error || !data || data.length === 0) return fbPaquetes();
    return data.map((p) => ({
      id: p.id,
      title: p.titulo,
      region: p.region ?? "",
      destination: p.destino ?? "",
      duration: p.duracion ?? "",
      people: p.personas ?? "",
      priceFrom: p.precio_desde ?? "",
      description: p.descripcion ?? "",
      longDescription: p.descripcion_larga ?? "",
      includes: p.incluye ?? [],
      notIncludes: p.no_incluye ?? [],
      image: p.imagen_url ?? "",
      gallery: p.galeria ?? [],
      featured: !!p.destacado,
      ctaUrl: p.cta_url || "/tarifario",
    }));
  } catch {
    return fbPaquetes();
  }
}

export async function getPaquete(id: string): Promise<SitioPaquete | null> {
  const items = await getPaquetes();
  return items.find((p) => String(p.id) === String(id)) ?? null;
}

export async function getDestinos(): Promise<SitioDestino[]> {
  try {
    const sb = await createClient();
    const { data, error } = await sb
      .from("web_destinos")
      .select("*")
      .eq("activo", true)
      .order("orden", { ascending: true });
    if (error || !data || data.length === 0) return fbDestinos();
    return data.map((d) => ({
      id: d.id,
      name: d.nombre,
      region: d.region ?? "",
      image: d.imagen_url ?? "",
      tips: d.tips ?? [],
    }));
  } catch {
    return fbDestinos();
  }
}

export async function getDestino(id: string): Promise<SitioDestino | null> {
  const items = await getDestinos();
  return items.find((d) => String(d.id) === String(id)) ?? null;
}

export async function getTestimonios(): Promise<SitioTestimonio[]> {
  try {
    const sb = await createClient();
    const { data, error } = await sb
      .from("web_testimonios")
      .select("*")
      .eq("activo", true)
      .order("orden", { ascending: true });
    if (error || !data || data.length === 0) return fbTestimonios();
    return data.map((t) => ({
      id: t.id,
      name: t.nombre,
      location: t.ubicacion ?? "",
      rating: t.rating,
      comment: t.comentario,
      image: t.imagen_url ?? "",
    }));
  } catch {
    return fbTestimonios();
  }
}

export async function getBlog(): Promise<SitioBlog[]> {
  try {
    const sb = await createClient();
    const { data, error } = await sb
      .from("web_blog")
      .select("*")
      .eq("activo", true)
      .order("orden", { ascending: true });
    if (error || !data || data.length === 0) return fbBlog();
    return data.map((b) => ({
      id: b.id,
      title: b.titulo,
      slug: b.slug,
      category: b.categoria ?? "",
      date: b.fecha ?? "",
      summary: b.resumen ?? "",
      content: b.contenido ?? "",
      image: b.imagen_url ?? "",
    }));
  } catch {
    return fbBlog();
  }
}

export async function getBlogPost(id: string): Promise<SitioBlog | null> {
  const items = await getBlog();
  return (
    items.find((b) => String(b.id) === String(id) || (b.slug && b.slug === id)) ??
    null
  );
}

export async function getConfig(): Promise<SitioConfig> {
  try {
    const sb = await createClient();
    const { data, error } = await sb
      .from("web_config")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return { ...CONFIG_FALLBACK };
    const extra = (data.extra ?? {}) as Record<string, unknown>;
    return {
      heroTitulo: data.hero_titulo,
      heroSubtitulo: data.hero_subtitulo,
      heroImagenUrl: data.hero_imagen_url,
      heroCtaTexto: data.hero_cta_texto,
      heroCtaUrl: data.hero_cta_url,
      nosotrosTitulo: data.nosotros_titulo,
      nosotrosTexto: data.nosotros_texto,
      nosotrosImagenUrl: data.nosotros_imagen_url,
      contactoEmail: data.contacto_email,
      contactoTelefono: data.contacto_telefono,
      whatsappNumero: data.whatsapp_numero,
      whatsappMensaje: data.whatsapp_mensaje,
      direccion: data.direccion,
      instagramUrl: data.instagram_url,
      facebookUrl: data.facebook_url,
      tiktokUrl: data.tiktok_url,
      youtubeUrl:
        typeof extra.youtube_url === "string" ? extra.youtube_url : null,
      telefonoFijo:
        typeof extra.telefono_fijo === "string" ? extra.telefono_fijo : null,
      lineasAtencion: parseLineasAtencion(extra.lineas_atencion),
    };
  } catch {
    return { ...CONFIG_FALLBACK };
  }
}
