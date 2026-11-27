"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { regenerarTarifariosDeHotelAcotado } from "../../../paquetes/actions";
import type { ResultadoRegeneracionHotel } from "@/lib/tarifario/regeneracionHotel";
import { MENSAJE_CIERRE_UNIDAD_NO_SOPORTADO } from "@/lib/tarifario/cierresHotel";
import { despuesDeResponder, type ModoDespues } from "@/lib/tarifario/despuesDeResponder";

// `regeneracion`: «diferida» = la fila ya está guardada/borrada y los tarifarios se regeneran DESPUÉS de responder (sin que el usuario espere); «inmediata» = se esperó (fuera de una petición de Next).
type Result = { ok: true; aviso?: string; regeneracion?: ModoDespues; id?: number } | { ok: false; error: string };

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
  const inicioMs = Date.now();
  const { data: creado, error } = await sb.from("hotel_blackouts").insert({
    hotel_id: input.hotelId,
    fecha_inicio: input.fechaInicio,
    fecha_fin: input.fechaFin,
    total: input.total,
    acomodaciones: input.total || !input.acomodaciones.length ? null : input.acomodaciones,
    categorias: input.total || !categorias.length ? null : categorias,
    motivo: input.motivo.trim() || null,
  }).select("id").maybeSingle();
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${input.hotelId}`);
  const { regeneracion, aviso } = await regenerarDespues(input.hotelId, inicioMs);
  return { ok: true, regeneracion, ...(creado?.id != null ? { id: creado.id } : {}), ...(aviso ? { aviso } : {}) };
}

// El hotel sale de la fila realmente borrada (nunca del parámetro) y se verifica que HAYA una fila: con RLS un borrado sin permiso afecta 0 filas SIN error, y decir «listo» haría
// desaparecer de la pantalla un cierre que sigue vigente.
export async function eliminarBlackout(id: number, _hotelIdSolicitado?: number): Promise<Result> {
  void _hotelIdSolicitado;
  const sb = await createClient();
  const inicioMs = Date.now();
  const { data: borrado, error } = await sb.from("hotel_blackouts").delete().eq("id", id).select("hotel_id").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!borrado) return { ok: false, error: "No se pudo eliminar el cierre: ya no existe o no tienes permiso para borrarlo." };
  revalidatePath(`/dashboard/producto/hoteles/${borrado.hotel_id}`);
  // Reabrir también cambia lo vendible (vuelven estadías): se regenera para que reaparezcan.
  const { regeneracion, aviso } = await regenerarDespues(borrado.hotel_id, inicioMs);
  return { ok: true, regeneracion, ...(aviso ? { aviso } : {}) };
}

// La regeneración de TODOS los paquetes que usan el hotel (~16 consultas por paquete, de a 2 paquetes) ya no se espera para responder: el cierre ya está en la base y la base oculta las filas
// cerradas en el mismo instante (migración 315) y la venta lo valida en vivo. Si la regeneración no se puede hacer, queda registrada y el paquete queda marcado por su propio mecanismo.
async function regenerarDespues(hotelId: number, inicioMs: number): Promise<{ regeneracion: ModoDespues; aviso?: string }> {
  let aviso: string | undefined;
  const regeneracion = await despuesDeResponder("blackouts", async () => {
    aviso = avisoRegeneracion(await regenerarTarifariosDeHotelAcotado(hotelId, inicioMs));
    if (aviso) console.error(`blackouts: ${aviso}`);
  });
  return { regeneracion, ...(regeneracion === "inmediata" && aviso ? { aviso } : {}) };
}
