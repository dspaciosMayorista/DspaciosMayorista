"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { calcularEdad } from "@/lib/utils";

type Result = { ok: true } | { ok: false; error: string };

async function rol(sb: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("usuarios").select("rol").eq("id", user.id).single();
  return data?.rol ?? null;
}

// Asignar / cambiar el asesor interno del contrato (roles de gestión).
export async function actualizarAsesorContrato(numero: string, asesorNombre: string): Promise<Result> {
  const sb = await createClient();
  const r = await rol(sb);
  if (!["superadmin", "gerencia", "administracion", "operaciones"].includes(r ?? "")) {
    return { ok: false, error: "No tienes permiso para cambiar el asesor." };
  }
  const nombre = asesorNombre.trim() || null;
  const { error } = await sb.from("ventas").update({ asesor_firma_nombre: nombre, asesor: nombre }).eq("numero_contrato", numero);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}

export type PasajeroEdit = { nombre: string; tipoId: string; identificacion: string; fechaNacimiento: string; esInfante: boolean };

// Reemplazar los pasajeros del contrato (con validaciones).
export async function actualizarPasajerosContrato(numero: string, pasajeros: PasajeroEdit[]): Promise<Result> {
  const sb = await createClient();
  const r = await rol(sb);
  if (!["superadmin", "gerencia", "administracion", "operaciones", "venta"].includes(r ?? "")) {
    return { ok: false, error: "No tienes permiso para editar pasajeros." };
  }
  const { data: venta } = await sb.from("ventas").select("fecha_salida").eq("numero_contrato", numero).maybeSingle();
  const ref = venta?.fecha_salida ?? null;

  // Solo se descartan filas totalmente vacías (sin ningún dato). El resto debe
  // venir completo: mismos validadores del contrato del tarifario.
  const filasConDato = pasajeros.filter(
    (p) => p.nombre.trim() || p.identificacion.trim() || p.fechaNacimiento.trim()
  );
  if (!filasConDato.length) return { ok: false, error: "Debe haber al menos un pasajero." };

  const docOk = (tipo: string, num: string) => tipo === "PAS" || /^\d+$/.test(num.trim());

  // Validaciones por pasajero: datos completos + edad + documento repetido.
  const vistos = new Set<string>();
  for (let i = 0; i < filasConDato.length; i++) {
    const p = filasConDato[i];
    if (!p.nombre.trim()) return { ok: false, error: `Pasajero ${i + 1}: el nombre es obligatorio.` };
    if (!p.identificacion.trim()) return { ok: false, error: `Pasajero ${i + 1}: el número de documento es obligatorio.` };
    if (!docOk(p.tipoId, p.identificacion)) return { ok: false, error: `Pasajero ${i + 1}: el documento debe ser solo números (excepto Pasaporte).` };
    if (!p.fechaNacimiento.trim()) return { ok: false, error: `Pasajero ${i + 1}: la fecha de nacimiento es obligatoria.` };
    const edad = calcularEdad(p.fechaNacimiento, ref);
    if (edad != null && edad < 18 && p.tipoId === "CC") return { ok: false, error: `Pasajero ${i + 1}: un menor no puede tener CC (usa RC o TI).` };
    const k = `${p.tipoId}-${p.identificacion.trim()}`;
    if (vistos.has(k)) return { ok: false, error: `Pasajero ${i + 1}: documento repetido.` };
    vistos.add(k);
  }
  const limpios = filasConDato;

  await sb.from("contrato_pasajeros").delete().eq("numero_contrato", numero);
  const filas = limpios.map((p, i) => {
    // Infante = bebé (< 2 años a la fecha de viaje). Se deriva de la fecha de
    // nacimiento; no se elige a mano.
    const edad = calcularEdad(p.fechaNacimiento, ref);
    return {
      numero_contrato: numero,
      nombre: p.nombre.trim(),
      tipo_id: p.tipoId || "CC",
      identificacion: p.identificacion.trim() || null,
      fecha_nacimiento: p.fechaNacimiento || null,
      es_infante: edad != null && edad < 2,
      orden: i,
    };
  });
  const { error } = await sb.from("contrato_pasajeros").insert(filas);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}
