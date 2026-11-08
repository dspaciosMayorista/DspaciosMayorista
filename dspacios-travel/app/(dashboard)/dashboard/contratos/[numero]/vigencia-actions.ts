"use server";

import { createClient } from "@/lib/supabase/server";
import { esUid } from "@/lib/contrato/identidad";

/**
 * Aviso de cortesía (#75): ¿el contrato que esta pantalla muestra sigue siendo el vigente con ese número?
 * Devuelve true/false, o null si no se pudo saber (error, sin sesión): ante la duda NO se avisa.
 * ⚠️ Esto NO protege nada: las escrituras las rechaza la base con la identidad que trae la pantalla (migración 284). Solo evita que
 * alguien siga trabajando sobre una pantalla de un contrato que ya no existe. Compara el uid que la pantalla YA tenía con el vigente;
 * jamás devuelve el uid vigente ni lo usa para sustituir la identidad de la pantalla.
 */
export async function contratoSigueVigente(numero: string, uid: string): Promise<boolean | null> {
  if (typeof numero !== "string" || !numero || !esUid(uid)) return null;
  try {
    const sb = await createClient(); // identidad:n/a — solo lectura de cortesía; no escribe ninguna tabla de contrato
    const { data, error } = await sb.rpc("contratos_identidades", { p_numeros: [numero] });
    if (error) return null;
    const fila = (data ?? [])[0] as { contrato_uid?: string } | undefined;
    return !!fila && fila.contrato_uid?.toLowerCase() === uid.toLowerCase();
  } catch {
    return null;
  }
}
