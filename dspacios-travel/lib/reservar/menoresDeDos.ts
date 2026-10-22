// ─────────────────────────────────────────────────────────────────────────
// Tarifa de infante (migración 226) — regla del dueño:
//   · MENOR DE 2 AÑOS (0 a 1,99; `edad < 2`): en el vuelo paga SOLO su
//     `fee_infante` (puede ser $0) y en cada servicio su `precio_infante`
//     (puede ser $0). No ocupa silla ni cuenta para el rango de un servicio
//     por grupo.
//   · DESDE LOS 2 AÑOS: tarifa de adulto en el vuelo y en los servicios.
//   · El HOTEL conserva su propia clase de infante/niño (edad configurable por
//     hotel; por defecto el infante llega hasta los 2 años): el precio de la
//     parte de hotel sigue esa clase, no la edad de vuelo.
//
// Por eso cada menor tiene DOS clasificaciones independientes: la clase del
// hotel (infante / niño 1 / niño 2) y "menor de 2 años" (vuelo + servicios).
// Este módulo PURO es la fuente única de esa cuenta y del precio de los
// menores — lo usan computarReserva (reservar, checkout, cotización), el
// buscador de Vista Booking y las pruebas. Sin I/O, sin alias `@/` (se
// importa directo desde `node --test`).
// ─────────────────────────────────────────────────────────────────────────

import { EDAD_INFANTE_MAX_VUELO } from "./pasajeros.ts";

export type ClaseMenorHotel = "infante" | "nino" | "nino2";
export type ConteoMenores = { infante: number; nino: number; nino2: number };

export const CLASES_MENOR: readonly ClaseMenorHotel[] = ["infante", "nino", "nino2"];

/** Edad (años cumplidos) por debajo de la cual el vuelo y los servicios cobran tarifa de infante. */
export const EDAD_MENOR_DE_DOS = EDAD_INFANTE_MAX_VUELO;

export function esMenorDeDos(edad: number | null | undefined): boolean {
  return edad != null && Number.isFinite(edad) && edad < EDAD_MENOR_DE_DOS;
}

/**
 * Cuántos menores de CADA clase de hotel son menores de 2 años.
 *  - Con edades (flujo de Vista Booking): se cuentan por edad real. Los menores
 *    de 2 que el hotel clasifica como infante (`edad <= infanteMax`) salen de
 *    `infante`; los que el hotel clasifica como niño (infante < edad <= niño)
 *    salen de `nino` primero y luego `nino2` (la distribución por habitación
 *    pierde la edad individual: la regla es determinista, no depende del orden).
 *  - Sin edades (flujo legado por conteo): los infantes declarados SON menores
 *    de 2 (decisión del dueño) y los niños declarados son de 2 o más.
 * Nunca devuelve más de lo que hay en `totales`.
 */
export function contarMenoresDeDos(
  edades: readonly number[] | null | undefined,
  infanteMax: number,
  totales: ConteoMenores
): ConteoMenores {
  if (!edades) return { infante: Math.max(0, totales.infante), nino: 0, nino2: 0 };
  let infantesM2 = 0;
  let ninosM2 = 0;
  for (const e of edades) {
    if (!esMenorDeDos(e)) continue;
    if (e <= infanteMax) infantesM2++;
    else ninosM2++;
  }
  const infante = Math.min(infantesM2, Math.max(0, totales.infante));
  const nino = Math.min(ninosM2, Math.max(0, totales.nino));
  const nino2 = Math.min(ninosM2 - nino, Math.max(0, totales.nino2));
  return { infante, nino, nino2 };
}

export type LineaMenor = {
  clase: ClaseMenorHotel;
  cantidad: number;
  /** Tarifa por persona (parte hotel + vuelo + servicios que corresponda). */
  tarifa: number;
  /** true = tarifa de menor de 2 años (`precio_pvp_menor2`); false = `precio_pvp`. */
  menorDeDos: boolean;
};

export type ResultadoTarifaMenores =
  | { ok: true; lineas: LineaMenor[]; total: number; paxConSilla: number; menoresDeDos: number }
  | { ok: false; error: string };

export const MENSAJE_TARIFARIO_SIN_INFANTE =
  "El tarifario de este paquete se generó antes de la tarifa de infante (menores de 2 años). Regenera el tarifario del paquete (Paquetes → Generar tarifario) para poder cotizar con infantes.";

/**
 * Tarifa los menores de una reserva a partir de los precios publicados.
 *  - `pvp`        = `precio_pvp` por acomodación (adulto en vuelo y servicios).
 *  - `pvpMenor2`  = `precio_pvp_menor2` por acomodación (fee + servicios de infante).
 *
 * Reglas de compatibilidad (idénticas a las de siempre fuera de infante):
 *  · Niño 1 / Niño 2 sin tarifa publicada NO se suman (la verificación de
 *    disponibilidad ya corrió antes); un niño de 2+ ocupa silla.
 *  · Infante de hotel de 2+ años: paga `pvp.infante` (hotel infante + vuelo y
 *    servicios de adulto) y ocupa silla.
 *  · Menor de 2 años: paga `pvpMenor2[clase]` y NO ocupa silla. Si el
 *    tarifario no trae ese precio es un tarifario anterior a la 226: se
 *    rechaza con un mensaje claro en vez de cobrar el vuelo de adulto.
 */
export function tarifarMenores(args: {
  totales: ConteoMenores;
  menoresDeDos: ConteoMenores;
  pvp: Readonly<Record<string, number>>;
  pvpMenor2: Readonly<Record<string, number>>;
}): ResultadoTarifaMenores {
  const lineas: LineaMenor[] = [];
  let total = 0;
  let paxConSilla = 0;
  let menoresDeDos = 0;
  for (const clase of CLASES_MENOR) {
    const cant = Math.max(0, Math.trunc(args.totales[clase] || 0));
    if (cant <= 0) continue;
    const m2 = Math.min(cant, Math.max(0, Math.trunc(args.menoresDeDos[clase] || 0)));
    const mayores = cant - m2;
    if (m2 > 0) {
      const t = args.pvpMenor2[clase];
      if (t == null) return { ok: false, error: MENSAJE_TARIFARIO_SIN_INFANTE };
      lineas.push({ clase, cantidad: m2, tarifa: t, menorDeDos: true });
      total += m2 * t;
      menoresDeDos += m2;
    }
    if (mayores > 0) {
      const t = args.pvp[clase];
      if (t == null) {
        // Niños sin tarifa: comportamiento histórico (no se suman). Infante de
        // hotel de 2+ años sin fila publicada: tarifario anterior a la 226.
        if (clase === "infante") return { ok: false, error: MENSAJE_TARIFARIO_SIN_INFANTE };
        continue;
      }
      lineas.push({ clase, cantidad: mayores, tarifa: t, menorDeDos: false });
      total += mayores * t;
      paxConSilla += mayores;
    }
  }
  return { ok: true, lineas, total, paxConSilla, menoresDeDos };
}

const ETIQUETA_CLASE: Record<ClaseMenorHotel, string> = { infante: "Infante", nino: "Niño 1", nino2: "Niño 2" };
const ORDEN_BASE: Record<ClaseMenorHotel, number> = { infante: 52, nino: 50, nino2: 51 };

/**
 * Descripción del ítem de contrato/cotización de una línea de menores. Los
 * casos de siempre conservan su texto ("Niño 1 · cat / régimen", "Infante · …");
 * el menor de 2 años que el hotel clasifica como niño y el infante de hotel de
 * 2 años (edad de vuelo adulta) lo dicen explícito.
 */
export function descripcionLineaMenor(l: Pick<LineaMenor, "clase" | "menorDeDos">, categoria: string, regimen: string): string {
  const base = ETIQUETA_CLASE[l.clase];
  if (l.menorDeDos && l.clase !== "infante") return `${base} (menor de 2 años) · ${categoria} / ${regimen}`;
  if (!l.menorDeDos && l.clase === "infante") return `Infante (2 años) · ${categoria} / ${regimen}`;
  return `${base} · ${categoria} / ${regimen}`;
}

/** Orden del ítem: las líneas históricas conservan 50/51/52; las nuevas van después (53+). */
export function ordenLineaMenor(l: Pick<LineaMenor, "clase" | "menorDeDos">): number {
  if (!l.menorDeDos && l.clase !== "infante") return ORDEN_BASE[l.clase];
  if (l.menorDeDos && l.clase === "infante") return ORDEN_BASE.infante;
  return l.clase === "infante" ? 53 : l.clase === "nino" ? 54 : 55;
}

/** Suma de menores de 2 años en todas las clases. */
export function totalMenoresDeDos(c: ConteoMenores): number {
  return Math.max(0, c.infante) + Math.max(0, c.nino) + Math.max(0, c.nino2);
}

/**
 * Nombres de los servicios por PERSONA con tarifa de adulto pero SIN precio de
 * infante: el menor de 2 años paga como adulto en ellos (NULL ≠ $0) y la app lo
 * avisa al montar/generar el paquete y en el catálogo. Un servicio por GRUPO no
 * entra: el menor de 2 años ni cuenta para el rango ni paga extra.
 */
export function serviciosSinPrecioInfante(
  servicios: readonly { nombre: string | null; modo: "persona" | "grupo"; precioPersona: number | null; precioInfante: number | null }[]
): string[] {
  const nombres: string[] = [];
  for (const s of servicios) {
    if (s.modo !== "persona" || s.precioPersona == null || s.precioInfante != null) continue;
    nombres.push(s.nombre ?? "Servicio");
  }
  return nombres;
}

// ── Compatibilidad: lo que entregan los consumidores del cómputo ────────────────────────────
// `computarReserva` SIEMPRE entrega `lineasMenores`/`numMenoresDeDos`. Los consumidores pasan por aquí para que un
// cómputo armado sin esos campos (cliente falso de una prueba anterior a la 226, o un snapshot viejo) se comporte como
// antes: los infantes declarados son los menores de 2 años y las filas salen de `pvpPorAcom`/`num*`.
export type DatosMenoresComputo = {
  lineasMenores?: readonly LineaMenor[];
  numMenoresDeDos?: number;
  pvpPorAcom?: Readonly<Record<string, number>>;
  numNinos?: number;
  numNinos2?: number;
  numInfantes?: number;
};

export function menoresDelComputo(
  d: DatosMenoresComputo,
  opciones: { infantesDeclarados?: number } = {}
): { lineasMenores: LineaMenor[]; numMenoresDeDos: number; numInfantes: number } {
  if (d.lineasMenores) {
    const lineas = [...d.lineasMenores];
    return {
      lineasMenores: lineas,
      numMenoresDeDos: d.numMenoresDeDos ?? lineas.filter((l) => l.menorDeDos).reduce((n, l) => n + l.cantidad, 0),
      numInfantes: d.numInfantes ?? 0,
    };
  }
  const pvp = d.pvpPorAcom ?? {};
  const numInfantes = d.numInfantes ?? Math.max(0, Math.trunc(opciones.infantesDeclarados ?? 0));
  const lineas: LineaMenor[] = [];
  const nNino = Math.max(0, d.numNinos ?? 0);
  const nNino2 = Math.max(0, d.numNinos2 ?? 0);
  if (nNino > 0 && pvp["nino"] != null) lineas.push({ clase: "nino", cantidad: nNino, tarifa: pvp["nino"], menorDeDos: false });
  if (nNino2 > 0 && pvp["nino2"] != null) lineas.push({ clase: "nino2", cantidad: nNino2, tarifa: pvp["nino2"], menorDeDos: false });
  if (numInfantes > 0 && pvp["infante"] != null) lineas.push({ clase: "infante", cantidad: numInfantes, tarifa: pvp["infante"], menorDeDos: true });
  return { lineasMenores: lineas, numMenoresDeDos: d.numMenoresDeDos ?? numInfantes, numInfantes };
}
