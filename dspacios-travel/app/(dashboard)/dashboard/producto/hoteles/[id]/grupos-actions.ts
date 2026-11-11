"use server";

// #43/#60 incremento 3 — Acciones del editor de grupos de días (preparación INACTIVA).
// Cada acción hace EXACTAMENTE una llamada RPC (migración 295). No se llama `revalidatePath` ni se
// regenera el tarifario: nada de esto cambia precios ni lo que hoy se vende; el panel actualiza su
// estado con la configuración que devuelve la propia RPC. Sin reintentos: una confirmación obsoleta
// (SQLSTATE PT409) se devuelve como `desactualizada` y el usuario recarga a mano.
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import { esDesactualizada, payloadFilas, type ConfigGrupos, type FilaPropuesta, type GrupoEditado, type ModoPropuesta } from "@/lib/hoteles/alcanceGrupos";

export type ResultadoGrupos<T = object> =
  | ({ ok: true; config: ConfigGrupos } & T)
  | { ok: false; error: string; desactualizada?: true };

type ErrorRpc = { code?: string | null; message?: string | null } | null;
function fallo(error: ErrorRpc): { ok: false; error: string; desactualizada?: true } {
  if (esDesactualizada(error)) {
    return { ok: false, desactualizada: true, error: "La configuración de esta vigencia cambió desde que la abriste. Recarga y revisa de nuevo antes de confirmar." };
  }
  return { ok: false, error: (error?.message ?? "No se pudo completar la operación.").replace(/^CONFIG_DESACTUALIZADA:\s*/, "") };
}
const idValido = (n: unknown) => Number.isInteger(n) && (n as number) > 0;

export async function leerConfigGrupos(temporadaId: number): Promise<ResultadoGrupos> {
  if (!idValido(temporadaId)) return { ok: false, error: "Vigencia no válida." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("grupos_dias_config", { p_temporada_id: temporadaId });
  if (error || !data) return fallo(error);
  return { ok: true, config: data as unknown as ConfigGrupos };
}

export async function guardarGruposVigencia(temporadaId: number, huella: string, grupos: GrupoEditado[]): Promise<ResultadoGrupos<{ altas: number; cambios: number }>> {
  if (!idValido(temporadaId) || typeof huella !== "string" || !Array.isArray(grupos)) return { ok: false, error: "Datos no válidos." };
  const payload = grupos.map((g) => ({ ...(g.id ? { id: g.id } : {}), nombre: String(g.nombre ?? "").trim(), dias: (g.dias ?? []).map(Number) }));
  const sb = await createClient();
  const { data, error } = await sb.rpc("grupos_dias_guardar", { p_temporada_id: temporadaId, p_huella: huella, p_grupos: payload });
  if (error || !data) return fallo(error);
  const r = data as unknown as { altas: number; cambios: number; config: ConfigGrupos };
  return { ok: true, altas: r.altas, cambios: r.cambios, config: r.config };
}

export async function guardarPropuestaGrupos(
  temporadaId: number, huella: string, modo: ModoPropuesta, grupoId: string | null, filas: FilaPropuesta[],
): Promise<ResultadoGrupos<{ nuevas: number; actualizadas: number; eliminadas: number }>> {
  if (!idValido(temporadaId) || typeof huella !== "string" || !Array.isArray(filas)) return { ok: false, error: "Datos no válidos." };
  if (!["actualizar", "reemplazar_grupo", "reemplazar_vigencia"].includes(modo)) return { ok: false, error: "Modo no válido." };
  // El MISMO payload que describe la vista previa (lib/hoteles/alcanceGrupos.ts › payloadFilas).
  const payload = payloadFilas(filas);
  const sb = await createClient();
  const { data, error } = await sb.rpc("grupos_dias_guardar_propuesta", {
    p_temporada_id: temporadaId, p_huella: huella, p_modo: modo, p_grupo_id: modo === "reemplazar_grupo" ? grupoId : null, p_filas: payload as unknown as Json,
  });
  if (error || !data) return fallo(error);
  const r = data as unknown as { nuevas: number; actualizadas: number; eliminadas: number; config: ConfigGrupos };
  return { ok: true, nuevas: r.nuevas, actualizadas: r.actualizadas, eliminadas: r.eliminadas, config: r.config };
}

export async function borrarGrupoDias(grupoId: string, huella: string): Promise<ResultadoGrupos<{ propuestasEliminadas: number }>> {
  if (typeof grupoId !== "string" || !grupoId || typeof huella !== "string") return { ok: false, error: "Datos no válidos." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("grupos_dias_borrar", { p_grupo_id: grupoId, p_huella: huella });
  if (error || !data) return fallo(error);
  const r = data as unknown as { propuestas_eliminadas: number; config: ConfigGrupos };
  return { ok: true, propuestasEliminadas: r.propuestas_eliminadas, config: r.config };
}
