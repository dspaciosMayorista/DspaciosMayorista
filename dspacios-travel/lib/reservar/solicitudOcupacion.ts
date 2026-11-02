// #120 · Ocupación de una solicitud a pedido — módulo PURO (import relativo: se prueba con `node --test`). Es EXACTAMENTE la regla del motor (`computarReserva`):
//   plazas de adulto = habitaciones × pax de tarifa de cada acomodación,
//   menores clasificados por EDAD con el umbral del hotel (`clasificarMenoresPorEdad`: infante / niño) y repartidos por habitación (`distribuirPorHabitaciones`).
// ADULTOS REALES (regla confirmada por el dueño): una doble con 1 adulto real + 1 niño real tiene 2 viajeros, no «2 adultos + 1 niño». Para el hotel el niño ocupa la plaza que se
// cobra como adulto (`pax_tarifa`); para vuelo, sillas, servicios y contrato rige el número REAL de personas. Sin `adultosReales` los adultos son las plazas (todo como siempre).
// Sin `hotel_acomodaciones` configuradas rigen los DEFAULTS del motor (`defaultAcomConfig`: pax_max = pax de tarifa → una doble no admite niños ADICIONALES a sus 2 plazas); por eso un hotel
// sin configurar rechaza a los menores de más aquí igual que lo haría al valorar o reservar.
import { ACOM_ROOMS, defaultAcomConfig, type AcomConfig } from "../acomodaciones.ts";
import { distribuirPorHabitaciones, type HabitacionConsultada } from "./distribucionHabitaciones.ts";
import { clasificarMenoresPorEdad } from "./edadesMenores.ts";
import type { ConteosViajeros } from "./solicitudHotel.ts";

export type ResultadoOcupacion = { ok: true; conteos: ConteosViajeros } | { ok: false; error: string };

/**
 * Reparte los adultos REALES entre las habitaciones (en el orden de captura): cada habitación conserva al menos 1 adulto y las plazas de adulto que sobran (hasta `pax_tarifa − 1`
 * por habitación) quedan libres para niños. Determinista: las plazas libres se quitan de la primera habitación que pueda cederlas. Pura.
 */
export function repartirAdultosReales(plazasPorHabitacion: readonly number[], adultosReales: unknown):
  { ok: true; adultosPorHabitacion: number[]; plazasLibres: number } | { ok: false; error: string } {
  const plazas = plazasPorHabitacion.reduce((s, p) => s + p, 0);
  if (typeof adultosReales !== "number" || !Number.isInteger(adultosReales) || adultosReales < 1) return { ok: false, error: "Indica cuántos adultos viajan (al menos 1)." };
  if (adultosReales > plazas) return { ok: false, error: `Las habitaciones elegidas son para ${plazas} adulto(s); declaraste ${adultosReales}. Ajusta la cantidad de habitaciones o de adultos.` };
  if (adultosReales < plazasPorHabitacion.length)
    return { ok: false, error: `Cada habitación necesita al menos un adulto: con ${plazasPorHabitacion.length} habitación(es) se necesitan ${plazasPorHabitacion.length} adulto(s) como mínimo; declaraste ${adultosReales}.` };
  let libres = plazas - adultosReales;
  const adultosPorHabitacion = plazasPorHabitacion.map((p) => { const cede = Math.min(libres, p - 1); libres -= cede; return p - cede; });
  return { ok: true, adultosPorHabitacion, plazasLibres: plazas - adultosReales };
}

/** Mensaje si las plazas de adulto libres (plazas − adultos reales) no las puede ocupar un niño real; `null` = coherente. Lo comparten la solicitud y el motor (misma regla, un solo texto). */
export function errorPlazasLibres(plazas: number, adultos: number, ninos: number): string | null {
  const libres = plazas - adultos;
  if (libres <= 0 || ninos >= libres) return null;
  return `Las habitaciones elegidas tienen ${plazas} plaza(s) de adulto y declaraste ${adultos} adulto(s): ${libres === 1 ? "la plaza libre solo puede ocuparla" : `las ${libres} plazas libres solo pueden ocuparlas`} niño(s) y hay ${ninos}. Declara a los niños o ajusta los adultos o las habitaciones.`;
}

export function evaluarOcupacionSolicitud(i: {
  habitaciones: Record<string, number>;
  edadesMenores: readonly number[];
  reglas: readonly AcomConfig[];
  /** Umbrales de edad del hotel (referidos a la fecha de salida: las edades de la consulta ya son las del viaje). */
  reglaEdad: { infanteMax: number; ninoMax: number };
  /** Adultos que viajan de verdad (opcional; ausente = las plazas de adulto de las habitaciones). Solo un NIÑO puede ocupar una plaza de adulto libre. */
  adultosReales?: number | null;
}): ResultadoOcupacion {
  const habitaciones: HabitacionConsultada[] = [];
  for (const a of ACOM_ROOMS) {
    const n = Math.max(0, Math.trunc(Number(i.habitaciones?.[a]) || 0));
    if (n <= 0) continue;
    const config = i.reglas.find((x) => x.acomodacion === a) ?? defaultAcomConfig(a);
    for (let k = 0; k < n; k++) habitaciones.push({ acom: a, config });
  }
  if (!habitaciones.length) return { ok: false, error: "Indica al menos una habitación." };
  const plazas = habitaciones.reduce((s, h) => s + h.config.pax_tarifa, 0);
  let adultos = plazas;
  let adultosPorHabitacion: number[] | undefined;
  if (i.adultosReales != null) {
    const r = repartirAdultosReales(habitaciones.map((h) => h.config.pax_tarifa), i.adultosReales);
    if (!r.ok) return { ok: false, error: r.error };
    adultos = i.adultosReales; adultosPorHabitacion = r.adultosPorHabitacion;
  }
  const clas = clasificarMenoresPorEdad([...i.edadesMenores], i.reglaEdad.infanteMax, i.reglaEdad.ninoMax);
  if (!clas.ok) return { ok: false, error: clas.error };
  const errLibres = errorPlazasLibres(plazas, adultos, clas.c.ninos);
  if (errLibres) return { ok: false, error: errLibres };
  const dist = distribuirPorHabitaciones({ adultosDeclarados: adultos, ninos: clas.c.ninos, infantes: clas.c.infantes, habitaciones, adultosPorHabitacion });
  if (!dist.ok) return { ok: false, error: dist.error };
  return { ok: true, conteos: { adultos, ninos: dist.totales.nino + dist.totales.nino2, infantes: dist.totales.infantes } };
}
