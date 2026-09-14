// ─────────────────────────────────────────────────────────────────────────
// Composición PÚBLICA/SANEADA (adultos/niños/infantes) de cada habitación
// física de una cotización Bernalo — construida CAMPO A CAMPO desde el
// resultado INTERNO y AUTORITATIVO de `computarReservaBernalo`
// (`HabitacionComputoBernalo.resultado.menoresClasificados`, que a su vez
// sale de `tarifa.reglaMenores` — la clasificación de edad REAL de la
// tarifa, nunca un umbral fijo inventado en el cliente).
//
// Por qué existe: el resumen del carrito (`resumenHabitacionesBernalo`,
// `app/tarifario/CartDrawer.tsx`) mostraba solo "Doble (2 adt)" para un
// hotel `modelo_tarifario = "unidad"` — nunca los menores, porque el ítem
// del carrito (`HotelCartItemBernalo`) nunca transportó esa información.
// Inventar la clasificación en el cliente (ej. "menor de 10 = niño, menor
// de 3 = infante" hardcoded) sería CONTRADECIR la tarifa real de cada hotel
// — la política de edades de Bernalo varía por tarifa (`ReglaEdadMenor`,
// `lib/calc/unidadAlojamiento.ts`), así que la ÚNICA fuente correcta es el
// resultado que YA clasificó el motor al cotizar.
//
// Un menor clasificado tarifariamente como "adulto" (ronda 5 de
// `unidadAlojamiento.ts`: la política Bernalo real de 11+ años "paga tarifa
// normal") se suma a `adultos` — nunca aparece como "niño"/"infante": así
// es como el propio motor lo trata para capacidad y suplementos
// (`aplicarSuplementosUnidad`), y este resumen no puede decir algo distinto
// de lo que el motor ya decidió.
//
// Nunca expone: netos, comisión, proveedor, snapshot, payload ni
// suplementos internos — solo 4 números por habitación (id + 3 conteos).
//
// Módulo PURO (sin "use client"/"use server", sin I/O): se importa directo
// desde `node --test` y desde la Server Action pública
// (`app/tarifario/cotizacionBernaloActions.ts`).
// ─────────────────────────────────────────────────────────────────────────

/** Lo mínimo que necesita este módulo de `MenorClasificado`
 * (`lib/calc/unidadAlojamiento.ts`) — estructural, para no arrastrar la
 * cadena de imports "@/..." de ese archivo. */
export type MenorClasificadoMinimo = { categoriaTarifaria: "infante" | "nino" | "adulto" };

/** Lo mínimo que necesita este módulo de `HabitacionComputoBernalo`
 * (`lib/reservar/computoReservaBernalo.ts`) — estructural, mismo motivo. */
export type HabitacionComputoBernaloMinima = {
  habitacionId: string;
  ocupacion: { adultos: number };
  resultado: { menoresClasificados: readonly MenorClasificadoMinimo[] };
};

/** Composición SANEADA de UNA habitación — las únicas 4 claves que cruzan
 * la frontera pública. */
export type ComposicionHabitacionPublica = {
  habitacionId: string;
  adultos: number;
  ninos: number;
  infantes: number;
};

function contarPorCategoria(menores: readonly MenorClasificadoMinimo[], categoria: "infante" | "nino" | "adulto"): number {
  let n = 0;
  for (const m of menores) if (m.categoriaTarifaria === categoria) n++;
  return n;
}

/**
 * Construye la composición pública de CADA habitación del resultado
 * interno — `adultos` incluye tanto los adultos declarados como los
 * menores que la tarifa clasificó tarifariamente como "adulto" (regla
 * Bernalo 11+ años); `ninos`/`infantes` son EXACTAMENTE los conteos que
 * `menoresClasificados` ya decidió. Nunca lanza; entrada vacía → salida
 * vacía.
 */
export function construirComposicionHabitacionesPublica(
  habitaciones: readonly HabitacionComputoBernaloMinima[]
): ComposicionHabitacionPublica[] {
  return habitaciones.map((h) => ({
    habitacionId: h.habitacionId,
    adultos: h.ocupacion.adultos + contarPorCategoria(h.resultado.menoresClasificados, "adulto"),
    ninos: contarPorCategoria(h.resultado.menoresClasificados, "nino"),
    infantes: contarPorCategoria(h.resultado.menoresClasificados, "infante"),
  }));
}
