// ─────────────────────────────────────────────────────────────────────────
// Helpers PUROS de la tarjeta unidad en modo búsqueda (`TarjetaUnidadBusqueda`
// en `app/tarifario/VistaBooking.tsx`). Extraídos acá para poder probarlos con
// ejecución REAL bajo `node --test` — el componente en sí (JSX/React) no es
// ejecutable sin bundler, pero estas tres decisiones sí, y son las que la
// auditoría final marcó como frágiles:
//
//   1. `claveBusquedaUnidad` — identidad ESTABLE de la búsqueda vigente de un
//      hotel, para usarla como `key` de React. Cuando cambia (fechas u
//      ocupación distintas, o el conjunto de combinaciones confirmadas), React
//      DESMONTA la tarjeta vieja y monta una nueva → todo su estado local
//      (`cat`, `alim`, `precioActualizado`, `errorAgregar`, `agregando`) nace
//      de cero, sin ningún `useEffect` de sincronización frágil. Dos búsquedas
//      del MISMO hotel con fechas u ocupación distintas producen claves
//      distintas; una búsqueda idéntica produce la MISMA clave (no remonta sin
//      motivo).
//
//   2. `claveReservaUnidad` — identidad canónica COMPLETA de una reserva
//      Bernalo (hotel + paquete + categoría + alimentación + salida/fechas +
//      composición de habitaciones: id/acomodación/adultos/edades). Es lo que
//      compara `enCarrito`: una reserva del mismo hotel para OTRAS fechas u
//      ocupación NO es la misma línea del carrito (no se marca "agregada" ni
//      se elimina por error), y una idéntica SÍ se encuentra. Reutiliza
//      `claveOcupacionCompletaBernalo` (la misma clave canónica que ya usa la
//      validación carrito→checkout) — nunca reimplementa el criterio.
//
//   3. `revalidarReservaUnidad` — envuelve la revalidación server-side
//      (`cotizarAlojamientoBernaloPublico`, inyectada) en try/catch y devuelve
//      un resultado discriminado que NUNCA lanza: `agregar` (con el precio
//      REVALIDADO y si cambió respecto al mostrado), `rechazo` (el servidor
//      dijo que no, con su mensaje real) o `error` (excepción de red/servidor,
//      con un mensaje entendible). El componente solo agrega al carrito en
//      `agregar`; en los otros dos muestra el mensaje y no agrega. La
//      liberación del estado de carga (`agregando`) vive en el `finally` del
//      componente (es estado de React) — este helper garantiza que la promesa
//      SIEMPRE resuelve (nunca cuelga por una excepción no capturada), que es
//      lo que permite que ese `finally` corra.
//
// Módulo PURO (sin "use client"/"use server", sin Supabase/React): imports
// relativos con extensión `.ts`, mismo motivo documentado en
// `lib/tarifario/datosBernalo.ts` — así se importa directo desde `node --test`.
// ─────────────────────────────────────────────────────────────────────────

import type { AcomRoom } from "../acomodaciones.ts";
import type { HabitacionOcupacionEntrada, HabitacionOcupacionValidada } from "../reservar/ocupacionPorHabitacion.ts";
import {
  claveOcupacionBernalo,
  claveOcupacionCompletaBernalo,
  type SalidaSeleccionadaBernaloEntrada,
} from "../reservar/solicitudAlojamientoBernalo.ts";
import type { OpcionUnidadConfirmada } from "./evaluarDisponibilidadUnidad.ts";

// ── 1) Identidad de la BÚSQUEDA vigente (key de React) ─────────────────────

/**
 * Clave ESTABLE de la búsqueda de un hotel: hotelId + fechas + ocupación
 * canónica + el conjunto de combinaciones confirmadas — INCLUYENDO su dato
 * público cotizado (`precioVenta`/`moneda`/`paxTotal`), no solo su identidad
 * (paqueteId/categoría/alimentación). Sin esto, una búsqueda idéntica que ya
 * recibió un precio revalidado distinto (`precioActualizado`, ver
 * `TarjetaUnidadBusqueda`) producía la MISMA clave que la búsqueda original —
 * el remonte no ocurría, y el precio actualizado podía sobrevivir a una
 * búsqueda nueva con otra tarifa para la MISMA combinación.
 *
 * Todas las `opciones` de un hotel comparten hotelId/fechas/ocupación (solo
 * difieren en paquete/categoría/alimentación/precio/moneda/pax), así que
 * `opciones[0]` es representativo de las tres primeras; el conjunto de combos
 * (cada uno con su dato cotizado, ordenado de forma determinista) cierra la
 * identidad. `opciones` vacías nunca deberían llegar (la tarjeta solo se
 * pinta con al menos una), pero se maneja sin lanzar.
 *
 * Cada combinación se construye como una TUPLA `[paqueteId, categoria,
 * alimentacion, precioVenta, moneda, paxTotal]` y el conjunto completo (ya
 * ordenado) se serializa con UN solo `JSON.stringify` — nunca concatenación
 * manual con `:`/`,` (esos separadores pueden aparecer dentro de una
 * categoría/alimentación de texto libre y colisionar dos combinaciones
 * distintas en la misma clave). El orden de llegada de `opciones` no importa:
 * se ordena por la representación JSON de cada tupla antes de serializar.
 */
export function claveBusquedaUnidad(opciones: readonly OpcionUnidadConfirmada[]): string {
  if (opciones.length === 0) return "vacia";
  const o0 = opciones[0];
  const ocupacion = claveOcupacionBernalo(
    o0.ocupacion.map((h) => ({ id: h.id, acom: h.acom, adultos: h.adultos, edadesMenores: h.edadesMenores }))
  );
  const tuplas = opciones
    .map((o): [number, string, string, number, string, number] => [
      o.paqueteId, o.categoria, o.alimentacion, o.precioVenta, o.moneda, o.paxTotal,
    ])
    .map((tupla) => JSON.stringify(tupla))
    .sort();
  const combos = JSON.stringify(tuplas);
  return [o0.hotelId, o0.fechaIda, o0.fechaRegreso, ocupacion, combos].join("|");
}

// ── 2) Identidad canónica de una RESERVA (comparación de carrito) ──────────

/** Lo mínimo que identifica una reserva Bernalo — mismo subconjunto que
 * transporta el ítem del carrito y que produce una búsqueda confirmada. Las
 * `edadesMenores` de cada habitación llegan como `unknown` desde el ítem del
 * carrito (`HotelCartItemBernalo.habitaciones`) — se normalizan sin lanzar. */
export type IdentidadReservaUnidadEntrada = {
  hotelId: number;
  paqueteId: number;
  categoria: string;
  alimentacion: string;
  salida: SalidaSeleccionadaBernaloEntrada;
  habitaciones: readonly { id: string; acom: string; adultos: number; edadesMenores: unknown }[];
};

/**
 * Clave canónica COMPLETA de una reserva Bernalo — misma clave ⇔ misma
 * reserva. Delega en `claveOcupacionCompletaBernalo` (la clave canónica ya
 * probada de carrito→checkout), tras normalizar `edadesMenores` a `number[]`
 * (el ítem del carrito los declara `unknown`; un valor no numérico se descarta
 * en vez de romper la comparación). El `acom` se preserva verbatim en la clave
 * — el cast a `AcomRoom` es solo para el tipo, nunca cambia el valor comparado.
 */
export function claveReservaUnidad(e: IdentidadReservaUnidadEntrada): string {
  const habitaciones: HabitacionOcupacionValidada[] = e.habitaciones.map((h) => ({
    id: h.id,
    acom: h.acom as AcomRoom,
    adultos: h.adultos,
    edadesMenores: Array.isArray(h.edadesMenores)
      ? h.edadesMenores.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      : [],
  }));
  return claveOcupacionCompletaBernalo({
    paqueteId: e.paqueteId,
    hotelId: e.hotelId,
    categoria: e.categoria,
    alimentacion: e.alimentacion,
    salida: e.salida,
    habitaciones,
  });
}

// ── 3) Revalidación server-side de "Agregar al carrito" ────────────────────

/** Entrada exacta que espera la Server Action pública de cotización
 * (`cotizarAlojamientoBernaloPublico`) — estructural, para no importar el
 * archivo "use server" desde este módulo neutral. */
export type EntradaRevalidacionUnidad = {
  paqueteId: number;
  hotelId: number;
  categoria: string;
  alimentacion: string;
  salida: SalidaSeleccionadaBernaloEntrada;
  habitaciones: HabitacionOcupacionEntrada[];
};

/** Composición saneada mínima (adultos/niños/infantes por habitación) —
 * mismo shape estructural que `ComposicionHabitacionPublica`
 * (`lib/reservar/composicionHabitacionBernalo.ts`), duplicado a propósito
 * (no importado) para que este módulo neutral no dependa de esa cadena. */
export type ComposicionHabitacionMinima = { habitacionId: string; adultos: number; ninos: number; infantes: number };

/** Forma MÍNIMA del resultado de `cotizarAlojamientoBernaloPublico` que este
 * helper lee — cualquier resultado real es estructuralmente compatible (trae
 * más campos en `ok:true`: paxTotal/promedioPorViajero; y `codigo` en el
 * rechazo). Solo `pvp`/`moneda`/`composicionHabitaciones`/`mensaje` se leen acá. */
export type CotizacionUnidadMinima =
  | { ok: true; pvp: number; moneda: string; composicionHabitaciones: ComposicionHabitacionMinima[] }
  | { ok: false; mensaje: string };

export type CotizarUnidadFn = (entrada: EntradaRevalidacionUnidad) => Promise<CotizacionUnidadMinima>;

export type ResultadoRevalidacionUnidad =
  | { estado: "agregar"; precio: number; moneda: string; precioCambio: boolean; composicionHabitaciones: ComposicionHabitacionMinima[] }
  | { estado: "rechazo"; mensaje: string }
  | { estado: "error"; mensaje: string };

export const MENSAJE_ERROR_REVALIDACION =
  "No pudimos confirmar la disponibilidad en este momento. Intenta de nuevo en unos segundos.";

/**
 * Revalida una reserva Bernalo contra el servidor ANTES de agregarla al
 * carrito. NUNCA lanza: una excepción de red/servidor se traduce a
 * `{ estado: "error" }` (mensaje entendible), un rechazo del servidor a
 * `{ estado: "rechazo" }` (su mensaje real), y solo un `ok:true` produce
 * `{ estado: "agregar" }` con el precio REVALIDADO (`precio`/`moneda`) y si
 * cambió respecto al que mostraba la tarjeta (`precioCambio`). El llamador
 * agrega al carrito EXCLUSIVAMENTE en `agregar` — nunca en `rechazo`/`error`.
 */
export async function revalidarReservaUnidad(
  cotizar: CotizarUnidadFn,
  entrada: EntradaRevalidacionUnidad,
  precioMostrado: number,
  monedaMostrada: string,
): Promise<ResultadoRevalidacionUnidad> {
  try {
    const r = await cotizar(entrada);
    if (!r.ok) return { estado: "rechazo", mensaje: r.mensaje };
    return {
      estado: "agregar",
      precio: r.pvp,
      moneda: r.moneda,
      precioCambio: r.pvp !== precioMostrado || r.moneda !== monedaMostrada,
      composicionHabitaciones: r.composicionHabitaciones,
    };
  } catch {
    return { estado: "error", mensaje: MENSAJE_ERROR_REVALIDACION };
  }
}
