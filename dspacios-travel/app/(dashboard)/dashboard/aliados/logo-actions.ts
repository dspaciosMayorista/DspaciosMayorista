"use server";

// #32 — Logo de un aliado desde Aliados (interno). Solo superadmin y gerencia activos; el aliado es el elegido en la fila (id validado). La base vuelve a verificar al actor.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exigirEscrituraCatalogoGlobal } from "@/lib/auth/contextoAgencia";
import { aliadoIdValido, esPersonalLogo } from "@/lib/aliados/logoAcceso";
import { MAX_LOGO_BYTES } from "@/lib/aliados/logo";
import { guardarLogo, retirarLogo, type AdminLogo, type RespuestaLogo } from "@/lib/aliados/logoServidor";

async function autorizar(idCrudo: unknown): Promise<{ ok: true; userId: string; aliadoId: number } | { ok: false; error: string }> {
  const aliadoId = aliadoIdValido(idCrudo);
  if (aliadoId == null) return { ok: false, error: "Aliado inválido." };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "No autorizado." };
  const { data: perfil } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!esPersonalLogo(perfil)) return { ok: false, error: "Solo superadmin y gerencia cambian el logo de un aliado." };
  // El catálogo de aliados es global: se escribe desde Mayorista (misma guarda que crear/editar un aliado).
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  return { ok: true, userId: user.id, aliadoId };
}

export async function subirLogoAliadoInterno(fd: FormData): Promise<RespuestaLogo> {
  const a = await autorizar(fd.get("aliadoId"));
  if (!a.ok) return a;
  const f = fd.get("logo");
  if (!(f instanceof File)) return { ok: false, error: "Elige una imagen." };
  if (f.size > MAX_LOGO_BYTES) return { ok: false, error: "El logo no puede superar 1 MB." };
  const r = await guardarLogo(createAdminClient() as unknown as AdminLogo, { actorId: a.userId, aliadoId: a.aliadoId, bytes: new Uint8Array(await f.arrayBuffer()) });
  if (r.ok) revalidatePath("/dashboard/aliados");
  return r;
}

export async function retirarLogoAliadoInterno(aliadoId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await autorizar(aliadoId);
  if (!a.ok) return a;
  const r = await retirarLogo(createAdminClient() as unknown as AdminLogo, { actorId: a.userId, aliadoId: a.aliadoId });
  if (r.ok) revalidatePath("/dashboard/aliados");
  return r;
}
