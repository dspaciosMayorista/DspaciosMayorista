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

// ⚠️ Revisión posterior — defecto "PAGINACIÓN IGNORA ERRORES" confirmado:
// antes el bucle desestructuraba SOLO `data` (`const { data: page } = ...`),
// descartando `error` por completo. Un error técnico real de Supabase
// (timeout, RLS inesperada, service caído) quedaba INDISTINGUIBLE de "no
// hay más filas" — `page` llega `null` en ambos casos — así que el bucle
// simplemente paraba, `cargarFilasTarifarioPaginado` devolvía lo que
// llevara acumulado hasta ahí (0 filas si el error fue en la primera
// página) como si fuera un resultado VÁLIDO, y la medición registraba
// `resultado=ok`. Consecuencia real: un fallo de red se veía en el
// tarifario público como "no hay tarifas" — información falsa, no solo
// datos incompletos.
//
// `ResultadoPaginado<T>` ahora distingue explícitamente 3 casos:
//   - éxito con filas (`ok: true`, `filas` puede estar vacío si de verdad
//     no hay tarifas activas — eso SÍ es un resultado válido);
//   - error técnico (`ok: false`) — el caller decide cómo abortar/loguear,
//     esta función nunca imprime nada ni sanea el error (eso es
//     responsabilidad de quien tiene el `flujo`/`flujoId`).
// Una página vacía LEGÍTIMA (`data: []`, `error: null` — Supabase siempre
// devuelve un array, nunca null, cuando la consulta en sí no falla) sigue
// terminando el bucle con `ok: true` y corta exactamente como antes.
export type ResultadoPaginado<T> =
  | {
      ok: true;
      filas: T[];
      /** Round-trips reales hechos a Supabase (incluye el último, que puede volver vacío). */
      paginasConsultadas: number;
    }
  | {
      ok: false;
      /** Round-trips hechos ANTES de encontrar el error (incluye el que falló). */
      paginasConsultadas: number;
      /** Error crudo de Supabase — el caller lo sanea con registrarErrorTecnico(), nunca se expone tal cual. */
      error: unknown;
    };

/**
 * Carga TODAS las filas de `tarifario_resultado` (`paquete_activo = true`)
 * para el set de columnas dado, paginando de a 1000. `columnas` es el mismo
 * string que antes se pasaba directo a `.select(...)` en cada copia del
 * bucle — sin cambios de comportamiento en el caso de éxito, solo sin
 * duplicar el bucle y con manejo explícito de error (ver arriba).
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
    const { data: page, error } = await sb
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
    if (error) return { ok: false, paginasConsultadas, error };
    if (!page || page.length === 0) break; // página válida vacía (sin error) — fin real de los datos
    filas.push(...(page as unknown as T[]));
    if (page.length < PAGE) break;
  }
  return { ok: true, filas, paginasConsultadas };
}
