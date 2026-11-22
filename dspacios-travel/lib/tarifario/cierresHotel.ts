// #127 — General hotel closures (`hotel_blackouts`), ONE rule for every consumer.
//
// A general closure is NOT the season exclusion stored in `hotel_temporadas.blackouts` (that one only removes a single
// season on those nights; another eligible season may still win). A general closure overrides EVERY season: if any
// occupied night of a stay falls inside it, the stay cannot be sold (total) or the matching category/accommodation
// cannot be sold (partial). Consumers: the live evaluator (`evaluarHotelPorFechas`), tariff generation
// (`generarTarifario`), the display filter (`filtrarTarifarioVencidas`), the checkout page and the authoritative
// sales boundary (`computarReserva`, `computarReservaBernalo`).
//
// Pure (no I/O) except `cargarCierresHoteles`. RELATIVE imports on purpose: this file is loaded by `node --test`
// without a path-alias loader.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database"; // solo tipos: se borra con strip-types, igual que en vigencia.ts
import { ejecutarConsultaPaginada } from "./paginacion.ts";

export type CierreHotel = {
  hotel_id?: number | null;
  fecha_inicio: string;
  fecha_fin: string; // last CLOSED night, inclusive
  total: boolean;
  acomodaciones: string[] | null;
  categorias: string[] | null;
};

/** Room accommodations a stay can be priced for (children/infant classes are not rooms). */
export const ACOMODACIONES_HABITACION = ["sencilla", "doble", "triple", "multiple"] as const;

const MS_DIA = 86_400_000;
// UTC arithmetic: the result never depends on the server time zone.
const utcDia = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / MS_DIA);
export const sumarDiasISO = (iso: string, dias: number): string => new Date((utcDia(iso) + dias) * MS_DIA).toISOString().slice(0, 10);

/** Last OCCUPIED night of a stay (the check-out day is not an occupied night). */
export const ultimaNoche = (fechaIda: string, numNoches: number): string => sumarDiasISO(fechaIda, Math.max(1, numNoches) - 1);

/** Does the closure touch ANY occupied night of the stay? Both closure endpoints are inclusive; a closure that starts on the check-out day does not. */
export function cierreCubreEstadia(c: Pick<CierreHotel, "fecha_inicio" | "fecha_fin">, fechaIda: string, numNoches: number): boolean {
  return c.fecha_inicio <= ultimaNoche(fechaIda, numNoches) && c.fecha_fin >= fechaIda;
}

/** Does the closure apply to this category and accommodation? Total = everything; otherwise empty lists mean "all". */
export function cierreAplica(c: Pick<CierreHotel, "total" | "acomodaciones" | "categorias">, categoria: string, acomodacion: string): boolean {
  if (c.total) return true;
  const cats = c.categorias ?? [], acoms = c.acomodaciones ?? [];
  return (cats.length === 0 || cats.includes(categoria)) && (acoms.length === 0 || acoms.includes(acomodacion));
}

/** Closures that touch the stay, resolved once so the same stay can be asked about many combinations. */
export function resolverCierresEstadia(cierres: readonly CierreHotel[] | null | undefined, fechaIda: string, numNoches: number) {
  const cubren = (cierres ?? []).filter((c) => cierreCubreEstadia(c, fechaIda, numNoches));
  return {
    cubren,
    /** The whole hotel is closed for this stay. */
    totalCerrado: cubren.some((c) => c.total),
    /** Is this category + accommodation closed? `acomodacion = null` (unknown) = closed only when every room accommodation is. */
    cerrada(categoria: string | null, acomodacion: string | null): boolean {
      if (cubren.length === 0) return false;
      const cat = categoria ?? "";
      if (acomodacion != null) return cubren.some((c) => cierreAplica(c, cat, acomodacion));
      return ACOMODACIONES_HABITACION.every((a) => cubren.some((c) => cierreAplica(c, cat, a)));
    },
  };
}

/** Single question form for rows already published (one stay, one category, one accommodation). */
export const estadiaCerrada = (
  cierres: readonly CierreHotel[] | null | undefined, categoria: string | null, acomodacion: string | null, fechaIda: string, numNoches: number,
): boolean => resolverCierresEstadia(cierres, fechaIda, numNoches).cerrada(categoria, acomodacion);

/**
 * "From" window (porción): every entry date in [desde, hasta] (inclusive, same scan the generator does) is closed for a stay of
 * `numNoches`. An entry `e` is closed when the closure intersects [e, e + numNoches - 1], i.e. e ∈ [fecha_inicio − numNoches + 1, fecha_fin].
 * Interval union, no per-day loop. `acomodacion = null` = closed only when every room accommodation has no sellable entry.
 */
export function ventanaSinEntradaVendible(
  cierres: readonly CierreHotel[] | null | undefined, categoria: string | null, acomodacion: string | null, desde: string, hasta: string, numNoches: number,
): boolean {
  const lo = utcDia(desde), hi = utcDia(hasta);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return false;
  const n = Math.max(1, numNoches);
  const cat = categoria ?? "";
  const sinEntrada = (acom: string): boolean => {
    const tramos = (cierres ?? []).filter((c) => cierreAplica(c, cat, acom))
      .map((c) => [utcDia(c.fecha_inicio) - n + 1, utcDia(c.fecha_fin)] as const).sort((a, b) => a[0] - b[0]);
    let siguiente = lo; // first entry not yet proven closed
    for (const [a, b] of tramos) {
      if (a > siguiente) break;
      if (b >= siguiente) siguiente = b + 1;
      if (siguiente > hi) return true;
    }
    return siguiente > hi;
  };
  return acomodacion != null ? sinEntrada(acomodacion) : ACOMODACIONES_HABITACION.every(sinEntrada);
}

/**
 * #127 G1 — does ANY applicable closure touch ANY stay the window of a published «from» row stands for? The row's price is the cheapest entry of [desde, hasta];
 * an entry that is still sellable does not prove that THAT price is. Without a sellable witness (see `testigoDesde`) such a row is not trustworthy: fail closed until a
 * verified regeneration publishes it with its witness. The occupied nights of all entries are [desde, hasta + numNoches − 1]: one widened stay.
 */
export function ventanaTocadaPorCierre(
  cierres: readonly CierreHotel[] | null | undefined, categoria: string | null, acomodacion: string | null, desde: string, hasta: string, numNoches: number,
): boolean {
  const dias = Math.max(0, utcDia(hasta) - utcDia(desde));
  return estadiaCerrada(cierres, categoria, acomodacion, desde, dias + Math.max(1, numNoches));
}

/**
 * #127 G1 — sellable WITNESS of a published «from» price: the earliest sellable entry whose own price equals the published total. `precioEntrada(entrada)` prices ONE entry
 * with the same engine that produced the total (the caller injects it). No entry reproduces the total → null → the row is NOT published (never a price nobody can buy).
 */
export function testigoDesde(tramos: readonly (readonly [string, string])[], precioEntrada: (entrada: string) => number | null, total: number): string | null {
  for (const [a, b] of tramos) {
    for (let d = utcDia(a); d <= utcDia(b); d++) {
      const e = sumarDiasISO("1970-01-01", d);
      const p = precioEntrada(e);
      if (p != null && Math.abs(p - total) < 0.005) return e;
    }
  }
  return null;
}

/** Entry date `entrada` is closed for this combination. */
export const entradaCerrada = (
  cierres: readonly CierreHotel[] | null | undefined, categoria: string | null, acomodacion: string | null, entrada: string, numNoches: number,
): boolean => estadiaCerrada(cierres, categoria, acomodacion, entrada, numNoches);

/**
 * Sellable entry dates of [lo, hi] (inclusive) as maximal contiguous sub-intervals [first, last]. The «from» price engine (lib/calc/paquetes.ts, fingerprinted — not edited for this)
 * scans a window of entries; evaluating it once per sub-interval and keeping the cheapest result is the same search WITHOUT the entries a closure makes unsellable.
 * No closure that applies → exactly one interval, the whole window, so nothing changes for hotels without closures.
 */
export function subventanasEntradaVendible(
  cierres: readonly CierreHotel[] | null | undefined, categoria: string | null, acomodacion: string | null, lo: string, hi: string, numNoches: number,
): [string, string][] {
  const a = utcDia(lo), b = utcDia(hi);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const n = Math.max(1, numNoches), cat = categoria ?? "", acom = acomodacion ?? "doble";
  const cerrados = (cierres ?? []).filter((c) => cierreAplica(c, cat, acom))
    .map((c) => [utcDia(c.fecha_inicio) - n + 1, utcDia(c.fecha_fin)] as const).sort((x, y) => x[0] - y[0]);
  const out: [string, string][] = [];
  let inicio = a;
  for (const [x, y] of cerrados) {
    if (y < inicio) continue;
    if (x > b) break;
    if (x > inicio) out.push([sumarDiasISO("1970-01-01", inicio), sumarDiasISO("1970-01-01", x - 1)]);
    inicio = Math.max(inicio, y + 1);
    if (inicio > b) break;
  }
  if (inicio <= b) out.push([sumarDiasISO("1970-01-01", inicio), sumarDiasISO("1970-01-01", b)]);
  return out;
}

export type CierresPorHotel = Map<number, CierreHotel[]>;

/**
 * ONE paginated read for every hotel of a page / generation / search (never one per card). Closures that ended before `hoy` cannot affect
 * a sellable stay and are not read. Returns the raw error so the caller can FAIL CLOSED (a missing read must never mean "no closures").
 */
export async function cargarCierresHoteles(
  admin: SupabaseClient<Database>, hotelIds: readonly number[], hoy: string,
): Promise<{ porHotel: CierresPorHotel; error: unknown }> {
  const ids = [...new Set(hotelIds.filter((x) => Number.isFinite(x)))];
  const porHotel: CierresPorHotel = new Map();
  if (!ids.length) return { porHotel, error: null };
  const { data, error } = await ejecutarConsultaPaginada<CierreHotel & { hotel_id: number }>((from, hasta) =>
    admin.from("hotel_blackouts").select("hotel_id, fecha_inicio, fecha_fin, total, acomodaciones, categorias")
      .in("hotel_id", ids).gte("fecha_fin", hoy).order("id").range(from, hasta),
  );
  if (error) return { porHotel, error };
  for (const c of data ?? []) {
    const arr = porHotel.get(c.hotel_id) ?? [];
    arr.push(c);
    porHotel.set(c.hotel_id, arr);
  }
  return { porHotel, error: null };
}

/**
 * Unit-priced hotels (`modelo_tarifario = 'unidad'`) have no per-person accommodation: the system has NO mapping between a room accommodation and a unit, and none was approved.
 * So the supported closure dimensions for them are TOTAL and CATEGORY only; a closure restricted by accommodation cannot be honoured and is NOT applied to a unit tariff.
 * It is reported (rejected on save, flagged in the list), never silently reinterpreted.
 */
export const cierreNoAplicaAUnidad = (c: Pick<CierreHotel, "total" | "acomodaciones">): boolean => !c.total && (c.acomodaciones?.length ?? 0) > 0;
export const MENSAJE_CIERRE_UNIDAD_NO_SOPORTADO =
  "Este hotel se tarifa por unidad: el cierre solo puede ser TOTAL o por CATEGORÍA. Un cierre por acomodación no se puede aplicar a una tarifa por unidad (no existe equivalencia entre acomodación y unidad).";

/** Operator-facing reason shown when a published offer is rejected at the sales boundary. */
export const MENSAJE_HOTEL_CERRADO = "El hotel no tiene disponibilidad para esas fechas (cierre de ventas vigente). Elige otras fechas u otra opción.";
