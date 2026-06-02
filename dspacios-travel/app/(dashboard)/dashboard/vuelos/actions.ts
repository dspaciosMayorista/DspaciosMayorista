"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true; id?: number } | { ok: false; error: string };

const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type BloqueoInput = {
  record: string;
  aerolinea: string;
  proveedorId: number | null;
  destinoId: number | null;
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
  rangosEdad?: number[];
};

export async function crearBloqueo(input: BloqueoInput): Promise<Result> {
  const sb = await createClient();

  const { data: bloqueo, error } = await sb
    .from("bloqueos_vuelo")
    .insert({
      record: input.record.trim().toUpperCase(),
      aerolinea: oNull(input.aerolinea),
      proveedor_id: input.proveedorId,
      destino_id: input.destinoId,
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
      rangos_edad: input.rangosEdad?.length ? input.rangosEdad : null,
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

// Editar un bloqueo existente (no modifica cupos/sillas ya generadas).
export type BloqueoEditInput = Omit<BloqueoInput, "cuposTotal">;
export async function actualizarBloqueo(id: number, input: BloqueoEditInput): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("bloqueos_vuelo")
    .update({
      record: input.record.trim().toUpperCase(),
      aerolinea: oNull(input.aerolinea),
      proveedor_id: input.proveedorId,
      destino_id: input.destinoId,
      ruta: oNull(input.ruta),
      vuelo_ida: oNull(input.vueloIda),
      fecha_ida: oNull(input.fechaIda),
      hora_salida_ida: oNull(input.horaSalidaIda),
      hora_llegada_ida: oNull(input.horaLlegadaIda),
      vuelo_regreso: oNull(input.vueloRegreso),
      fecha_regreso: oNull(input.fechaRegreso),
      hora_salida_reg: oNull(input.horaSalidaReg),
      hora_llegada_reg: oNull(input.horaLlegadaReg),
      tarifa_para_empaquetar: input.tarifaParaEmpaquetar,
      fecha_devolucion: oNull(input.fechaDevolucion),
      fecha_emision: oNull(input.fechaEmision),
      notas: oNull(input.notas),
      rangos_edad: input.rangosEdad?.length ? input.rangosEdad : null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/vuelos/${id}`);
  return { ok: true, id };
}

export async function cambiarSillas(input: {
  origenId: number;
  destinoId: number;
  cantidad: number;
  motivo: string;
}): Promise<Result> {
  const sb = await createClient();
  if (input.origenId === input.destinoId)
    return { ok: false, error: "El origen y el destino deben ser distintos." };
  if (input.cantidad <= 0) return { ok: false, error: "Cantidad inválida." };

  // Sillas disponibles en el origen
  const { data: libres } = await sb
    .from("sillas")
    .select("id")
    .eq("bloqueo_id", input.origenId)
    .in("estado", ["disponible", "cambio_entrante"])
    .order("numero_silla")
    .limit(input.cantidad);
  if (!libres || libres.length < input.cantidad)
    return { ok: false, error: `Solo hay ${libres?.length ?? 0} sillas disponibles en el origen.` };
  const ids = libres.map((s) => s.id);

  // Origen → CAMBIO
  const { error: e1 } = await sb.from("sillas").update({ estado: "cambio" }).in("id", ids);
  if (e1) return { ok: false, error: e1.message };

  // Siguiente número de silla en el destino
  const { data: maxRows } = await sb
    .from("sillas")
    .select("numero_silla")
    .eq("bloqueo_id", input.destinoId)
    .order("numero_silla", { ascending: false })
    .limit(1);
  const next = maxRows?.[0]?.numero_silla ?? 0;

  // Destino → nuevas CAMBIO ENTRANTE
  const nuevas = Array.from({ length: input.cantidad }, (_, i) => ({
    bloqueo_id: input.destinoId,
    numero_silla: next + i + 1,
    estado: "cambio_entrante" as const,
  }));
  const { error: e2 } = await sb.from("sillas").insert(nuevas);
  if (e2) return { ok: false, error: e2.message };

  // Registrar movimientos
  await sb.from("movimientos_silla").insert(
    ids.map((silla_id) => ({
      silla_id,
      bloqueo_origen_id: input.origenId,
      bloqueo_destino_id: input.destinoId,
      motivo: input.motivo || null,
    }))
  );

  revalidatePath(`/dashboard/vuelos/${input.origenId}`);
  revalidatePath(`/dashboard/vuelos/${input.destinoId}`);
  revalidatePath("/dashboard/vuelos");
  return { ok: true };
}

export type EstadoSillaManual = "disponible" | "en_plazo" | "confirmada" | "devuelta" | "no_vendida";

export async function cambiarEstadoSilla(
  sillaId: number,
  estado: EstadoSillaManual,
  bloqueoId: number
): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("sillas")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("id", sillaId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/vuelos/${bloqueoId}`);
  revalidatePath("/dashboard/vuelos");
  return { ok: true };
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
