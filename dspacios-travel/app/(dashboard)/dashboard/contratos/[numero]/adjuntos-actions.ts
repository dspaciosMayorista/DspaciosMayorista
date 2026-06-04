"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };
const BUCKET = "contratos";

// El cliente sube el archivo al bucket privado y aquí se registra la fila.
export async function registrarAdjunto(input: {
  numeroContrato: string; tipo: string; nombre: string; path: string; sizeBytes: number;
}): Promise<Result> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("nombre").eq("id", user.id).single() : { data: null };

  const { error } = await sb.from("contrato_adjuntos").insert({
    numero_contrato: input.numeroContrato,
    tipo: input.tipo || "otro",
    nombre: input.nombre || null,
    path: input.path,
    size_bytes: input.sizeBytes || null,
    subido_por: perfil?.nombre ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/contratos/${input.numeroContrato}`);
  return { ok: true };
}

// URL firmada temporal para descargar un adjunto del bucket privado.
export async function urlFirmadaAdjunto(path: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 120);
  if (error || !data) return { ok: false, error: error?.message ?? "No se pudo generar el enlace." };
  return { ok: true, url: data.signedUrl };
}

export async function eliminarAdjunto(id: number, path: string, numeroContrato: string): Promise<Result> {
  const sb = await createClient();
  await sb.storage.from(BUCKET).remove([path]);
  const { error } = await sb.from("contrato_adjuntos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/contratos/${numeroContrato}`);
  return { ok: true };
}
