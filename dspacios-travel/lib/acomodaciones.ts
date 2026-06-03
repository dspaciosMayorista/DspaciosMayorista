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
