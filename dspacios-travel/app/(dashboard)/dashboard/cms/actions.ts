"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

const oNull = (s: string | null | undefined) =>
  s && s.trim() !== "" ? s.trim() : null;

// Rutas del sitio público que dependen del CMS (se revalidan tras cada cambio).
function revalidarSitio() {
  revalidatePath("/");
  revalidatePath("/paquetes");
  revalidatePath("/destinos");
  revalidatePath("/testimonios");
  revalidatePath("/blog");
  revalidatePath("/dashboard/cms");
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

// Convierte un textarea (una línea por ítem) a text[].
function lineasAArray(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ───────────────────────── PAQUETES ─────────────────────────
export type WebPaqueteInput = {
  titulo: string;
  region: string;
  destino: string;
  duracion: string;
  personas: string;
  precio_desde: string;
  descripcion: string;
  descripcion_larga: string;
  incluye: string; // textarea (una línea por ítem)
  no_incluye: string;
  imagen_url: string;
  galeria: string; // textarea (una línea por URL)
  destacado: boolean;
  cta_url: string;
  orden: number;
  activo: boolean;
};

function paqueteToRow(input: WebPaqueteInput) {
  return {
    titulo: input.titulo.trim(),
    region: oNull(input.region),
    destino: oNull(input.destino),
    duracion: oNull(input.duracion),
    personas: oNull(input.personas),
    precio_desde: oNull(input.precio_desde),
    descripcion: oNull(input.descripcion),
    descripcion_larga: oNull(input.descripcion_larga),
    incluye: lineasAArray(input.incluye),
    no_incluye: lineasAArray(input.no_incluye),
    imagen_url: oNull(input.imagen_url),
    galeria: lineasAArray(input.galeria),
    destacado: !!input.destacado,
    cta_url: oNull(input.cta_url),
    orden: Number(input.orden) || 0,
    activo: !!input.activo,
  };
}

export async function crearPaquete(input: WebPaqueteInput): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  if (!input.titulo.trim()) return { ok: false, error: "El título es obligatorio." };
  const { error } = await auth.sb.from("web_paquetes").insert(paqueteToRow(input));
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function actualizarPaquete(
  id: number,
  input: WebPaqueteInput
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb
    .from("web_paquetes")
    .update(paqueteToRow(input))
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function eliminarPaquete(id: number): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb.from("web_paquetes").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function toggleActivoPaquete(
  id: number,
  activo: boolean
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb
    .from("web_paquetes")
    .update({ activo })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

// ───────────────────────── DESTINOS ─────────────────────────
export type WebDestinoInput = {
  nombre: string;
  region: string;
  imagen_url: string;
  tips: string; // textarea
  orden: number;
  activo: boolean;
};

function destinoToRow(input: WebDestinoInput) {
  return {
    nombre: input.nombre.trim(),
    region: oNull(input.region),
    imagen_url: oNull(input.imagen_url),
    tips: lineasAArray(input.tips),
    orden: Number(input.orden) || 0,
    activo: !!input.activo,
  };
}

export async function crearDestino(input: WebDestinoInput): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const { error } = await auth.sb.from("web_destinos").insert(destinoToRow(input));
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function actualizarDestino(
  id: number,
  input: WebDestinoInput
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb
    .from("web_destinos")
    .update(destinoToRow(input))
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function eliminarDestino(id: number): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb.from("web_destinos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}

export async function toggleActivoDestino(
  id: number,
  activo: boolean
): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb
    .from("web_destinos")
    .update({ activo })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
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

// ───────────────────────── CONFIG (fila única id=1) ─────────────────────────
export type WebConfigInput = {
  hero_titulo: string;
  hero_subtitulo: string;
  hero_imagen_url: string;
  hero_cta_texto: string;
  hero_cta_url: string;
  nosotros_titulo: string;
  nosotros_texto: string;
  nosotros_imagen_url: string;
  contacto_email: string;
  contacto_telefono: string;
  whatsapp_numero: string;
  whatsapp_mensaje: string;
  direccion: string;
  instagram_url: string;
  facebook_url: string;
  tiktok_url: string;
};

export async function guardarConfig(input: WebConfigInput): Promise<Result> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;
  const { error } = await auth.sb.from("web_config").upsert(
    {
      id: 1,
      hero_titulo: oNull(input.hero_titulo),
      hero_subtitulo: oNull(input.hero_subtitulo),
      hero_imagen_url: oNull(input.hero_imagen_url),
      hero_cta_texto: oNull(input.hero_cta_texto),
      hero_cta_url: oNull(input.hero_cta_url),
      nosotros_titulo: oNull(input.nosotros_titulo),
      nosotros_texto: oNull(input.nosotros_texto),
      nosotros_imagen_url: oNull(input.nosotros_imagen_url),
      contacto_email: oNull(input.contacto_email),
      contacto_telefono: oNull(input.contacto_telefono),
      whatsapp_numero: oNull(input.whatsapp_numero),
      whatsapp_mensaje: oNull(input.whatsapp_mensaje),
      direccion: oNull(input.direccion),
      instagram_url: oNull(input.instagram_url),
      facebook_url: oNull(input.facebook_url),
      tiktok_url: oNull(input.tiktok_url),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) return { ok: false, error: error.message };
  revalidarSitio();
  return { ok: true };
}
