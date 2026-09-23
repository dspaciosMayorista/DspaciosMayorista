// Filtros generales de Vista Booking (Buscar hotel/Categoría/Alimentación/
// Acomodación, `TarifarioPublic.tsx`) aplicados a los resultados de una
// BÚSQUEDA por destino (`BuscadorBooking.tsx` → `EstadoBusquedaPorcion`) —
// NUNCA al catálogo de exploración, que ya se filtra antes de llegar a
// `VistaBooking` (`filasFiltradas`/`hotelesBernaloFiltrados` en
// TarifarioPublic).
//
// Hallazgo corregido: `TarifarioPublic` filtraba `filas` (exploración), pero
// en modo búsqueda `VistaBooking` arma sus tarjetas EXCLUSIVAMENTE desde
// `EstadoBusquedaPorcion.resultados`/`.unidad` (el motor de liquidación en
// vivo) — un array completamente distinto que nunca pasaba por esos
// filtros. Buscar/Categoría/Alimentación/Acomodación quedaban mudos apenas
// el usuario ejecutaba una búsqueda por destino.
//
// Funciones PURAS — sin React, sin Supabase — para poder probarse con datos
// sintéticos.

import type { BusquedaResultado } from "@/lib/reservar/cotizar";
import type { OpcionUnidadConfirmada } from "@/lib/tarifario/evaluarDisponibilidadUnidad";
import type { GrupoOfertaUnidad } from "@/lib/tarifario/recomendados";

export type FiltrosBusquedaBooking = {
  /** "Buscar hotel" (TarifarioPublic `q`) — compara contra nombre de hotel Y
   * de paquete, igual criterio que `coincideFiltro` (exploración). */
  texto: string;
  /** Vacía = sin filtro. */
  categoria: string;
  /** Vacía = sin filtro. */
  regimen: string;
  /** `null` = sin filtro. Valores válidos: los 6 de `ACOM_OPCIONES`
   * (sencilla/doble/triple/multiple/nino/nino2). */
  acomodacion: string | null;
};

export function filtrosBusquedaVacios(): FiltrosBusquedaBooking {
  return { texto: "", categoria: "", regimen: "", acomodacion: null };
}

export function hayFiltroBusquedaActivo(f: FiltrosBusquedaBooking): boolean {
  return !!(f.texto.trim() || f.categoria || f.regimen || f.acomodacion);
}

// Acomodación por HABITACIÓN — el modelo persona reparte pax por habitación
// (sencilla/doble/triple/multiple, `lib/acomodaciones.ts::AcomRoom`); niño/
// niño2 son clasificaciones POR PERSONA dentro de esa distribución, no un
// tipo de habitación (por eso se validan aparte, contra `combo.menores`).
const ROOM_KEYS = new Set(["sencilla", "doble", "triple", "multiple"]);

export type ComboPersonaElegido = { categoria: string; regimen: string; total: number };

export type CoincidenciaPersona =
  | {
      coincide: true;
      /** `null` = ningún filtro de categoría/alimentación/niño obliga a
       * cambiar el combo por defecto (el más barato, `r.categoria`/
       * `r.regimen`/`r.total`) — la tarjeta sigue mostrando exactamente lo
       * que mostraba antes de este ajuste. Presente = el combo por defecto
       * NO cumple el filtro pero otro sí; ESTE es el que hay que forzar
       * (el más barato entre los que sí cumplen), para no dejar en pantalla
       * un precio/categoría/alimentación que el usuario no eligió. */
      comboForzado: ComboPersonaElegido | null;
      /** Contrato explícito (decisión de diseño, no un detalle interno):
       * cuando Categoría/Alimentación/Niño 1/Niño 2 están activos, estos
       * filtros NO son solo "qué hoteles aparecen" — también ACOTAN los
       * combos que la tarjeta puede ofrecer. `null` = sin restricción, el
       * selector interno de la tarjeta sigue mostrando TODOS los combos de
       * `r.combos` (comportamiento de siempre). Un arreglo = la tarjeta debe
       * limitar sus selectores de categoría/alimentación a ESTOS combos —
       * nunca dejar que el usuario, dentro de la tarjeta, vuelva a un combo
       * que el filtro de arriba ya descartó (eso sería una contradicción
       * visual: "Categoría: Superior" arriba y "Estándar" seleccionable
       * adentro). Siempre incluye `comboForzado` (o el default, si ya
       * cumplía) — nunca viene vacío cuando `coincide` es `true`. */
      combosRestringidos: ComboPersonaElegido[] | null;
    }
  | { coincide: false };

/**
 * ¿Este resultado PERSONA de una búsqueda por destino sobrevive a los
 * filtros generales? Y si sobrevive gracias a un combo distinto del
 * predeterminado, ¿cuál es?
 *
 * Auditoría de Acomodación (limitación real, no un defecto a "arreglar"):
 * la composición de habitaciones (`r.habitaciones`) es la que el propio
 * formulario de búsqueda pidió UNA sola vez para TODA la consulta — todos
 * los resultados de una misma búsqueda comparten exactamente la misma
 * composición. Filtrar por Sencilla/Doble/Triple/Múltiple después de
 * buscar no puede distinguir un hotel de otro: o la búsqueda ya incluía esa
 * habitación (pasan todos) o no (no pasa ninguno). No es un bug — es que la
 * composición ya la fijó el buscador, no esta grilla; el filtro sigue
 * siendo honesto (nunca dice que un hotel tiene una habitación que la
 * búsqueda no pidió).
 */
export function personaCoincideFiltros(r: BusquedaResultado, f: FiltrosBusquedaBooking): CoincidenciaPersona {
  if (f.texto.trim()) {
    const hay = `${r.hotelNombre ?? ""} ${r.paqueteNombre ?? ""}`.toLowerCase();
    if (!hay.includes(f.texto.trim().toLowerCase())) return { coincide: false };
  }
  if (f.acomodacion && ROOM_KEYS.has(f.acomodacion) && !((r.habitaciones[f.acomodacion] ?? 0) > 0)) {
    return { coincide: false };
  }
  // Niño 1/Niño 2 SÍ diferencian hotel por hotel (y combo por combo): el
  // umbral de edad que decide si un menor clasifica como "niño"/"niño2" es
  // propio de cada hotel/categoría/régimen (`combo.menores`, ver
  // `BusquedaResultado.combos` en lib/reservar/cotizar.ts) — a diferencia de
  // la composición de habitaciones, esto sí es información real por oferta.
  const necesitaCombo = !!f.categoria || !!f.regimen || f.acomodacion === "nino" || f.acomodacion === "nino2";
  if (!necesitaCombo) return { coincide: true, comboForzado: null, combosRestringidos: null };

  const validos = r.combos.filter((c) =>
    (!f.categoria || c.categoria === f.categoria) &&
    (!f.regimen || c.regimen === f.regimen) &&
    (f.acomodacion !== "nino" || c.menores.nino > 0) &&
    (f.acomodacion !== "nino2" || c.menores.nino2 > 0)
  );
  if (!validos.length) return { coincide: false };

  // El combo por defecto (`r.categoria`/`r.regimen`, el más barato de TODOS)
  // puede o no estar entre los válidos — si lo está y además es el más
  // barato de ESE subconjunto (caso típico), no hace falta "forzar" nada
  // distinto de lo que ya se vería; se calcula igual por simplicidad (mismo
  // resultado, una sola regla en vez de dos).
  const elegido = validos.reduce((a, b) => (b.total < a.total ? b : a));
  const combosRestringidos = validos.map((c) => ({ categoria: c.categoria, regimen: c.regimen, total: c.total }));
  return {
    coincide: true,
    comboForzado: { categoria: elegido.categoria, regimen: elegido.regimen, total: elegido.total },
    combosRestringidos,
  };
}

export type CoincidenciaUnidad<T extends OpcionUnidadConfirmada> =
  | {
      coincide: true;
      opcionForzada: T | null;
      /** Mismo contrato que `combosRestringidos` en persona: `null` = sin
       * restricción (Categoría/Alimentación no estaban activos), la tarjeta
       * sigue ofreciendo TODAS las `opciones` del grupo. Un arreglo = la
       * tarjeta debe limitar sus selectores a ESTAS opciones — nunca dejar
       * elegible una combinación que el filtro de arriba ya descartó. */
      opcionesRestringidas: T[] | null;
    }
  | { coincide: false };

/**
 * ¿Este grupo de opciones UNIDAD (ya repartidas por (hotelId,paqueteId), ver
 * `agruparOpcionesUnidadPorOferta`) sobrevive a los filtros generales?
 *
 * Auditoría de Acomodación (limitación real): el modelo "unidad" (Bernalo)
 * cobra por habitación/apartamento completo, sin la columna sencilla/doble/
 * triple/múltiple/niño/niño2 del modelo "persona" — esa clasificación no
 * existe en sus datos. Mismo criterio YA aplicado en exploración
 * (`TarifarioPublic.tsx`: `hotelesBernalo={fAcom ? [] : ...}` excluye TODO
 * hotel unidad cuando el filtro de Acomodación está activo): acá se excluye
 * el grupo completo en vez de adivinar una equivalencia que no existe.
 */
export function unidadCoincideFiltros<T extends OpcionUnidadConfirmada>(
  g: GrupoOfertaUnidad<T>,
  f: FiltrosBusquedaBooking
): CoincidenciaUnidad<T> {
  if (f.acomodacion) return { coincide: false };
  const primera = g.opciones[0];
  if (!primera) return { coincide: false };
  if (f.texto.trim()) {
    const hay = `${primera.hotelNombre} ${primera.paqueteNombre}`.toLowerCase();
    if (!hay.includes(f.texto.trim().toLowerCase())) return { coincide: false };
  }
  if (!f.categoria && !f.regimen) return { coincide: true, opcionForzada: null, opcionesRestringidas: null };
  const validas = g.opciones.filter((o) =>
    (!f.categoria || o.categoria === f.categoria) &&
    (!f.regimen || o.alimentacion === f.regimen)
  );
  if (!validas.length) return { coincide: false };
  const elegida = validas.reduce((a, b) => (b.precioVenta < a.precioVenta ? b : a));
  return { coincide: true, opcionForzada: elegida, opcionesRestringidas: validas };
}
