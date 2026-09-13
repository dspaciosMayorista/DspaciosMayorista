// ─────────────────────────────────────────────────────────────────────────
// Fase 3C Bernalo — orquestación PURA: dado un hotel Bernalo, fechas de
// entrada/salida, las filas YA leídas de `hotel_temporadas`/
// `hotel_tarifas_unidad` y una colección de `HabitacionOcupacion` (Fase
// 3A), resuelve la temporada de la estadía (`resolverTemporadaEstadia`),
// resuelve la tarifa publicada exacta de cada habitación
// (`seleccionarTarifaAlojamientoPublicada`, Fase 3B) y cotiza
// (`cotizarHabitaciones`, Fase 3A) — sin resultado parcial: cualquier
// bloqueo en cualquier etapa bloquea la colección completa.
//
// CERO Supabase/Next/UI aquí: las filas llegan ya leídas. La frontera
// server-side que las consulta (con cliente de SESIÓN, en tres consultas
// totales — nunca una por habitación) es
// `lib/reservar/resolverCotizacionAlojamientoBernalo.ts`, que solo hace I/O
// y delega TODA la decisión a este archivo.
//
// ── Por qué no se resuelve la tarifa llamando a la frontera de Fase 3B por
// habitación ──────────────────────────────────────────────────────────────
// `resolverTarifaAlojamientoBernalo` (frontera de Fase 3B) consulta TODAS
// las filas publicadas del hotel en cada llamada — su SQL solo filtra por
// `hotel_id`/`estado`, nunca por temporada/categoría/alimentación (esa
// comparación ocurre en memoria, en `seleccionarTarifaAlojamientoPublicada`,
// el resolver PURO). Llamar esa frontera una vez POR HABITACIÓN repetiría la
// MISMA consulta N veces. Aquí las filas se reciben una sola vez y el
// resolver puro de Fase 3B se llama en memoria, una vez por clasificación
// (categoría, alimentación) DISTINTA — deduplicada antes de resolver.
// ─────────────────────────────────────────────────────────────────────────

import { toTemporadaRango, type TemporadaRango } from "./paquetes.ts";
import { resolverTemporadaEstadia, type ResolucionTemporadaEstadiaBloqueada } from "./resolverTemporadaEstadia.ts";
import {
  seleccionarTarifaAlojamientoPublicada,
  type CriterioResolucionTarifa,
  type ResolucionTarifaBloqueada,
  type ResultadoResolucionTarifa,
} from "./resolverTarifaAlojamiento.ts";
import {
  cotizarHabitaciones,
  type HabitacionOcupacion,
  type ItemCotizarHabitacion,
  type ResultadoColeccionCotizada,
  type ResultadoColeccionBloqueada,
} from "./ocupacionHabitacion.ts";

export type DatosOrquestacionBernalo = {
  hotelId: number;
  /** `hoteles.modelo_tarifario` ya leído — `null` si el hotel no existe. */
  modeloTarifario: string | null;
  /** Filas crudas de `hotel_temporadas` del hotel, ya leídas (sin filtrar). */
  temporadasRaw: unknown[];
  /** Filas crudas de `hotel_tarifas_unidad` DEL HOTEL, estado `publicada` (ya filtradas por SQL o no — este archivo vuelve a filtrar por columnas exactas de todos modos, ver Fase 3B). */
  filasTarifas: unknown[];
  fechaIda: string;
  fechaRegreso: string;
  /** Fecha de "hoy" (yyyy-mm-dd) para la vigencia de compra — obligatoria, sin `Date.now()` oculto. */
  hoy: string;
  habitaciones: HabitacionOcupacion[];
};

export type ResultadoOrquestacionBernaloOk = ResultadoColeccionCotizada & {
  hotelId: number;
  temporada: string;
  fechaIda: string;
  fechaRegreso: string;
  noches: number;
};

export type ResultadoOrquestacionBernaloBloqueada =
  | { ok: false; codigo: "sin_habitaciones"; mensaje: string; contexto: Record<string, unknown> }
  | { ok: false; codigo: "modelo_no_bernalo"; mensaje: string; contexto: Record<string, unknown> }
  | { ok: false; codigo: "habitacion_noches_inconsistente"; mensaje: string; contexto: Record<string, unknown> }
  | ResolucionTemporadaEstadiaBloqueada
  | (ResolucionTarifaBloqueada & { habitacionId: string })
  | ResultadoColeccionBloqueada;

export type ResultadoOrquestacionBernalo = ResultadoOrquestacionBernaloOk | ResultadoOrquestacionBernaloBloqueada;

// `null` no es comodín (mismo criterio que Fase 3B, regla 4): dos
// habitaciones con `categoria: null` SÍ comparten clave — es una
// clasificación real ("sin categoría"), no un valor ausente aparte.
function claveClasificacion(categoria: string | null, alimentacion: string | null): string {
  return JSON.stringify([categoria, alimentacion]);
}

/**
 * Orquesta la Fase 3C completa a partir de datos YA leídos (puro, sin I/O).
 * La misma entrada produce siempre el mismo resultado.
 */
export function orquestarCotizacionAlojamientoBernalo(datos: DatosOrquestacionBernalo): ResultadoOrquestacionBernalo {
  if (datos.habitaciones.length === 0) {
    return { ok: false, codigo: "sin_habitaciones", mensaje: "No hay habitaciones para cotizar.", contexto: { hotelId: datos.hotelId } };
  }

  // 1) Guardia: solo hoteles Bernalo por unidad. Fail-closed también cuando
  // el hotel no existe (`modeloTarifario` llega `null`).
  if (datos.modeloTarifario !== "unidad") {
    return {
      ok: false,
      codigo: "modelo_no_bernalo",
      mensaje: `El hotel ${datos.hotelId} no usa el modelo tarifario Bernalo por unidad (modelo_tarifario=${datos.modeloTarifario ?? "hotel no encontrado"}).`,
      contexto: { hotelId: datos.hotelId, modeloTarifario: datos.modeloTarifario },
    };
  }

  // 2) Calendario autoritativo (Fase 3C — reutiliza `temporadaVigenteParaFecha`
  // vía `resolverTemporadaEstadia`, sin reimplementar sus reglas).
  const temporadas: TemporadaRango[] = datos.temporadasRaw.map((t) => toTemporadaRango(t as Parameters<typeof toTemporadaRango>[0]));
  const resolucionTemporada = resolverTemporadaEstadia(temporadas, datos.fechaIda, datos.fechaRegreso, datos.hoy);
  if (!resolucionTemporada.ok) return resolucionTemporada;

  // Cada habitación debe describir la MISMA cantidad de noches que la
  // estadía — nunca se sobreescribe en silencio un valor distinto que el
  // llamador haya puesto en `HabitacionOcupacion.noches`.
  const habitacionesConNochesInvalidas = datos.habitaciones.filter((h) => h.noches !== resolucionTemporada.noches);
  if (habitacionesConNochesInvalidas.length > 0) {
    return {
      ok: false,
      codigo: "habitacion_noches_inconsistente",
      mensaje: `${habitacionesConNochesInvalidas.length} habitación(es) declaran una cantidad de noches distinta a la de la estadía (${resolucionTemporada.noches}).`,
      contexto: {
        nochesEstadia: resolucionTemporada.noches,
        habitaciones: habitacionesConNochesInvalidas.map((h) => ({ id: h.id, noches: h.noches })),
      },
    };
  }

  // 3) Tarifas Bernalo: el resolver PURO de Fase 3B, una vez por
  // clasificación (categoría, alimentación) DISTINTA — deduplicada.
  const clasificacionesDistintas = new Map<string, CriterioResolucionTarifa>();
  for (const h of datos.habitaciones) {
    const clave = claveClasificacion(h.categoria, h.alimentacion);
    if (!clasificacionesDistintas.has(clave)) {
      clasificacionesDistintas.set(clave, {
        hotelId: datos.hotelId,
        temporada: resolucionTemporada.temporada,
        categoria: h.categoria,
        alimentacion: h.alimentacion,
      });
    }
  }

  const resolucionesPorClave = new Map<string, ResultadoResolucionTarifa>();
  for (const [clave, criterio] of clasificacionesDistintas) {
    resolucionesPorClave.set(clave, seleccionarTarifaAlojamientoPublicada(datos.filasTarifas, criterio));
  }

  // 4) Cualquier clasificación sin tarifa resuelta bloquea TODO (fail-closed,
  // sin resultado parcial) — se reporta la primera, con la habitación que la
  // originó, para diagnóstico.
  for (const h of datos.habitaciones) {
    const resolucion = resolucionesPorClave.get(claveClasificacion(h.categoria, h.alimentacion))!;
    if (!resolucion.ok) {
      return { ...resolucion, habitacionId: h.id };
    }
  }

  // 5) Cotización: una llamada al motor por habitación FÍSICA (Fase 3A).
  const items: ItemCotizarHabitacion[] = datos.habitaciones.map((h) => {
    const resolucion = resolucionesPorClave.get(claveClasificacion(h.categoria, h.alimentacion))!;
    const ok = resolucion as Extract<ResultadoResolucionTarifa, { ok: true }>;
    return { habitacion: h, tarifa: ok.tarifa };
  });

  const resultado = cotizarHabitaciones(items);
  if (!resultado.ok) return resultado;

  return {
    ...resultado,
    hotelId: datos.hotelId,
    temporada: resolucionTemporada.temporada,
    fechaIda: datos.fechaIda,
    fechaRegreso: datos.fechaRegreso,
    noches: resolucionTemporada.noches,
  };
}
