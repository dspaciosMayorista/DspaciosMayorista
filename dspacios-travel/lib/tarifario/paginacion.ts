import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const PAGE = 1000;
export const PAGINAS_CONCURRENTES = 6;

export type ResultadoPaginado<T> =
  | { ok: true; filas: T[]; paginasConsultadas: number }
  | { ok: false; paginasConsultadas: number; error: unknown };

type RespuestaPagina<T> = { data: T[] | null; error: unknown };

async function consultarPagina<T>(
  sb: SupabaseClient<Database>,
  columnas: string,
  indice: number
): Promise<RespuestaPagina<T>> {
  const from = indice * PAGE;
  const { data, error } = await sb
    .from("tarifario_resultado")
    .select(columnas)
    .eq("paquete_activo", true)
    .order("destino_nombre")
    .order("bloqueo_label")
    .order("hotel_nombre")
    .order("categoria")
    .order("regimen")
    // Desempates estables para que una fila no cambie de pagina entre
    // consultas paralelas cuando comparte los cinco campos anteriores.
    .order("modulo")
    .order("paquete_id")
    .order("bloqueo_id")
    .order("empaquetado_id")
    .order("salida_id")
    .order("hotel_id")
    .order("servicio_id")
    .order("tipo_tarifa")
    .order("pax_desde")
    .order("pax_hasta")
    .order("acomodacion")
    .order("precio_pvp")
    .range(from, from + PAGE - 1);
  return { data: data as unknown as T[] | null, error };
}

/**
 * Carga el catalogo completo conservando su orden y contenido. La primera
 * pagina se consulta sola para mantener barato el caso de catalogos pequenos.
 * Si viene llena, el resto se consulta en lotes acotados: reduce la latencia
 * acumulada sin abrir una rafaga ilimitada contra PostgREST.
 */
export async function cargarFilasTarifarioPaginado<T>(
  sb: SupabaseClient<Database>,
  columnas: string
): Promise<ResultadoPaginado<T>> {
  const filas: T[] = [];
  let paginasConsultadas = 0;

  const primera = await consultarPagina<T>(sb, columnas, 0);
  paginasConsultadas++;
  if (primera.error) return { ok: false, paginasConsultadas, error: primera.error };
  const primeraData = primera.data ?? [];
  filas.push(...primeraData);
  if (primeraData.length < PAGE) return { ok: true, filas, paginasConsultadas };

  for (let inicio = 1; ; inicio += PAGINAS_CONCURRENTES) {
    const lote = await Promise.all(
      Array.from({ length: PAGINAS_CONCURRENTES }, (_, offset) =>
        consultarPagina<T>(sb, columnas, inicio + offset)
      )
    );
    paginasConsultadas += lote.length;

    const conError = lote.find((pagina) => pagina.error);
    if (conError) return { ok: false, paginasConsultadas, error: conError.error };

    let termino = false;
    for (const pagina of lote) {
      if (termino) break;
      const data = pagina.data ?? [];
      filas.push(...data);
      if (data.length < PAGE) termino = true;
    }
    if (termino) return { ok: true, filas, paginasConsultadas };
  }
}

