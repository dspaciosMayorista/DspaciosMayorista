"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { eliminarArchivoYFila, type ResultadoOp } from "@/lib/adjuntos/operaciones";

type Result = ResultadoOp;
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

// Recibe SOLO el id. La ruta y el número de contrato se leen de la base con el
// cliente autenticado —o sea, pasando por RLS— y se usan esos, no los que
// mandó el navegador. Si la fila no es visible, se para antes de tocar Storage.
//
// Antes esto llamaba `remove()` y TIRABA el resultado, y borraba la fila igual.
// Si Storage rechazaba el borrado, la fila desaparecía de la pantalla y el
// archivo —una cédula, un soporte de pago— se quedaba en el bucket sin nada que
// lo referenciara: invisible e imborrable desde la interfaz. La orquestación (y
// el porqué del orden) está en `lib/adjuntos/operaciones.ts`, que es puro y
// tiene pruebas.
export async function eliminarAdjunto(id: number): Promise<Result> {
  const sb = await createClient();
  const r = await eliminarArchivoYFila(
    {
      buscarFila: async (idFila) =>
        await sb.from("contrato_adjuntos").select("path, numero_contrato").eq("id", idFila).maybeSingle(),
      eliminarArchivo: (paths) => sb.storage.from(BUCKET).remove(paths),
      // `.select("id")` NO es decorativo: PostgREST responde `error: null`
      // aunque la RLS filtre la fila y no borre nada. Sin el select no habría
      // forma de distinguir "borrado" de "no tocado".
      eliminarFila: async (idFila) =>
        await sb.from("contrato_adjuntos").delete().eq("id", idFila).select("id"),
    },
    { id }
  );
  if (!r.ok) return r;
  revalidatePath(`/dashboard/contratos/${r.numeroContrato}`);
  return { ok: true };
}
