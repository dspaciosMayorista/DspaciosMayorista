// Filas de las tablas paquete_din* → PaqueteDin del cálculo (#82). PURO, sin I/O.
import type { PaqueteDin, PrecioAcom, PrecioVuelo, ServicioDin, Esquema, PvpModo } from "@/lib/paqueteDinamico/calculo";

export type FilaPaqueteDin = {
  id: number; nombre: string; moneda: string; esquema: Esquema; pvp_modo: PvpModo | null; pct_mk: number;
  usa_vuelo: boolean; usa_hotel: boolean; usa_servicios: boolean; noches: number;
  pvp_general: PrecioAcom | null; total_declarado: PrecioAcom | null;
};
export type FilaVueloDin = { id: number; empaquetado_id: number | null; destino_id: number | null; aerolinea: string | null; ruta: string | null; fecha_ida: string | null; fecha_regreso: string | null; proveedor: string | null; neto: Partial<PrecioVuelo>; pvp: Partial<PrecioVuelo> };
export type FilaHotelDin = { id: number; hotel_id: number | null; /** Solo lectura de la FICHA (no es columna de la base): lo ponen quienes leen la ficha. */ adults_only?: boolean | null; capacidad_ninos?: number | null; edad_infante_max?: number | null; edad_nino_max?: number | null; nombre: string; categoria: string | null; regimen: string | null; descripcion: string | null; foto_url: string | null; estrellas?: number | null; ubicacion?: string | null; proveedor: string | null; neto: PrecioAcom; pvp: PrecioAcom; pvp_general: PrecioAcom | null };
export type FilaServicioDin = { id: number; servicio_id: number | null; nombre: string; proveedor: string | null; neto: number | null; pvp: number | null; pvp_infante?: number | null };

const vz = (v: Partial<PrecioVuelo> | undefined): PrecioVuelo => ({ adulto: v?.adulto ?? null, nino: v?.nino ?? null, infante: v?.infante ?? null });

/** Una OPCIÓN vendible = el paquete + un hotel + un vuelo (cada uno opcional según los checks). */
export function armarPaqueteCalc(p: FilaPaqueteDin, hotel?: FilaHotelDin | null, vuelo?: FilaVueloDin | null, servicios: FilaServicioDin[] = []): PaqueteDin {
  const sv: ServicioDin[] = servicios.map((s) => ({ id: String(s.id), nombre: s.nombre, proveedor: s.proveedor ?? "", neto: s.neto, pvp: s.pvp, ...(s.servicio_id != null ? { vinculado: true, pvpInfante: s.pvp_infante ?? null } : {}), ...(p.esquema === "neta_markup" && s.servicio_id != null ? { fichaPrecio: true } : {}) }));
  return {
    esquema: p.esquema, pvpModo: p.pvp_modo, moneda: p.moneda, pctMk: Number(p.pct_mk) || 0,
    usaVuelo: p.usa_vuelo, usaHotel: p.usa_hotel, usaServicios: p.usa_servicios,
    vuelo: p.usa_vuelo && vuelo ? { proveedor: vuelo.proveedor ?? "", neto: vz(vuelo.neto), pvp: vz(vuelo.pvp) } : undefined,
    hotel: p.usa_hotel && hotel ? { nombre: hotel.nombre, proveedor: hotel.proveedor ?? "", neto: hotel.neto ?? {}, pvp: hotel.pvp ?? {}, ...(hotel.adults_only === true ? { adultsOnly: true } : {}) } : undefined,
    servicios: p.usa_servicios ? sv : [],
    pvpGeneral: (hotel?.pvp_general ?? p.pvp_general) ?? undefined,
    totalDeclarado: p.total_declarado ?? undefined,
  };
}

/** Todas las opciones hotel×vuelo del paquete (para validar y para las tarjetas). */
export function opcionesDelPaquete(p: FilaPaqueteDin, hoteles: FilaHotelDin[], vuelos: FilaVueloDin[], servicios: FilaServicioDin[]) {
  const hs: (FilaHotelDin | null)[] = p.usa_hotel ? hoteles : [null];
  const vs: (FilaVueloDin | null)[] = p.usa_vuelo ? vuelos : [null];
  const out: { hotel: FilaHotelDin | null; vuelo: FilaVueloDin | null; calc: PaqueteDin }[] = [];
  for (const h of hs) for (const v of vs) out.push({ hotel: h, vuelo: v, calc: armarPaqueteCalc(p, h, v, servicios) });
  return out;
}
