// #64 — Cuánto vale cada ALTERNATIVA de una comparativa del carrito (cálculo puro, para la pantalla; el servidor liquida y es la autoridad).
//
// Los hoteles de una comparativa son alternativas que compiten: NUNCA se suman entre sí. Cada opción vale su hotel + sus servicios hijos + los vuelos manuales
// de SU grupo (destino IATA + fechas), cada vuelo una sola vez. Un vuelo de otro grupo no cuenta. No existe un «total del carrito» de una comparativa.
import { agruparHotelesPorViaje, claveGrupoViaje, esClaveGrupoViaje, type HotelDeVuelo, type TramoVueloManual } from "@/lib/cart/servicioManual";

export type HotelComparativa = HotelDeVuelo & { id: string; pax: number; precio: number; moneda: string | null };
export type ServicioHijo = { nombre: string; precio: number; hotelItemId: string };
export type VueloComparativa = {
  /** «otro» = servicio manual que no es un vuelo (sin tramo): se suma igual, una vez, a cada opción de su grupo. */
  clase?: "vuelo" | "otro";
  id: string; nombre: string; tramo: TramoVueloManual | null; pax: number; precio: number; impuestoNoComisionable: number; moneda: string; hotelRef: string | null;
};

export type OpcionResumen = {
  hotelId: string; hotelNombre: string; pax: number; moneda: string | null;
  hotelPrecio: number; servicios: { nombre: string; precio: number }[];
  vuelos: { clase?: "vuelo" | "otro"; id: string; nombre: string; tramo: TramoVueloManual | null; pax: number; precio: number; impuestoNoComisionable: number }[];
  /** PVP de ESTA alternativa: hotel + servicios hijos + vuelos de su grupo (cada uno una vez). */
  pvp: number;
  /** Parte NO comisionable de los vuelos de la opción (los impuestos del hotel los liquida el servidor). */
  impuestoNoComisionableVuelos: number;
};
export type GrupoResumen = { clave: string; destinoIata: string; fechaIda: string; fechaRegreso: string; opciones: OpcionResumen[] };

/** Clave del grupo al que pertenece un vuelo: su selector puede ser la clave misma, el id de un hotel del grupo, o «comun» si hay un único grupo. */
export function grupoDeVuelo(v: Pick<VueloComparativa, "hotelRef">, grupos: readonly { clave: string; hoteles: readonly { id: string }[] }[]): string | null {
  const ref = v.hotelRef;
  if (!ref) return null;
  if (esClaveGrupoViaje(ref)) return grupos.some((g) => g.clave === ref) ? ref : null;
  if (ref === "comun") return grupos.length === 1 ? grupos[0].clave : null;
  return grupos.find((g) => g.hoteles.some((h) => h.id === ref))?.clave ?? null;
}

export function resumirOpcionesComparativa(
  hoteles: readonly HotelComparativa[], servicios: readonly ServicioHijo[], vuelos: readonly VueloComparativa[],
): { grupos: GrupoResumen[]; sinDato: HotelComparativa[]; vuelosSinGrupo: VueloComparativa[] } {
  const { grupos, sinDato } = agruparHotelesPorViaje(hoteles);
  const vuelosSinGrupo: VueloComparativa[] = [];
  const porGrupo = new Map<string, VueloComparativa[]>();
  for (const v of vuelos) {
    const clave = grupoDeVuelo(v, grupos);
    if (!clave) { vuelosSinGrupo.push(v); continue; }
    porGrupo.set(clave, [...(porGrupo.get(clave) ?? []), v]);
  }
  return {
    grupos: grupos.map((g) => ({
      clave: g.clave, destinoIata: g.destinoIata, fechaIda: g.fechaIda, fechaRegreso: g.fechaRegreso,
      opciones: g.hoteles.map((h): OpcionResumen => {
        const hijos = servicios.filter((s) => s.hotelItemId === h.id).map((s) => ({ nombre: s.nombre, precio: s.precio }));
        const vs = (porGrupo.get(g.clave) ?? []).map((v) => ({ clase: v.clase, id: v.id, nombre: v.nombre, tramo: v.tramo, pax: v.pax, precio: v.precio, impuestoNoComisionable: v.impuestoNoComisionable }));
        return {
          hotelId: h.id, hotelNombre: h.nombre, pax: h.pax, moneda: h.moneda, hotelPrecio: h.precio, servicios: hijos, vuelos: vs,
          pvp: h.precio + hijos.reduce((s, x) => s + x.precio, 0) + vs.reduce((s, x) => s + x.precio, 0),
          impuestoNoComisionableVuelos: vs.reduce((s, x) => s + x.impuestoNoComisionable, 0),
        };
      }),
    })),
    sinDato, vuelosSinGrupo,
  };
}

export { claveGrupoViaje };
