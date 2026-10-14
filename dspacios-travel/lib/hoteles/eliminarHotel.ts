// Eliminación de un hotel del catálogo (Producto → Hoteles).
//
// Por qué existe: el borrado era un `delete` directo cuyo resultado nadie
// leía. Con el hotel en un tarifario generado, Postgres lo rechaza
// (`tarifario_resultado_hotel_id_fkey`, sin ON DELETE) y la pantalla no
// mostraba nada. Y al revés, con el hotel en el ARMADO de un paquete pero
// todavía sin resultados, el borrado SÍ pasaba y `armado_hoteles` (ON DELETE
// CASCADE hasta la migración 209) le quitaba el hotel al
// paquete en silencio. Con la migración 209 esa FK es RESTRICT: la revisión de
// aquí da el mensaje guiado y la base es la garantía ante una carrera.
//
// Regla: si el hotel está vinculado a paquetes (armado o tarifario generado)
// NO se borra nada; se devuelven los paquetes afectados para que el usuario
// lo quite de cada uno y regenere su tarifario (publicar reemplaza todas las
// filas del paquete, así deja de referenciarlo). Solo sin vínculos se borra,
// y únicamente se informa éxito si de verdad se eliminó la fila.
//
// Lo que arrastra un borrado sin vínculos es lo de siempre (FK ya existentes,
// no se agrega ningún CASCADE): las tarifas, temporadas, fotos y demás datos
// propios del hotel. Los contratos no se tocan: `contrato_alojamiento_bernalo`
// queda con `hotel_id = null` y conserva su snapshot (migración 176), y el
// historial de tarifas (migración 203) no tiene FK.
//
// Sin dependencias de Next: recibe el cliente Supabase de la Server Action,
// así la lógica se prueba con un cliente simulado.
import type { SupabaseClient } from "@supabase/supabase-js";

export type PaqueteVinculado = {
  id: number;
  nombre: string;
  /** El hotel sigue marcado en el armado del paquete (`armado_hoteles`). */
  enArmado: boolean;
  /** El tarifario generado del paquete todavía lo incluye (`tarifario_resultado`). */
  enTarifario: boolean;
};

export type ResultadoEliminarHotel =
  | { ok: true }
  | { ok: false; error: string; paquetes?: PaqueteVinculado[] };

const PAGINA = 1000;

// Lee TODOS los `paquete_id` de una tabla para el hotel. Paginado y avanzando
// por las filas realmente recibidas: el límite de filas del proyecto corta
// las respuestas sin error (ver CLAUDE.md, "límite de filas de Supabase").
async function paquetesDe(
  sb: SupabaseClient,
  tabla: "armado_hoteles" | "tarifario_resultado",
  hotelId: number,
): Promise<Set<number> | null> {
  const ids = new Set<number>();
  for (let desde = 0; ; ) {
    const { data, error } = await sb
      .from(tabla)
      .select("paquete_id")
      .eq("hotel_id", hotelId)
      .order("id")
      .range(desde, desde + PAGINA - 1);
    if (error) return null;
    const filas = (data ?? []) as Array<{ paquete_id: number | null }>;
    if (filas.length === 0) return ids;
    for (const f of filas) if (f.paquete_id != null) ids.add(f.paquete_id);
    desde += filas.length;
  }
}

/**
 * Texto para el usuario ante un rechazo de FK (23503) del DELETE. Llega aquí
 * si un vínculo apareció entre la revisión y el borrado (la FK del armado es
 * RESTRICT, así que la base lo impide aunque la revisión no lo viera), o si lo
 * usa una tabla que la revisión no consulta (p. ej. las tablas antiguas
 * `habitaciones`/`tarifas` de la migración 004).
 * Nunca incluye texto de la base (tablas ni restricciones): solo distingue si
 * la causa es un paquete o no.
 */
export function mensajeHotelEnUso(nombre: string, error: { message?: string; details?: string }): string {
  const texto = `${error.message ?? ""} ${error.details ?? ""}`;
  if (texto.includes("tarifario_resultado") || texto.includes("armado_hoteles")) {
    return `No se puede eliminar "${nombre}": está vinculado a uno o más paquetes (en su armado o en tarifarios generados). Quítalo de esos paquetes, regenera sus tarifarios y vuelve a intentarlo. No se borró nada.`;
  }
  return `No se puede eliminar "${nombre}": otros registros todavía lo usan. No se borró nada.`;
}

export function mensajeHotelVinculado(nombre: string, paquetes: PaqueteVinculado[]): string {
  const n = paquetes.length;
  return `No se puede eliminar "${nombre}": está vinculado a ${n} ${n === 1 ? "paquete" : "paquetes"}. Quítalo de ${n === 1 ? "ese paquete" : "cada paquete"} y regenera su tarifario; después vuelve a intentarlo. No se borró nada.`;
}

export async function eliminarHotelSeguro(sb: SupabaseClient, id: number): Promise<ResultadoEliminarHotel> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Hotel inválido." };

  const { data: hotel, error: eHotel } = await sb.from("hoteles").select("id, nombre").eq("id", id).maybeSingle();
  if (eHotel) return { ok: false, error: "No se pudo comprobar el hotel. Intenta de nuevo." };
  if (!hotel) return { ok: false, error: "El hotel ya no existe (pudo eliminarse en otra sesión). Recarga la página." };
  const nombre = (hotel as { nombre: string }).nombre;

  // Revisión de vínculos. Si no se puede completar, no se borra: un "0"
  // supuesto dejaría pasar un hotel que está en un paquete.
  const [enArmado, enTarifario] = await Promise.all([
    paquetesDe(sb, "armado_hoteles", id),
    paquetesDe(sb, "tarifario_resultado", id),
  ]);
  if (!enArmado || !enTarifario) {
    return { ok: false, error: "No se pudo verificar si el hotel está en paquetes. No se borró nada; intenta de nuevo." };
  }

  const ids = [...new Set([...enArmado, ...enTarifario])].sort((a, b) => a - b);
  if (ids.length > 0) {
    const { data: filas } = await sb.from("armado_paquetes").select("id, nombre").in("id", ids);
    const nombres = new Map(((filas ?? []) as Array<{ id: number; nombre: string | null }>).map((p) => [p.id, p.nombre]));
    const paquetes = ids.map((pid) => ({
      id: pid,
      nombre: nombres.get(pid)?.trim() || `Paquete #${pid}`,
      enArmado: enArmado.has(pid),
      enTarifario: enTarifario.has(pid),
    }));
    return { ok: false, error: mensajeHotelVinculado(nombre, paquetes), paquetes };
  }

  const { data: borradas, error } = await sb.from("hoteles").delete().eq("id", id).select("id");
  if (error) {
    // El detalle técnico va solo al registro del servidor, nunca a la pantalla.
    console.error(`eliminarHotel: hotel ${id}: ${error.code ?? "sin código"}: ${error.message}`);
    if (error.code === "23503") return { ok: false, error: mensajeHotelEnUso(nombre, error) };
    return { ok: false, error: `No se pudo eliminar "${nombre}". Intenta de nuevo; si persiste, avisa a soporte.` };
  }
  if (!borradas || borradas.length === 0) {
    return { ok: false, error: `No se eliminó "${nombre}": no tienes permiso para borrarlo o ya no existe.` };
  }
  return { ok: true };
}
