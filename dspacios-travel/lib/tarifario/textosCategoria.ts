// #45 (303): descripción y «qué incluye» por categoría DENTRO de cada hotel, para la ficha pública/interna del tarifario.
// Best-effort y decorativo: un fallo (incluida la ausencia de la 303, 42703) deja la ficha sin estos textos y NUNCA toca precio,
// combinaciones ni disponibilidad. Solo se leen filas con algún texto; se pagina por la cantidad real recibida (límite de filas de PostgREST).
import { createAdminClient } from "../supabase/admin.ts";

export type TextosCategoriaPorHotel = Record<number, Record<string, { descripcion: string | null; incluye: string | null }>>;
type Fila = { hotel_id: number; descripcion: string | null; incluye: string | null; categorias_habitacion: { nombre: string } | null };

const PAGINA = 1000;
const MAX_PAGINAS = 50;

/** Pura: filas leídas → mapa hotelId → nombre de categoría → textos (vacíos y espacios se descartan). */
export function agruparTextosCategoria(filas: readonly Fila[]): TextosCategoriaPorHotel {
  const out: TextosCategoriaPorHotel = {};
  for (const f of filas) {
    const nombre = f.categorias_habitacion?.nombre;
    const descripcion = f.descripcion?.trim() || null;
    const incluye = f.incluye?.trim() || null;
    if (!nombre || (!descripcion && !incluye)) continue;
    (out[f.hotel_id] ??= {})[nombre] = { descripcion, incluye };
  }
  return out;
}

export async function cargarTextosCategoria(hotelIds: readonly number[]): Promise<{ textos: TextosCategoriaPorHotel; error: string | null }> {
  const ids = [...new Set(hotelIds)].filter((x) => Number.isSafeInteger(x) && x > 0);
  if (!ids.length) return { textos: {}, error: null };
  try {
    const admin = createAdminClient();
    const filas: Fila[] = [];
    for (let i = 0, desde = 0; i < MAX_PAGINAS; i++) {
      const { data, error } = await admin.from("hotel_categorias")
        .select("hotel_id, categoria_id, descripcion, incluye, categorias_habitacion(nombre)")
        .in("hotel_id", ids).or("descripcion.not.is.null,incluye.not.is.null")
        .order("hotel_id").order("categoria_id")
        .range(desde, desde + PAGINA - 1);
      if (error) return { textos: {}, error: error.message };
      const pag = (data ?? []) as unknown as Fila[];
      if (!pag.length) return { textos: agruparTextosCategoria(filas), error: null };
      filas.push(...pag);
      desde += pag.length;
    }
    return { textos: agruparTextosCategoria(filas), error: "límite de páginas alcanzado" };
  } catch (e) {
    return { textos: {}, error: e instanceof Error ? e.message : "error desconocido" };
  }
}
