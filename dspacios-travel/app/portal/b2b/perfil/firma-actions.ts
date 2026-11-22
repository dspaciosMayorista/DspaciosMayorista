"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cargarContextoEdicion } from "@/lib/portal/perfilEdicionServidor";
import { guardarFirmaServidor, type RespuestaFirma } from "@/lib/cuentaCobro/servidor";
import { TAM_MAX_FIRMA } from "@/lib/cuentaCobro/snapshot";

/** #98 — Sube la imagen de firma de la ficha del aliado freelance. La ficha sale de la sesión; del formulario solo se lee el archivo. */
export async function guardarFirma(form: FormData): Promise<RespuestaFirma> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Inicia sesión para subir tu firma." };
  const f = form?.get("firma");
  if (!(f instanceof File)) return { ok: false, error: "Elige una imagen de tu firma." };
  // Tope ANTES de leer el archivo a memoria; los bytes se vuelven a validar por contenido en el servidor.
  if (f.size > TAM_MAX_FIRMA) return { ok: false, error: "La imagen no puede superar 512 KB." };
  const admin = createAdminClient(); // identidad:n/a — tablas propias de #98 (sin número de contrato) y Storage
  const ctx = await cargarContextoEdicion(admin, user.id);
  const r = await guardarFirmaServidor(admin, user.id, ctx, { bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type || null });
  if (r.ok) revalidatePath("/portal/b2b/perfil");
  return r;
}
