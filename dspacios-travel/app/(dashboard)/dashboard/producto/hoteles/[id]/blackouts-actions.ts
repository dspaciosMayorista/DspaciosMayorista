"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { regenerarTarifariosDeHotelAcotado } from "../../../paquetes/actions";
import type { ResultadoRegeneracionHotel } from "@/lib/tarifario/regeneracionHotel";
import { MENSAJE_CIERRE_UNIDAD_NO_SOPORTADO } from "@/lib/tarifario/cierresHotel";

type Result = { ok: true; aviso?: string } | { ok: false; error: string };

// #127: un cierre general cambia lo vendible de TODOS los paquetes que usan el hotel. Guardarlo ya no solo refresca esta pantalla: se regeneran sus tarifarios (acotado, igual que
// al editar una tarifa) y, si algo no se pudo regenerar, se dice (la venta igual rechaza la estadía cerrada: ver computarReserva).
function avisoRegeneracion(r: ResultadoRegeneracionHotel): string | undefined {
  if (r.paquetes === null) return "El cierre quedó guardado, pero no se pudieron consultar los paquetes que usan este hotel: regenera sus tarifarios desde cada paquete.";
  if (r.fallidos.length) return `El cierre quedó guardado, pero no se regeneró el tarifario de ${r.fallidos.length} paquete(s) (${r.fallidos.map((x) => `#${x.paqueteId}`).join(", ")}): regéneralos desde el paquete. Mientras tanto la venta rechaza las estadías cerradas.`;
  return undefined;
}

export async function crearBlackout(input: {
  hotelId: number; fechaInicio: string; fechaFin: string; total: boolean;
  acomodaciones: string[]; categorias?: string[]; motivo: string;
}): Promise<Result> {
  const sb = await createClient();
  const categorias = input.categorias ?? [];
  if (!input.fechaInicio || !input.fechaFin) return { ok: false, error: "Indica las fechas de cierre." };
  if (input.fechaFin < input.fechaInicio) return { ok: false, error: "La fecha fin no puede ser anterior a la de inicio." };
  // Con cierre parcial hay que acotar por algo: categorías, acomodaciones o las
  // dos. Si no, sería un cierre total disfrazado.
  if (!input.total && !input.acomodaciones.length && !categorias.length)
    return { ok: false, error: "Elige qué cerrar: categorías, acomodaciones o ambas (o marca cierre total)." };
  // Hotel tarifado por unidad: solo cierre total o por categoría (no hay equivalencia acomodación ↔ unidad; ver cierresHotel.ts). Se rechaza en vez de guardar algo que no se aplicaría.
  if (!input.total && input.acomodaciones.length) {
    const { data: hm, error: hmErr } = await sb.from("hoteles").select("modelo_tarifario").eq("id", input.hotelId).maybeSingle();
    if (hmErr) return { ok: false, error: "No se pudo comprobar el modelo de tarifa del hotel. Intenta de nuevo." };
    if (hm?.modelo_tarifario === "unidad") return { ok: false, error: MENSAJE_CIERRE_UNIDAD_NO_SOPORTADO };
  }
  const { error } = await sb.from("hotel_blackouts").insert({
    hotel_id: input.hotelId,
    fecha_inicio: input.fechaInicio,
    fecha_fin: input.fechaFin,
    total: input.total,
    acomodaciones: input.total || !input.acomodaciones.length ? null : input.acomodaciones,
    categorias: input.total || !categorias.length ? null : categorias,
    motivo: input.motivo.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${input.hotelId}`);
  const aviso = avisoRegeneracion(await regenerarTarifariosDeHotelAcotado(input.hotelId));
  return { ok: true, ...(aviso ? { aviso } : {}) };
}

export async function eliminarBlackout(id: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("hotel_blackouts").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  // Reabrir también cambia lo vendible (vuelven estadías): se regenera para que reaparezcan.
  const aviso = avisoRegeneracion(await regenerarTarifariosDeHotelAcotado(hotelId));
  return { ok: true, ...(aviso ? { aviso } : {}) };
}
