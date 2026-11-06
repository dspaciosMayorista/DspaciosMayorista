"use server";

// #90 — Promociones EBB / Long Stay de un hotel. Solo toca hotel_reglas_descuento: nunca las netas ni las temporadas.
// Permiso: rol de escritura de catálogo ("producto") verificado aquí además de la RLS de la 278.
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { puedeEscribir } from "@/lib/roles";
import { validarReglaDescuento, type EntradaRegla } from "@/lib/hoteles/reglasDescuento";

type Result = { ok: true } | { ok: false; error: string };
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
  return { ok: false, error: "No se pudo guardar la promoción." };
}

const refrescar = (hotelId: number) => revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);

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
  if (input.id == null) {
    const { error } = await sb.from("hotel_reglas_descuento").insert({ hotel_id: input.hotelId, ...v.regla });
    if (error) return fallo(error);
  } else {
    const { data, error } = await sb.from("hotel_reglas_descuento").update(v.regla).eq("id", input.id).eq("hotel_id", input.hotelId).select("id");
    if (error) return fallo(error);
    if (!data?.length) return { ok: false, error: "La promoción ya no existe." };
  }
  refrescar(input.hotelId);
  return { ok: true };
}

export async function alternarReglaDescuento(id: number, hotelId: number, activa: boolean): Promise<Result> {
  const sb = await createClient();
  const sinPermiso = await autorizar(sb);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { data, error } = await sb.from("hotel_reglas_descuento").update({ activa: !!activa }).eq("id", id).eq("hotel_id", hotelId).select("id");
  if (error) return fallo(error);
  if (!data?.length) return { ok: false, error: "La promoción ya no existe." };
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
