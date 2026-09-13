// ─────────────────────────────────────────────────────────────────────────
// Puente entre la ocupación que captura el BUSCADOR GENERAL (`BuscadorBooking`)
// y la asociación habitación↔edades que exige la cotización por unidad.
//
// Por qué existe: el buscador general captura la ocupación en la forma
// LEGADA — una lista de habitaciones por TIPO (`{acom}[]`, sin id), un
// único total de adultos para toda la consulta y un arreglo PLANO de edades
// de menores, sin ningún vínculo a una habitación puntual. En cambio
// `computarReservaBernalo` (vía `adaptarOcupacionDesdeReservar`, Caso C)
// necesita la asociación EXPLÍCITA `HabitacionConEdadesExplicitas[]` —
// exactamente la que ya produce el flujo Bernalo por habitación
// (`lib/reservar/ocupacionPorHabitacion.ts`).
//
// Este módulo NO inventa una heurística de reparto: delega el REPARTO
// AUTORITATIVO en `distribuirPorHabitaciones` (el mismo motor que ya usa
// `buscarHoteles`/`cotizar.ts` para la persona — mínimos por habitación
// primero, rechazo si no alcanza, sobrantes por orden de captura, tope de
// Niño 1/Niño 2 por habitación, infantes con su propio cupo). Aquí solo se
// resuelve LO QUE FALTABA: una vez que ese motor ya decidió CUÁNTOS menores
// de cada clase van en cada habitación, asignar CUÁLES (las edades reales,
// en el orden en que se capturaron).
//
// Módulo PURO (sin "use client"/"use server", sin Supabase/React): se
// importa directo desde `node --test` y desde el servidor. Imports relativos
// con extensión `.ts` (no `@/...`) por el mismo motivo documentado en
// `lib/tarifario/datosBernalo.ts`.
// ─────────────────────────────────────────────────────────────────────────

import { type AcomRoom } from "../acomodaciones.ts";
import {
  distribuirPorHabitaciones,
  type ConfigCapacidadHabitacion,
} from "./distribucionHabitaciones.ts";
// Solo el TIPO (se borra al compilar/ejecutar): este módulo no arrastra la
// lógica de cotización por habitación, únicamente declara que su salida es
// compatible con la entrada del Caso C del adaptador.
import type { HabitacionConEdadesExplicitas } from "../calc/ocupacionHabitacion.ts";

export type HabitacionBusqueda = { acom: AcomRoom; config: ConfigCapacidadHabitacion };

/**
 * Una habitación ya repartida. Es un SUPERCONJUNTO estructural de
 * `HabitacionConEdadesExplicitas` (Caso C del adaptador) — el `acom` extra
 * es el que permite reenviar el resultado por la MISMA frontera de
 * validación que usa la cotización pública
 * (`validarHabitacionesOcupacion`), en vez de saltársela.
 */
export type HabitacionRepartida = HabitacionConEdadesExplicitas & { acom: AcomRoom };

export type ResultadoRepartoMenores =
  | {
      ok: true;
      habitaciones: HabitacionRepartida[];
      /** Menores clasificados por la regla del hotel — solo para diagnóstico interno. */
      infantes: number;
      ninos: number;
    }
  | { ok: false; tipo: "edad_adulto"; error: string }
  | { ok: false; tipo: "seleccion_invalida"; error: string }
  | { ok: false; tipo: "configuracion_invalida"; error: string };

/**
 * Reparte las edades capturadas en el buscador entre las habitaciones
 * consultadas, con la MISMA clasificación de edad que usa el resto del
 * sistema (`e <= infanteMax` → infante; `e <= ninoMax` → niño; si no,
 * ADULTO — y ahí se rechaza, porque el buscador solo captura edades de
 * menores: una edad de adulto declarada como menor es un dato inválido, no
 * algo que este módulo deba "corregir" moviéndola de lugar).
 *
 * El id de cada habitación sigue la convención POSICIONAL ya establecida en
 * `construirHabitacionesUI` (`${acom}-${índice dentro del mismo tipo}`):
 * nunca se reutiliza el id de una habitación que dejó de existir.
 */
export function repartirMenoresEnHabitaciones(input: {
  habitaciones: HabitacionBusqueda[];
  adultosDeclarados: number;
  edades: number[];
  infanteMax: number;
  ninoMax: number;
}): ResultadoRepartoMenores {
  const { habitaciones, adultosDeclarados, edades, infanteMax, ninoMax } = input;

  // Clasificación por edad — mismo predicado que `clasificarPorEdad`
  // (`lib/acomodaciones.ts`), que solo devuelve CONTEOS; aquí hace falta
  // saber además CUÁLES son, para poder asociarlos a una habitación.
  const cola: ({ edad: number; tipo: "infante" | "nino" } | null)[] = [];
  for (const edad of edades) {
    if (edad <= infanteMax) cola.push({ edad, tipo: "infante" });
    else if (edad <= ninoMax) cola.push({ edad, tipo: "nino" });
    else {
      return {
        ok: false,
        tipo: "edad_adulto",
        error: `La edad ${edad} no corresponde a un menor para este hotel (infantes hasta ${infanteMax}, niños hasta ${ninoMax}).`,
      };
    }
  }

  const totalInfantes = cola.filter((m) => m?.tipo === "infante").length;
  const totalNinos = cola.filter((m) => m?.tipo === "nino").length;

  // Reparto AUTORITATIVO: mínimos por habitación, rechazo honesto si la
  // selección no alcanza, sobrantes por orden de captura. Se llama SIEMPRE
  // (aunque no haya menores) — así la validación de adultos contra el
  // `pax_tarifa` de las habitaciones elegidas y la coherencia de la
  // configuración del hotel ocurren igual, sin un camino alterno que las
  // salte.
  const dist = distribuirPorHabitaciones({
    adultosDeclarados,
    ninos: totalNinos,
    infantes: totalInfantes,
    habitaciones,
  });
  if (!dist.ok) return dist;

  // Asignación de las edades REALES: se recorre el orden de captura y se
  // toma, para cada habitación, exactamente lo que el reparto ya decidió
  // (`infantes` + `nino` + `nino2`) — sin recalcular cupos acá. Las edades
  // de una habitación quedan en el orden en que se capturaron.
  const conteoPorAcom = new Map<string, number>();
  const habitacionesSalida: HabitacionRepartida[] = [];

  for (let i = 0; i < habitaciones.length; i++) {
    const asign = dist.habitaciones[i];
    const h = habitaciones[i];
    let cupoInfantes = asign.infantes;
    let cupoNinos = asign.nino + asign.nino2;
    const edadesHabitacion: number[] = [];

    for (let k = 0; k < cola.length && (cupoInfantes > 0 || cupoNinos > 0); k++) {
      const menor = cola[k];
      if (menor === null) continue;
      if (menor.tipo === "infante" && cupoInfantes > 0) {
        edadesHabitacion.push(menor.edad);
        cupoInfantes--;
        cola[k] = null;
      } else if (menor.tipo === "nino" && cupoNinos > 0) {
        edadesHabitacion.push(menor.edad);
        cupoNinos--;
        cola[k] = null;
      }
    }

    const posicion = conteoPorAcom.get(h.acom) ?? 0;
    conteoPorAcom.set(h.acom, posicion + 1);
    habitacionesSalida.push({
      id: `${h.acom}-${posicion}`,
      acom: h.acom,
      // Los adultos de una habitación son SIEMPRE su `pax_tarifa` (la
      // fórmula de precio por habitación no cambia — ver la cabecera de
      // `distribucionHabitaciones.ts`); el reparto ya validó que la suma
      // coincide con los adultos declarados.
      adultos: h.config.pax_tarifa,
      edadesMenores: edadesHabitacion,
    });
  }

  // Falla cerrada ante una inconsistencia interna: si el reparto autoritativo
  // dijo "N menores" y este recorrido no logró ubicarlos todos, lo correcto
  // es rechazar la cotización, nunca publicar una asociación incompleta (que
  // haría cotizar un pax total menor al real).
  if (cola.some((m) => m !== null)) {
    return {
      ok: false,
      tipo: "configuracion_invalida",
      error: "No fue posible asociar todas las edades declaradas a una habitación.",
    };
  }

  return { ok: true, habitaciones: habitacionesSalida, infantes: totalInfantes, ninos: totalNinos };
}
