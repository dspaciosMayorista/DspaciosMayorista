"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseIdentidad, mensajeSiIdentidad, type IdentidadContrato } from "@/lib/contrato/identidad";
import { idsCxpMaterializadas, postearAsientosDeObligaciones } from "@/lib/reservar/asientosObligaciones";

/**
 * 288 (#75): reintenta la confirmación de un contrato PENDIENTE cuyos abonos ya alcanzan el mínimo (p. ej. pagos previos de una conversión, o un abono cuya
 * confirmación falló). Es la MISMA autorización de confirmar a mano (RPC INVOKER con la RLS de quien llama): no amplía quién confirma. Idempotente: si ya se confirmó
 * (otro proceso, otra pestaña) no materializa nada otra vez.
 */
export async function reintentarConfirmacionPago(numero: string, identidad: IdentidadContrato): Promise<{ ok: boolean; confirmada?: boolean; error?: string }> {
  const id = parseIdentidad(identidad);
  const sb = await createClient(id);
  const { data, error } = await sb.rpc("reintentar_confirmacion_pago", { p_numero: numero });
  if (error) return { ok: false, error: mensajeSiIdentidad(error) ?? "No se pudo confirmar el contrato todavía. Inténtalo de nuevo o pide a un administrador que lo confirme." };
  const r = (data ?? {}) as { confirmada?: boolean };
  await postearAsientosDeObligaciones(numero, idsCxpMaterializadas(data), id);
  revalidatePath(`/dashboard/contratos/${numero}`);
  revalidatePath("/dashboard/contratos");
  return { ok: true, confirmada: r.confirmada === true };
}
