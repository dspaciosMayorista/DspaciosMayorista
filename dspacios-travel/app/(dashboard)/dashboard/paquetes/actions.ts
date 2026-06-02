"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true; id?: number } | { ok: false; error: string };
const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type AcomodacionTipo = "sencilla" | "doble" | "triple" | "multiple" | "nino";

export type PaqueteInput = {
  categoria: "bloqueo" | "porcion_terrestre";
  destinoId: number | null;
  nombre: string;
  descripcion: string;
  planAlimentacion: string;
  noches: number;
  comisionable: boolean;
  impuestoNoComisionable: number;
  bloqueoId: number | null;
  hoteles: {
    nombre: string;
    ciudad: string;
    alimentacion: string;
    acomodacionDetalle: string;
    noches: number;
  }[];
  precios: { acomodacion: AcomodacionTipo; precio: number }[];
  costos: {
    costoHotel: number;
    costoAereo: number;
    costoReceptivo: number;
    costoAsistencia: number;
    otrosCostos: number;
  };
};

export async function crearPaquete(input: PaqueteInput): Promise<Result> {
  const sb = await createClient();

  const { data: paquete, error } = await sb
    .from("paquetes")
    .insert({
      categoria: input.categoria,
      destino_id: input.destinoId,
      nombre: input.nombre.trim(),
      descripcion: oNull(input.descripcion),
      plan_alimentacion: oNull(input.planAlimentacion),
      noches: input.noches,
      comisionable: input.comisionable,
      impuesto_no_comisionable: input.impuestoNoComisionable,
      bloqueo_id: input.bloqueoId,
      activo: true,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  const pid = paquete.id;

  if (input.hoteles.length) {
    const { error: he } = await sb.from("paquete_hoteles").insert(
      input.hoteles.map((h, i) => ({
        paquete_id: pid,
        nombre: h.nombre.trim(),
        ciudad: oNull(h.ciudad),
        alimentacion: oNull(h.alimentacion),
        acomodacion_detalle: oNull(h.acomodacionDetalle),
        noches: h.noches || 0,
        orden: i,
      }))
    );
    if (he) return { ok: false, error: he.message };
  }

  if (input.precios.length) {
    const { error: pe } = await sb.from("paquete_precios").insert(
      input.precios.map((p) => ({
        paquete_id: pid,
        acomodacion: p.acomodacion,
        precio: p.precio,
      }))
    );
    if (pe) return { ok: false, error: pe.message };
  }

  const c = input.costos;
  if (c.costoHotel || c.costoAereo || c.costoReceptivo || c.costoAsistencia || c.otrosCostos) {
    const { error: ce } = await sb.from("paquete_costos").insert({
      paquete_id: pid,
      costo_hotel: c.costoHotel,
      costo_aereo: c.costoAereo,
      costo_receptivo: c.costoReceptivo,
      costo_asistencia: c.costoAsistencia,
      otros_costos: c.otrosCostos,
    });
    if (ce) return { ok: false, error: ce.message };
  }

  revalidatePath("/dashboard/paquetes");
  return { ok: true, id: pid };
}

export async function eliminarPaquete(id: number): Promise<Result> {
  const sb = await createClient();
  // hijos caen por on delete cascade
  const { error } = await sb.from("paquetes").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/paquetes");
  return { ok: true };
}
