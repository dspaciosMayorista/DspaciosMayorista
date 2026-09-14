// ─────────────────────────────────────────────────────────────────────────
// Fase 3D Bernalo — captura y transporte de la asociación EXPLÍCITA
// habitación física ↔ edades de sus menores, para hoteles con
// `modelo_tarifario = "unidad"`.
//
// Objetivo de este archivo, y SOLO este (ver el informe de la tarea): dar
// una fuente de estado CANÓNICA (una sola, sin conteos independientes que
// puedan desincronizarse — regla 14 del encargo) para que la UI capture,
// por HABITACIÓN FÍSICA (id estable), sus propios adultos y las edades
// exactas de sus menores — y una función de validación que el servidor
// pueda reutilizar TAL CUAL (regla 8: "el servidor vuelve a validar; la UI
// no es autoridad") para producir la entrada de
// `adaptarOcupacionDesdeReservar` (Caso C, Fase 3A).
//
// Fuera de alcance de este archivo (fases futuras, explícitamente):
//   - Llamar a `computarReserva`/el orquestador de Fase 3C.
//   - Levantar la guardia que bloquea hoteles Bernalo en Reservar/tarifario.
//   - UI en sí (JSX) — este módulo es PURO, sin "use client"/"use server",
//     sin React. El componente (`EditorPax`, `app/tarifario/VistaBooking.tsx`)
//     y la Server Action de re-validación son consumidores de este archivo.
//
// ── Por qué existe (regla 5 del encargo) ────────────────────────────────
// El flujo legado (`EditorPax` de hoy) captura "cantidad de menores" +
// arreglo plano de edades para TODA la solicitud, sin ningún vínculo a una
// habitación puntual — Fase 3A/3B/3C ya documentaron que esto hace
// irrecuperable la asociación real cuando hay más de una habitación con
// menores. Este archivo reemplaza esa captura, SOLO para hoteles Bernalo,
// por un estado indexado por habitación: `Record<habitacionId, string[]>`.
// Cuando la distribución de habitaciones cambia (se agrega/quita una
// habitación de un tipo), las edades de las habitaciones que YA NO EXISTEN
// se descartan — nunca se reasignan a otra habitación en silencio
// (`sincronizarHabitaciones`, más abajo).
// ─────────────────────────────────────────────────────────────────────────

import { type AcomRoom, ACOM_ROOMS } from "../acomodaciones.ts";
import { parseEdadMenor, ajustarCantidadEdades, EDAD_MENOR_MAX, MAX_MENORES_POR_CONSULTA } from "./edadesMenores.ts";

// ── Identidad de habitación ──────────────────────────────────────────────
// Id ESTABLE de cada habitación física: `${acomodación}-${índice}`, en el
// mismo orden que `ACOM_ROOMS`. El índice es POSICIONAL dentro de su propio
// tipo (la 2ª doble es siempre "doble-1", exista o no una 1ª doble en ese
// momento) — nunca se reutiliza el id de una habitación que dejó de existir
// para nombrar una habitación distinta después.
export type HabitacionUI = { id: string; acom: AcomRoom };

export function construirHabitacionesUI(habs: Record<string, number>): HabitacionUI[] {
  const out: HabitacionUI[] = [];
  for (const a of ACOM_ROOMS) {
    const n = Math.max(0, Math.trunc(Number(habs[a]) || 0));
    for (let i = 0; i < n; i++) out.push({ id: `${a}-${i}`, acom: a });
  }
  return out;
}

export function idsHabitacionesPorConteo(habs: Record<string, number>): string[] {
  return construirHabitacionesUI(habs).map((h) => h.id);
}

// ── Estado de UI: UNA sola fuente por habitación ────────────────────────
// Las edades de cada habitación, como TEXTO (controladas así en el input,
// para poder dejarlas vacías mientras se escribe) — mismo patrón que ya
// usa el flujo legado (`edadesTxt`), ahora indexado por habitación en vez
// de un único arreglo para toda la solicitud. La "cantidad de menores" de
// una habitación es SIEMPRE `edadesPorHabitacion[id].length` — no existe
// (a propósito, regla 14) un número guardado aparte que pudiera
// desincronizarse de ese arreglo.
export type EdadesPorHabitacion = Record<string, string[]>;

// Regla 5: cambiar la distribución de habitaciones NUNCA reasigna una edad
// ya escrita a otra habitación — solo LIMPIA las asociaciones de las
// habitaciones que ya no existen. Las que siguen existiendo (mismo id)
// conservan sus edades tal cual; las nuevas empiezan vacías.
export function sincronizarHabitaciones(
  edadesPorHabitacion: EdadesPorHabitacion,
  idsVigentes: readonly string[]
): EdadesPorHabitacion {
  const siguiente: EdadesPorHabitacion = {};
  for (const id of idsVigentes) siguiente[id] = edadesPorHabitacion[id] ?? [];
  return siguiente;
}

export function ajustarCantidadEdadesHabitacion(
  edadesPorHabitacion: EdadesPorHabitacion,
  habitacionId: string,
  nuevaCantidad: number
): EdadesPorHabitacion {
  return {
    ...edadesPorHabitacion,
    [habitacionId]: ajustarCantidadEdades(edadesPorHabitacion[habitacionId] ?? [], nuevaCantidad),
  };
}

export function establecerEdad(
  edadesPorHabitacion: EdadesPorHabitacion,
  habitacionId: string,
  indice: number,
  valor: string
): EdadesPorHabitacion {
  const actual = edadesPorHabitacion[habitacionId] ?? [];
  return { ...edadesPorHabitacion, [habitacionId]: actual.map((x, i) => (i === indice ? valor : x)) };
}

// ── Transporte: payload que viaja de la UI al servidor ──────────────────
// `cantidadMenores` viaja JUNTO con `edadesMenores` a propósito (regla 7:
// "validar que cantidad de edades coincida exactamente con menores
// declarados por habitación") — pero el CLIENTE nunca lo guarda como
// estado aparte: siempre se serializa como `edadesTxt.length` en el mismo
// momento que se arma el arreglo (ver `construirPayloadHabitaciones`), así
// que aquí no hay dos fuentes que puedan divergir. La razón de igual
// transportarlo es defensiva: el servidor no confía en que el body HTTP
// que le llegó sea el mismo objeto que armó este archivo — alguien podría
// mandar un payload manipulado con un arreglo de edades que no corresponde
// al conteo declarado, y `validarHabitacionesOcupacion` debe detectarlo.
export type HabitacionOcupacionEntrada = {
  id: string;
  acom: string;
  adultos: number;
  cantidadMenores: number;
  edadesMenores: unknown;
};

export function construirPayloadHabitaciones(
  habs: Record<string, number>,
  paxTarifaPorTipo: Record<string, number>,
  edadesPorHabitacion: EdadesPorHabitacion
): HabitacionOcupacionEntrada[] {
  return construirHabitacionesUI(habs).map(({ id, acom }) => {
    const edadesTxt = edadesPorHabitacion[id] ?? [];
    return {
      id,
      acom,
      adultos: Math.max(0, Math.trunc(Number(paxTarifaPorTipo[acom]) || 0)),
      cantidadMenores: edadesTxt.length,
      // `parseEdadMenor(...).valor` es `null` mientras el campo está vacío
      // o mal escrito — se transporta tal cual (nunca se sustituye por 0 u
      // otro valor inventado); `validarHabitacionesOcupacion` lo rechaza
      // explícitamente con el mismo criterio que el resto del sistema.
      edadesMenores: edadesTxt.map((t) => parseEdadMenor(t).valor),
    };
  });
}

// ── Validación — cliente (preview) Y servidor (autoridad real) ─────────
// La MISMA función en los dos lados: el servidor no reimplementa una
// versión "de confianza" distinta — vuelve a correr exactamente esto sobre
// el body que le llegó, tratado como `unknown` (regla 8).
export type HabitacionOcupacionValidada = {
  id: string;
  acom: AcomRoom;
  adultos: number;
  edadesMenores: number[];
};

export type ErrorHabitacionOcupacion = { habitacionId: string | null; mensaje: string };

export type ResultadoValidacionOcupacion =
  | { ok: true; habitaciones: HabitacionOcupacionValidada[] }
  | { ok: false; errores: ErrorHabitacionOcupacion[] };

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Recolecta TODOS los errores (no falla en el primero): la UX pide
// "mensajes claros junto a la habitación incompleta" — plural, una por
// habitación con problema, no solo la primera que falle.
export function validarHabitacionesOcupacion(entradaDesconocida: unknown): ResultadoValidacionOcupacion {
  if (!Array.isArray(entradaDesconocida)) {
    return { ok: false, errores: [{ habitacionId: null, mensaje: "Las habitaciones deben venir como un arreglo." }] };
  }
  if (entradaDesconocida.length === 0) {
    return { ok: false, errores: [{ habitacionId: null, mensaje: "No hay habitaciones para cotizar." }] };
  }

  const errores: ErrorHabitacionOcupacion[] = [];
  const habitaciones: HabitacionOcupacionValidada[] = [];
  const idsVistos = new Set<string>();

  for (const filaDesconocida of entradaDesconocida) {
    if (!esObjetoPlano(filaDesconocida)) {
      errores.push({ habitacionId: null, mensaje: "Cada habitación debe ser un objeto." });
      continue;
    }
    const fila = filaDesconocida;

    const id = fila.id;
    if (typeof id !== "string" || id.trim() === "") {
      errores.push({ habitacionId: null, mensaje: "Cada habitación debe traer un id (texto no vacío)." });
      continue;
    }
    if (idsVistos.has(id)) {
      errores.push({ habitacionId: id, mensaje: `El id de habitación "${id}" está repetido.` });
      continue;
    }
    idsVistos.add(id);

    const acomCruda = fila.acom;
    if (typeof acomCruda !== "string" || !(ACOM_ROOMS as readonly string[]).includes(acomCruda)) {
      errores.push({ habitacionId: id, mensaje: `La habitación "${id}" tiene un tipo de acomodación inválido.` });
      continue;
    }
    const acom = acomCruda as AcomRoom;

    const adultos = fila.adultos;
    if (typeof adultos !== "number" || !Number.isInteger(adultos) || adultos <= 0) {
      errores.push({ habitacionId: id, mensaje: `La habitación "${id}" tiene una cantidad de adultos inválida.` });
      continue;
    }

    const cantidadMenores = fila.cantidadMenores;
    if (
      typeof cantidadMenores !== "number" ||
      !Number.isInteger(cantidadMenores) ||
      cantidadMenores < 0 ||
      cantidadMenores > MAX_MENORES_POR_CONSULTA
    ) {
      errores.push({ habitacionId: id, mensaje: `La habitación "${id}" tiene una cantidad de menores inválida.` });
      continue;
    }

    const edadesRaw = fila.edadesMenores;
    if (!Array.isArray(edadesRaw)) {
      errores.push({ habitacionId: id, mensaje: `La habitación "${id}": las edades de los menores deben venir como un arreglo.` });
      continue;
    }
    // Regla 7: el conteo declarado debe coincidir EXACTAMENTE con la
    // cantidad de edades recibidas — nunca se completa ni se recorta.
    if (edadesRaw.length !== cantidadMenores) {
      errores.push({
        habitacionId: id,
        mensaje: `La habitación "${id}" declara ${cantidadMenores} menor(es) pero llegaron ${edadesRaw.length} edad(es).`,
      });
      continue;
    }

    const edadesMenores: number[] = [];
    let filaValida = true;
    for (let i = 0; i < edadesRaw.length; i++) {
      const e = edadesRaw[i];
      if (typeof e !== "number" || !Number.isFinite(e) || !Number.isInteger(e)) {
        errores.push({ habitacionId: id, mensaje: `La habitación "${id}": la edad del menor ${i + 1} es obligatoria y debe ser un número entero.` });
        filaValida = false;
        continue;
      }
      if (e < 0) {
        errores.push({ habitacionId: id, mensaje: `La habitación "${id}": la edad del menor ${i + 1} no puede ser negativa.` });
        filaValida = false;
        continue;
      }
      if (e > EDAD_MENOR_MAX) {
        errores.push({
          habitacionId: id,
          mensaje: `La habitación "${id}": la edad del menor ${i + 1} (${e}) no corresponde a un menor de edad (0 a ${EDAD_MENOR_MAX}).`,
        });
        filaValida = false;
        continue;
      }
      edadesMenores.push(e);
    }
    if (!filaValida) continue;

    habitaciones.push({ id, acom, adultos, edadesMenores });
  }

  if (errores.length > 0) return { ok: false, errores };
  return { ok: true, habitaciones };
}
