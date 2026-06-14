"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };
type Fila = { modulo: string; consultar: boolean; modificar: boolean; eliminar: boolean };

// Guardar la matriz de un ROL (reemplaza todas sus filas).
export async function guardarPermisosRol(rol: string, filas: Fila[]): Promise<Result> {
  if (rol === "superadmin") return { ok: false, error: "Superadmin siempre tiene acceso total." };
  const sb = await createClient();
  await sb.from("permisos_rol").delete().eq("rol", rol);
  const rows = filas.map((f) => ({ rol, modulo: f.modulo, consultar: f.consultar, modificar: f.modificar, eliminar: f.eliminar }));
  if (rows.length) {
    const { error } = await sb.from("permisos_rol").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/dashboard/usuarios/permisos");
  return { ok: true };
}

// Guardar el OVERRIDE de un usuario. Solo se persisten los módulos "personalizados";
// el resto se borra (vuelve a usar el rol).
export async function guardarPermisosUsuario(usuarioId: string, filas: Fila[]): Promise<Result> {
  const sb = await createClient();
  await sb.from("permisos_usuario").delete().eq("usuario_id", usuarioId);
  const rows = filas.map((f) => ({ usuario_id: usuarioId, modulo: f.modulo, consultar: f.consultar, modificar: f.modificar, eliminar: f.eliminar }));
  if (rows.length) {
    const { error } = await sb.from("permisos_usuario").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/dashboard/usuarios/permisos");
  return { ok: true };
}
