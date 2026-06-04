// Acomodaciones de habitación (reservar por habitaciones, no por personas).
//
// `sencilla`, `doble`, `triple`, `multiple` son TIPOS DE HABITACIÓN: al reservar
// se pide la CANTIDAD DE HABITACIONES de cada tipo. La tarifa del tarifario es
// por persona, así que el valor de 1 habitación = pax_tarifa × tarifa/persona
// (1 hab Doble ⇒ ×2, Triple ⇒ ×3, Sencilla ⇒ ×1, etc.).
//
// `nino`/`nino2`/infantes NO son habitaciones: van por cantidad de niños/infantes.

export type AcomRoom = "sencilla" | "doble" | "triple" | "multiple";

export const ACOM_ROOMS: AcomRoom[] = ["sencilla", "doble", "triple", "multiple"];

export const ACOM_ROOM_LABEL: Record<AcomRoom, string> = {
  sencilla: "Sencilla",
  doble: "Doble",
  triple: "Triple",
  multiple: "Múltiple",
};

/** Pax que cubre la tarifa por persona de una habitación (multiplicador). */
export const PAX_TARIFA_DEFAULT: Record<AcomRoom, number> = {
  sencilla: 1,
  doble: 2,
  triple: 3,
  multiple: 4,
};

/** Configuración de una acomodación por hotel (migración 027). */
export type AcomConfig = {
  acomodacion: AcomRoom;
  pax_tarifa: number;
  pax_max: number;
  adt_min: number;
  adt_max: number;
  chd_min: number;
  chd_max: number;
  inf_min: number;
  inf_max: number;
};

/** Config por defecto de una acomodación (cuando el hotel no la configuró). */
export function defaultAcomConfig(a: AcomRoom): AcomConfig {
  const pax = PAX_TARIFA_DEFAULT[a];
  return {
    acomodacion: a,
    pax_tarifa: pax,
    pax_max: pax,
    adt_min: pax,
    adt_max: pax,
    chd_min: 0,
    chd_max: pax,
    inf_min: 0,
    inf_max: pax,
  };
}

export function esAcomRoom(a: string): a is AcomRoom {
  return (ACOM_ROOMS as string[]).includes(a);
}

/** pax_tarifa de una acomodación buscando primero en la config del hotel. */
export function paxTarifaDe(configs: AcomConfig[] | undefined | null, a: AcomRoom): number {
  const c = configs?.find((x) => x.acomodacion === a);
  return c?.pax_tarifa ?? PAX_TARIFA_DEFAULT[a];
}

// ── Validación pasajeros ↔ acomodación (punto 4) ───────────────────────────

export type ClasificacionEdad = { adultos: number; ninos: number; infantes: number; sinFecha: number };

/** Clasifica edades en adulto/niño/infante según los umbrales del hotel. */
export function clasificarPorEdad(
  edades: (number | null | undefined)[],
  infanteMax: number,
  ninoMax: number
): ClasificacionEdad {
  let adultos = 0, ninos = 0, infantes = 0, sinFecha = 0;
  for (const e of edades) {
    if (e == null) { sinFecha++; continue; }
    if (e <= infanteMax) infantes++;
    else if (e <= ninoMax) ninos++;
    else adultos++;
  }
  return { adultos, ninos, infantes, sinFecha };
}

export type ValidacionReserva = { errores: string[]; avisos: string[] };

/**
 * Valida que las habitaciones elegidas, las cantidades de niños/infantes y las
 * edades reales de los pasajeros cuadren con la config de acomodaciones del hotel.
 * Devuelve `errores` (bloquean la reserva) y `avisos` (informativos).
 */
export function validarReservaHabitaciones(inp: {
  habitaciones: Record<string, number>;
  reglas: AcomConfig[];
  ninosDeclarados: number;
  infantesDeclarados: number;
  paxMinHotel?: number | null;
  paxMaxHotel?: number | null;
  real?: ClasificacionEdad; // clasificación por fecha de nacimiento (opcional)
}): ValidacionReserva {
  const errores: string[] = [];
  const avisos: string[] = [];

  let adultosEsperados = 0, capChd = 0, capInf = 0, capPax = 0;
  for (const a of ACOM_ROOMS) {
    const rooms = Math.max(0, Math.trunc(Number(inp.habitaciones[a]) || 0));
    if (rooms <= 0) continue;
    const r = inp.reglas.find((x) => x.acomodacion === a) ?? defaultAcomConfig(a);
    adultosEsperados += rooms * r.pax_tarifa;
    capChd += rooms * r.chd_max;
    capInf += rooms * r.inf_max;
    capPax += rooms * r.pax_max;
  }

  const ninos = Math.max(0, inp.ninosDeclarados);
  const infantes = Math.max(0, inp.infantesDeclarados);
  const ocupantes = adultosEsperados + ninos; // ocupan silla
  const paxTotal = ocupantes + infantes;

  // Capacidad de las habitaciones
  if (ninos > capChd) errores.push(`Las habitaciones elegidas admiten máximo ${capChd} niño(s); seleccionaste ${ninos}.`);
  if (infantes > capInf) errores.push(`Las habitaciones elegidas admiten máximo ${capInf} infante(s); seleccionaste ${infantes}.`);
  if (capPax > 0 && ocupantes > capPax) errores.push(`Las habitaciones elegidas admiten máximo ${capPax} pax; hay ${ocupantes}.`);

  // Pax mín/máx del hotel
  if (inp.paxMaxHotel && paxTotal > inp.paxMaxHotel) errores.push(`El hotel admite máximo ${inp.paxMaxHotel} pax por reserva; hay ${paxTotal}.`);
  if (inp.paxMinHotel && paxTotal > 0 && paxTotal < inp.paxMinHotel) errores.push(`El hotel exige mínimo ${inp.paxMinHotel} pax por reserva; hay ${paxTotal}.`);

  // Edades reales vs lo declarado
  if (inp.real) {
    const { adultos, ninos: nReal, infantes: iReal, sinFecha } = inp.real;
    let detalle = false;
    if (adultos > adultosEsperados) { errores.push(`Por fecha de nacimiento hay ${adultos} adulto(s), pero las habitaciones son para ${adultosEsperados}.`); detalle = true; }
    if (nReal > ninos) { errores.push(`Por fecha de nacimiento hay ${nReal} niño(s), pero declaraste ${ninos}.`); detalle = true; }
    if (iReal > infantes) { errores.push(`Por fecha de nacimiento hay ${iReal} infante(s), pero declaraste ${infantes}.`); detalle = true; }
    if (sinFecha === 0) {
      if (!detalle && (adultos !== adultosEsperados || nReal !== ninos || iReal !== infantes)) {
        errores.push(`Las edades no cuadran con la acomodación — adultos ${adultos}/${adultosEsperados}, niños ${nReal}/${ninos}, infantes ${iReal}/${infantes}.`);
      }
    } else if (paxTotal > 0) {
      avisos.push(`Faltan ${sinFecha} fecha(s) de nacimiento para validar edades.`);
    }
  }

  return { errores, avisos };
}

