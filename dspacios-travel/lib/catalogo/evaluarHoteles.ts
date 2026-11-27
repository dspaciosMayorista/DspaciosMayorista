// B95-13/15/20 — evaluación ÚNICA de las filas de hotel de un formulario manual (cotización dinámica, comparativa y contrato manual).
// PURA: la usan el navegador (mensajes en línea / botón desactivado, con el catálogo ya cargado) y el servidor (autoritativo, con el hotel leído de la base por id).
// Por cada fila: (1) el hotel del catálogo pertenece al destino elegido; (2) cómo se compró (directa / plataforma) y quién es el PROVEEDOR a pagar; (3) las habitaciones
// (cantidad por tipo) cuadran con adultos / niños / infantes y con las reglas del hotel. Devuelve además lo que se guarda: proveedor, plataforma y el texto derivado de la acomodación.
import type { AcomConfig, AcomRoom } from "@/lib/acomodaciones";
import { errorHotelFueraDeDestino, resolverCompraHotel, textoHabitaciones, validarAcomodacionHotel, type CompraOrigen, type Ocupacion } from "@/lib/catalogo/validacionManual";
import type { HotelCatalogoManual } from "@/lib/catalogo/prefillManual";

/** Lo que se necesita saber de un hotel del catálogo (en el servidor sale de la base por id; en el navegador, del catálogo ya cargado). */
export type HotelDb = {
  id: number; nombre: string; destinoId: number | null; proveedor: string | null; adultsOnly: boolean;
  paxMin: number | null; paxMax: number | null; reglas: AcomConfig[];
  /** Umbrales de edad del hotel (infante hasta / niño hasta); null = sin dato: se usan los de la tabla (2 y 10). */
  edadInfanteMax?: number | null; edadNinoMax?: number | null;
};

export const hotelDbDeCatalogo = (h: HotelCatalogoManual): HotelDb => ({
  id: h.id, nombre: h.nombre, destinoId: h.destinoId ?? null, proveedor: h.proveedor, adultsOnly: h.adultsOnly,
  paxMin: h.paxMin ?? null, paxMax: h.paxMax ?? null, reglas: h.reglasAcom ?? [], edadInfanteMax: h.edadInfanteMax ?? null, edadNinoMax: h.edadNinoMax ?? null,
});

export type FilaHotel = { nombre: string; catalogoId?: number | null; compra?: unknown; plataforma?: string | null; proveedor?: string | null; habitaciones?: unknown };
export type ContextoHoteles = {
  destinoId: number | null;
  /** null = no hay con qué comparar (contrato sin pasajeros cargados): solo se exige la estructura de habitaciones. */
  ocupacion: Ocupacion | null;
  /** Hoteles del catálogo por id (los que no estén aquí se tratan como «ya no existe»). */
  db: ReadonlyMap<number, HotelDb>;
  /** false = no se exige estructura de habitaciones (producto negociado del tarifario: sus hoteles vienen del paquete). */
  exigirHabitaciones?: boolean;
};
export type HotelResuelto = { proveedor: string; plataforma: string | null; compra: CompraOrigen | null; acomodacion: string; aviso: string | null; errores: string[] };

/** Evalúa UNA fila. Los errores van en texto claro y en el orden en que conviene corregirlos. */
export function evaluarHotel(f: FilaHotel, ctx: ContextoHoteles): HotelResuelto {
  const errores: string[] = [];
  const nombre = (f.nombre ?? "").trim() || "el hotel";
  const hotel = f.catalogoId != null ? ctx.db.get(f.catalogoId) ?? null : null;
  if (f.catalogoId != null && !hotel) errores.push(`El hotel «${nombre}» del catálogo ya no existe o no se pudo verificar. Vuelve a elegirlo.`);
  if (hotel) {
    const fuera = errorHotelFueraDeDestino(hotel, ctx.destinoId);
    if (fuera) errores.push(fuera);
    if (hotel.adultsOnly && ctx.ocupacion && (ctx.ocupacion.ninos > 0 || ctx.ocupacion.infantes > 0)) errores.push(`El hotel «${hotel.nombre}» es solo para adultos (Adults Only) y el viaje incluye niños o infantes.`);
  }
  const compra = resolverCompraHotel({ compra: f.compra, plataforma: f.plataforma, proveedor: f.proveedor, proveedorCatalogo: hotel?.proveedor ?? null, nombreHotel: hotel?.nombre ?? f.nombre });
  if (!compra.ok) errores.push(compra.error);
  let acomodacion = "";
  if (ctx.exigirHabitaciones !== false) {
    const tipos = (hotel?.reglas ?? []).map((r) => r.acomodacion as AcomRoom);
    errores.push(...validarAcomodacionHotel(f.habitaciones, ctx.ocupacion, { nombre: hotel?.nombre ?? f.nombre, reglas: hotel?.reglas ?? [], paxMin: hotel?.paxMin ?? null, paxMax: hotel?.paxMax ?? null, tiposOfrecidos: tipos.length ? tipos : null }));
    acomodacion = textoHabitaciones(f.habitaciones);
  }
  return {
    proveedor: compra.ok ? compra.proveedor : (f.proveedor ?? "").trim(),
    plataforma: compra.ok ? compra.plataforma : null,
    compra: compra.ok ? compra.compra : null,
    acomodacion, aviso: compra.ok ? compra.aviso : null, errores,
  };
}

/** Todas las filas: errores con el nombre del hotel por delante cuando hay varias (un hotel de una comparativa no se confunde con otro). */
export function evaluarHoteles(filas: readonly FilaHotel[], ctx: ContextoHoteles): { ok: true; filas: HotelResuelto[] } | { ok: false; error: string; errores: string[] } {
  const res = filas.map((f) => evaluarHotel(f, ctx));
  const errores = res.flatMap((r) => r.errores);
  return errores.length ? { ok: false, error: errores[0], errores } : { ok: true, filas: res };
}
