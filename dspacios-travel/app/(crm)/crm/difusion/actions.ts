"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true; id?: number } | { ok: false; error: string };
const oNull = (s: string | null | undefined) => (s && s.trim() !== "" ? s.trim() : null);
const rev = () => revalidatePath("/crm/difusion");

// ── Material (inventario) ────────────────────────────────────────────────────
export type MaterialInput = {
  destino: string; hotelProducto: string; hotelId: number | null;
  tipoMaterial: string; fuente: string; estado: string; prioridad: string;
  linkArchivo: string; fechaMaterial: string; observaciones: string;
};

function materialRow(i: MaterialInput) {
  return {
    destino: oNull(i.destino),
    hotel_producto: i.hotelProducto.trim(),
    hotel_id: i.hotelId,
    tipo_material: oNull(i.tipoMaterial),
    fuente: oNull(i.fuente),
    estado: i.estado || "disponible",
    prioridad: i.prioridad || "media",
    link_archivo: oNull(i.linkArchivo),
    fecha_material: oNull(i.fechaMaterial),
    observaciones: oNull(i.observaciones),
  };
}

export async function crearMaterial(i: MaterialInput): Promise<Result> {
  if (!i.hotelProducto.trim()) return { ok: false, error: "El hotel/producto es obligatorio." };
  const sb = await createClient();
  const { data, error } = await sb.from("crm_material").insert(materialRow(i)).select("id").single();
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true, id: data.id };
}

export async function actualizarMaterial(id: number, i: MaterialInput): Promise<Result> {
  if (!i.hotelProducto.trim()) return { ok: false, error: "El hotel/producto es obligatorio." };
  const sb = await createClient();
  const { error } = await sb.from("crm_material").update({ ...materialRow(i), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true, id };
}

export async function eliminarMaterial(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("crm_material").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

// ── Envío (histórico) ────────────────────────────────────────────────────────
export type EnvioInput = {
  materialId: number | null; destino: string; hotelProducto: string; tipoMaterial: string;
  fechaEnvio: string; listaEnviada: string; canal: string; objetivo: string; enfoque: string;
  resultado: string; responsable: string; observaciones: string;
};

export async function registrarEnvio(i: EnvioInput): Promise<Result> {
  if (!i.hotelProducto.trim()) return { ok: false, error: "Indica el hotel/producto enviado." };
  if (!i.fechaEnvio) return { ok: false, error: "Indica la fecha de envío." };
  const sb = await createClient();
  const { error } = await sb.from("crm_envio").insert({
    material_id: i.materialId,
    destino: oNull(i.destino),
    hotel_producto: i.hotelProducto.trim(),
    tipo_material: oNull(i.tipoMaterial),
    fecha_envio: i.fechaEnvio,
    lista_enviada: oNull(i.listaEnviada),
    canal: oNull(i.canal),
    objetivo: oNull(i.objetivo),
    enfoque: oNull(i.enfoque),
    resultado: i.resultado || "sin_medir",
    responsable: oNull(i.responsable),
    observaciones: oNull(i.observaciones),
  });
  if (error) return { ok: false, error: error.message };
  // Marca el material como enviado (informativo; la rotación se calcula del histórico).
  if (i.materialId) await sb.from("crm_material").update({ estado: "enviado" }).eq("id", i.materialId);
  rev();
  return { ok: true };
}

export async function actualizarResultadoEnvio(id: number, resultado: string): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("crm_envio").update({ resultado }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

export async function eliminarEnvio(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("crm_envio").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

// ── Plan (calendario) ────────────────────────────────────────────────────────
export type PlanInput = {
  materialId: number | null; fechaProgramada: string; destino: string; hotelProducto: string;
  tipoMaterial: string; canal: string; listaObjetivo: string; enfoque: string; estado: string; observaciones: string;
};

export async function crearPlan(i: PlanInput): Promise<Result> {
  if (!i.fechaProgramada) return { ok: false, error: "Indica la fecha programada." };
  const sb = await createClient();
  const { error } = await sb.from("crm_difusion_plan").insert({
    material_id: i.materialId,
    fecha_programada: i.fechaProgramada,
    destino: oNull(i.destino),
    hotel_producto: oNull(i.hotelProducto),
    tipo_material: oNull(i.tipoMaterial),
    canal: oNull(i.canal),
    lista_objetivo: oNull(i.listaObjetivo),
    enfoque: oNull(i.enfoque),
    estado: i.estado || "pendiente",
    observaciones: oNull(i.observaciones),
  });
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

export async function cambiarEstadoPlan(id: number, estado: string): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("crm_difusion_plan").update({ estado, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

export async function eliminarPlan(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("crm_difusion_plan").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

// Marca un plan como "enviado" y crea el registro en el histórico.
export async function marcarPlanEnviado(id: number): Promise<Result> {
  const sb = await createClient();
  const { data: p } = await sb.from("crm_difusion_plan").select("*").eq("id", id).maybeSingle();
  if (!p) return { ok: false, error: "Programación no encontrada." };
  if (!p.hotel_producto) return { ok: false, error: "El plan no tiene hotel/producto; edítalo antes de marcar enviado." };
  const { error: e1 } = await sb.from("crm_envio").insert({
    material_id: p.material_id,
    destino: p.destino,
    hotel_producto: p.hotel_producto,
    tipo_material: p.tipo_material,
    fecha_envio: p.fecha_programada,
    lista_enviada: p.lista_objetivo,
    canal: p.canal,
    objetivo: null,
    enfoque: p.enfoque,
    resultado: "sin_medir",
  });
  if (e1) return { ok: false, error: e1.message };
  await sb.from("crm_difusion_plan").update({ estado: "enviado", updated_at: new Date().toISOString() }).eq("id", id);
  rev();
  return { ok: true };
}
