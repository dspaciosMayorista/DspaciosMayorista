// O-3 — lectura de la evidencia previa del aliado para el PERSONAL. Se lee con la SESIÓN de quien mira: la RLS de `cotizacion_evidencias` (325) decide qué ve cada rol y agencia;
// si no ve nada, no se muestra nada (nunca se deduce nada por rol aquí). Lecturas por vista: 1 a 3 consultas acotadas por id/número, sin sondeos.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenciaInterna } from "@/components/cotizacion/EvidenciaAliadoPanel";

type Cualquiera = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- tablas nuevas (325) aún fuera de types/database.ts

/** Evidencias (vigentes y retiradas) de las cotizaciones dadas, y el código de cada una. */
export async function cargarEvidenciaAliado(sb: SupabaseClient, ids: number[]): Promise<{ evidencias: EvidenciaInterna[]; codigos: Record<number, string> }> {
  if (ids.length === 0) return { evidencias: [], codigos: {} };
  const db = sb as unknown as Cualquiera;
  const { data } = await db.from("cotizacion_evidencias").select("id, cotizacion_id, nombre_original, mime, size_bytes, subido_en, vigente, retirado_en").in("cotizacion_id", ids).order("id", { ascending: true });
  const evidencias = (data ?? []) as EvidenciaInterna[];
  if (evidencias.length === 0) return { evidencias, codigos: {} };
  const { data: cots } = await db.from("cotizaciones").select("id, codigo").in("id", [...new Set(evidencias.map((e) => e.cotizacion_id))]);
  return { evidencias, codigos: Object.fromEntries(((cots ?? []) as { id: number; codigo: string | null }[]).map((c) => [c.id, c.codigo ?? `#${c.id}`])) };
}

/** Cotizaciones de origen de un contrato: la que lo tiene como contrato principal y las del carrito que lo listan entre sus contratos. */
export async function cotizacionesDeContrato(sb: SupabaseClient, numero: string): Promise<number[]> {
  const db = sb as unknown as Cualquiera;
  const [a, b] = await Promise.all([
    db.from("cotizaciones").select("id").eq("numero_contrato", numero),
    db.from("cotizaciones").select("id").contains("detalle", { contratos: [numero] }),
  ]);
  return [...new Set([...((a.data ?? []) as { id: number }[]), ...((b.data ?? []) as { id: number }[])].map((f) => f.id))];
}
