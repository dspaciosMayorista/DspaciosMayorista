// Menores, capacidad y edades del hotel del paquete dinámico (#82). PURO: sin I/O, sin "use client"/"use server".
// REUTILIZA las reglas de las reservas normales (no las reescribe): clasificación por edad (`clasificarMenoresPorEdad`), reparto por habitación
// (`distribuirPorHabitaciones`: Niño 1 y Niño 2 son DOS TARIFAS por habitación, no rangos de edad) y validación de capacidad/pax del hotel
// (`validarReservaHabitaciones`). Lo usan igual la pantalla (tarjeta y checkout) y el servidor: quien llega al servidor se revalida desde cero.
import { ACOM_ROOMS, PAX_TARIFA_DEFAULT, defaultAcomConfig, validarReservaHabitaciones, type AcomConfig, type AcomRoom } from "@/lib/acomodaciones";
import { distribuirPorHabitaciones, type AsignacionHabitacion, type HabitacionConsultada } from "@/lib/reservar/distribucionHabitaciones";
import { MAX_MENORES_POR_CONSULTA, clasificarMenoresPorEdad, validarEdadesMenores } from "@/lib/reservar/edadesMenores";
import { esMenorDeDos } from "@/lib/reservar/menoresDeDos";
import { REGLA_EDAD_DEFAULT, construirReglaEdadDesdeMaximos, normalizarReglaEdadGeneral, validarRangoReglaEdad } from "@/lib/calc/reglaEdadTarifa";

/** El sistema cobra como máximo dos niños por habitación (Niño 1 y Niño 2). */
export const CAPACIDAD_NINOS_MAX = 2;

export type ReglasHotelDin = {
  infanteMax: number;
  ninoMax: number;
  /** Capacidad por tipo de habitación (misma forma que `hotel_acomodaciones`). */
  reglas: AcomConfig[];
  paxMin: number | null;
  paxMax: number | null;
  adultsOnly: boolean;
  origen: "manual" | "ficha";
};

export const EDADES_MANUAL_POR_DEFECTO = { infanteMax: REGLA_EDAD_DEFAULT.infanteMax, ninoMax: REGLA_EDAD_DEFAULT.ninoMax };

/** Valida lo que se pide al armar un hotel MANUAL: capacidad de niños por habitación y los dos umbrales de edad. */
export function validarConfigMenoresManual(a: { capacidadNinos: unknown; edadInfanteMax: unknown; edadNinoMax: unknown }):
  { ok: true; capacidadNinos: number; edadInfanteMax: number; edadNinoMax: number } | { ok: false; error: string } {
  const ent = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);
  const cap = ent(a.capacidadNinos), inf = ent(a.edadInfanteMax), nino = ent(a.edadNinoMax);
  if (cap == null || cap < 0 || cap > CAPACIDAD_NINOS_MAX) {
    return { ok: false, error: `Indica la capacidad máxima de niños por habitación (0 a ${CAPACIDAD_NINOS_MAX}: el sistema cobra hasta Niño 1 y Niño 2 por habitación).` };
  }
  if (inf == null || nino == null) return { ok: false, error: "Indica hasta qué edad es infante y hasta qué edad es niño en este hotel." };
  const err = validarRangoReglaEdad(construirReglaEdadDesdeMaximos(inf, nino));
  if (err) return { ok: false, error: err };
  if (nino > 17) return { ok: false, error: "La edad máxima de niño no puede superar 17 años." };
  return { ok: true, capacidadNinos: cap, edadInfanteMax: inf, edadNinoMax: nino };
}

/** Capacidad GENERAL del hotel manual: el mismo tope de niños en todas sus acomodaciones (simplificación de este producto). */
export function reglasHotelManual(h: { capacidadNinos: number; edadInfanteMax: number; edadNinoMax: number }): ReglasHotelDin {
  const reglas = ACOM_ROOMS.map((a): AcomConfig => {
    const pax = PAX_TARIFA_DEFAULT[a];
    return { acomodacion: a, pax_tarifa: pax, pax_max: pax + h.capacidadNinos, adt_min: pax, adt_max: pax, chd_min: 0, chd_max: h.capacidadNinos, inf_min: 0, inf_max: h.capacidadNinos };
  });
  return { infanteMax: h.edadInfanteMax, ninoMax: h.edadNinoMax, reglas, paxMin: null, paxMax: null, adultsOnly: false, origen: "manual" };
}

type FilaHotelFicha = { edad_infante_min?: number | null; edad_infante_max?: number | null; edad_nino_min?: number | null; edad_nino_max?: number | null; pax_min?: number | null; pax_max?: number | null; adults_only?: boolean | null };

/** Reglas de un hotel con FICHA: umbrales de edad, capacidad por acomodación, pax y «solo adultos» tal como están en su ficha. */
export function reglasHotelFicha(h: FilaHotelFicha, acom: Partial<AcomConfig>[]): ReglasHotelDin {
  const regla = normalizarReglaEdadGeneral({ infanteMin: h.edad_infante_min ?? null, infanteMax: h.edad_infante_max ?? null, ninoMin: h.edad_nino_min ?? null, ninoMax: h.edad_nino_max ?? null });
  const reglas = ACOM_ROOMS.map((a): AcomConfig => ({ ...defaultAcomConfig(a), ...(acom.find((x) => x.acomodacion === a) ?? {}) } as AcomConfig));
  return { infanteMax: regla.infanteMax, ninoMax: regla.ninoMax, reglas, paxMin: h.pax_min ?? null, paxMax: h.pax_max ?? null, adultsOnly: h.adults_only === true, origen: "ficha" };
}

/** Texto para el cliente: qué edades aplica ESE hotel y qué significan Niño 1 y Niño 2. */
export function explicarEdades(r: ReglasHotelDin | null): { edades: string; ninos12: string; adultsOnly: string | null } {
  const inf = r?.infanteMax ?? EDADES_MANUAL_POR_DEFECTO.infanteMax, nino = r?.ninoMax ?? EDADES_MANUAL_POR_DEFECTO.ninoMax;
  return {
    edades: `En este hotel: infante hasta los ${inf} años · niño de ${inf + 1} a ${nino} años · desde los ${nino + 1} años se cuenta como adulto (en el vuelo cuenta la edad: menor de 2 años = infante).`,
    ninos12: "Niño 1 y Niño 2 no son rangos de edad: son las dos tarifas de niño de cada habitación. El primer niño de una habitación paga Niño 1 y el segundo, Niño 2.",
    adultsOnly: r?.adultsOnly ? "Este hotel es solo para adultos: no admite menores." : null,
  };
}

export type MenoresResueltos = { ninos: number; ninos2: number; infantes: number; menoresDeDos: number; edades: number[]; distribucion: AsignacionHabitacion[] };

/**
 * A partir de las HABITACIONES y las EDADES de los menores (nunca de conteos que mande el navegador) calcula cuántos pagan Niño 1, Niño 2 e infante,
 * reparte por habitación y valida capacidad. Sin hotel (paquete de vuelo/servicios) solo clasifica con los umbrales por defecto del sistema.
 */
export function resolverMenores(a: { habitaciones: Partial<Record<AcomRoom, number>>; edades: unknown; reglas: ReglasHotelDin | null }):
  ({ ok: true } & MenoresResueltos) | { ok: false; error: string } {
  const bruto = a.edades == null ? [] : a.edades;
  if (!Array.isArray(bruto)) return { ok: false, error: "Las edades de los menores deben venir como una lista." };
  if (bruto.length > MAX_MENORES_POR_CONSULTA) return { ok: false, error: `No se pueden cotizar más de ${MAX_MENORES_POR_CONSULTA} menores en una sola consulta.` };
  const v = validarEdadesMenores(bruto, bruto.length);
  if (!v.ok) return v;
  const r = a.reglas;
  const infMax = r?.infanteMax ?? EDADES_MANUAL_POR_DEFECTO.infanteMax, ninoMax = r?.ninoMax ?? EDADES_MANUAL_POR_DEFECTO.ninoMax;
  const habitaciones: HabitacionConsultada[] = [];
  for (const k of ACOM_ROOMS) {
    const n = Math.max(0, Math.trunc(Number(a.habitaciones[k]) || 0));
    const config = r?.reglas.find((x) => x.acomodacion === k) ?? defaultAcomConfig(k);
    for (let i = 0; i < n; i++) habitaciones.push({ acom: k, config });
  }
  const adultos = habitaciones.reduce((s, h) => s + h.config.pax_tarifa, 0);
  if (!v.edades.length) return { ok: true, ninos: 0, ninos2: 0, infantes: 0, menoresDeDos: 0, edades: [], distribucion: [] };
  if (r?.adultsOnly) return { ok: false, error: "Este hotel es solo para adultos: no admite menores." };
  const c = clasificarMenoresPorEdad(v.edades, infMax, ninoMax);
  if (!c.ok) return { ok: false, error: c.error };
  if (!r) {
    return { ok: true, ninos: c.c.ninos, ninos2: 0, infantes: c.c.infantes, menoresDeDos: v.edades.filter(esMenorDeDos).length, edades: v.edades, distribucion: [] };
  }
  if (!habitaciones.length) return { ok: false, error: "Indica al menos una habitación." };
  const d = distribuirPorHabitaciones({ adultosDeclarados: adultos, ninos: c.c.ninos, infantes: c.c.infantes, habitaciones });
  if (!d.ok) return { ok: false, error: d.error };
  const hab: Record<string, number> = {};
  for (const k of ACOM_ROOMS) hab[k] = Math.max(0, Math.trunc(Number(a.habitaciones[k]) || 0));
  const val = validarReservaHabitaciones({ habitaciones: hab, reglas: r.reglas, ninosDeclarados: d.totales.nino + d.totales.nino2, infantesDeclarados: d.totales.infantes, paxMinHotel: r.paxMin, paxMaxHotel: r.paxMax });
  if (val.errores.length) return { ok: false, error: val.errores[0] };
  return { ok: true, ninos: d.totales.nino, ninos2: d.totales.nino2, infantes: d.totales.infantes, menoresDeDos: v.edades.filter(esMenorDeDos).length, edades: v.edades, distribucion: d.habitaciones };
}
