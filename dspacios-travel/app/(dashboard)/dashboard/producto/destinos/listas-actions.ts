"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { puedeEscribir } from "@/lib/roles";
import { NOMBRE_DESTINO_PROVISIONAL, validarNombreDestinoFijo } from "@/lib/programas/destinoFijo";

// Listas fijas de Producto > Destinos. Hoy: "Lista destino programas"
// (tabla programa_destinos_fijos, migración 213). Es una lista comercial
// manual, SEPARADA del catálogo `destinos` (ciudades/IATA).
//
// Autorización en dos capas: la acción exige ESCRITURA.producto (aquí) y la RLS
// de la tabla exige el mismo grupo de roles. Los valores asignados a un programa
// NO se borran en silencio: la acción lo rechaza con el conteo y la FK RESTRICT
// es el respaldo en la base.

export type ResultadoLista = { ok: true; id?: number } | { ok: false; error: string };

const MSG_DUPLICADO = "Ya existe un destino con ese nombre (no se distingue entre mayúsculas, tildes ni espacios repetidos).";
const MSG_SIN_PERMISO = "No tienes permiso para administrar esta lista.";

type ErrorBd = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null };

/**
 * Convierte un error de la base en un mensaje SEGURO para el usuario. El detalle técnico
 * (código, mensaje, detalles) se queda en el log del servidor y nunca viaja al navegador:
 * podría exponer nombres de tablas, restricciones o SQL.
 */
function fallar(accion: string, error: ErrorBd, mensajeGenerico: string): ResultadoLista {
  console.error(
    `[producto/destinos/listas-fijas] accion=${accion} code=${error.code ?? "?"} message=${error.message ?? ""} details=${error.details ?? ""} hint=${error.hint ?? ""}`
  );
  if (error.code === "42501") return { ok: false, error: MSG_SIN_PERMISO };
  return { ok: false, error: mensajeGenerico };
}

async function autorizar(sb: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data: rol, error } = await sb.rpc("mi_rol");
  if (error) {
    console.error(`[producto/destinos/listas-fijas] accion=verificar_rol code=${error.code ?? "?"} message=${error.message ?? ""}`);
    return "No se pudo verificar tu permiso. Intenta de nuevo.";
  }
  if (!puedeEscribir("producto", (rol as string | null) ?? null)) return MSG_SIN_PERMISO;
  return null;
}

function revalidar() {
  revalidatePath("/dashboard/producto/destinos");
  revalidatePath("/dashboard/producto/programas");
  revalidatePath("/tarifario");
}

export async function crearDestinoFijo(nombre: string): Promise<ResultadoLista> {
  const v = validarNombreDestinoFijo(nombre);
  if (!v.ok) return v;
  const sb = await createClient();
  const sinPermiso = await autorizar(sb);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { data, error } = await sb.from("programa_destinos_fijos").insert({ nombre: v.nombre }).select("id").single();
  if (error) return error.code === "23505" ? { ok: false, error: MSG_DUPLICADO } : fallar("crear", error, "No se pudo crear el destino. Intenta de nuevo.");
  revalidar();
  return { ok: true, id: data.id };
}

/**
 * Crea el destino PROVISIONAL de despliegue («Por clasificar», marcado es_provisional). A lo sumo uno:
 * el índice único parcial de la base lo garantiza aunque dos personas pulsen a la vez. Se identifica por
 * la marca, no por el nombre.
 */
export async function crearDestinoProvisional(): Promise<ResultadoLista> {
  const sb = await createClient();
  const sinPermiso = await autorizar(sb);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { data, error } = await sb
    .from("programa_destinos_fijos")
    .insert({ nombre: NOMBRE_DESTINO_PROVISIONAL, es_provisional: true })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const esProvisionalUk = `${error.message ?? ""} ${error.details ?? ""}`.includes("programa_destinos_fijos_provisional_uk");
      console.error(`[producto/destinos/listas-fijas] accion=crear_provisional code=23505 message=${error.message ?? ""} details=${error.details ?? ""}`);
      return {
        ok: false,
        error: esProvisionalUk
          ? "Ya existe un destino provisional."
          : `Ya hay un destino llamado «${NOMBRE_DESTINO_PROVISIONAL}» que no es el provisional. Renómbralo antes de crear el provisional.`,
      };
    }
    return fallar("crear_provisional", error, "No se pudo crear el destino provisional. Intenta de nuevo.");
  }
  revalidar();
  return { ok: true, id: data.id };
}

export async function renombrarDestinoFijo(id: number, nombre: string): Promise<ResultadoLista> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Destino inválido." };
  const v = validarNombreDestinoFijo(nombre);
  if (!v.ok) return v;
  const sb = await createClient();
  const sinPermiso = await autorizar(sb);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { data, error } = await sb
    .from("programa_destinos_fijos")
    .update({ nombre: v.nombre, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) return error.code === "23505" ? { ok: false, error: MSG_DUPLICADO } : fallar("renombrar", error, "No se pudo renombrar el destino. Intenta de nuevo.");
  if (!data?.length) return { ok: false, error: "El destino ya no existe." };
  revalidar();
  return { ok: true, id };
}

export async function eliminarDestinoFijo(id: number): Promise<ResultadoLista> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Destino inválido." };
  const sb = await createClient();
  const sinPermiso = await autorizar(sb);
  if (sinPermiso) return { ok: false, error: sinPermiso };

  const { count, error: errCount } = await sb
    .from("programas")
    .select("id", { count: "exact", head: true })
    .eq("destino_fijo_id", id);
  if (errCount) return fallar("eliminar_conteo", errCount, "No se pudo verificar si el destino está en uso. Intenta de nuevo.");
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `No se puede eliminar: ${count} ${count === 1 ? "programa lo tiene" : "programas lo tienen"} asignado. Cámbiales el destino primero.`,
    };
  }

  const { data, error } = await sb.from("programa_destinos_fijos").delete().eq("id", id).select("id");
  if (error) {
    // 23503 = FK RESTRICT: alguien lo asignó entre el conteo y el borrado.
    if (error.code === "23503") return { ok: false, error: "No se puede eliminar: un programa lo tiene asignado." };
    return fallar("eliminar", error, "No se pudo eliminar el destino. Intenta de nuevo.");
  }
  if (!data?.length) return { ok: false, error: "No se pudo eliminar (el destino ya no existe o no tienes permiso)." };
  revalidar();
  return { ok: true };
}
