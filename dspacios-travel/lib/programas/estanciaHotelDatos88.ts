// #88 — Lectura del catálogo de hoteles/vigencias/noches adicionales de un
// programa por hotel y vigencia (migración 244). SOLO SERVIDOR: lee los netos del
// proveedor, que ninguna tabla publica al navegador. Lo que sale hacia la ficha y el
// formulario es `TablaHotelPvp` (PVP y vigencias, jamás un neto).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  vacioPorAcom,
  type BaseHotelFila,
  type HotelEstancia,
  type ModalidadServicios,
  type NocheTarifaFila,
  type PorAcom,
  type UnidadCobro,
} from "./estanciaHotel88.ts";
import { construirTablaHotelPvp, desdeDobleHoteles, type ProgramaPrecioCabecera, type TablaHotelPvp } from "./precioReserva57.ts";
import { MODO_PRECIO_HOTEL } from "./estanciaHotel88.ts";
import type { ResultadoProgramasResumen } from "@/lib/programas";

type SB = SupabaseClient<Database>;

export type CatalogoHoteles88 = { hoteles: HotelEstancia[]; base: BaseHotelFila[]; noches: NocheTarifaFila[] };

const n = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

type FilaNetos = {
  neto_sencilla: number | string | null; neto_doble: number | string | null; neto_triple: number | string | null;
  neto_multiple: number | string | null; neto_nino: number | string | null;
};
const netos = (r: FilaNetos): PorAcom => ({
  ...vacioPorAcom(),
  sencilla: n(r.neto_sencilla), doble: n(r.neto_doble), triple: n(r.neto_triple), multiple: n(r.neto_multiple), nino: n(r.neto_nino),
});

/**
 * Cliente con el que se leen los netos: el de servicio si existe la clave (la ficha
 * pública y el rol `venta` no pueden leer estas tablas, y no deben), si no el de la sesión.
 */
export function clienteCatalogoHoteles(sesion: SB): SB {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? (createAdminClient() as SB) : sesion;
}

export async function cargarCatalogoHoteles88(cliente: SB, programaId: number): Promise<{ ok: true; catalogo: CatalogoHoteles88 } | { ok: false; error: unknown }> {
  const { data: hoteles, error: eH } = await cliente
    .from("programa_hoteles")
    .select("id, nombre, zona, tipo_habitacion, max_pax_habitacion, max_menores_habitacion, proveedor_id, orden")
    .eq("programa_id", programaId)
    .order("orden");
  if (eH) return { ok: false, error: eH };
  const ids = (hoteles ?? []).map((h) => h.id);
  if (!ids.length) return { ok: true, catalogo: { hoteles: [], base: [], noches: [] } };

  const [{ data: base, error: eB }, { data: noches, error: eN }] = await Promise.all([
    cliente
      .from("programa_hotel_precios")
      .select("id, hotel_id, desde, hasta, modalidad_servicios, bajo_solicitud, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino")
      .in("hotel_id", ids)
      .order("desde"),
    cliente
      .from("programa_hotel_noches")
      .select("id, hotel_id, desde, hasta, unidad_cobro, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino")
      .in("hotel_id", ids)
      .order("desde"),
  ]);
  if (eB || eN) return { ok: false, error: eB ?? eN };

  return {
    ok: true,
    catalogo: {
      hoteles: (hoteles ?? []).map((h) => ({
        id: h.id, nombre: h.nombre, zona: h.zona, tipoHabitacion: h.tipo_habitacion,
        maxPaxHabitacion: h.max_pax_habitacion, maxMenoresHabitacion: h.max_menores_habitacion, proveedorId: h.proveedor_id,
      })),
      base: (base ?? []).map((b) => ({
        id: b.id, hotelId: b.hotel_id, desde: b.desde, hasta: b.hasta,
        modalidad: b.modalidad_servicios as ModalidadServicios, bajoSolicitud: b.bajo_solicitud, neto: netos(b),
      })),
      noches: (noches ?? []).map((t) => ({
        id: t.id, hotelId: t.hotel_id, desde: t.desde, hasta: t.hasta, unidad: t.unidad_cobro as UnidadCobro, neto: netos(t),
      })),
    },
  };
}

/** Tablas de PVP (una por hotel) para la ficha y el formulario. Nunca lleva netos. */
export async function cargarTablasPvp88(
  sesion: SB, programaId: number, programa: ProgramaPrecioCabecera,
): Promise<{ ok: true; tablas: TablaHotelPvp[] } | { ok: false; error: unknown }> {
  const r = await cargarCatalogoHoteles88(clienteCatalogoHoteles(sesion), programaId);
  if (!r.ok) return r;
  const { hoteles, base, noches } = r.catalogo;
  return { ok: true, tablas: hoteles.map((h) => construirTablaHotelPvp(programa, h, base, noches)) };
}

/**
 * «Desde» de los programas por hotel y vigencia dentro del listado (tarjetas del tarifario).
 * `getProgramasResumen` es puro y solo conoce las matrices de siempre: para los programas
 * `modo_precio = 'hotel'` el «Desde» sale de la DOBLE más baja de sus hoteles/vigencias, con
 * la misma tabla de PVP de la ficha. Un fallo de lectura deja ese «Desde» en null («Consultar»)
 * y se reporta en `error`; nunca se inventa un importe.
 */
export async function completarDesdeHoteles88(sesion: SB, r: ResultadoProgramasResumen): Promise<ResultadoProgramasResumen> {
  if (!r.programas.length) return r;
  const cliente = clienteCatalogoHoteles(sesion);
  const { data: filas, error } = await cliente
    .from("programas")
    .select("id, moneda, pct_mk, pct_fee_tarjeta, asistencia_medica_dia, dias")
    .in("id", r.programas.map((p) => p.id))
    .eq("modo_precio", MODO_PRECIO_HOTEL);
  if (error) return { ...r, error: r.error ?? error };
  if (!filas?.length) return r;
  const desde = new Map<number, number | null>();
  let falla: unknown = null;
  for (const f of filas) {
    const t = await cargarTablasPvp88(sesion, f.id, f);
    if (t.ok) desde.set(f.id, desdeDobleHoteles(t.tablas));
    else { falla ??= t.error; desde.set(f.id, null); }
  }
  return {
    programas: r.programas.map((p) => (desde.has(p.id) ? { ...p, desde_pvp: desde.get(p.id) ?? null } : p)),
    error: r.error ?? falla,
  };
}
