"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

// Re-valida superadmin del lado server (mismo patrón que actions.ts).
async function exigirSuperadmin(): Promise<{ ok: true } | { ok: false; error: string }> {
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
    return { ok: false, error: "Solo el superadmin puede subir archivos." };
  return { ok: true };
}

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const TIPOS_OK = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
]);

// Limpia el nombre de archivo para una key segura en Storage.
function limpiarNombre(nombre: string): string {
  return (nombre || "archivo")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "archivo";
}

// Sube un archivo (imagen o pdf) al bucket 'web-cms' y devuelve su URL pública.
// `carpeta` ubica el archivo (p. ej. "flyers" o "img").
export async function subirArchivoWeb(formData: FormData): Promise<UploadResult> {
  const auth = await exigirSuperadmin();
  if (!auth.ok) return auth;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "No se recibió ningún archivo." };
  if (file.size > MAX_BYTES)
    return { ok: false, error: "El archivo supera el máximo de 15 MB." };
  if (!TIPOS_OK.has(file.type))
    return { ok: false, error: "Solo se permiten imágenes (JPG/PNG/WEBP/GIF/AVIF) o PDF." };

  const carpetaRaw = formData.get("carpeta");
  const carpeta =
    typeof carpetaRaw === "string" && /^[a-z0-9_-]+$/.test(carpetaRaw)
      ? carpetaRaw
      : "img";

  const key = `${carpeta}/${Date.now()}-${limpiarNombre(file.name)}`;

  const admin = createAdminClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from("web-cms").upload(key, buffer, {
    contentType: file.type,
    upsert: false,
  });
  if (error) return { ok: false, error: error.message };

  const { data } = admin.storage.from("web-cms").getPublicUrl(key);
  return { ok: true, url: data.publicUrl };
}
