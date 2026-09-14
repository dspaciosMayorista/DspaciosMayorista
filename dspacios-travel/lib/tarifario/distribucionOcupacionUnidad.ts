// ─────────────────────────────────────────────────────────────────────────
// Adaptador PURO: convierte la ocupación AGREGADA que captura el buscador
// general (tipos/cantidad de habitaciones consultadas, adultos totales,
// edades exactas de menores) en habitaciones FÍSICAS — con adultos y edades
// ya asignados a cada una — para hoteles `modelo_tarifario = "unidad"`.
//
// ── Causa del defecto que este módulo corrige (hallazgo confirmado con
// datos reales, hotel_id=216, "Hotel Prueba Odair") ─────────────────────────
// La búsqueda unidad reutilizaba el reparto de PERSONA
// (`distribuirPorHabitaciones`/`repartirMenoresEnHabitaciones`), cuya
// capacidad de niños se deriva de `hotel_acomodaciones` — y, si el hotel no
// tenía filas ahí (caso real, ninguna fila para hotel_id=216), caía a
// `defaultAcomConfig("doble")`: `pax_tarifa=2, pax_max=2`. La capacidad de
// niño de ese modelo es `min(chd_max, 2, pax_max − pax_tarifa)` — con
// `pax_max=pax_tarifa=2`, esa resta da SIEMPRE `0`: 2 adultos + 1 menor
// (cualquier edad) se rechazaba ANTES de siquiera intentar
// `computarReservaBernalo`, aunque la tarifa unidad PUBLICADA (capacidad
// real: minPax=1, maxPax=3, paxIncluidos=2) sí la admitía y de hecho la
// cotizaba en $700.000 una vez que alguien insertaba a mano una fila de
// `hotel_acomodaciones` con `pax_max=3`.
//
// El fallback persona (`hotel_acomodaciones`/`defaultAcomConfig`) es
// estructuralmente INCOMPATIBLE con el modelo unidad: asume una tarifa por
// PERSONA con "Niño 1"/"Niño 2" (tope de 2 tarifas de niño por habitación,
// `MAX_NINO_TARIFAS_POR_HABITACION` en `distribucionHabitaciones.ts`) y una
// capacidad derivada del nombre de la acomodación (Doble→2, Triple→3…) — el
// modelo unidad no tiene "Niño 1"/"Niño 2": su capacidad real vive
// EXCLUSIVAMENTE en `capacidad.minPax/maxPax` de la tarifa Bernalo publicada
// (`lib/calc/unidadAlojamiento.ts::TarifaAlojamiento.capacidad`), y ahí
// TODOS los menores ocupan un cupo físico por igual (`totalPax = adultos +
// menores.length`, ver `validarUnidadOcupada`) — sin distinción de niño/
// infante para efectos de CAPACIDAD (sí la hay para efectos de PRECIO,
// dentro de `computarReservaBernalo`, que sigue siendo la autoridad final).
//
// Este módulo NO inventa una capacidad global a partir del nombre de la
// acomodación consultada (Doble/Triple/…) — el llamador (`lib/tarifario/
// evaluarDisponibilidadUnidad.ts`) resuelve la `capacidad` REAL de la
// combinación categoría×alimentación×temporada evaluada (vía
// `resolverCapacidadTarifaUnidad`, que reutiliza TAL CUAL los resolvers
// puros de Fase 3B/3C — nunca reimplementa esas reglas) y se la pasa como
// parámetro. Si hay varias combinaciones con capacidades distintas, cada una
// se evalúa con SU PROPIA capacidad — nunca una capacidad mezclada o
// heredada de otra combinación.
//
// ── Algoritmo: reparto PAREJO, nunca "todo en la primera habitación" ──────
// Con más de una habitación consultada, un reparto ingenuo (todos los
// menores en la habitación 0) produce falsos rechazos: si la habitación 0
// termina excediendo `maxPax` mientras la 1 queda subocupada, la búsqueda
// se rechaza aunque SÍ exista una distribución válida. Este módulo reparte
// tanto los adultos como el total de pax (adultos + menores) de forma
// PAREJA entre las N habitaciones — cada habitación recibe `floor(total/N)`
// o `floor(total/N)+1` (las primeras `total % N` habitaciones, en orden de
// captura, se llevan el `+1`) — con la MISMA regla de desempate ("las
// primeras R habitaciones se llevan el sobrante") aplicada tanto a adultos
// como al total: eso GARANTIZA matemáticamente que, en cada habitación, los
// adultos asignados nunca superan su cupo total objetivo (ver la prueba
// exhaustiva en `pruebas/distribucionOcupacionUnidad.test.ts`, caso "cupo de
// menores nunca queda negativo") — así que el cupo de menores por
// habitación (`objetivo − adultos`) NUNCA es negativo, sin importar cuántos
// adultos/menores/habitaciones se combinen.
//
// Solo dos rechazos son de ESTE módulo (antes de intentar repartir nada):
//   1) Menos de 1 adulto por habitación en promedio — `computarReservaBernalo`
//      (vía `validarUnidadOcupada`) rechaza CUALQUIER unidad con 0 adultos;
//      adelantar este rechazo evita construir una distribución que el motor
//      real rechazaría de todos modos, con un mensaje más claro.
//   2) El total de pax no cabe (menos que `N×minPax` o más que `N×maxPax`,
//      cuando `maxPax` es conocido) — igual: `computarReservaBernalo`
//      rechazaría cualquier distribución posible, así que fallar acá ahorra
//      la llamada y dice por qué. Cuando la capacidad NO se pudo resolver
//      (combinación sin tarifa aplicable), el llamador pasa
//      `{ minPax: 1, maxPax: null }` — reparto sin cota, dejando que
//      `computarReservaBernalo` sea la única autoridad que rechace (con su
//      propio código, ej. `no_cotizable`).
// Ninguna otra regla se inventa acá: nunca se rechaza una composición que la
// tarifa unidad SÍ admite — `computarReservaBernalo` vuelve a validar todo
// desde cero (temporada, tarifa exacta, `minPax`/`maxPax`/reglas de edad)
// antes de cotizar.
//
// Módulo PURO (sin "use client"/"use server", sin Supabase/React): imports
// relativos con extensión `.ts`, mismo criterio que el resto de `lib/tarifario/`
// y `lib/reservar/` para poder correr bajo `node --test` sin bundler.
// ─────────────────────────────────────────────────────────────────────────

import { type AcomRoom } from "../acomodaciones.ts";

export type CapacidadDistribucionUnidad = { minPax: number; maxPax: number | null };

export type HabitacionUnidadDistribuida = {
  id: string;
  acom: AcomRoom;
  adultos: number;
  edadesMenores: number[];
};

export type ResultadoDistribucionOcupacionUnidad =
  | { ok: true; habitaciones: HabitacionUnidadDistribuida[] }
  | { ok: false; tipo: "configuracion_invalida" | "seleccion_invalida"; error: string };

/** Reparto entero PAREJO de `total` entre `n` cubetas: cada una recibe
 * `floor(total/n)` o `floor(total/n)+1` — las primeras `total % n` cubetas
 * (en orden de índice) se llevan el `+1`. Determinista, nunca depende del
 * orden de llegada de nada externo. */
function repartoParejo(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const resto = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
}

/**
 * Distribuye la ocupación agregada del buscador (habitaciones consultadas
 * por tipo, adultos totales, edades exactas) en habitaciones físicas para
 * UNA combinación unidad (una `capacidad` — la de la tarifa aplicable a esa
 * combinación categoría×alimentación×temporada). Nunca lanza; siempre
 * devuelve `ok:false` con un motivo claro en vez de una distribución
 * inválida.
 */
export function distribuirOcupacionUnidad(input: {
  habitacionesConsultadas: readonly { acom: AcomRoom }[];
  adultosDeclarados: number;
  edadesMenores: readonly number[];
  capacidad: CapacidadDistribucionUnidad;
}): ResultadoDistribucionOcupacionUnidad {
  const { habitacionesConsultadas, adultosDeclarados, edadesMenores, capacidad } = input;
  const n = habitacionesConsultadas.length;
  if (n === 0) {
    return { ok: false, tipo: "seleccion_invalida", error: "Indica al menos una habitación." };
  }
  if (!Number.isInteger(adultosDeclarados) || adultosDeclarados < 0) {
    return { ok: false, tipo: "configuracion_invalida", error: `"adultosDeclarados" debe ser un entero >= 0 (${adultosDeclarados}).` };
  }
  if (!Array.isArray(edadesMenores) || edadesMenores.some((e) => !Number.isInteger(e) || e < 0)) {
    return { ok: false, tipo: "configuracion_invalida", error: '"edadesMenores" debe ser un arreglo de enteros >= 0.' };
  }
  const { minPax, maxPax } = capacidad;
  if (!Number.isInteger(minPax) || minPax < 1) {
    return { ok: false, tipo: "configuracion_invalida", error: `Configuración inválida: capacidad.minPax (${minPax}) debe ser un entero >= 1.` };
  }
  if (maxPax !== null && (!Number.isInteger(maxPax) || maxPax < minPax)) {
    return {
      ok: false,
      tipo: "configuracion_invalida",
      error: `Configuración inválida: capacidad.maxPax (${maxPax}) debe ser null o un entero >= minPax (${minPax}).`,
    };
  }

  // Al menos 1 adulto por habitación en promedio — sin esto, el reparto
  // parejo dejaría inevitablemente alguna habitación con 0 adultos, y
  // `computarReservaBernalo` rechaza cualquier unidad así (regla comercial
  // del motor, no una regla inventada acá).
  if (adultosDeclarados < n) {
    return {
      ok: false,
      tipo: "seleccion_invalida",
      error: `Cada habitación necesita al menos 1 adulto: hay ${n} habitación(es) y solo ${adultosDeclarados} adulto(s) declarado(s).`,
    };
  }

  const totalPax = adultosDeclarados + edadesMenores.length;
  if (maxPax !== null && totalPax > n * maxPax) {
    return {
      ok: false,
      tipo: "seleccion_invalida",
      error: `Las ${n} habitación(es) consultadas admiten máximo ${n * maxPax} pax en total; hay ${totalPax}.`,
    };
  }
  if (totalPax < n * minPax) {
    return {
      ok: false,
      tipo: "seleccion_invalida",
      error: `Las ${n} habitación(es) consultadas exigen un mínimo de ${n * minPax} pax en total; hay ${totalPax}.`,
    };
  }

  // Misma regla de desempate ("las primeras R se llevan el sobrante") para
  // adultos y para el total — es lo que garantiza que `objetivo[i] −
  // adultosPorHab[i]` nunca sea negativo (ver la cabecera del archivo).
  const objetivoPorHab = repartoParejo(totalPax, n);
  const adultosPorHab = repartoParejo(adultosDeclarados, n);

  const edadesRestantes = [...edadesMenores];
  const habitaciones: HabitacionUnidadDistribuida[] = habitacionesConsultadas.map((h, i) => {
    const cupoMenores = objetivoPorHab[i] - adultosPorHab[i];
    const edades = edadesRestantes.splice(0, Math.max(0, cupoMenores));
    return { id: `${h.acom}-${i}`, acom: h.acom, adultos: adultosPorHab[i], edadesMenores: edades };
  });

  // Defensa en profundidad: si por alguna razón quedaron edades sin ubicar
  // (no debería ocurrir dado el reparto parejo demostrado arriba), fallar
  // cerrado en vez de publicar una asociación incompleta.
  if (edadesRestantes.length > 0) {
    return {
      ok: false,
      tipo: "configuracion_invalida",
      error: "No fue posible asociar todas las edades declaradas a una habitación.",
    };
  }

  return { ok: true, habitaciones };
}
