// ─────────────────────────────────────────────────────────────────────────
// Fase 3C Bernalo — calendario autoritativo: qué temporada aplica a CADA
// noche de una estadía (entrada inclusiva, salida exclusiva), y si esa
// estadía puede representarse con una sola tarifa Bernalo.
//
// Objetivo de este archivo, y SOLO este (ver el informe de la tarea):
// resolver la temporada de la estadía reutilizando el resolver detallado
// que YA decide qué `hotel_temporadas` cubre una fecha y por qué —
// `resolverNocheDetallado` (`lib/calc/paquetes.ts`), que reusa a su vez
// `entradasNoche`/`cubreFecha`/`compraVigente` sin duplicarlas. Este
// archivo NO reimplementa ni copia esas reglas — solo llama al resolver
// detallado una vez por noche y decide qué hacer con cada motivo.
//
// Fuera de alcance de este archivo (fases futuras, explícitamente):
//   - Consultar Supabase (`hotel_temporadas` llega ya leída, mapeada a
//     `TemporadaRango[]` por el llamador — la frontera server-side está en
//     `lib/reservar/resolverCotizacionAlojamientoBernalo.ts`).
//   - Resolver la tarifa Bernalo en sí (Fase 3B, `resolverTarifaAlojamiento.ts`).
//   - Cotizar (Fase 3A, `ocupacionHabitacion.ts`).
//
// Antes de esta ronda, un blackout y una fecha genuinamente sin temporada
// configurada colapsaban en el mismo `null` (vía `temporadaVigenteParaFecha`)
// y este archivo los bloqueaba con el mismo código, sin poder decir cuál
// de los dos pasó. Ahora `resolverNocheDetallado` distingue el motivo
// (`en_blackout` / `fuera_de_vigencia_compra` / `sin_cobertura`) sin haber
// cambiado NINGUNA regla de selección — solo lo hace observable. Este
// archivo mapea esos motivos a dos códigos públicos: `blackout` (motivo
// exacto: la fecha está deliberadamente excluida) y `temporada_no_resuelta`
// (agrupa "sin cobertura" y "fuera de vigencia de compra" — ambos son, para
// quien reserva, la misma situación: no hay una tarifa vigente para esa
// fecha, a diferencia de un blackout, que sí tiene una tarifa configurada
// pero deliberadamente apagada para esa fecha puntual).
// ─────────────────────────────────────────────────────────────────────────

import { resolverNocheDetallado, noches, type TemporadaRango } from "./paquetes.ts";

export type ResolucionTemporadaEstadiaOk = {
  ok: true;
  temporada: string;
  noches: number;
  fechaIda: string;
  fechaRegreso: string;
};

export type CodigoTemporadaEstadia =
  | "fechas_invalidas"
  | "blackout"
  | "temporada_no_resuelta"
  | "estadia_multitemporada_no_soportada";

export type ResolucionTemporadaEstadiaBloqueada = {
  ok: false;
  codigo: CodigoTemporadaEstadia;
  mensaje: string;
  contexto: Record<string, unknown>;
};

export type ResultadoTemporadaEstadia = ResolucionTemporadaEstadiaOk | ResolucionTemporadaEstadiaBloqueada;

function fechaISOaDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function esFechaISOValida(iso: unknown): iso is string {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return !Number.isNaN(fechaISOaDate(iso).getTime());
}

// Fecha (como `Date` y como ISO) de la noche `indiceNoche` de la estadía
// (0 = noche de entrada). `setDate` sobre una copia fresca de `fechaIda` —
// nunca se muta un `Date` compartido entre iteraciones.
function nocheDesde(fechaIda: string, indiceNoche: number): { fecha: Date; iso: string } {
  const fecha = fechaISOaDate(fechaIda);
  fecha.setDate(fecha.getDate() + indiceNoche);
  return { fecha, iso: fecha.toLocaleDateString("en-CA") };
}

/**
 * Resuelve la temporada aplicable a una estadía completa: una noche por cada
 * día desde `fechaIda` (INCLUSIVE) hasta el día ANTERIOR a `fechaRegreso`
 * (salida EXCLUSIVA — la noche de la fecha de regreso no se cobra).
 *
 * - Fechas inválidas o cero noches → bloqueado `fechas_invalidas`.
 * - Alguna noche en un blackout → bloqueado `blackout`, con la fecha exacta.
 * - Alguna noche sin cobertura o fuera de vigencia de compra → bloqueado
 *   `temporada_no_resuelta`, con la fecha exacta.
 * - La estadía cubre más de una temporada distinta → bloqueado
 *   `estadia_multitemporada_no_soportada` (el motor Bernalo representa una
 *   tarifa por ESTADÍA completa — dividirla podría duplicar suplementos
 *   "por estadía"; no se aproxima, se bloquea).
 * - Todas las noches resuelven la MISMA temporada → éxito.
 *
 * `hoy` es obligatorio (no usa `Date.now()` internamente): la misma entrada
 * produce siempre el mismo resultado.
 */
export function resolverTemporadaEstadia(
  temporadas: TemporadaRango[],
  fechaIda: string,
  fechaRegreso: string,
  hoy: string
): ResultadoTemporadaEstadia {
  if (!esFechaISOValida(fechaIda) || !esFechaISOValida(fechaRegreso)) {
    return {
      ok: false,
      codigo: "fechas_invalidas",
      mensaje: "La fecha de entrada o de salida no es una fecha válida (yyyy-mm-dd).",
      contexto: { fechaIda, fechaRegreso },
    };
  }

  const numNoches = noches(fechaIda, fechaRegreso);
  if (numNoches <= 0) {
    return {
      ok: false,
      codigo: "fechas_invalidas",
      mensaje: "La fecha de salida debe ser posterior a la de entrada (la estadía debe tener al menos una noche).",
      contexto: { fechaIda, fechaRegreso, noches: numNoches },
    };
  }

  const resueltas: { fecha: string; resolucion: ReturnType<typeof resolverNocheDetallado> }[] = [];
  for (let i = 0; i < numNoches; i++) {
    const { fecha, iso } = nocheDesde(fechaIda, i);
    resueltas.push({ fecha: iso, resolucion: resolverNocheDetallado(fecha.getTime(), temporadas, hoy) });
  }

  const primeraEnBlackout = resueltas.find((r) => !r.resolucion.ok && r.resolucion.motivo === "en_blackout");
  if (primeraEnBlackout && !primeraEnBlackout.resolucion.ok) {
    return {
      ok: false,
      codigo: "blackout",
      mensaje: `La noche del ${primeraEnBlackout.fecha} cae en un blackout: hay una temporada configurada para esa fecha, pero está excluida deliberadamente.`,
      contexto: {
        fecha: primeraEnBlackout.fecha,
        fechaIda,
        fechaRegreso,
        temporadas: primeraEnBlackout.resolucion.temporadasImplicadas.map((t) => t.nombre),
      },
    };
  }

  const primeraSinResolver = resueltas.find((r) => !r.resolucion.ok);
  if (primeraSinResolver && !primeraSinResolver.resolucion.ok) {
    return {
      ok: false,
      codigo: "temporada_no_resuelta",
      mensaje: `No hay una temporada vigente (${primeraSinResolver.resolucion.motivo === "fuera_de_vigencia_compra" ? "fuera de vigencia de compra" : "sin cobertura configurada"}) para la noche del ${primeraSinResolver.fecha}.`,
      contexto: { fecha: primeraSinResolver.fecha, fechaIda, fechaRegreso, motivo: primeraSinResolver.resolucion.motivo },
    };
  }

  const resultasOk = resueltas as { fecha: string; resolucion: Extract<ReturnType<typeof resolverNocheDetallado>, { ok: true }> }[];
  const distintas = [...new Set(resultasOk.map((r) => r.resolucion.temporada.nombre))];
  if (distintas.length > 1) {
    return {
      ok: false,
      codigo: "estadia_multitemporada_no_soportada",
      mensaje: `La estadía del ${fechaIda} al ${fechaRegreso} cruza ${distintas.length} temporadas distintas (${distintas.join(", ")}) — dividir la tarifa Bernalo entre temporadas no está soportado todavía: el motor representa una tarifa por estadía completa, y dividirla podría duplicar suplementos "por estadía".`,
      contexto: { temporadas: distintas, fechaIda, fechaRegreso },
    };
  }

  return { ok: true, temporada: distintas[0], noches: numNoches, fechaIda, fechaRegreso };
}
