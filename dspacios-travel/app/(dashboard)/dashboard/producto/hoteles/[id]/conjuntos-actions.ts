"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { puedeEscribir } from "@/lib/roles";
import { validarConjunto, type ConjuntoFechas, type RangoFechas } from "@/lib/hoteles/conjuntosFechas";
import type { Json } from "@/types/database";

// Conjuntos de fechas con nombre y año (migración 327). Son un catálogo SIN vínculo con las vigencias: aplicar un conjunto COPIA sus noches a la vigencia (en el cliente, antes de guardarla);
// editar o borrar un conjunto NUNCA cambia una vigencia ya guardada. Estas acciones solo administran el catálogo.
type Entrada = { nombre: string; anio: number; tipo: string; rangos: RangoFechas[]; nota?: string | null };
type Resultado = { ok: true; conjunto: ConjuntoFechas } | { ok: false; error: string };

const COLUMNAS = "id, nombre, anio, tipo, rangos, nota";
const SIN_PERMISO = "No tienes permiso para administrar los conjuntos de fechas.";
const MENSAJE_DUPLICADO = "Ya existe un conjunto con ese nombre en ese año. Cambia el nombre o el año.";

function aConjunto(f: { id: number; nombre: string; anio: number; tipo: string; rangos: Json; nota: string | null }): ConjuntoFechas {
  return { id: f.id, nombre: f.nombre, anio: f.anio, tipo: f.tipo, nota: f.nota, rangos: Array.isArray(f.rangos) ? (f.rangos as unknown as RangoFechas[]) : [] };
}
// Un error de la base nunca se muestra crudo: el de unicidad tiene mensaje propio y el resto se resume.
const mensajeBase = (e: { code?: string; message: string }) => (e.code === "23505" ? MENSAJE_DUPLICADO : "No se pudo guardar el conjunto. Intenta de nuevo.");

async function conPermiso() {
  const sb = await createClient();
  const { data: rol, error } = await sb.rpc("mi_rol");
  if (error) return { sb, error: "No se pudo verificar tu permiso. Intenta de nuevo." };
  return puedeEscribir("producto", (rol as string | null) ?? null) ? { sb, error: null } : { sb, error: SIN_PERMISO };
}

export async function crearConjuntoFechas(input: Entrada): Promise<Resultado> {
  const v = validarConjunto(input);
  if (!v.ok) return v;
  const { sb, error: sinPermiso } = await conPermiso();
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { data, error } = await sb.from("conjuntos_fechas").insert({ nombre: v.nombre, anio: v.anio, tipo: v.tipo, rangos: v.rangos as unknown as Json, nota: v.nota }).select(COLUMNAS).maybeSingle();
  if (error) return { ok: false, error: mensajeBase(error) };
  if (!data) return { ok: false, error: "No se pudo guardar el conjunto: la base no devolvió la fila creada." };
  revalidatePath("/dashboard/producto/hoteles", "layout");
  return { ok: true, conjunto: aConjunto(data) };
}

export async function actualizarConjuntoFechas(id: number, input: Entrada): Promise<Resultado> {
  const v = validarConjunto(input);
  if (!v.ok) return v;
  const { sb, error: sinPermiso } = await conPermiso();
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { data, error } = await sb.from("conjuntos_fechas").update({ nombre: v.nombre, anio: v.anio, tipo: v.tipo, rangos: v.rangos as unknown as Json, nota: v.nota }).eq("id", id).select(COLUMNAS).maybeSingle();
  if (error) return { ok: false, error: mensajeBase(error) };
  if (!data) return { ok: false, error: "No se encontró el conjunto (ya no existe o no tienes permiso para editarlo)." };
  revalidatePath("/dashboard/producto/hoteles", "layout");
  return { ok: true, conjunto: aConjunto(data) };
}

export async function eliminarConjuntoFechas(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const { sb, error: sinPermiso } = await conPermiso();
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { data, error } = await sb.from("conjuntos_fechas").delete().eq("id", id).select("id").maybeSingle();
  if (error) return { ok: false, error: "No se pudo eliminar el conjunto. Intenta de nuevo." };
  // RLS sin permiso afecta 0 filas SIN error: no se informa «listo» de algo que no ocurrió.
  if (!data) return { ok: false, error: "No se pudo eliminar el conjunto: ya no existe o no tienes permiso para borrarlo." };
  revalidatePath("/dashboard/producto/hoteles", "layout");
  return { ok: true };
}
