"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { parseExtracto } from "@/lib/contabilidad/extracto";

type Result = { ok: true; n?: number } | { ok: false; error: string };

// Importa el extracto pegado del Excel (texto crudo).
export async function importarExtracto(texto: string, anio?: number, cuenta?: string): Promise<Result> {
  const sb = await createClient();
  const { lineas } = parseExtracto(texto, anio);
  if (!lineas.length) return { ok: false, error: "No se detectaron movimientos. Pega las filas del extracto (fecha, descripción, valor)." };
  const { error } = await sb.from("conciliacion_extracto").insert(
    lineas.map((l) => ({
      fecha: l.fecha, descripcion: l.descripcion || null, valor: l.valor, saldo: l.saldo,
      periodo: l.periodo, cuenta: cuenta?.trim() || null,
    }))
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/conciliaciones");
  return { ok: true, n: lineas.length };
}

export async function eliminarLineaExtracto(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("conciliacion_extracto").delete().eq("id", id).is("conciliacion_id", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/conciliaciones");
  return { ok: true };
}

// Cruce MANUAL: N líneas de extracto contra M ítems del sistema. Las sumas
// (en valor absoluto) deben coincidir.
export async function cruzar(input: {
  extractoIds: number[];
  sistema: { ref: string; descripcion: string; fecha: string | null; valor: number }[];
  nota?: string;
}): Promise<Result> {
  const sb = await createClient();
  if (!input.extractoIds.length || !input.sistema.length) return { ok: false, error: "Selecciona al menos una línea de cada lado." };

  const { data: lineas } = await sb.from("conciliacion_extracto").select("id, valor, conciliacion_id").in("id", input.extractoIds);
  if (!lineas || lineas.length !== input.extractoIds.length) return { ok: false, error: "Alguna línea del extracto ya no existe." };
  if (lineas.some((l) => l.conciliacion_id != null)) return { ok: false, error: "Alguna línea ya está conciliada." };

  const totalExtracto = lineas.reduce((a, l) => a + Math.abs(Number(l.valor) || 0), 0);
  const totalSistema = input.sistema.reduce((a, s) => a + Math.abs(Number(s.valor) || 0), 0);
  if (Math.abs(totalExtracto - totalSistema) > 1) {
    return { ok: false, error: `Las sumas no coinciden: extracto ${totalExtracto.toLocaleString("es-CO")} vs sistema ${totalSistema.toLocaleString("es-CO")}.` };
  }

  const { data: conc, error: e1 } = await sb.from("conciliacion").insert({ nota: input.nota?.trim() || null, total: totalExtracto }).select("id").single();
  if (e1 || !conc) return { ok: false, error: e1?.message ?? "No se pudo crear el cruce." };

  const { error: e2 } = await sb.from("conciliacion_extracto").update({ conciliacion_id: conc.id }).in("id", input.extractoIds);
  if (e2) return { ok: false, error: e2.message };

  const { error: e3 } = await sb.from("conciliacion_sistema").insert(
    input.sistema.map((s) => ({ conciliacion_id: conc.id, ref: s.ref, descripcion: s.descripcion || null, fecha: s.fecha, valor: s.valor }))
  );
  if (e3) return { ok: false, error: e3.message };

  revalidatePath("/dashboard/contabilidad/conciliaciones");
  return { ok: true };
}

export async function deshacerCruce(conciliacionId: number): Promise<Result> {
  const sb = await createClient();
  await sb.from("conciliacion_extracto").update({ conciliacion_id: null }).eq("conciliacion_id", conciliacionId);
  const { error } = await sb.from("conciliacion").delete().eq("id", conciliacionId); // cascade borra conciliacion_sistema
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/contabilidad/conciliaciones");
  return { ok: true };
}
