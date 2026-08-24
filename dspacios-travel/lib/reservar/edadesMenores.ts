// ─────────────────────────────────────────────────────────────────────────
// Edad individual de cada menor en la CONSULTA de Vista Booking (no la fecha
// de nacimiento — esa se diligencia después, en el listado real de
// pasajeros del contrato). Reemplaza el mecanismo anterior de "cuántos
// niños van en la tarifa Niño 1 / cuántos en Niño 2 / cuántos infantes",
// que el asesor asignaba a mano sin ninguna edad real de por medio.
//
// Reglas REALES reutilizadas, no inventadas:
// - El único umbral de edad que el motor de reservas usa de verdad es
//   `hoteles.edad_infante_max`/`edad_nino_max` (lib/acomodaciones.ts,
//   `clasificarPorEdad` — la misma función que ya usa `computarReserva`
//   para validar las edades reales de los pasajeros contra la
//   acomodación). Este módulo llama a esa MISMA función; no reimplementa
//   el umbral.
// - "Niño 1"/"Niño 2" (migración 20260601000020_dos_ninos.sql) NO son dos
//   rangos de edad distintos — son dos TARIFAS por el mismo rango "niño"
//   ("el hotel da gratis el 1er niño y cobra el 2º, o cobra distinto cada
//   uno"). La edad decide CUÁNTOS menores caen en la categoría "niño";
//   cuál de ellos paga Niño-1 y cuál Niño-2 es un reparto por ORDEN DE
//   CAPTURA (decisión de negocio explícita): el primero cuenta como
//   Niño-1, el segundo como Niño-2. Un hotel solo tiene esas DOS tarifas
//   configuradas — un 3er menor en edad de niño no tiene dónde
//   liquidarse, así que falla cerrado en vez de inventar una 3ª tarifa o
//   reutilizar una de las dos silenciosamente.
// - Un menor cuya edad supera `edad_nino_max` no tiene una "tarifa de
//   adulto" individual que cobrarle: en este sistema el adulto se cobra
//   por OCUPACIÓN DE HABITACIÓN (habitaciones × pax_tarifa), no por
//   persona suelta. Por eso esa edad falla cerrado pidiendo contarla
//   entre los adultos/habitaciones, en vez de inventar un cobro.
//
// Módulo PURO (sin "use client"/"use server"): se usa tanto desde los
// componentes de Vista Booking (preview en memoria antes de cotizar) como
// desde el servidor (re-validación autoritativa de lo que mande el
// cliente, que se trata siempre como `unknown`).
// ─────────────────────────────────────────────────────────────────────────

// Import relativo (no `@/…`) a propósito: este módulo se importa DIRECTO
// desde `node --test` (ver pruebas/edadesMenores.test.ts) para ejecutar la
// lógica real, y ese runtime no resuelve el alias `@/` de tsconfig — mismo
// motivo por el que otros módulos puros del repo (lib/reservar/origen.ts,
// lib/vuelos/control.ts) evitan imports con alias.
import { clasificarPorEdad } from "../acomodaciones.ts";

// Un "menor" nunca puede declararse con 18 años o más — la propia
// definición de adulto del sistema (ocupación de habitación, nunca tarifa
// de menor) hace que cualquier edad de mayoría de edad no tenga sentido en
// este campo. No es un rango de negocio nuevo: es el límite de lo que el
// campo "menor" puede significar.
export const EDAD_MENOR_MAX = 17;

// Tope de menores por consulta — protege el payload, no es una regla de
// negocio de precios (ver también MAX_PAX_CONSULTA más abajo, el tope total).
export const MAX_MENORES_POR_CONSULTA = 10;

// Tope total de pax (adultos + menores) por una sola consulta/ítem —
// protección de payload/DoS en la frontera del servidor, no un límite de
// ocupación real de ningún hotel (esos ya se validan aparte por acomodación).
export const MAX_PAX_CONSULTA = 24;

// Parser de UN campo de edad tal como lo escribe el usuario (string —
// controlado así para poder dejarlo vacío mientras escribe). Compartido por
// todos los formularios de Vista Booking que piden edad por menor, para no
// reimplementar el mismo criterio (entero, sin negativos/decimales/texto,
// dentro de EDAD_MENOR_MAX) en cada componente.
export function parseEdadMenor(s: string): { valor: number | null; error: string | null } {
  const t = s.trim();
  if (t === "") return { valor: null, error: "Obligatoria" };
  if (!/^\d+$/.test(t)) return { valor: null, error: "Entero, sin negativos ni decimales" };
  const n = Number(t);
  if (n > EDAD_MENOR_MAX) return { valor: null, error: `0 a ${EDAD_MENOR_MAX}` };
  return { valor: n, error: null };
}

// Ajusta el arreglo de edades (como texto — controlado en el input) a una
// nueva cantidad de menores: si crece, agrega campos VACÍOS al final; si
// decrece, quita solo los sobrantes del final. Las edades ya escritas nunca
// se reordenan ni se pierden. Compartido por todos los formularios de Vista
// Booking que piden "cantidad de menores" + N campos de edad, para que el
// comportamiento de "aumentar/disminuir conserva lo existente" sea uno solo,
// probado una vez, y no una copia por componente.
export function ajustarCantidadEdades(actual: readonly string[], nuevaCantidad: number): string[] {
  const n = Math.max(0, Math.min(MAX_MENORES_POR_CONSULTA, Math.trunc(nuevaCantidad) || 0));
  const next = actual.slice(0, n);
  while (next.length < n) next.push("");
  return next;
}

export function validarCantidadMenores(v: unknown): { ok: true; cantidad: number } | { ok: false; error: string } {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return { ok: false, error: "La cantidad de menores debe ser un entero mayor o igual a 0." };
  if (v > MAX_MENORES_POR_CONSULTA) return { ok: false, error: `No se pueden cotizar más de ${MAX_MENORES_POR_CONSULTA} menores en una sola consulta.` };
  return { ok: true, cantidad: v };
}

// Valida la FORMA completa del arreglo de edades antes de que el llamador
// use `.map()`/`.length`/aritmética sobre él — nunca asume que lo que
// llegó ya es `number[]` solo porque el tipo de TypeScript lo declare así
// (una Server Action puede invocarse con cualquier body HTTP).
export function validarEdadesMenores(
  v: unknown,
  cantidadMenores: number
): { ok: true; edades: number[] } | { ok: false; error: string } {
  if (!Array.isArray(v)) return { ok: false, error: "Las edades de los menores deben venir como un arreglo." };
  if (v.length !== cantidadMenores) {
    return { ok: false, error: `Se esperaban ${cantidadMenores} edad(es) de menor y llegaron ${v.length}.` };
  }
  const edades: number[] = [];
  for (let i = 0; i < v.length; i++) {
    const e = v[i];
    if (typeof e !== "number" || !Number.isInteger(e) || !Number.isFinite(e)) {
      return { ok: false, error: `La edad del menor ${i + 1} debe ser un número entero.` };
    }
    if (e < 0) return { ok: false, error: `La edad del menor ${i + 1} no puede ser negativa.` };
    if (e > EDAD_MENOR_MAX) return { ok: false, error: `La edad del menor ${i + 1} (${e}) no corresponde a un menor de edad.` };
    edades.push(e);
  }
  return { ok: true, edades };
}

export type ClasificacionMenores = { infantes: number; nino: number; nino2: number };

export type ResultadoClasificacionMenores =
  | { ok: true; c: ClasificacionMenores }
  | { ok: false; codigo: "edad_adulto" | "sin_cupo_tarifa_menores"; error: string };

// Clasifica las edades YA VALIDADAS (ver validarEdadesMenores) contra los
// umbrales REALES del hotel — reutiliza `clasificarPorEdad`, la misma
// función que usa el motor de reservas para validar pasajeros reales. Falla
// cerrado (nunca aproxima ni reparte por defecto) si alguna edad excede el
// umbral de niño, o si hay más de 2 menores en edad de niño (el hotel solo
// tiene 2 tarifas de niño configurables).
export function clasificarYRepartirMenores(
  edades: number[],
  infanteMax: number,
  ninoMax: number
): ResultadoClasificacionMenores {
  const c = clasificarPorEdad(edades, infanteMax, ninoMax);
  if (c.adultos > 0) {
    const edadAdulto = edades.find((e) => e > ninoMax)!;
    return {
      ok: false,
      codigo: "edad_adulto",
      error: `La edad ${edadAdulto} corresponde a tarifa de adulto según este hotel (mayor a ${ninoMax} años) — cuenta a esta persona entre los adultos (habitaciones), no como menor.`,
    };
  }
  if (c.ninos > 2) {
    return {
      ok: false,
      codigo: "sin_cupo_tarifa_menores",
      error: `Este hotel solo tiene tarifa configurada para 2 niños (Niño 1 y Niño 2); hay ${c.ninos} menor(es) en edad de niño (entre ${infanteMax + 1} y ${ninoMax} años).`,
    };
  }
  return { ok: true, c: { infantes: c.infantes, nino: Math.min(c.ninos, 1), nino2: Math.max(0, c.ninos - 1) } };
}

// Confirma que el hotel/combo (categoría+régimen) tenga de verdad una tarifa
// para las categorías que la clasificación necesita. Infante queda fuera a
// propósito: es la ÚNICA asimetría real y ya documentada del sistema (si el
// hotel no configuró tarifa de infante, se vende gratis en vez de bloquear —
// ver computo.ts, "a diferencia de niño, si no está configurado NO bloquea
// la reserva"); Niño 1/2 SIEMPRE deben tener tarifa configurada si hay
// alguien clasificado ahí, o la consulta falla cerrado.
export function verificarTarifasMenoresDisponibles(
  c: ClasificacionMenores,
  disponible: { nino: boolean; nino2: boolean }
): string | null {
  if (c.nino > 0 && !disponible.nino) return "Este hotel no tiene tarifa de Niño 1 configurada para esa categoría/régimen — no se puede cotizar con esa edad.";
  if (c.nino2 > 0 && !disponible.nino2) return "Este hotel no tiene tarifa de Niño 2 configurada para esa categoría/régimen — no se puede cotizar con esa edad.";
  return null;
}
