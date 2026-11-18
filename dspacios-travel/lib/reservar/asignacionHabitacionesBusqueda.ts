// ─────────────────────────────────────────────────────────────────────────
// #102 — Ocupación de la búsqueda general: de «N habitaciones + viajeros» a un
// reparto VÁLIDO por hotel.
//
// Tres capas, deliberadamente separadas (módulo PURO, sin I/O, importable desde
// `node --test`):
//   1) Normalización GLOBAL de la solicitud (`validarOcupacionGlobal`): solo lo
//      que es cierto para cualquier hotel (enteros, topes, «más habitaciones que
//      viajeros»). NO decide edades ni tipos de habitación: eso depende del hotel.
//   2) Clasificación de edades POR HOTEL/combo (`clasificarMenoresDeHotel`): con
//      los umbrales de ESE hotel, un menor puede ser infante, niño o «tarifa de
//      adulto». Ser tarifa de adulto es una decisión de PRECIO del hotel: no
//      reescribe al pasajero (se conserva su edad real en `comoAdulto`).
//   3) Reparto de habitaciones POR HOTEL (`asignarHabitacionesHotel`): enumera los
//      tipos de habitación que el hotel/combo SÍ vende (con su `pax_tarifa`
//      propio, no el estándar 1/2/3/4) y toma el primer reparto cuya ocupación
//      (adultos + niños + infantes) valida `distribuirPorHabitaciones`. Un reparto
//      «genérico» nunca excluye a un hotel que tenga otro reparto válido.
//
// Preferencia determinista entre repartos válidos (documentada para el dueño):
//   · el más PAREJO (menor diferencia entre la habitación más grande y la más
//     chica: 4 adultos en 2 habitaciones → 2 Dobles, no Triple + Sencilla);
//   · a igual parejo, el orden lexicográfico por tamaño descendente.
// Los menores se reparten con las reglas ya existentes (mínimos primero, luego por
// orden de captura). Si ninguna distribución cabe, se explica el motivo real.
// ─────────────────────────────────────────────────────────────────────────

import { ACOM_ROOMS, ACOM_ROOM_LABEL, defaultAcomConfig, type AcomRoom } from "../acomodaciones.ts";
import {
  distribuirPorHabitaciones,
  type AsignacionHabitacion,
  type ConfigCapacidadHabitacion,
  type HabitacionConsultada,
  type TotalesDistribucion,
} from "./distribucionHabitaciones.ts";
import { esMenorDeDos, type ClaseMenorHotel, type LineaMenor } from "./menoresDeDos.ts";

// ── 1) Normalización global ────────────────────────────────────────────────

/**
 * Validación que no depende de ningún hotel. «Más habitaciones que viajeros» es
 * imposible siempre (cada habitación necesita al menos una persona). Que los
 * adultos quepan en N habitaciones SÍ depende del hotel (su `pax_tarifa`), por eso
 * no se decide acá.
 */
export function validarOcupacionGlobal(input: {
  numHabitaciones: number;
  adultos: number;
  cantidadMenores: number;
  maxHabitaciones: number;
}): { ok: true } | { ok: false; error: string } {
  const { numHabitaciones, adultos, cantidadMenores, maxHabitaciones } = input;
  if (!Number.isInteger(numHabitaciones) || numHabitaciones < 1) return { ok: false, error: "Indica al menos una habitación." };
  if (numHabitaciones > maxHabitaciones) return { ok: false, error: `No se pueden consultar más de ${maxHabitaciones} habitaciones a la vez.` };
  if (!Number.isInteger(adultos) || adultos < 1) return { ok: false, error: "La cantidad de adultos debe ser un entero mayor o igual a 1." };
  const viajeros = adultos + Math.max(0, cantidadMenores);
  if (numHabitaciones > viajeros) {
    return { ok: false, error: `Pediste ${numHabitaciones} habitaciones para ${viajeros} viajero(s): cada habitación necesita al menos una persona.` };
  }
  return { ok: true };
}

// ── 2) Clasificación de edades por hotel ───────────────────────────────────

export type ClasificacionHotel =
  | { ok: true; infantes: number[]; ninos: number[]; comoAdulto: number[]; /** Menores que sí pagan tarifa de menor, en orden de captura. */ menores: number[] }
  | { ok: false; error: string };

/**
 * `e <= infanteMax` → infante; `e <= ninoMax` → niño; si no, tarifa de ADULTO en
 * este hotel. Con `permitirComoAdulto = false` (flujo legado con habitaciones
 * explícitas) una edad por encima del umbral de niño se rechaza, como siempre.
 */
export function clasificarMenoresDeHotel(
  edades: readonly number[],
  infanteMax: number,
  ninoMax: number,
  permitirComoAdulto: boolean
): ClasificacionHotel {
  const infantes: number[] = [];
  const ninos: number[] = [];
  const comoAdulto: number[] = [];
  for (const e of edades) {
    if (e <= infanteMax) infantes.push(e);
    else if (e <= ninoMax) ninos.push(e);
    else comoAdulto.push(e);
  }
  if (!permitirComoAdulto && comoAdulto.length) {
    return {
      ok: false,
      error: `La edad ${comoAdulto[0]} corresponde a tarifa de adulto según este hotel (mayor a ${ninoMax} años) — cuenta a esta persona entre los adultos (habitaciones), no como menor.`,
    };
  }
  return { ok: true, infantes, ninos, comoAdulto, menores: edades.filter((e) => e <= ninoMax) };
}

// ── 3) Reparto de habitaciones por hotel ───────────────────────────────────

export type OpcionHabitacion = { acom: AcomRoom; config: ConfigCapacidadHabitacion };

export type AsignacionHotelOk = {
  ok: true;
  /** Habitaciones en el orden en que se repartió la ocupación (más grande primero). */
  habitaciones: AsignacionHabitacion[];
  totales: TotalesDistribucion;
  porAcom: Partial<Record<AcomRoom, number>>;
};
export type AsignacionHotelError = {
  ok: false;
  tipo: "sin_reparto_adultos" | "seleccion_invalida" | "configuracion_invalida" | "sin_tarifas";
  error: string;
};

const ORDEN_ACOM = new Map<AcomRoom, number>(ACOM_ROOMS.map((a, i) => [a, i]));

/** Todas las combinaciones de `nHab` habitaciones cuyos adultos suman `adultos`, de la más a la menos preferida. */
export function candidatosDeReparto(nHab: number, adultos: number, opciones: readonly OpcionHabitacion[]): OpcionHabitacion[][] {
  // Una sola opción por tipo, de mayor a menor capacidad (a igual capacidad, orden del catálogo).
  const porTipo = new Map<AcomRoom, OpcionHabitacion>();
  for (const o of opciones) if (!porTipo.has(o.acom)) porTipo.set(o.acom, o);
  const tipos = [...porTipo.values()].sort(
    (a, b) => b.config.pax_tarifa - a.config.pax_tarifa || (ORDEN_ACOM.get(a.acom) ?? 0) - (ORDEN_ACOM.get(b.acom) ?? 0)
  );
  const out: OpcionHabitacion[][] = [];
  const actual: OpcionHabitacion[] = [];
  const rec = (desde: number, quedan: number, faltan: number) => {
    if (quedan === 0) { if (faltan === 0) out.push(actual.slice()); return; }
    for (let i = desde; i < tipos.length; i++) {
      const p = tipos[i].config.pax_tarifa;
      if (p < 1 || p > faltan) continue;
      actual.push(tipos[i]);
      rec(i, quedan - 1, faltan - p);
      actual.pop();
    }
  };
  rec(0, nHab, adultos);
  const spread = (c: OpcionHabitacion[]) => Math.max(...c.map((o) => o.config.pax_tarifa)) - Math.min(...c.map((o) => o.config.pax_tarifa));
  out.sort((a, b) => {
    const d = spread(a) - spread(b);
    if (d !== 0) return d;
    for (let i = 0; i < a.length; i++) {
      const x = b[i].config.pax_tarifa - a[i].config.pax_tarifa;
      if (x !== 0) return x;
    }
    return 0;
  });
  return out;
}

export function asignarHabitacionesHotel(input: {
  numHabitaciones: number;
  /** Adultos con tarifa de adulto EN ESTE HOTEL (declarados + menores que el hotel trata como adulto). */
  adultosTarifa: number;
  ninos: number;
  infantes: number;
  opciones: readonly OpcionHabitacion[];
}): AsignacionHotelOk | AsignacionHotelError {
  const { numHabitaciones, adultosTarifa, ninos, infantes, opciones } = input;
  if (!opciones.length) {
    return { ok: false, tipo: "sin_tarifas", error: "Este hotel no tiene tarifa de habitación configurada para esta categoría/alimentación." };
  }
  const candidatos = candidatosDeReparto(numHabitaciones, adultosTarifa, opciones);
  if (!candidatos.length) {
    const pax = opciones.map((o) => o.config.pax_tarifa);
    const min = Math.min(...pax), max = Math.max(...pax);
    return {
      ok: false,
      tipo: "sin_reparto_adultos",
      error: `${adultosTarifa} adulto(s) no se pueden repartir en ${numHabitaciones} habitación(es): este hotel admite entre ${min} y ${max} adulto(s) por habitación.`,
    };
  }
  let primerError: AsignacionHotelError | null = null;
  for (const cand of candidatos) {
    const habitaciones: HabitacionConsultada[] = cand.map((o) => ({ acom: o.acom, config: o.config }));
    const r = distribuirPorHabitaciones({ adultosDeclarados: adultosTarifa, ninos, infantes, habitaciones });
    if (r.ok) {
      const porAcom: Partial<Record<AcomRoom, number>> = {};
      for (const h of r.habitaciones) porAcom[h.acom] = (porAcom[h.acom] ?? 0) + 1;
      return { ok: true, habitaciones: r.habitaciones, totales: r.totales, porAcom };
    }
    primerError ??= { ok: false, tipo: r.tipo, error: r.error };
  }
  return primerError!;
}

/** «1 Doble + 1 Sencilla» — resumen compacto de qué habitaciones se evaluaron. */
export function resumenHabitaciones(porAcom: Partial<Record<AcomRoom, number>>): string {
  return [...ACOM_ROOMS].reverse().filter((a) => (porAcom[a] ?? 0) > 0)
    .map((a) => `${porAcom[a]} ${ACOM_ROOM_LABEL[a]}`)
    .join(" + ");
}

/**
 * Reparto estándar (tipos 1/2/3/4) para mostrar ANTES de buscar. Es solo una
 * orientación: la búsqueda nunca se bloquea por esto, porque cada hotel puede tener
 * su propia configuración de ocupación.
 */
export function repartoEstandar(numHabitaciones: number, adultos: number): { ok: true; texto: string; porAcom: Partial<Record<AcomRoom, number>> } | { ok: false } {
  const opciones: OpcionHabitacion[] = ACOM_ROOMS.map((a) => ({ acom: a, config: defaultAcomConfig(a) }));
  const cand = candidatosDeReparto(numHabitaciones, adultos, opciones)[0];
  if (!cand) return { ok: false };
  const porAcom: Partial<Record<AcomRoom, number>> = {};
  for (const o of cand) porAcom[o.acom] = (porAcom[o.acom] ?? 0) + 1;
  return { ok: true, texto: resumenHabitaciones(porAcom), porAcom };
}

// ── Edades por clase (para mostrar «Niño 1 · 8 años») ──────────────────────

export type EdadesPorClase = Record<ClaseMenorHotel, number[]>;

/** Asigna las edades reales a la clase de tarifa que el reparto por habitación les dio. */
export function edadesPorClase(habitaciones: readonly AsignacionHabitacion[], infantes: readonly number[], ninos: readonly number[]): EdadesPorClase {
  const inf = [...infantes];
  const kids = [...ninos];
  const out: EdadesPorClase = { infante: [], nino: [], nino2: [] };
  for (const h of habitaciones) {
    for (let i = 0; i < h.infantes; i++) { const e = inf.shift(); if (e != null) out.infante.push(e); }
    if (h.nino) { const e = kids.shift(); if (e != null) out.nino.push(e); }
    if (h.nino2) { const e = kids.shift(); if (e != null) out.nino2.push(e); }
  }
  return out;
}

// ── Desglose compacto adulto / menores / total ─────────────────────────────

export type LineaDesglose = {
  clase: "adulto" | ClaseMenorHotel | "servicio_grupo";
  cantidad: number;
  /** Por persona para la estadía seleccionada (`servicio_grupo`: importe único). */
  tarifa: number;
  subtotal: number;
  acomodaciones?: AcomRoom[];
  menorDeDos?: boolean;
  /** Edades reales de quienes pagan esta línea (solo si se pueden afirmar sin duda). */
  edades?: number[];
  /**
   * #125 × #102 (I1): esta línea es de niño(s) con «un niño gratis por habitación». `tarifa`/`subtotal` ya son lo que se PAGA (tarifa completa − `condonado`), así que el desglose suma el total;
   * `condonado` es por niño (solo el alojamiento promocionado); `promociones` = procedencia, en orden cronológico (varias si promociones sucesivas le dieron noches gratis).
   */
  gratis?: { promociones: string[]; condonado: number };
};

/**
 * Las líneas salen de los MISMOS números que forman `total` (precio por acomodación,
 * `tarifarMenores`, cargo de grupo): nunca se recalcula nada. Las acomodaciones de
 * adulto con la misma tarifa se agrupan; si difieren se muestran por separado (una
 * diferencia real de tarifa no se promedia).
 */
export function construirDesglose(input: {
  porAcom: Partial<Record<AcomRoom, number>>;
  paxTarifaDe: (a: AcomRoom) => number;
  pvp: Readonly<Record<string, number>>;
  lineasMenores: readonly LineaMenor[];
  edades?: EdadesPorClase;
  cargoGrupo?: number;
}): LineaDesglose[] {
  const out: LineaDesglose[] = [];
  const grupos = new Map<number, { cantidad: number; acoms: AcomRoom[] }>();
  for (const a of ACOM_ROOMS) {
    const rooms = input.porAcom[a] ?? 0;
    if (rooms <= 0) continue;
    const tarifa = input.pvp[a];
    const g = grupos.get(tarifa) ?? { cantidad: 0, acoms: [] };
    g.cantidad += rooms * input.paxTarifaDe(a);
    g.acoms.push(a);
    grupos.set(tarifa, g);
  }
  for (const [tarifa, g] of grupos) out.push({ clase: "adulto", cantidad: g.cantidad, tarifa, subtotal: g.cantidad * tarifa, acomodaciones: g.acoms });
  for (const l of input.lineasMenores) {
    const linea: LineaDesglose = { clase: l.clase, cantidad: l.cantidad, tarifa: l.tarifa, subtotal: l.cantidad * l.tarifa, menorDeDos: l.menorDeDos };
    const candidatas = input.edades?.[l.clase]?.filter((e) => esMenorDeDos(e) === l.menorDeDos);
    // Solo se muestran edades si cuadran exactamente con la cantidad cobrada; si no, se omiten antes que adivinar.
    if (candidatas && candidatas.length === l.cantidad) linea.edades = candidatas;
    out.push(linea);
  }
  if (input.cargoGrupo && input.cargoGrupo > 0) out.push({ clase: "servicio_grupo", cantidad: 1, tarifa: input.cargoGrupo, subtotal: input.cargoGrupo });
  return out;
}
