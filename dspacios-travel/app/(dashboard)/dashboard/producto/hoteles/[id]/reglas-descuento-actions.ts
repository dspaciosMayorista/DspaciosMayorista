"use server";

// #90 — Promociones EBB / Long Stay de un hotel. Solo toca hotel_reglas_descuento: nunca las netas ni las temporadas.
// Permiso: rol de escritura de catálogo ("producto") verificado aquí además de la RLS de la 278 y del candado de las RPC (301).
// #43/#60 entrega 5 (301): guardar pasa por `regla_descuento_guardar`. Si el cambio crea combinaciones sin configurar con una
// promoción, queda RETENIDO (la versión autorizada sigue vendiéndose) y se devuelve qué promociones falta configurar.
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { puedeEscribir } from "@/lib/roles";
import { validarReglaDescuento, type EntradaRegla } from "@/lib/hoteles/reglasDescuento";

export type PendienteCombinacion = { promocion: string; faltan: ("ebb" | "long_stay")[] };
type Result = { ok: true; retenida?: PendienteCombinacion[] } | { ok: false; error: string };
const SIN_PERMISO = "No tienes permiso para administrar promociones de hoteles.";

async function autorizar(sb: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data: rol, error } = await sb.rpc("mi_rol");
  if (error) return "No se pudo verificar tu permiso. Intenta de nuevo.";
  return puedeEscribir("producto", (rol as string | null) ?? null) ? null : SIN_PERMISO;
}

function fallo(error: { code?: string; message?: string }): Result {
  console.error(`[hoteles/promociones] code=${error.code ?? "?"} message=${error.message ?? ""}`);
  if (error.code === "23505") return { ok: false, error: "Ya existe una promoción de ese tipo con ese mismo mínimo en este hotel." };
  if (error.code === "42501") return { ok: false, error: SIN_PERMISO };
  const m = error.message ?? "";
  if (error.code === "23514" && /^(COMBINACION_SIN_CONFIGURAR|CONTRADICCION_PROMOCIONES):/.test(m)) return { ok: false, error: m.replace(/^[A-Z_]+:\s*/, "") };
  if (error.code === "P0002" || error.code === "22023") return { ok: false, error: m };
  return { ok: false, error: "No se pudo guardar la promoción." };
}

const refrescar = (hotelId: number) => revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);

function resultadoRpc(data: unknown): Result {
  const r = (data ?? {}) as { estado?: string; pendientes?: PendienteCombinacion[] };
  return r.estado === "retenida" ? { ok: true, retenida: Array.isArray(r.pendientes) ? r.pendientes : [] } : { ok: true };
}

async function guardarRpc(sb: Awaited<ReturnType<typeof createClient>>, hotelId: number, id: number | null, regla: { tipo: string; umbral: number; pct: number; activa: boolean }): Promise<Result> {
  const { data, error } = await sb.rpc("regla_descuento_guardar", { p_hotel: hotelId, p_id: id, p_tipo: regla.tipo, p_umbral: regla.umbral, p_pct: regla.pct, p_activa: regla.activa });
  if (error) return fallo(error);
  refrescar(hotelId);
  return resultadoRpc(data);
}

export async function guardarReglaDescuento(input: { hotelId: number; id?: number } & EntradaRegla): Promise<Result> {
  const v = validarReglaDescuento(input);
  if (!v.ok) return v;
  if (!Number.isInteger(input.hotelId) || input.hotelId < 1) return { ok: false, error: "Hotel inválido." };
  const sb = await createClient();
  const sinPermiso = await autorizar(sb);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  // Duplicado (mismo tipo y mínimo) antes de escribir; la unique de la 278 lo respalda ante carreras.
  const { data: dup, error: eDup } = await sb.from("hotel_reglas_descuento").select("id").eq("hotel_id", input.hotelId).eq("tipo", v.regla.tipo).eq("umbral", v.regla.umbral);
  if (eDup) return fallo(eDup);
  if ((dup ?? []).some((r) => r.id !== input.id)) return fallo({ code: "23505" });
  // Editar no cambia si está activa (eso lo hace alternar); una regla nueva nace activa, como antes.
  let activa = true;
  if (input.id != null) {
    const { data: fila, error } = await sb.from("hotel_reglas_descuento").select("activa").eq("id", input.id).eq("hotel_id", input.hotelId).maybeSingle();
    if (error) return fallo(error);
    if (!fila) return { ok: false, error: "La promoción ya no existe." };
    activa = fila.activa;
  }
  return guardarRpc(sb, input.hotelId, input.id ?? null, { ...v.regla, activa });
}

export async function alternarReglaDescuento(id: number, hotelId: number, activa: boolean): Promise<Result> {
  const sb = await createClient();
  const sinPermiso = await autorizar(sb);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { data: fila, error } = await sb.from("hotel_reglas_descuento").select("tipo, umbral, pct").eq("id", id).eq("hotel_id", hotelId).maybeSingle();
  if (error) return fallo(error);
  if (!fila) return { ok: false, error: "La promoción ya no existe." };
  return guardarRpc(sb, hotelId, id, { tipo: fila.tipo, umbral: fila.umbral, pct: fila.pct, activa: !!activa });
}

/** Aplica un cambio retenido cuando ya están configuradas las combinaciones que faltaban. */
export async function aplicarReglaRetenida(id: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  const sinPermiso = await autorizar(sb);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { data, error } = await sb.rpc("regla_descuento_aplicar", { p_id: id });
  if (error) return fallo(error);
  refrescar(hotelId);
  return resultadoRpc(data);
}

/** Descarta un cambio retenido: la versión autorizada sigue igual (una regla nueva retenida se elimina). */
export async function descartarReglaRetenida(id: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  const sinPermiso = await autorizar(sb);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { error } = await sb.rpc("regla_descuento_descartar", { p_id: id });
  if (error) return fallo(error);
  refrescar(hotelId);
  return { ok: true };
}

export async function eliminarReglaDescuento(id: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  const sinPermiso = await autorizar(sb);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { error } = await sb.from("hotel_reglas_descuento").delete().eq("id", id).eq("hotel_id", hotelId);
  if (error) return fallo(error);
  refrescar(hotelId);
  return { ok: true };
}
