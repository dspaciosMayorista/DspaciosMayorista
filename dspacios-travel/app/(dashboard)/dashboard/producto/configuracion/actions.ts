"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };
const rev = () => revalidatePath("/dashboard/producto/configuracion");

// ── Categorías de habitación ──────────────────────────────────────────────
export async function crearCategoria(nombre: string, descripcion: string): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("categorias_habitacion").insert({
    nombre: nombre.trim(),
    descripcion: descripcion.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

export async function eliminarCategoria(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("categorias_habitacion").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

// ── Régimen de alimentación (planes_alimentacion) ─────────────────────────
export async function crearRegimen(codigo: string, nombre: string, descripcion: string, notaEspecial: string = ""): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("planes_alimentacion").insert({
    codigo: codigo.trim().toUpperCase(),
    nombre: nombre.trim(),
    descripcion: descripcion.trim() || null,
    nota_especial: notaEspecial.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

export async function actualizarRegimen(id: number, codigo: string, nombre: string, notaEspecial: string = "", descripcion: string = ""): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("planes_alimentacion").update({
    codigo: codigo.trim().toUpperCase(),
    nombre: nombre.trim(),
    descripcion: descripcion.trim() || null,
    nota_especial: notaEspecial.trim() || null,
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}

export async function eliminarRegimen(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("planes_alimentacion").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  rev();
  return { ok: true };
}
