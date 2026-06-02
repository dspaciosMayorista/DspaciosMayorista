"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true; id?: number } | { ok: false; error: string };

const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type BloqueoInput = {
  record: string;
  aerolinea: string;
  ruta: string;
  vueloIda: string;
  fechaIda: string;
  horaSalidaIda: string;
  horaLlegadaIda: string;
  vueloRegreso: string;
  fechaRegreso: string;
  horaSalidaReg: string;
  horaLlegadaReg: string;
  cuposTotal: number;
  tarifaParaEmpaquetar: number;
  fechaDevolucion: string;
  fechaEmision: string;
  notas: string;
};

export async function crearBloqueo(input: BloqueoInput): Promise<Result> {
  const sb = await createClient();

  const { data: bloqueo, error } = await sb
    .from("bloqueos_vuelo")
    .insert({
      record: input.record.trim().toUpperCase(),
      aerolinea: oNull(input.aerolinea),
      ruta: oNull(input.ruta),
      vuelo_ida: oNull(input.vueloIda),
      fecha_ida: oNull(input.fechaIda),
      hora_salida_ida: oNull(input.horaSalidaIda),
      hora_llegada_ida: oNull(input.horaLlegadaIda),
      vuelo_regreso: oNull(input.vueloRegreso),
      fecha_regreso: oNull(input.fechaRegreso),
      hora_salida_reg: oNull(input.horaSalidaReg),
      hora_llegada_reg: oNull(input.horaLlegadaReg),
      cupos_total: input.cuposTotal,
      tarifa_para_empaquetar: input.tarifaParaEmpaquetar,
      fecha_devolucion: oNull(input.fechaDevolucion),
      fecha_emision: oNull(input.fechaEmision),
      notas: oNull(input.notas),
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  // Generar las sillas (1..cupos) en estado disponible
  if (input.cuposTotal > 0) {
    const sillas = Array.from({ length: input.cuposTotal }, (_, i) => ({
      bloqueo_id: bloqueo.id,
      numero_silla: i + 1,
      estado: "disponible" as const,
    }));
    const { error: se } = await sb.from("sillas").insert(sillas);
    if (se) return { ok: false, error: se.message };
  }

  revalidatePath("/dashboard/vuelos");
  return { ok: true, id: bloqueo.id };
}

export async function eliminarBloqueo(id: number): Promise<Result> {
  const sb = await createClient();
  // Borrar sillas primero (no hay cascade declarado)
  await sb.from("sillas").delete().eq("bloqueo_id", id);
  const { error } = await sb.from("bloqueos_vuelo").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/vuelos");
  return { ok: true };
}
