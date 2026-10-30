// ─────────────────────────────────────────────────────────────────────────
// #88 — Programas terrestres por HOTEL y VIGENCIA, con NOCHES ADICIONALES.
//
// Módulo PURO (sin Supabase, sin alias `@/`; imports relativos con `.ts` para que
// `node --test` lo cargue directo). Lo usan la liquidación única de #57
// (`lib/programas/precioReserva57.ts`), el cargador de datos, el formulario y las
// pruebas de paridad. La fórmula del PVP NO se reescribe aquí: se compone con
// `pvpProgramaFormula` de `lib/calc/programaPrecio.ts`, la misma de la ficha.
//
// Reglas comerciales confirmadas por el dueño:
//   · Matriz base: hotel × vigencia × acomodación × modalidad de servicios
//     (privados / regulares). Cada precio base es NETO por persona para TODA la
//     estancia incluida; la vigencia se decide por la fecha de ENTRADA al hotel.
//   · Noches adicionales: solo DESPUÉS de la estancia incluida. Cada noche usa la
//     tarifa de la vigencia de SU propia fecha. La tarifa depende de hotel,
//     vigencia y acomodación, y el proveedor la cobra por PERSONA o por
//     HABITACIÓN (unidad configurada expresamente, sin valor por defecto). Es la
//     misma para servicios privados y regulares.
//   · Aplican a todos los ocupantes de las habitaciones elegidas.
//       - Tarifa POR HABITACIÓN: los menores ocupantes van INCLUIDOS (sin suplemento
//         hotelero y sin exigir `neto_nino`; un valor cargado se ignora). Solo pagan la
//         asistencia médica de la noche, como cualquier persona.
//       - Tarifa POR PERSONA: cada menor exige tarifa adicional EXPLÍCITA (0 = gratis
//         declarado; null = falta → no se cotiza).
//     Los infantes conservan la regla existente: no pagan.
//   · Sin tarifa para alguna fecha, o dos vigencias que cubren la misma fecha:
//     se BLOQUEA con mensaje claro. Nunca se usa una tarifa cercana de respaldo.
//   · Las noches extra amplían los días (y el costo) de la asistencia médica.
//
// Redondeo (decisión del dueño, fijada en pruebas/programaEstanciaHotel88.test.ts):
//   · BASE (regla existente): neto + asistencia×días → /(1−mk) → /(1−fee) → UN
//     solo redondeo hacia arriba por persona (USD al dólar, COP al millar); el
//     total suma `PVP redondeado × pax` en centavos.
//   · NOCHES ADICIONALES: se REDONDEA CADA NOCHE y LUEGO se suman. La unidad de
//     venta es "una noche de una persona (o de una habitación)": cada noche se
//     redondea por separado, igual que la ficha la publica (PVP por noche), y el
//     total es Σ(noches × unidades × PVP de noche). Así la tabla de la ficha, el
//     desglose por fechas, el contrato y el total cuadran al centavo.
// ─────────────────────────────────────────────────────────────────────────
import { pvpProgramaDesglose, type DesglosePvp, type PvpOpciones } from "../calc/programaPrecio.ts";
import { paxDeAcomodacion } from "../acomodaciones.ts";

/** `programas.modo_precio` de un programa terrestre vendido por hotel y vigencia. */
export const MODO_PRECIO_HOTEL = "hotel";
export const esModoHotel = (modo: string | null | undefined) => modo === MODO_PRECIO_HOTEL;

/** Tope defensivo de noches adicionales por reserva (evita una entrada absurda; no es regla comercial). */
export const MAX_NOCHES_ADICIONALES = 30;

export type ModalidadServicios = "privado" | "regular";
export const MODALIDADES_SERVICIOS: readonly ModalidadServicios[] = ["privado", "regular"];
export const ETIQUETA_MODALIDAD: Record<ModalidadServicios, string> = { privado: "Servicios privados", regular: "Servicios regulares" };

export type UnidadCobro = "persona" | "habitacion";
export const UNIDADES_COBRO: readonly UnidadCobro[] = ["persona", "habitacion"];
export const ETIQUETA_UNIDAD: Record<UnidadCobro, string> = { persona: "por persona", habitacion: "por habitación" };

export const ACOMODACIONES_ADULTO = ["sencilla", "doble", "triple", "multiple"] as const;
export type AcomAdulto = (typeof ACOMODACIONES_ADULTO)[number];
export type ClaveTarifa = AcomAdulto | "nino";
export const CLAVES_TARIFA: readonly ClaveTarifa[] = [...ACOMODACIONES_ADULTO, "nino"];
export const ETIQUETA_ACOM: Record<string, string> = {
  sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple", cuadruple: "Cuádruple", nino: "Menor",
};

/** Un valor por acomodación; `null` = no existe (nunca se interpreta como 0). */
export type PorAcom = Record<ClaveTarifa, number | null>;
export const vacioPorAcom = (): PorAcom => ({ sencilla: null, doble: null, triple: null, multiple: null, nino: null });

// ── Fechas (UTC, sin zona horaria) ─────────────────────────────────────────

export function esFechaIso(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function sumarDiasIso(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function fechaLegible(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ── Vigencias ──────────────────────────────────────────────────────────────

export type Vigente = { desde: string; hasta: string };
export type ResultadoVigencia<T> =
  | { ok: true; fila: T }
  | { ok: false; codigo: "sin_tarifa" | "ambigua"; error: string };

/**
 * La ÚNICA fila cuya vigencia cubre `fecha` (extremos incluidos). Cero filas →
 * `sin_tarifa`; dos o más → `ambigua`: ninguna de las dos se elige por proximidad.
 */
export function resolverVigencia<T extends Vigente>(filas: readonly T[], fecha: string, que: string): ResultadoVigencia<T> {
  const cubren = filas.filter((f) => f.desde <= fecha && fecha <= f.hasta);
  if (cubren.length === 0) {
    return { ok: false, codigo: "sin_tarifa", error: `No hay ${que} para el ${fechaLegible(fecha)}. Elige otra fecha o pide que se cargue la vigencia.` };
  }
  if (cubren.length > 1) {
    return {
      ok: false,
      codigo: "ambigua",
      error: `Hay ${cubren.length} vigencias de ${que} que cubren el ${fechaLegible(fecha)} a la vez. Corrige las vigencias del programa; no se usa ninguna por aproximación.`,
    };
  }
  return { ok: true, fila: cubren[0] };
}

/** Primer par de filas cuyas vigencias se solapan (extremos incluidos), o null. */
export function primerSolape<T extends Vigente>(filas: readonly T[]): [T, T] | null {
  for (let i = 0; i < filas.length; i++) {
    for (let j = i + 1; j < filas.length; j++) {
      if (filas[i].desde <= filas[j].hasta && filas[j].desde <= filas[i].hasta) return [filas[i], filas[j]];
    }
  }
  return null;
}

// ── Catálogo (forma que entregan el cargador y las pruebas) ─────────────────

export type HotelEstancia = {
  id: number;
  nombre: string;
  zona: string | null;
  tipoHabitacion: string | null;
  /** Máximo de personas (adultos + menores + infantes) por habitación; null = sin tope declarado. */
  maxPaxHabitacion: number | null;
  /** Máximo de menores + infantes por habitación; null = sin tope declarado. */
  maxMenoresHabitacion: number | null;
  /** Proveedor que cobra el hotel; null = el del programa. */
  proveedorId: number | null;
};

/** Precio BASE (estancia incluida) neto por persona. */
export type BaseHotelFila = {
  id: number;
  hotelId: number;
  desde: string;
  hasta: string;
  modalidad: ModalidadServicios;
  bajoSolicitud: boolean;
  neto: PorAcom;
};

/** Tarifa de NOCHE ADICIONAL neta, con su unidad de cobro declarada. */
export type NocheTarifaFila = {
  id: number;
  hotelId: number;
  desde: string;
  hasta: string;
  unidad: UnidadCobro;
  neto: PorAcom;
};

/** Tarifa de noche con su PVP ya calculado; el neto solo existe en el servidor. */
export type NocheTarifaPvp = {
  id: number;
  hotelId: number;
  desde: string;
  hasta: string;
  unidad: UnidadCobro;
  pvp: PorAcom;
  neto?: PorAcom;
};

/**
 * PVP de UNA noche de UNA unidad (persona u habitación). Misma fórmula de la
 * base (`pvpProgramaFormula`) con `dias = 1`:
 *   · por persona: neto + asistencia×1;
 *   · por habitación (adultos): neto de la habitación + asistencia×1 de CADA
 *     ocupante de esa habitación (sencilla 1, doble 2, triple 3, múltiple 4);
 *   · menor: con tarifa POR PERSONA paga su tarifa explícita de menor + la asistencia de la noche; con tarifa POR HABITACIÓN va
 *     incluido (sin suplemento hotelero) y solo paga la asistencia de la noche.
 * Se usa `pvpProgramaFormula` (sin la guarda de neto 0) porque una tarifa de $0
 * declarada de forma expresa sigue pagando la asistencia de la noche.
 */
export function pvpNocheUnidad(neto: number, unidad: UnidadCobro, clave: ClaveTarifa, opt: PvpOpciones): number {
  return desgloseNocheUnidad(neto, unidad, clave, opt).pvp;
}

/** La misma cuenta de `pvpNocheUnidad`, con sus pasos (vista previa y fórmula visible). Una sola implementación. */
export function desgloseNocheUnidad(neto: number, unidad: UnidadCobro, clave: ClaveTarifa, opt: PvpOpciones): DesglosePvp {
  const optNoche: PvpOpciones = { ...opt, dias: 1 };
  if (clave === "nino" || unidad === "persona") return pvpProgramaDesglose(neto, optNoche);
  const ocupantes = paxDeAcomodacion(clave);
  return pvpProgramaDesglose(neto, { ...optNoche, asistenciaDia: (Number(opt.asistenciaDia) || 0) * ocupantes });
}

export function nocheTarifaConPvp(fila: NocheTarifaFila, opt: PvpOpciones): NocheTarifaPvp {
  const pvp = vacioPorAcom();
  for (const k of CLAVES_TARIFA) {
    const n = fila.neto[k];
    pvp[k] = n == null ? null : pvpNocheUnidad(n, fila.unidad, k, opt);
  }
  // POR HABITACIÓN el menor ocupante va incluido: sin suplemento hotelero (neto 0) y sin exigir neto_nino (un valor cargado se
  // ignora). Sigue pagando la asistencia médica de la noche (misma fórmula, sin la guarda de neto 0), así que su PVP nunca es 0
  // cuando hay asistencia diaria. Lo que se paga al hotel no cambia.
  if (fila.unidad === "habitacion") {
    pvp.nino = pvpNocheUnidad(0, "persona", "nino", opt);
    return { id: fila.id, hotelId: fila.hotelId, desde: fila.desde, hasta: fila.hasta, unidad: fila.unidad, pvp, neto: { ...fila.neto, nino: 0 } };
  }
  return { id: fila.id, hotelId: fila.hotelId, desde: fila.desde, hasta: fila.hasta, unidad: fila.unidad, pvp, neto: fila.neto };
}

/** Quita el neto (lo que viaja al navegador). */
export function sinNeto(f: NocheTarifaPvp): NocheTarifaPvp {
  return { id: f.id, hotelId: f.hotelId, desde: f.desde, hasta: f.hasta, unidad: f.unidad, pvp: f.pvp };
}

// ── Noches incluidas del programa ──────────────────────────────────────────

/**
 * Noches de la estancia incluida de un programa por hotel: los días menos uno. Si el programa trae
 * también `noches` y no coinciden, no se adivina cuál vale (las fechas del itinerario, el regreso y
 * la asistencia dependen de ello): se pide corregir el programa. Sin días no hay estancia calculable.
 */
export function nochesIncluidasPrograma(p: { dias: number | null; noches: number | null }): { ok: true; noches: number } | { ok: false; error: string } {
  if (p.dias == null || !Number.isInteger(p.dias) || p.dias < 1) {
    return { ok: false, error: "El programa no tiene configurados sus días: no se pueden calcular las fechas de la estancia." };
  }
  const esperadas = p.dias - 1;
  if (p.noches != null && p.noches !== esperadas) {
    return { ok: false, error: `Revisa los días y noches del programa: ${p.dias} días corresponden a ${esperadas} noches y figuran ${p.noches}.` };
  }
  return { ok: true, noches: esperadas };
}

// ── Fechas de las noches adicionales ───────────────────────────────────────

/**
 * Fechas exactas de las noches adicionales: la primera es la noche siguiente a
 * la última incluida (entrada + noches incluidas), y así consecutivamente.
 */
export function fechasNochesAdicionales(fechaEntrada: string, nochesIncluidas: number, cantidad: number): string[] {
  return Array.from({ length: cantidad }, (_, j) => sumarDiasIso(fechaEntrada, nochesIncluidas + j));
}

/** Fecha de regreso: la salida de la última noche (incluidas + adicionales). */
export function fechaRegresoEstancia(fechaEntrada: string, nochesIncluidas: number, adicionales: number): string {
  return sumarDiasIso(fechaEntrada, nochesIncluidas + adicionales);
}

// ── Ocupación del hotel ────────────────────────────────────────────────────

export function ocupantesDe(habitaciones: Record<string, number>): { habitaciones: number; adultos: number } {
  let hab = 0;
  let adultos = 0;
  for (const [a, n] of Object.entries(habitaciones)) {
    const c = Number(n) || 0;
    if (c <= 0) continue;
    hab += c;
    adultos += c * paxDeAcomodacion(a);
  }
  return { habitaciones: hab, adultos };
}

/**
 * Ocupación permitida por el hotel (mensaje o null). Los menores e infantes se
 * alojan en las habitaciones de los adultos: sin ninguna habitación no hay dónde.
 */
export function validarOcupacionHotel(h: Pick<HotelEstancia, "nombre" | "maxPaxHabitacion" | "maxMenoresHabitacion">, habitaciones: Record<string, number>, ninos: number, infantes: number): string | null {
  const { habitaciones: hab, adultos } = ocupantesDe(habitaciones);
  const menores = Math.max(0, Number(ninos) || 0) + Math.max(0, Number(infantes) || 0);
  if (hab === 0) return menores > 0 ? "Los menores se alojan en las habitaciones de los adultos: elige al menos una habitación." : null;
  // Tope POR habitación: una triple o múltiple no cabe en un hotel que admite 2 aunque otras habitaciones tengan cupo libre.
  if (h.maxPaxHabitacion != null) {
    for (const [a, n] of Object.entries(habitaciones)) {
      const pax = paxDeAcomodacion(a);
      if ((Number(n) || 0) > 0 && pax > h.maxPaxHabitacion) {
        return `${h.nombre} admite como máximo ${h.maxPaxHabitacion} persona(s) por habitación: una habitación ${ETIQUETA_ACOM[a] ?? a} es para ${pax}.`;
      }
    }
  }
  if (h.maxPaxHabitacion != null && adultos + menores > hab * h.maxPaxHabitacion) {
    return `${h.nombre} admite como máximo ${h.maxPaxHabitacion} persona(s) por habitación: ${adultos + menores} ocupantes no caben en ${hab} habitación(es).`;
  }
  if (h.maxMenoresHabitacion != null && menores > hab * h.maxMenoresHabitacion) {
    return `${h.nombre} admite como máximo ${h.maxMenoresHabitacion} menor(es) por habitación: ${menores} menores no caben en ${hab} habitación(es).`;
  }
  return null;
}

// ── Liquidación de las noches adicionales ──────────────────────────────────

export type EntradaNoches88 = {
  /** Tarifas de noche del hotel elegido (con PVP; el neto es opcional). */
  tarifas: readonly NocheTarifaPvp[];
  hotelNombre: string;
  fechaEntrada: string;
  nochesIncluidas: number;
  nochesAdicionales: number;
  /** HABITACIONES por acomodación (como en la base). */
  habitaciones: Record<string, number>;
  ninos: number;
  /** Asistencia médica por persona y día (solo para el costo atribuible). */
  asistenciaDia: number;
};

export type LineaNoche88 = {
  acomodacion: string;
  /** Qué se cobra: una persona o una habitación. */
  unidad: UnidadCobro;
  cantidad: number;
  pvpUnit: number;
  netoUnit: number | null;
  /** Menor ocupante de una tarifa POR HABITACIÓN: sin suplemento hotelero; el PVP es solo su asistencia. */
  incluidoEnHabitacion?: boolean;
};

export type Noche88 = {
  fecha: string;
  tarifaId: number;
  vigenciaDesde: string;
  vigenciaHasta: string;
  unidad: UnidadCobro;
  lineas: LineaNoche88[];
  pvpCentavos: number;
  netoCentavos: number | null;
};

export type ResultadoNoches88 =
  | {
      ok: true;
      noches: Noche88[];
      pvpCentavos: number;
      /** null si alguna tarifa llegó sin neto (cliente): nunca se inventa. */
      netoCentavos: number | null;
      /** Asistencia de las noches extra de quienes pagan (adultos y menores; no infantes), en centavos. */
      asistenciaCentavos: number;
    }
  | {
      ok: false;
      codigo: "noches_invalidas" | "sin_tarifa" | "ambigua" | "sin_tarifa_acomodacion" | "sin_tarifa_menor";
      error: string;
    };

const centavos = (v: number) => Math.round(v * 100);

export function liquidarNochesAdicionales(e: EntradaNoches88): ResultadoNoches88 {
  const k = e.nochesAdicionales;
  if (!Number.isInteger(k) || k < 0 || k > MAX_NOCHES_ADICIONALES) {
    return { ok: false, codigo: "noches_invalidas", error: `Las noches adicionales deben ser un número entero entre 0 y ${MAX_NOCHES_ADICIONALES}.` };
  }
  if (k === 0) return { ok: true, noches: [], pvpCentavos: 0, netoCentavos: 0, asistenciaCentavos: 0 };

  const habs = Object.entries(e.habitaciones).filter(([, n]) => (Number(n) || 0) > 0);
  const nNinos = Math.max(0, Math.trunc(Number(e.ninos) || 0));
  const fechas = fechasNochesAdicionales(e.fechaEntrada, e.nochesIncluidas, k);

  const noches: Noche88[] = [];
  let pvpTotal = 0;
  let netoTotal: number | null = 0;
  for (const fecha of fechas) {
    const r = resolverVigencia(e.tarifas, fecha, `tarifa de noche adicional en ${e.hotelNombre}`);
    if (!r.ok) return { ok: false, codigo: r.codigo, error: r.error };
    const t = r.fila;
    const lineas: LineaNoche88[] = [];
    let pvpNoche = 0;
    let netoNoche: number | null = 0;

    for (const [acom, nHabRaw] of habs) {
      const nHab = Number(nHabRaw) || 0;
      const clave = acom as ClaveTarifa;
      const pvpUnit = (ACOMODACIONES_ADULTO as readonly string[]).includes(acom) ? t.pvp[clave] : null;
      if (pvpUnit == null) {
        return {
          ok: false,
          codigo: "sin_tarifa_acomodacion",
          error: `${e.hotelNombre} no tiene tarifa de noche adicional para ${ETIQUETA_ACOM[acom] ?? acom} el ${fechaLegible(fecha)}.`,
        };
      }
      const cantidad = t.unidad === "habitacion" ? nHab : nHab * paxDeAcomodacion(acom);
      const netoUnit = t.neto ? t.neto[clave] : null;
      lineas.push({ acomodacion: acom, unidad: t.unidad, cantidad, pvpUnit, netoUnit });
      pvpNoche += centavos(pvpUnit) * cantidad;
      netoNoche = netoNoche == null || netoUnit == null ? null : netoNoche + centavos(netoUnit) * cantidad;
    }

    if (nNinos > 0) {
      const pvpUnit = t.pvp.nino;
      if (pvpUnit == null) {
        return {
          ok: false,
          codigo: "sin_tarifa_menor",
          error: `${e.hotelNombre} no tiene tarifa adicional de menor para el ${fechaLegible(fecha)}; no se puede cotizar esta selección con menores.`,
        };
      }
      const netoUnit = t.neto ? t.neto.nino : null;
      lineas.push({ acomodacion: "nino", unidad: "persona", cantidad: nNinos, pvpUnit, netoUnit, ...(t.unidad === "habitacion" ? { incluidoEnHabitacion: true } : {}) });
      pvpNoche += centavos(pvpUnit) * nNinos;
      netoNoche = netoNoche == null || netoUnit == null ? null : netoNoche + centavos(netoUnit) * nNinos;
    }

    noches.push({ fecha, tarifaId: t.id, vigenciaDesde: t.desde, vigenciaHasta: t.hasta, unidad: t.unidad, lineas, pvpCentavos: pvpNoche, netoCentavos: netoNoche });
    pvpTotal += pvpNoche;
    netoTotal = netoTotal == null || netoNoche == null ? null : netoTotal + netoNoche;
  }

  const { adultos } = ocupantesDe(e.habitaciones);
  const asistenciaCentavos = centavos(Number(e.asistenciaDia) || 0) * k * (adultos + nNinos);
  return { ok: true, noches, pvpCentavos: pvpTotal, netoCentavos: netoTotal, asistenciaCentavos };
}

// ── Itinerario desplazado ──────────────────────────────────────────────────

export type DiaItinerario = {
  dia: number;
  tipo_tramo?: "dia" | "traslado_previo" | "traslado_posterior";
  titulo: string | null;
  desayuno: boolean;
  almuerzo: boolean;
  cena: boolean;
  descripcion: string | null;
};
export type DiaConFecha = DiaItinerario & { fecha: string | null; libre: boolean };

export const TITULO_DIA_LIBRE = "Día libre";

/**
 * Itinerario de la reserva: los días y actividades originales conservan su orden
 * y su contenido; por cada noche extra se inserta un día libre ANTES del último
 * día (recogida o salida), que se desplaza. Ej.: 4 días / 3 noches con 1 extra →
 * días 1-3 igual, día 4 libre, día 5 = recogida. Nada se duplica (los tours y
 * traslados siguen exactamente una vez). Sin `fechaEntrada` las fechas van null.
 */
export function itinerarioConNochesExtra(dias: readonly DiaItinerario[], adicionales: number, fechaEntrada: string | null, hotel: string | null, diasPrograma?: number | null): DiaConFecha[] | null {
  const orden = [...dias].sort((a, b) => a.dia - b.dia);
  const k = Number.isInteger(adicionales) && adicionales > 0 ? adicionales : 0;
  // Con noches que desplazar, el itinerario DEBE tener los días 1..N del programa: con uno ausente "el último" no sería la recogida.
  const turisticos = orden.filter((d) => (d.tipo_tramo ?? "dia") === "dia");
  if (k > 0 && validarItinerarioCompleto(dias, diasPrograma === undefined ? turisticos.length : diasPrograma) != null) return null;
  const fechaDe = (dia: number) => (fechaEntrada ? sumarDiasIso(fechaEntrada, dia - 1) : null);
  const original = (d: DiaItinerario): DiaConFecha => ({ ...d, fecha: fechaDe(d.dia), libre: false });
  if (orden.length === 0 || k === 0) return orden.map(original);

  const ultimo = turisticos[turisticos.length - 1];
  if (!ultimo) return null;
  const previos = orden.filter((d) => d !== ultimo && d.tipo_tramo !== "traslado_posterior").map(original);
  const libres: DiaConFecha[] = Array.from({ length: k }, (_, j) => {
    const dia = ultimo.dia + j;
    return {
      dia,
      titulo: TITULO_DIA_LIBRE,
      desayuno: false,
      almuerzo: false,
      cena: false,
      descripcion: hotel ? `Noche adicional en ${hotel}. Día libre, sin actividades programadas.` : "Noche adicional. Día libre, sin actividades programadas.",
      fecha: fechaDe(dia),
      libre: true,
    };
  });
  const dia = ultimo.dia + k;
  const posteriores = orden.filter((d) => d.tipo_tramo === "traslado_posterior")
    .map((d) => ({ ...original(d), dia: d.dia + k, fecha: fechaDe(d.dia + k) }));
  return [...previos, ...libres, { ...ultimo, dia, fecha: fechaDe(dia), libre: false }, ...posteriores];
}

/**
 * El itinerario debe traer exactamente los días 1..N del programa (N = `programas.dias`) antes de desplazar el último: con un día
 * ausente o repetido, "el último día" no sería la recogida y el desplazamiento la dejaría en el día equivocado. Mensaje o null.
 */
export function validarItinerarioCompleto(dias: readonly Pick<DiaItinerario, "dia" | "tipo_tramo">[], diasPrograma: number | null): string | null {
  if (diasPrograma == null || !Number.isInteger(diasPrograma) || diasPrograma < 1) {
    return "El programa no tiene configurados sus días: sin ellos no se puede validar el itinerario, ni calcular, publicar ni reservar.";
  }
  const normales = dias.filter((d) => (d.tipo_tramo ?? "dia") === "dia");
  const presentes = normales.map((d) => d.dia);
  const faltan = Array.from({ length: diasPrograma }, (_, i) => i + 1).filter((d) => !presentes.includes(d));
  const repetidos = presentes.filter((d, i) => presentes.indexOf(d) !== i);
  const sobran = presentes.filter((d) => !Number.isInteger(d) || d < 1 || d > diasPrograma);
  const previos = dias.filter((d) => d.tipo_tramo === "traslado_previo");
  const posteriores = dias.filter((d) => d.tipo_tramo === "traslado_posterior");
  const trasladoInvalido = dias.some((d) => !["dia", "traslado_previo", "traslado_posterior"].includes(d.tipo_tramo ?? "dia"))
    || previos.length > 1 || posteriores.length > 1
    || previos.some((d) => d.dia !== 0)
    || posteriores.some((d) => d.dia !== diasPrograma + 1);
  if (!faltan.length && !repetidos.length && !sobran.length && !trasladoInvalido) return null;
  const partes = [
    faltan.length ? `faltan los días ${faltan.join(", ")}` : null,
    repetidos.length ? `se repiten los días ${[...new Set(repetidos)].join(", ")}` : null,
    sobran.length ? `hay días fuera de 1–${diasPrograma} (${[...new Set(sobran)].join(", ")})` : null,
    trasladoInvalido ? "los traslados deben ir antes del día 1 o después del último día, como máximo uno en cada extremo" : null,
  ].filter(Boolean).join("; ");
  return `El itinerario del programa está incompleto (${partes}): complétalo antes de calcular, publicar o reservar el programa.`;
}

/** Estado estructurado del itinerario (PR #409): qué días faltan, cuáles se repiten y cuáles sobran respecto de los días 1..N del programa. */
export function estadoItinerario(dias: readonly Pick<DiaItinerario, "dia" | "tipo_tramo">[], diasPrograma: number | null): { completo: boolean; faltantes: number[]; repetidos: number[]; fuera: number[]; mensaje: string | null } {
  const mensaje = validarItinerarioCompleto(dias, diasPrograma);
  if (diasPrograma == null || !Number.isInteger(diasPrograma) || diasPrograma < 1) return { completo: false, faltantes: [], repetidos: [], fuera: [], mensaje };
  const presentes = dias.filter((d) => (d.tipo_tramo ?? "dia") === "dia").map((d) => d.dia);
  return {
    completo: mensaje == null,
    faltantes: Array.from({ length: diasPrograma }, (_, i) => i + 1).filter((d) => !presentes.includes(d)),
    repetidos: [...new Set(presentes.filter((d, i) => presentes.indexOf(d) !== i))],
    fuera: [...new Set(presentes.filter((d) => !Number.isInteger(d) || d < 1 || d > diasPrograma))],
    mensaje,
  };
}

// ── Transporte ─────────────────────────────────────────────────────────────

/**
 * El modo «hotel y vigencia» es solo para programas TERRESTRES: no se combina con aéreo. Rechaza si CUALQUIERA de los dos campos reales
 * lo marca (`tipo_transporte = 'aereo'` o `incluye_aereo = true`), aunque el otro diga ninguno/terrestre: es exactamente el criterio de
 * `programas_modo_hotel_terrestre_chk` (migración 245), así el usuario ve este mensaje y no el error crudo de la base. Mensaje o null.
 */
export function errorModoHotelConAereo(p: { tipo_transporte?: string | null; incluye_aereo?: boolean | null }): string | null {
  return p.tipo_transporte === "aereo" || p.incluye_aereo === true
    ? "El modo por hotel y vigencia es solo para programas terrestres: un programa con aéreo no puede usarlo. Cambia el transporte del programa o su estructura de precio."
    : null;
}

// ── Capacidad del hotel y vigencias base compartidas (PR #409) ─────────────

/** Ocupación declarada por el hotel; null = sin tope. */
export type OcupacionHotel = { maxPaxHabitacion?: number | null; maxMenoresHabitacion?: number | null };

/**
 * ¿Esta tarifa tiene sentido para el hotel? Una acomodación para N personas no cabe si el hotel admite menos de N por
 * habitación, y la tarifa de menor no existe si el hotel no admite menores (max_menores_habitacion = 0).
 */
export function claveCompatible(h: OcupacionHotel, clave: ClaveTarifa): boolean {
  if (clave === "nino") return h.maxMenoresHabitacion == null || h.maxMenoresHabitacion > 0;
  return h.maxPaxHabitacion == null || paxDeAcomodacion(clave) <= h.maxPaxHabitacion;
}

/** Tarifas CARGADAS que el hotel no admite (para mostrarlas y resolverlas; nunca se descartan en silencio). */
export function clavesIncompatibles(h: OcupacionHotel, neto: PorAcom): ClaveTarifa[] {
  return CLAVES_TARIFA.filter((k) => neto[k] != null && !claveCompatible(h, k));
}

export function motivoIncompatible(h: OcupacionHotel, clave: ClaveTarifa): string {
  return clave === "nino"
    ? `el hotel admite máximo ${h.maxMenoresHabitacion ?? 0} menor(es) por habitación: no lleva tarifa de menor`
    : `${ETIQUETA_ACOM[clave]} es para ${paxDeAcomodacion(clave)} personas y el hotel admite máximo ${h.maxPaxHabitacion} persona(s) por habitación`;
}

/** Deja en null las tarifas que el hotel no admite (lo que se publica jamás las muestra, aunque existan filas antiguas). */
export function soloCompatibles(h: OcupacionHotel, v: PorAcom): PorAcom {
  const o = { ...v };
  for (const k of CLAVES_TARIFA) if (!claveCompatible(h, k)) o[k] = null;
  return o;
}

export type OpcionVigenciaBase = { desde: string; hasta: string; modalidades: ModalidadServicios[] };

/**
 * Vigencias base ÚNICAS de un hotel (las que ofrece el selector de noches adicionales). Privados y regulares con las mismas
 * fechas son UNA sola opción (la noche adicional tiene una sola tarifa para ambas). Si las dos modalidades existen y sus
 * fechas no coinciden, devuelve los conflictos: la noche no puede ligarse a una vigencia ambigua.
 */
export function opcionesVigenciaBase(base: readonly { desde: string; hasta: string; modalidad: string }[]): { opciones: OpcionVigenciaBase[]; conflictos: string[] } {
  const mapa = new Map<string, OpcionVigenciaBase>();
  for (const b of base) {
    if (!esFechaIso(b.desde) || !esFechaIso(b.hasta) || !(MODALIDADES_SERVICIOS as readonly string[]).includes(b.modalidad)) continue;
    const clave = `${b.desde}|${b.hasta}`;
    const o = mapa.get(clave) ?? { desde: b.desde, hasta: b.hasta, modalidades: [] };
    if (!o.modalidades.includes(b.modalidad as ModalidadServicios)) o.modalidades.push(b.modalidad as ModalidadServicios);
    mapa.set(clave, o);
  }
  const opciones = [...mapa.values()].sort((a, b) => a.desde.localeCompare(b.desde) || a.hasta.localeCompare(b.hasta));
  const hayPrivado = opciones.some((o) => o.modalidades.includes("privado"));
  const hayRegular = opciones.some((o) => o.modalidades.includes("regular"));
  const conflictos: string[] = [];
  if (hayPrivado && hayRegular) {
    for (const o of opciones) {
      if (o.modalidades.length === 2) continue;
      const falta = o.modalidades[0] === "privado" ? "regulares" : "privados";
      conflictos.push(`Las vigencias base de servicios privados y regulares no coinciden: ${fechaLegible(o.desde)}–${fechaLegible(o.hasta)} no existe en servicios ${falta}.`);
    }
  }
  return { opciones, conflictos };
}

export type CatalogoHotelValidable = OcupacionHotel & {
  base: { desde: string; hasta: string; modalidad: string; neto: PorAcom }[];
  noches: { desde: string; hasta: string; unidad: string; neto: PorAcom }[];
};

/**
 * Conflictos de un hotel que impiden guardarlo (los mismos los muestra el editor y los exige el servidor):
 * tarifas que el hotel no admite, y noches adicionales que no están ligadas a una vigencia base existente.
 */
export function conflictosHotel(h: CatalogoHotelValidable): string[] {
  const out: string[] = [];
  h.base.forEach((b, j) => {
    for (const k of clavesIncompatibles(h, b.neto)) out.push(`La vigencia base ${j + 1} tiene tarifa ${ETIQUETA_ACOM[k]}: ${motivoIncompatible(h, k)}.`);
  });
  h.noches.forEach((n, j) => {
    const ks = clavesIncompatibles(h, n.neto).filter((k) => !(k === "nino" && n.unidad === "habitacion"));
    for (const k of ks) out.push(`La noche adicional ${j + 1} tiene tarifa ${ETIQUETA_ACOM[k]}: ${motivoIncompatible(h, k)}.`);
  });
  if (h.noches.length) {
    const { opciones, conflictos } = opcionesVigenciaBase(h.base);
    out.push(...conflictos);
    h.noches.forEach((n, j) => {
      if (!opciones.some((o) => o.desde === n.desde && o.hasta === n.hasta)) {
        out.push(`La tarifa de noche adicional ${j + 1} (${n.desde ? fechaLegible(n.desde) : "?"}–${n.hasta ? fechaLegible(n.hasta) : "?"}) no corresponde a ninguna vigencia base del hotel: elige una vigencia base existente o quita la tarifa.`);
      }
    });
  }
  return out;
}

// ── Validación del catálogo al guardarlo ───────────────────────────────────

export type HotelParaGuardar = {
  nombre: string;
  base: { desde: string; hasta: string; modalidad: string; neto: PorAcom; bajoSolicitud?: boolean }[];
  noches: { desde: string; hasta: string; unidad: string; neto: PorAcom }[];
  maxPaxHabitacion?: number | null;
  maxMenoresHabitacion?: number | null;
};

/**
 * Valida el catálogo ANTES de guardarlo (mensaje legible; la BD repite lo
 * esencial con CHECK). Los solapes se rechazan al guardar, pero el motor los
 * bloquea igual al cotizar (datos viejos o cargados por otra vía).
 */
export function validarHotelesParaGuardar(hoteles: readonly HotelParaGuardar[]): string | null {
  const nombres = new Set<string>();
  for (const [i, h] of hoteles.entries()) {
    const nombre = (h.nombre ?? "").trim();
    if (!nombre) return `El hotel ${i + 1} no tiene nombre.`;
    const clave = nombre.toLowerCase();
    if (nombres.has(clave)) return `El hotel "${nombre}" está repetido.`;
    nombres.add(clave);
    if (h.maxPaxHabitacion != null && !(Number.isInteger(h.maxPaxHabitacion) && h.maxPaxHabitacion >= 1)) return `${nombre}: el máximo de personas por habitación debe ser un entero de 1 o más.`;
    if (h.maxMenoresHabitacion != null && !(Number.isInteger(h.maxMenoresHabitacion) && h.maxMenoresHabitacion >= 0)) return `${nombre}: el máximo de menores por habitación debe ser un entero de 0 o más.`;
    for (const [j, b] of h.base.entries()) {
      if (!esFechaIso(b.desde) || !esFechaIso(b.hasta)) return `${nombre}: la vigencia base ${j + 1} necesita fechas válidas.`;
      if (b.desde > b.hasta) return `${nombre}: la vigencia base ${j + 1} termina antes de empezar.`;
      if (!(MODALIDADES_SERVICIOS as readonly string[]).includes(b.modalidad)) return `${nombre}: la vigencia base ${j + 1} necesita la modalidad de servicios (privados o regulares).`;
      for (const k of CLAVES_TARIFA) {
        const v = b.neto[k];
        if (v != null && !(Number.isFinite(v) && v >= 0)) return `${nombre}: los precios base no pueden ser negativos.`;
      }
    }
    for (const mod of MODALIDADES_SERVICIOS) {
      const s = primerSolape(h.base.filter((b) => b.modalidad === mod).map((b) => ({ desde: b.desde, hasta: b.hasta })));
      if (s) return `${nombre}: dos vigencias base de ${ETIQUETA_MODALIDAD[mod].toLowerCase()} se solapan (${fechaLegible(s[0].desde)}–${fechaLegible(s[0].hasta)} y ${fechaLegible(s[1].desde)}–${fechaLegible(s[1].hasta)}).`;
    }
    for (const [j, n] of h.noches.entries()) {
      if (!esFechaIso(n.desde) || !esFechaIso(n.hasta)) return `${nombre}: la vigencia de noche adicional ${j + 1} necesita fechas válidas.`;
      if (n.desde > n.hasta) return `${nombre}: la vigencia de noche adicional ${j + 1} termina antes de empezar.`;
      if (!(UNIDADES_COBRO as readonly string[]).includes(n.unidad)) return `${nombre}: la tarifa de noche adicional ${j + 1} necesita su unidad de cobro (por persona o por habitación).`;
      for (const k of CLAVES_TARIFA) {
        const v = n.neto[k];
        if (v != null && !(Number.isFinite(v) && v >= 0)) return `${nombre}: las tarifas de noche adicional no pueden ser negativas.`;
      }
      // Por habitación el menor va incluido: su campo no cuenta como valor de la tarifa.
      const utiles = n.unidad === "habitacion" ? CLAVES_TARIFA.filter((k) => k !== "nino") : CLAVES_TARIFA;
      if (utiles.every((k) => n.neto[k] == null)) return `${nombre}: la tarifa de noche adicional ${j + 1} no tiene ningún valor.`;
    }
    const s = primerSolape(h.noches.map((n) => ({ desde: n.desde, hasta: n.hasta })));
    if (s) return `${nombre}: dos vigencias de noche adicional se solapan (${fechaLegible(s[0].desde)}–${fechaLegible(s[0].hasta)} y ${fechaLegible(s[1].desde)}–${fechaLegible(s[1].hasta)}).`;
    const conflicto = conflictosHotel(h as unknown as CatalogoHotelValidable)[0];
    if (conflicto) return `${nombre}: ${conflicto}`;
  }
  return null;
}

// ── Contrato: líneas, foto y obligaciones ──────────────────────────────────

function describirFechas(fechas: readonly string[]): string {
  if (fechas.length === 1) return `el ${fechaLegible(fechas[0])}`;
  const seguidas = fechas.every((f, i) => i === 0 || f === sumarDiasIso(fechas[i - 1], 1));
  return seguidas ? `del ${fechaLegible(fechas[0])} al ${fechaLegible(fechas[fechas.length - 1])}` : fechas.map(fechaLegible).join(", ");
}

export type ItemNochesContrato = { descripcion: string; valorTotal: number };

/**
 * Líneas del contrato para las noches adicionales (`contrato_items` en modo
 * "total"): una por acomodación y unidad de cobro, con las fechas exactas. La
 * suma de sus `valorTotal` es EXACTAMENTE el PVP de las noches (centavos): ni se
 * cobra de más ni de menos al agruparlas.
 */
export function itemsContratoNoches(noches: readonly Noche88[], hotelNombre: string): ItemNochesContrato[] {
  const grupos = new Map<string, { acomodacion: string; unidad: UnidadCobro; fechas: string[]; cantidad: number; centavos: number; incluido: boolean }>();
  for (const n of noches) {
    for (const l of n.lineas) {
      const clave = `${l.acomodacion}|${l.unidad}|${l.incluidoEnHabitacion ? "inc" : ""}`;
      const g = grupos.get(clave) ?? { acomodacion: l.acomodacion, unidad: l.unidad, fechas: [], cantidad: l.cantidad, centavos: 0, incluido: !!l.incluidoEnHabitacion };
      g.fechas.push(n.fecha);
      g.centavos += centavos(l.pvpUnit) * l.cantidad;
      grupos.set(clave, g);
    }
  }
  return [...grupos.values()].map((g) => {
    const que = g.acomodacion === "nino"
      ? g.incluido ? `${g.cantidad} menor(es) incluidos en la habitación (solo asistencia)` : `${g.cantidad} menor(es)`
      : g.unidad === "habitacion" ? `${g.cantidad} hab ${ETIQUETA_ACOM[g.acomodacion] ?? g.acomodacion}` : `${g.cantidad} pax en ${ETIQUETA_ACOM[g.acomodacion] ?? g.acomodacion}`;
    return {
      descripcion: `Noches adicionales · ${hotelNombre} · ${que} · ${g.fechas.length} noche(s) ${describirFechas(g.fechas)}`,
      valorTotal: g.centavos / 100,
    };
  });
}

export type ProveedorObligacion = { id: number | null; nombre: string | null; aplicaRetencion: boolean; pctRetencion: number };

export type PlanObligacionesPrograma = {
  /** Obligación con el proveedor del programa. */
  programa: { valor: number };
  /** Obligación aparte con el proveedor del hotel (solo si es OTRO proveedor y hay costo de noches). */
  noches: { valor: number; proveedor: ProveedorObligacion } | null;
};

/**
 * A quién se le debe cada peso, UNA sola vez: el costo de las noches extra va a
 * la obligación del proveedor del hotel. Si el hotel no tiene proveedor propio o
 * es el mismo del programa, se suma a la obligación del programa (una sola CxP);
 * si es otro proveedor, la obligación del programa conserva SOLO la base y las
 * noches van en la suya. Suma exacta en centavos. La asistencia no entra aquí: hoy
 * no tiene proveedor ni CxP identificables.
 */
export function planObligacionesPrograma(a: {
  netoBase: number;
  netoNoches: number;
  proveedorPrograma: ProveedorObligacion;
  proveedorHotel: ProveedorObligacion | null;
}): PlanObligacionesPrograma {
  const base = centavos(a.netoBase);
  const noches = centavos(a.netoNoches);
  const ph = a.proveedorHotel;
  const separado = ph != null && ph.id != null && ph.id !== a.proveedorPrograma.id && noches > 0;
  if (!separado) return { programa: { valor: (base + noches) / 100 }, noches: null };
  return { programa: { valor: base / 100 }, noches: { valor: noches / 100, proveedor: ph } };
}

/** Foto de la selección que se congela en el contrato (sin netos). */
export type FotoEstancia = {
  hotelId: number;
  hotelNombre: string;
  zona: string | null;
  tipoHabitacion: string | null;
  modalidad: ModalidadServicios;
  moneda: string;
  fechaEntrada: string;
  nochesIncluidas: number;
  nochesAdicionales: number;
  fechaRegreso: string;
  baseDesde: string;
  baseHasta: string;
  habitaciones: Record<string, number>;
  ninos: number;
  infantes: number;
  precioBase: number;
  precioNoches: number;
  noches: {
    fecha: string;
    vigencia_desde: string;
    vigencia_hasta: string;
    unidad: UnidadCobro;
    pvp_total: number;
    lineas: { acomodacion: string; unidad: UnidadCobro; cantidad: number; pvp_unit: number }[];
  }[];
  itinerario: DiaConFecha[];
};

/** `noches` de la foto: lo que ve el cliente (PVP), nunca el neto. */
export function nochesParaFoto(noches: readonly Noche88[]): FotoEstancia["noches"] {
  return noches.map((n) => ({
    fecha: n.fecha,
    vigencia_desde: n.vigenciaDesde,
    vigencia_hasta: n.vigenciaHasta,
    unidad: n.unidad,
    pvp_total: n.pvpCentavos / 100,
    lineas: n.lineas.map((l) => ({ acomodacion: l.acomodacion, unidad: l.unidad, cantidad: l.cantidad, pvp_unit: l.pvpUnit })),
  }));
}

/** Detalle de neto por noche, para el registro de costo (solo roles contables). */
export function nochesParaCosto(noches: readonly Noche88[]) {
  return noches.map((n) => ({
    fecha: n.fecha,
    neto_total: n.netoCentavos == null ? null : n.netoCentavos / 100,
    lineas: n.lineas.map((l) => ({ acomodacion: l.acomodacion, unidad: l.unidad, cantidad: l.cantidad, neto_unit: l.netoUnit })),
  }));
}
