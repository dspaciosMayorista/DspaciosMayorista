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
/** Presentación PÚBLICA del hotel del CATÁLOGO vinculado (#88): solo estrellas, clasificación, descripción, ubicación y galería. `estrellas` ya validada (entero 1–5 o null); los textos vienen recortados ("" = sin dato); `fotos` = galería con la portada primero. Nunca costos, notas, contactos ni documentos. */
export type PresentacionHotelCatalogo = { estrellas: number | null; clasificacion: string; descripcion: string; ubicacion: string; fotos: string[] };
/** `reglas` = capacidad y edades del hotel (ficha o manual); null = paquete anterior sin esa configuración (sin validación de capacidad). */
export type HotelPublico = { id: number; nombre: string; categoria: string; regimen: string; descripcion: string; foto: string;
  /** Galería que muestra la tarjeta: la del hotel del catálogo si la tiene; si no, la foto propia del paquete; si no, la predeterminada. `foto` = la primera. */
  fotos: string[];
  /** Estrellas del hotel (null = sin dato) y ubicación para el mapa ("" = sin dato). Distintas de `categoria` (la habitación). */
  estrellas: number | null; ubicacion: string;
  /** Clasificación del hotel del catálogo (p. ej. «Boutique»): solo se muestra cuando no hay estrellas (misma regla que las demás tarjetas). "" = sin dato. */
  clasificacion: string; desde: number; reglas: ReglasHotelDin | null; categorias: string[]; regimenes: string[] };
export type ContextoPublico = { reglasHotel?: Map<number, ReglasHotelDin | null>; /** Presentación del catálogo por `hoteles.id` (solo los hoteles vinculados). */ catalogo?: Map<number, PresentacionHotelCatalogo>; fichas?: Map<number, ResumenFicha>; vuelos?: Map<number, VueloDetalle>; opcionesHotel?: Map<number, { categorias: string[]; regimenes: string[] }> };
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
    hotel: c.hotel ? { nombre: c.hotel.nombre, neto: {}, pvp: acom(c.hotel.neto, c.hotel.pvp), ...(c.hotel.adultsOnly ? { adultsOnly: true } : {}) } : undefined,
    servicios: c.servicios.map((s) => ({ id: s.id, nombre: s.nombre, neto: null, pvp: s.fichaPrecio ? null : pv(s.neto, s.pvp), ...(s.fichaPrecio ? { fichaPrecio: true } : {}), ...(s.vinculado ? { vinculado: true } : {}) })),
    pvpGeneral: c.pvpGeneral,
  };
}

/**
 * Qué muestra la tarjeta de un hotel del paquete (#88). PURO.
 *  · Hotel VINCULADO (hotel_id) con ficha leída: manda el dato ACTUAL del catálogo de ESE id (nunca por nombre); lo que la ficha no tiene se completa con lo guardado en la fila
 *    (copia hecha al vincular o dato manual) y, si tampoco está, queda vacío: no se inventa nada.
 *  · Hotel manual (sin hotel_id) o ficha no disponible: exactamente lo guardado en la fila, como antes.
 *  · Fotos: galería del catálogo (portada primero) → foto propia del paquete → imagen predeterminada.
 */
export function presentacionDelHotel(h: Pick<FilaHotelDin, "hotel_id" | "descripcion" | "foto_url" | "estrellas" | "ubicacion">, cat: PresentacionHotelCatalogo | undefined): { descripcion: string; estrellas: number | null; ubicacion: string; clasificacion: string; fotos: string[] } {
  const propiaFoto = h.foto_url?.trim() || "";
  const c = h.hotel_id != null ? cat : undefined;
  return {
    descripcion: c?.descripcion || (h.descripcion ?? ""),
    estrellas: c?.estrellas ?? h.estrellas ?? null,
    ubicacion: c?.ubicacion || (h.ubicacion?.trim() ?? ""),
    clasificacion: c?.clasificacion ?? "",
    fotos: c?.fotos.length ? c.fotos : [propiaFoto || FOTO_HOTEL_PREDETERMINADA],
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
    hoteles: p.usa_hotel ? hoteles.filter((h) => opciones.some((o) => o.hotelId === h.id)).map((h) => {
      const pr = presentacionDelHotel(h, h.hotel_id != null ? ctx.catalogo?.get(h.hotel_id) : undefined);
      return {
        id: h.id, nombre: h.nombre, categoria: h.categoria ?? "", regimen: h.regimen ?? "", descripcion: pr.descripcion, foto: pr.fotos[0], fotos: pr.fotos, estrellas: pr.estrellas, ubicacion: pr.ubicacion, clasificacion: pr.clasificacion, desde: desdeHotel(h.id),
        reglas: ctx.reglasHotel?.get(h.id) ?? null, categorias: ctx.opcionesHotel?.get(h.id)?.categorias ?? [], regimenes: ctx.opcionesHotel?.get(h.id)?.regimenes ?? [],
      };
    }) : [],
    vuelos: p.usa_vuelo ? vuelos.filter((v) => opciones.some((o) => o.vueloId === v.id)).map((v) => ({ id: v.id, fechaIda: v.fecha_ida, fechaRegreso: v.fecha_regreso, etiqueta: [v.aerolinea, v.ruta, v.fecha_ida].filter(Boolean).join(" · ") || `Vuelo ${v.id}`, detalle: ctx.vuelos?.get(v.id) ?? { aerolinea: v.aerolinea, ruta: v.ruta, vueloIda: null, horaSalidaIda: null, horaLlegadaIda: null, vueloRegreso: null, horaSalidaReg: null, horaLlegadaReg: null } })) : [],
    servicios: p.usa_servicios ? servicios.map((s) => ({ id: s.id, nombre: s.nombre, ficha: ctx.fichas?.get(s.id) ?? null })) : [],
    opciones,
  };
}
