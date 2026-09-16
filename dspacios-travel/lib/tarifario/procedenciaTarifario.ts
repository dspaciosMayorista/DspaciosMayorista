// ─────────────────────────────────────────────────────────────────────────
// Forma las columnas de procedencia de `tarifario_resultado` (migración 180)
// a partir de `ProcedenciaNoche[]` (lib/calc/paquetes.ts) — la lista YA
// deduplicada de identidades de noche que produjo la MISMA liquidación que
// calculó el total (nunca se vuelve a resolver nada acá, es solo el
// "empaque" a columnas de base de datos).
//
// Defecto que corrige: `liquidarHotelNochesConTemporadas` solo exponía la
// identidad de la noche de ENTRADA (checkin) — una estadía fija que cruza
// temporadas (noche 1 base, noche 2 promoción) quedaba mal etiquetada. Ahora
// la liquidación devuelve TODAS las identidades reales (deduplicadas); este
// módulo decide cómo representarlas en la fila persistida:
//   - 1 sola identidad → "uniforme": temporada_ganadora/es_promocion/
//     precio_final_autoritativo poblados con ESA identidad (comportamiento
//     visible sin cambios para el caso común de estadías sin cruce).
//   - 2+ identidades → "mixta": temporada_ganadora/es_promocion/
//     precio_final_autoritativo quedan NULL (nunca se elige una
//     arbitrariamente), `procedencia_mixta = true`, y el detalle completo
//     (todas las temporadas, deduplicadas) queda en `procedencia_temporadas`
//     (jsonb) para trazabilidad/auditoría — nunca se serializa como texto.
// El jsonb SIEMPRE se puebla (incluido el caso uniforme, con un solo
// elemento) — es la fuente única de auditoría, las columnas planas son solo
// un atajo de lectura/filtro para el caso simple.
//
// Import relativo (no `@/lib/calc/paquetes`) a propósito — mismo motivo que
// el resto de módulos puros de `lib/tarifario/*`: testeable con `node --test`
// sin loader de paths.
// ─────────────────────────────────────────────────────────────────────────

import type { ProcedenciaNoche } from "../calc/paquetes.ts";

/** Forma de cada elemento de `tarifario_resultado.procedencia_temporadas`
 * (jsonb) — snake_case porque es exactamente lo que se persiste, nunca se
 * re-transforma entre esta función y el `insert`. */
export type ProcedenciaTemporadaJSON = {
  temporada: string;
  es_promocion: boolean;
  precio_final_autoritativo: boolean;
};

export type ColumnasProcedencia = {
  temporada_ganadora: string | null;
  es_promocion: boolean | null;
  precio_final_autoritativo: boolean | null;
  procedencia_temporadas: ProcedenciaTemporadaJSON[];
  procedencia_mixta: boolean;
};

/**
 * `entradas` ausente/vacío (liquidación sin resultado, ej. costoHotel null)
 * → todas las columnas NULL/`[]`/`false`, nunca se inventa una identidad.
 */
export function columnasProcedencia(entradas: ProcedenciaNoche[] | undefined | null): ColumnasProcedencia {
  const lista = entradas ?? [];
  const mixta = lista.length > 1;
  const unica = lista.length === 1 ? lista[0] : null;
  return {
    temporada_ganadora: unica?.temporadaGanadora ?? null,
    es_promocion: unica?.esPromocion ?? null,
    precio_final_autoritativo: unica?.precioFinalAutoritativo ?? null,
    procedencia_temporadas: lista.map((e) => ({
      temporada: e.temporadaGanadora,
      es_promocion: e.esPromocion,
      precio_final_autoritativo: e.precioFinalAutoritativo,
    })),
    procedencia_mixta: mixta,
  };
}
