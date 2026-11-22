"use server";

// #32 — Logo del aliado desde «Mi perfil». La ficha sale de la SESIÓN (nunca del formulario) y exige la misma elegibilidad que editar la ficha (#25).
// El tipo REAL del archivo se valida por sus bytes (PNG/JPG, ≤ 1 MB); la base vuelve a verificar al actor.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aliadoQueCambiaLogo } from "@/lib/aliados/logoAcceso";
import { MAX_LOGO_BYTES } from "@/lib/aliados/logo";
import { guardarLogo, retirarLogo, type AdminLogo, type RespuestaLogo } from "@/lib/aliados/logoServidor";

const RUTA = "/portal/b2b/perfil";

async function sesion() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  const admin = createAdminClient();
  const a = await aliadoQueCambiaLogo(admin as never, user?.id);
  return { user, admin, a };
}

export async function subirLogoPortal(fd: FormData): Promise<RespuestaLogo> {
  const { user, admin, a } = await sesion();
  if (!a.ok || !user) return { ok: false, error: a.ok ? "Inicia sesión para continuar." : a.error };
  const f = fd.get("logo");
  if (!(f instanceof File)) return { ok: false, error: "Elige una imagen." };
  if (f.size > MAX_LOGO_BYTES) return { ok: false, error: "El logo no puede superar 1 MB." }; // antes de leerlo a memoria
  const r = await guardarLogo(admin as unknown as AdminLogo, { actorId: user.id, aliadoId: a.aliadoId, bytes: new Uint8Array(await f.arrayBuffer()) });
  if (r.ok) revalidatePath(RUTA);
  return r;
}

export async function retirarLogoPortal(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, admin, a } = await sesion();
  if (!a.ok || !user) return { ok: false, error: a.ok ? "Inicia sesión para continuar." : a.error };
  const r = await retirarLogo(admin as unknown as AdminLogo, { actorId: user.id, aliadoId: a.aliadoId });
  if (r.ok) revalidatePath(RUTA);
  return r;
}
