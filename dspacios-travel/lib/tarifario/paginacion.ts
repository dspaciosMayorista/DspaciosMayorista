import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Diagnóstico del incidente de ~13s en /dashboard/reservar, /dashboard/
// tarifario y /tarifario: las tres rutas leen `tarifario_resultado`
// paginando de a 1000 filas (límite de fila de PostgREST), pero antes cada
// una tenía su PROPIA copia del mismo bucle (`lib/tarifario/datos.ts` para
// Reservar/público, `app/(dashboard)/dashboard/tarifario/page.tsx` para el
// tarifario interno) — con el mismo comportamiento exacto pero duplicado.
// Este es el ÚNICO lugar donde vive ese bucle ahora.
//
// Deliberadamente NO trae el enriquecimiento de Vista Booking (cupos, fotos,
// hoteles, planes, vigencia, etc.) — eso sigue siendo exclusivo de
// `cargarDatosTarifario()` (lib/tarifario/datos.ts). El tarifario interno
// (`/dashboard/tarifario`) usa este cargador con SU PROPIO set de columnas,
// más liviano — reusar `cargarDatosTarifario()` ahí aumentaría sus consultas
// y su payload sin necesidad (esa ruta no necesita cupos/fotos/capacidades).
const PAGE = 1000;

export type ResultadoPaginado<T> = {
  filas: T[];
  /** Round-trips reales hechos a Supabase (incluye el último, que puede volver vacío). */
  paginasConsultadas: number;
};

/**
 * Carga TODAS las filas de `tarifario_resultado` (`paquete_activo = true`)
 * para el set de columnas dado, paginando de a 1000. `columnas` es el mismo
 * string que antes se pasaba directo a `.select(...)` en cada copia del
 * bucle — sin cambios de comportamiento, solo sin duplicar el bucle.
 *
 * Nota de conteo: si el total de filas es un múltiplo EXACTO de 1000 (ej.
 * 1000, 2000), el bucle hace UN round-trip extra que vuelve vacío para
 * confirmar que no hay más — comportamiento heredado tal cual del código
 * original, no introducido por esta extracción. `paginasConsultadas` cuenta
 * ese round-trip también (es tráfico real hecho a Supabase).
 */
export async function cargarFilasTarifarioPaginado<T>(
  sb: SupabaseClient<Database>,
  columnas: string
): Promise<ResultadoPaginado<T>> {
  const filas: T[] = [];
  let paginasConsultadas = 0;
  for (let from = 0; ; from += PAGE) {
    const { data: page } = await sb
      .from("tarifario_resultado")
      .select(columnas)
      .eq("paquete_activo", true)
      .order("destino_nombre")
      .order("bloqueo_label")
      .order("hotel_nombre")
      .order("categoria")
      .order("regimen")
      .range(from, from + PAGE - 1);
    paginasConsultadas++;
    if (!page || page.length === 0) break;
    filas.push(...(page as unknown as T[]));
    if (page.length < PAGE) break;
  }
  return { filas, paginasConsultadas };
}
