// #13 — Generación diaria de los avisos de compra por vencer (campana de la aplicación). Delgada a propósito: toda la lógica (ventanas elegibles, destinatarios, un solo aviso por evento, archivo de lo que ya no aplica)
// vive en la función de base `generar_avisos_compra` (migración 343): una sentencia, idempotente, con un tope de TRABAJO por llamada (500 avisos creados y 500 archivados) pero con PROGRESO — solo toma lo que aún falta,
// así que llamarla otra vez avanza en vez de repetir lo hecho (B3-3). Aquí solo se repite la llamada, con un tope de pasadas, hasta que no quede nada pendiente o una pasada ya no avance.
import { createAdminClient } from "@/lib/supabase/admin";

type Pasada = { hoy: string; dias: number; ventanas: number; creados: number; archivados: number; pendientes: number; truncado: boolean };
export type ResultadoGeneracionCompra =
  | { ok: true; hoy: string; dias: number; ventanas: number; creados: number; archivados: number; pendientes: number; truncado: boolean; pasadas: number }
  | { ok: false; error: string };

/** Tope de pasadas por ejecución diaria: 20 × 500 = 10.000 avisos creados (y otros tantos archivados) como máximo; lo que sobre queda en `pendientes` y lo toma la ejecución siguiente. */
export const MAX_PASADAS_COMPRA = 20;

/** Repite `llamar` mientras haya pendientes Y la pasada anterior haya hecho algo (si no avanzó, repetir sería un bucle). Pura respecto de la red: la llamada se inyecta. */
export async function generarAvisosCompraCon(llamar: () => Promise<{ data: unknown; error: { message: string } | null }>, maxPasadas = MAX_PASADAS_COMPRA): Promise<ResultadoGeneracionCompra> {
  let creados = 0, archivados = 0, pasadas = 0, ultima: Pasada | null = null;
  while (pasadas < maxPasadas) {
    const { data, error } = await llamar();
    if (error) return { ok: false, error: error.message };
    const p = data as Pasada; pasadas += 1; ultima = p;
    creados += p.creados; archivados += p.archivados;
    if (!(p.pendientes > 0) || p.creados + p.archivados === 0) break;
  }
  if (!ultima) return { ok: false, error: "Sin pasadas." };
  return { ok: true, hoy: ultima.hoy, dias: ultima.dias, ventanas: ultima.ventanas, creados, archivados, pendientes: ultima.pendientes, truncado: ultima.pendientes > 0, pasadas };
}

export async function generarAvisosCompra(): Promise<ResultadoGeneracionCompra> {
  try {
    const cliente = createAdminClient() as unknown as { rpc: (f: string) => Promise<{ data: unknown; error: { message: string } | null }> };
    return await generarAvisosCompraCon(() => cliente.rpc("generar_avisos_compra"));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudieron generar los avisos de compra." };
  }
}
