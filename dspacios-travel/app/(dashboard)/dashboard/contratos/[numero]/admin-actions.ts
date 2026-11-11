"use server";

import { createClient } from "@/lib/supabase/server";
import { parseIdentidad, mensajeSiIdentidad, type IdentidadContrato } from "@/lib/contrato/identidad";
import { revalidatePath } from "next/cache";
import { codigosDeErrorReuso, describirBloqueosReuso, reusoSujetoAElegibilidad } from "@/lib/contrato/reciclaje";

// Solo superadmin. Borra el contrato (y sus hijas) y, si reusar=true, libera su
// consecutivo para que el siguiente contrato lo reutilice.
// Mayorista (DTM-, migración 287): la base solo libera el consecutivo de un contrato pendiente, nunca
// confirmado y vacío; si no cumple, rechaza SIN cambiar nada y aquí se traduce el motivo.
export async function eliminarContrato(numero: string, reusar: boolean, identidad: IdentidadContrato): Promise<{ ok: boolean; error?: string; motivos?: string[] }> {
  const sb = await createClient(parseIdentidad(identidad));
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (perfil?.rol !== "superadmin") return { ok: false, error: "Solo un superadmin puede eliminar contratos." };

  const { error } = await sb.rpc("eliminar_contrato", { p_numero: numero, p_reusar: reusar });
  if (error) {
    const codigos = codigosDeErrorReuso(error.message);
    if (codigos) {
      return {
        ok: false,
        error: "No se puede reutilizar el consecutivo de este contrato. No se cambió nada.",
        motivos: describirBloqueosReuso(codigos),
      };
    }
    return { ok: false, error: mensajeSiIdentidad(error) ?? error.message };
  }
  revalidatePath("/dashboard/contratos");
  return { ok: true };
}

// Vista previa (solo superadmin): ¿el consecutivo de este contrato DTM- se puede reutilizar? Devuelve los motivos
// que lo impiden; lista vacía = candidato que cumple las guardas. Ante cualquier fallo de lectura, bloquea.
// identidad:n/a — solo lectura (vista previa), no escribe tablas de contrato
export async function previsualizarReuso(numero: string): Promise<{ ok: boolean; aplica: boolean; motivos: string[]; error?: string }> {
  if (!reusoSujetoAElegibilidad(numero)) return { ok: true, aplica: false, motivos: [] };
  const sb = await createClient(); // identidad:n/a — solo lectura
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (perfil?.rol !== "superadmin") return { ok: false, aplica: true, motivos: [], error: "Solo un superadmin puede consultar la elegibilidad." };

  const { data, error } = await sb.rpc("contrato_reuso_preview", { p_numero: numero });
  if (error || !Array.isArray(data)) {
    return { ok: false, aplica: true, motivos: ["No se pudo comprobar la elegibilidad (se bloquea por seguridad)."], error: "No se pudo comprobar la elegibilidad." };
  }
  return { ok: true, aplica: true, motivos: describirBloqueosReuso(data as string[]) };
}
