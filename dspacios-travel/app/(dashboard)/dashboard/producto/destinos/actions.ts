"use server";

import { createClient } from "@/lib/supabase/server";
import { puedeEscribir } from "@/lib/roles";
import {
  CATEGORIAS_RECEPTIVO,
  cargarReceptivosSegunRol,
  filaNombreReceptivoDe,
  type ReceptivoDeDestino,
} from "@/lib/producto/receptivos";

export type ResultadoReceptivosDestino =
  | { estado: "ok"; receptivos: ReceptivoDeDestino[] }
  /** El rol no lee `servicios_adicionales`: no se consulta (RLS devolvería vacío SIN error). */
  | { estado: "sin_permiso" }
  | { estado: "error" };

// Solo LECTURA, bajo demanda: los nombres de los receptivos de UN destino,
// para el diálogo que abre la insignia "N receptivos" del listado. No se
// cargan para todas las tarjetas de entrada.
//
// Mismo criterio que el conteo de page.tsx (así la lista y el número
// coinciden): `servicios_adicionales` con `destino_id` = ese destino y
// categoría de receptivo (CATEGORIAS_RECEPTIVO) — nunca servicios generales
// sin destino ni otras categorías. Misma compuerta de rol (primero el rol;
// sin permiso no se consulta) y misma carga paginada validada, que falla
// cerrado ante cualquier respuesta anómala. Solo `id` y `nombre` salen del
// servidor: ningún dato de costo.
export async function listarReceptivosDestino(destinoId: number): Promise<ResultadoReceptivosDestino> {
  if (typeof destinoId !== "number" || !Number.isInteger(destinoId) || destinoId <= 0) return { estado: "error" };
  const sb = await createClient();
  const r = await cargarReceptivosSegunRol({
    obtenerRol: () => sb.rpc("mi_rol"),
    puedeLeer: (rol) => puedeEscribir("producto", rol),
    filaValida: filaNombreReceptivoDe(destinoId),
    pedirPagina: (desde, hasta) =>
      sb
        .from("servicios_adicionales")
        .select("id, nombre, destino_id")
        .eq("destino_id", destinoId)
        .in("categoria", [...CATEGORIAS_RECEPTIVO])
        .order("nombre")
        .order("id")
        .range(desde, hasta),
  });
  if (r.estado === "sin_permiso") return { estado: "sin_permiso" };
  if (r.estado !== "ok") {
    console.error(`[producto/destinos] etapa=lista_receptivos destino=${destinoId} estado=${r.estado} detalle=`, r.error);
    return { estado: "error" };
  }
  return {
    estado: "ok",
    receptivos: (r.filas as { id: number; nombre: string }[]).map((f) => ({ id: f.id, nombre: f.nombre })),
  };
}
