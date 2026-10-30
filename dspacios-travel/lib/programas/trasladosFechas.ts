// Fechas del viaje de un programa con traslado previo y/o posterior (migración 246). Funciones PURAS: las usan la reserva (servidor), el
// formulario y los blackouts de alcance «viaje», para que cuenten el traslado UNA sola vez y por el mismo camino.
//   · Modo HOTEL: `fechaIda` es la entrada al hotel (día 1). El traslado previo es el día anterior; el posterior, el día siguiente al regreso.
//   · Modo SALIDA/CATEGORÍA: `fechaIda` es la salida del programa, que con traslado previo ES el día del traslado (confirmado en Producción:
//     programa_salidas.noches = programas.dias − 1, o sea que NO cuenta esa noche). El traslado previo suma un día al regreso; el posterior, otro.
//   Las noches hoteleras, el precio y las CxP NO leen nada de aquí: solo cambian las fechas del viaje y del contrato.
import { esFechaIso, fechaLegible, sumarDiasIso } from "./estanciaHotel88.ts";

export type Traslados = { previo: boolean; posterior: boolean };

export const trasladosDeItinerario = (dias: readonly { tipo_tramo?: string | null }[] | null | undefined): Traslados => ({
  previo: (dias ?? []).some((d) => d.tipo_tramo === "traslado_previo"),
  posterior: (dias ?? []).some((d) => d.tipo_tramo === "traslado_posterior"),
});

/** Rango real del viaje (extremos inclusivos) según el modo. `noches` = noches de hotel (incluidas + adicionales en modo hotel). */
export function rangoViajeConTraslados(modo: "hotel" | "salida", fechaIda: string, noches: number, t: Traslados): { desde: string; hasta: string } {
  if (modo === "hotel") {
    return { desde: t.previo ? sumarDiasIso(fechaIda, -1) : fechaIda, hasta: sumarDiasIso(fechaIda, noches + (t.posterior ? 1 : 0)) };
  }
  return { desde: fechaIda, hasta: sumarDiasIso(fechaIda, noches + (t.previo ? 1 : 0) + (t.posterior ? 1 : 0)) };
}

/**
 * Fecha de una SALIDA. Semántica (revisada con los llamadores): una salida de un programa por salida es un viaje PUNTUAL que empieza en
 * `fecha_desde`; el formulario no tiene selector de fecha en este modo y siempre envía la `fecha_desde` de la salida elegida. `fecha_hasta` es el
 * final del recorrido, NO el final de un rango de fechas de inicio posibles. Por eso el servidor exige `fechaIda === fecha_desde` (sin importar si hay
 * traslado ni si la salida trae dos extremos) y rechaza una salida sin `fecha_desde`: no hay fecha libre legítima en este modo.
 * Con traslado, además `fecha_hasta` debe ser exactamente donde termina el recorrido (noches + traslados); si no, el contrato saldría con fechas
 * contradictorias. Todo se rechaza ANTES de numerar. Programas por hotel y por categoría no pasan por aquí.
 */
export function errorFechasSalida(
  s: { etiqueta: string | null; fecha_desde: string | null; fecha_hasta: string | null; noches: number | null },
  fechaIda: string,
  t: Traslados,
): string | null {
  const nombre = s.etiqueta ?? "sin nombre";
  if (!esFechaIso(s.fecha_desde)) {
    return `La salida «${nombre}» no tiene fecha de salida cargada, así que no se puede reservar. Cárgala en el programa antes de reservar: no se creó ningún contrato.`;
  }
  if (fechaIda !== s.fecha_desde) {
    return `La salida «${nombre}» sale el ${fechaLegible(s.fecha_desde)} y la reserva trae otra fecha (${esFechaIso(fechaIda) ? fechaLegible(fechaIda) : "no válida"}). `
      + "Reserva en la fecha de la salida elegida: no se creó ningún contrato.";
  }
  if (!(t.previo || t.posterior) || s.noches == null || !esFechaIso(s.fecha_hasta)) return null;
  const esperada = rangoViajeConTraslados("salida", s.fecha_desde, s.noches, t).hasta;
  if (esperada === s.fecha_hasta) return null;
  return `La salida «${nombre}» está cargada del ${fechaLegible(s.fecha_desde)} al ${fechaLegible(s.fecha_hasta)}, pero sus ${s.noches} noches `
    + `más el traslado deberían terminar el ${fechaLegible(esperada)}. Corrige las fechas de la salida (o sus noches) antes de reservar: no se creó ningún contrato.`;
}
