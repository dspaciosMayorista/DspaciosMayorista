"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };
const BUCKET = "contratos"; // bucket privado existente; carpeta pe-empleados/

// ── Empleados ───────────────────────────────────────────────────────────────
export async function guardarEmpleado(input: {
  id?: number;
  nombre: string;
  tipo: "empleado" | "servicios";
  salario: number;
  auxilio: boolean;
  riesgo: string;
  declarante: boolean;
}): Promise<Result> {
  const sb = await createClient();
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const row = {
    nombre: input.nombre.trim(),
    tipo: input.tipo === "servicios" ? "servicios" : "empleado",
    salario: Math.max(0, Number(input.salario) || 0),
    auxilio: !!input.auxilio,
    riesgo: input.riesgo || "I",
    declarante: !!input.declarante,
  };
  const { error } = input.id
    ? await sb.from("pe_empleados").update(row).eq("id", input.id)
    : await sb.from("pe_empleados").insert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/punto-equilibrio");
  return { ok: true };
}

export async function eliminarEmpleado(id: number, contratoPath?: string | null): Promise<Result> {
  const sb = await createClient();
  if (contratoPath) await sb.storage.from(BUCKET).remove([contratoPath]);
  const { error } = await sb.from("pe_empleados").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/punto-equilibrio");
  return { ok: true };
}

// El cliente sube el archivo al bucket y aquí se registra la ruta en el empleado.
export async function registrarContratoEmpleado(id: number, path: string, nombre: string): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("pe_empleados").update({ contrato_path: path, contrato_nombre: nombre || null }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/punto-equilibrio");
  return { ok: true };
}

export async function quitarContratoEmpleado(id: number, path: string): Promise<Result> {
  const sb = await createClient();
  await sb.storage.from(BUCKET).remove([path]);
  const { error } = await sb.from("pe_empleados").update({ contrato_path: null, contrato_nombre: null }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/punto-equilibrio");
  return { ok: true };
}

export async function urlContratoEmpleado(path: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 120);
  if (error || !data) return { ok: false, error: error?.message ?? "No se pudo generar el enlace." };
  return { ok: true, url: data.signedUrl };
}

// ── Otros costos y gastos ────────────────────────────────────────────────────
export async function guardarCosto(input: {
  id?: number;
  concepto: string;
  categoria: string;
  clasificacion: "fijo" | "variable";
  valor: number;
}): Promise<Result> {
  const sb = await createClient();
  if (!input.concepto.trim()) return { ok: false, error: "El concepto es obligatorio." };
  const row = {
    concepto: input.concepto.trim(),
    categoria: input.categoria.trim() || null,
    clasificacion: input.clasificacion === "variable" ? "variable" : "fijo",
    valor: Math.max(0, Number(input.valor) || 0),
  };
  const { error } = input.id
    ? await sb.from("pe_costos").update(row).eq("id", input.id)
    : await sb.from("pe_costos").insert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/punto-equilibrio");
  return { ok: true };
}

export async function eliminarCosto(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("pe_costos").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/punto-equilibrio");
  return { ok: true };
}
