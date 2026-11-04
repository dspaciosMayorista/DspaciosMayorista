// Vista PÚBLICA del paquete dinámico (#82). PURO. Nunca expone netas, markup ni proveedores:
// convierte cada opción a «solo PVP por componente» con los precios ya calculados, de modo que
// el navegador puede previsualizar el total con `liquidarPaquete` sin conocer ningún costo.
import { ACOMS_DIN, pvpDeNeto, totalPorPersona, type PaqueteDin, type PrecioAcom, type PrecioVuelo } from "@/lib/paqueteDinamico/calculo";
import type { ReglasHotelDin } from "@/lib/paqueteDinamico/menores";
import type { ResumenFicha } from "@/lib/paqueteDinamico/servicioFicha";
import { opcionesDelPaquete, type FilaHotelDin, type FilaPaqueteDin, type FilaServicioDin, type FilaVueloDin } from "@/lib/paqueteDinamico/modelo";

export const FOTO_HOTEL_PREDETERMINADA = "/marca/hotel-predeterminado.svg";

export type OpcionPublica = { hotelId: number | null; vueloId: number | null; calc: PaqueteDin; desdePorPersona: number };
/** Datos del vuelo para mostrarlo como en el checkout normal (los que existan: un vuelo manual no trae horarios). */
export type VueloDetalle = { aerolinea: string | null; ruta: string | null; vueloIda: string | null; horaSalidaIda: string | null; horaLlegadaIda: string | null; vueloRegreso: string | null; horaSalidaReg: string | null; horaLlegadaReg: string | null };
/** `reglas` = capacidad y edades del hotel (ficha o manual); null = paquete anterior sin esa configuración (sin validación de capacidad). */
export type HotelPublico = { id: number; nombre: string; categoria: string; regimen: string; descripcion: string; foto: string; desde: number; reglas: ReglasHotelDin | null; categorias: string[]; regimenes: string[] };
export type ContextoPublico = { reglasHotel?: Map<number, ReglasHotelDin | null>; fichas?: Map<number, ResumenFicha>; vuelos?: Map<number, VueloDetalle>; opcionesHotel?: Map<number, { categorias: string[]; regimenes: string[] }> };
export type DinamicoPublico = {
  id: number; nombre: string; moneda: string; destino: string; noches: number; descripcion: string; incluye: string[]; noIncluye: string[];
  compraFin: string | null; hoteles: HotelPublico[]; vuelos: { id: number; etiqueta: string; fechaIda: string | null; fechaRegreso: string | null; detalle: VueloDetalle | null }[]; servicios: { id: number; nombre: string; ficha: ResumenFicha | null }[];
  opciones: OpcionPublica[]; usaVuelo: boolean; usaHotel: boolean; usaServicios: boolean;
};

const lineas = (t: string | null | undefined) => (t ?? "").split("\n").map((x) => x.trim()).filter(Boolean);

/** Misma opción con los PVP resueltos y sin ningún neto/proveedor. */
export function aPvpPublico(c: PaqueteDin): PaqueteDin {
  const pv = (neto: number | null | undefined, pvp: number | null | undefined) => (c.esquema === "neta_markup" ? pvpDeNeto(neto, c.pctMk, c.moneda) : (pvp ?? NaN));
  const acom = (neto: PrecioAcom, pvp: PrecioAcom): PrecioAcom => Object.fromEntries(ACOMS_DIN.map((a) => [a, pv(neto[a], pvp[a])]));
  const vz = (neto: PrecioVuelo, pvp: PrecioVuelo): PrecioVuelo => ({ adulto: pv(neto.adulto, pvp.adulto), nino: pv(neto.nino, pvp.nino), infante: pv(neto.infante, pvp.infante) });
  return {
    esquema: "solo_pvp", pvpModo: c.esquema === "solo_pvp" && c.pvpModo === "general" ? "general" : "por_componente", moneda: c.moneda, pctMk: 0,
    usaVuelo: c.usaVuelo, usaHotel: c.usaHotel, usaServicios: c.usaServicios,
    vuelo: c.vuelo ? { neto: { adulto: null, nino: null, infante: null }, pvp: vz(c.vuelo.neto, c.vuelo.pvp) } : undefined,
    hotel: c.hotel ? { nombre: c.hotel.nombre, neto: {}, pvp: acom(c.hotel.neto, c.hotel.pvp) } : undefined,
    servicios: c.servicios.map((s) => ({ id: s.id, nombre: s.nombre, neto: null, pvp: s.fichaPrecio ? null : pv(s.neto, s.pvp), ...(s.fichaPrecio ? { fichaPrecio: true } : {}), ...(s.vinculado ? { vinculado: true } : {}) })),
    pvpGeneral: c.pvpGeneral,
  };
}

export function vistaPublica(p: FilaPaqueteDin & { destino: string; compra_fin: string | null; descripcion: string | null; incluye: string | null; no_incluye: string | null },
  hoteles: FilaHotelDin[], vuelos: FilaVueloDin[], servicios: FilaServicioDin[], ctx: ContextoPublico = {}): DinamicoPublico | null {
  const ops = opcionesDelPaquete(p, hoteles, vuelos, servicios);
  const opciones: OpcionPublica[] = ops.map((o) => {
    const pub = aPvpPublico(o.calc);
    return { hotelId: o.hotel?.id ?? null, vueloId: o.vuelo?.id ?? null, calc: pub, desdePorPersona: totalPorPersona(pub, "doble") };
  }).filter((o) => Number.isFinite(o.desdePorPersona) && (o.desdePorPersona > 0 || o.calc.servicios.some((s) => s.fichaPrecio)));
  if (!opciones.length) return null;
  const desdeHotel = (id: number | null) => Math.min(...opciones.filter((o) => o.hotelId === id).map((o) => o.desdePorPersona));
  return {
    id: p.id, nombre: p.nombre, moneda: p.moneda, destino: p.destino, noches: p.noches, descripcion: p.descripcion ?? "", incluye: lineas(p.incluye), noIncluye: lineas(p.no_incluye),
    compraFin: p.compra_fin, usaVuelo: p.usa_vuelo, usaHotel: p.usa_hotel, usaServicios: p.usa_servicios,
    hoteles: p.usa_hotel ? hoteles.filter((h) => opciones.some((o) => o.hotelId === h.id)).map((h) => ({
      id: h.id, nombre: h.nombre, categoria: h.categoria ?? "", regimen: h.regimen ?? "", descripcion: h.descripcion ?? "", foto: h.foto_url?.trim() || FOTO_HOTEL_PREDETERMINADA, desde: desdeHotel(h.id),
      reglas: ctx.reglasHotel?.get(h.id) ?? null, categorias: ctx.opcionesHotel?.get(h.id)?.categorias ?? [], regimenes: ctx.opcionesHotel?.get(h.id)?.regimenes ?? [],
    })) : [],
    vuelos: p.usa_vuelo ? vuelos.filter((v) => opciones.some((o) => o.vueloId === v.id)).map((v) => ({ id: v.id, fechaIda: v.fecha_ida, fechaRegreso: v.fecha_regreso, etiqueta: [v.aerolinea, v.ruta, v.fecha_ida].filter(Boolean).join(" · ") || `Vuelo ${v.id}`, detalle: ctx.vuelos?.get(v.id) ?? { aerolinea: v.aerolinea, ruta: v.ruta, vueloIda: null, horaSalidaIda: null, horaLlegadaIda: null, vueloRegreso: null, horaSalidaReg: null, horaLlegadaReg: null } })) : [],
    servicios: p.usa_servicios ? servicios.map((s) => ({ id: s.id, nombre: s.nombre, ficha: ctx.fichas?.get(s.id) ?? null })) : [],
    opciones,
  };
}
