"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true; id?: number } | { ok: false; error: string };
const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export async function crearHotel(input: {
  nombre: string;
  destinoId: number;
  proveedorId: number | null;
  zona: string;
  edadInfanteMin: number;
  edadInfanteMax: number;
  edadNinoMin: number;
  edadNinoMax: number;
  categoriaIds: number[];
  regimenIds: number[];
}): Promise<Result> {
  const sb = await createClient();
  const { data: hotel, error } = await sb
    .from("hoteles")
    .insert({
      nombre: input.nombre.trim(),
      destino_id: input.destinoId,
      proveedor_id: input.proveedorId,
      zona: oNull(input.zona),
      edad_infante_min: input.edadInfanteMin,
      edad_infante_max: input.edadInfanteMax,
      edad_nino_min: input.edadNinoMin,
      edad_nino_max: input.edadNinoMax,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  if (input.categoriaIds.length) {
    const { error: ce } = await sb.from("hotel_categorias").insert(
      input.categoriaIds.map((categoria_id) => ({ hotel_id: hotel.id, categoria_id }))
    );
    if (ce) return { ok: false, error: ce.message };
  }
  if (input.regimenIds.length) {
    const { error: re } = await sb.from("hotel_regimenes").insert(
      input.regimenIds.map((plan_id) => ({ hotel_id: hotel.id, plan_id }))
    );
    if (re) return { ok: false, error: re.message };
  }

  revalidatePath("/dashboard/producto/hoteles");
  return { ok: true, id: hotel.id };
}

export async function eliminarHotel(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("hoteles").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/hoteles");
  return { ok: true };
}

// ── Temporadas del hotel ──────────────────────────────────────────────────
export async function crearTemporada(
  hotelId: number,
  nombre: string,
  inicio: string,
  fin: string
): Promise<Result> {
  if (!nombre.trim()) return { ok: false, error: "El nombre de la temporada es obligatorio." };
  if (!inicio || !fin) return { ok: false, error: "Debes indicar fecha de inicio y fin." };
  if (fin < inicio) return { ok: false, error: "La fecha final no puede ser menor que la inicial." };

  const sb = await createClient();

  // No se permite solapar fechas con otra temporada del mismo hotel:
  // una noche solo puede pertenecer a una temporada.
  const { data: existentes } = await sb
    .from("hotel_temporadas")
    .select("nombre, fecha_inicio, fecha_fin")
    .eq("hotel_id", hotelId);
  for (const e of existentes ?? []) {
    if (!e.fecha_inicio || !e.fecha_fin) continue;
    // Solapan si inicio <= fin_existente && fin >= inicio_existente
    if (inicio <= e.fecha_fin && fin >= e.fecha_inicio) {
      return {
        ok: false,
        error: `Las fechas se cruzan con la temporada "${e.nombre}" (${e.fecha_inicio} → ${e.fecha_fin}).`,
      };
    }
  }

  const { error } = await sb.from("hotel_temporadas").insert({
    hotel_id: hotelId,
    nombre: nombre.trim(),
    fecha_inicio: inicio,
    fecha_fin: fin,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

export async function eliminarTemporada(id: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("hotel_temporadas").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

// ── Tarifa neta del hotel ─────────────────────────────────────────────────
export async function crearTarifa(input: {
  hotelId: number;
  tipoHabitacion: string;
  alimentacion: string;
  temporada: string;
  netoSencilla: number | null;
  netoDoble: number | null;
  netoTriple: number | null;
  netoMultiple: number | null;
  netoNino: number | null;
  netoNino2: number | null;
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("tarifa_hotel").insert({
    hotel_id: input.hotelId,
    tipo_habitacion: oNull(input.tipoHabitacion),
    alimentacion: oNull(input.alimentacion),
    temporada: oNull(input.temporada),
    neto_sencilla: input.netoSencilla,
    neto_doble: input.netoDoble,
    neto_triple: input.netoTriple,
    neto_multiple: input.netoMultiple,
    neto_nino: input.netoNino,
    neto_nino2: input.netoNino2,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${input.hotelId}`);
  return { ok: true };
}

export async function actualizarTarifa(
  id: number,
  hotelId: number,
  input: {
    tipoHabitacion: string;
    alimentacion: string;
    temporada: string;
    netoSencilla: number | null;
    netoDoble: number | null;
    netoTriple: number | null;
    netoMultiple: number | null;
    netoNino: number | null;
    netoNino2: number | null;
  }
): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("tarifa_hotel")
    .update({
      tipo_habitacion: oNull(input.tipoHabitacion),
      alimentacion: oNull(input.alimentacion),
      temporada: oNull(input.temporada),
      neto_sencilla: input.netoSencilla,
      neto_doble: input.netoDoble,
      neto_triple: input.netoTriple,
      neto_multiple: input.netoMultiple,
      neto_nino: input.netoNino,
      neto_nino2: input.netoNino2,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

export async function eliminarTarifa(id: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("tarifa_hotel").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}
