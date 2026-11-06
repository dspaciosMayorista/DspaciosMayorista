// Entrada del formulario de administración del paquete dinámico (#82) y su validación de forma. PURO.
import type { Esquema, PrecioAcom, PrecioVuelo, PvpModo } from "@/lib/paqueteDinamico/calculo";
import { erroresIataVuelo, validarMultidestino, type DestinoPais } from "@/lib/paqueteDinamico/ruta";
import { validarConfigMenoresManual } from "@/lib/paqueteDinamico/menores";

export const ROLES_PRODUCTO = ["superadmin", "gerencia", "administracion", "operaciones"] as const;

export type EntradaVuelo = {
  empaquetadoId: number | null; destinoId: number | null; aerolinea: string; fechaIda: string; fechaRegreso: string;
  /** Solo lectura: vinculado = la del empaquetado; manual = derivada de origen/destino. El servidor la recalcula siempre. */
  ruta: string; origenIata: string; destinoIata: string;
  proveedor: string; neto: Partial<PrecioVuelo>; pvp: Partial<PrecioVuelo>;
};
export type EntradaHotel = {
  hotelId: number | null; nombre: string; categoria: string; regimen: string; descripcion: string; fotoUrl: string; proveedor: string;
  /** Estrellas del HOTEL (1 a 5; null = sin dato). No es la categoría de la habitación. Con ficha se copian de ella al guardar. */
  estrellas: number | null;
  /** Dirección o lugar para el mapa (vacío = sin dato: la tarjeta no muestra mapa). */
  ubicacion: string;
  neto: PrecioAcom; pvp: PrecioAcom; pvpGeneral: PrecioAcom | null;
  /** La ficha del hotel es solo para adultos. El navegador lo trae del catálogo para ocultar campos; el SERVIDOR lo vuelve a leer de la ficha y ese valor es el que manda. */
  adultsOnly?: boolean;
  /** Solo hotel MANUAL: capacidad máxima de niños por habitación (general a sus acomodaciones) y umbrales de edad. Con ficha se leen de la ficha. */
  capacidadNinos: number | null; edadInfanteMax: number | null; edadNinoMax: number | null;
};
/** `proveedor`/`proveedorId` de un servicio vinculado salen de su ficha (servicios_adicionales.proveedor_id); en uno manual se escribe el nombre. */
export type EntradaServicio = {
  servicioId: number | null; destinoId: number | null; nombre: string; proveedor: string; proveedorId: number | null; neto: number | null; pvp: number | null;
  /** Solo PVP por persona con ficha: PVP del menor de 2 años (0 = gratis EXPLÍCITO; null = sin definir). Por grupo y en netas no aplica. */
  pvpInfante: number | null;
};

export type EntradaPaqueteTotal = {
  id?: number; nombre: string; destinoId: number | null; multidestino: boolean; destinosExtra: number[]; moneda: "COP" | "USD"; esquema: Esquema; pvpModo: PvpModo | null;
  pctMkPct: number; usaVuelo: boolean; usaHotel: boolean; usaServicios: boolean; noches: number;
  compraInicio: string; compraFin: string; viajeInicio: string; viajeFin: string;
  pvpGeneral: PrecioAcom | null; totalDeclarado: PrecioAcom | null; descripcion: string; incluye: string; noIncluye: string;
  vuelos: EntradaVuelo[]; hoteles: EntradaHotel[]; servicios: EntradaServicio[];
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Forma del formulario (campos, fechas, checks). Los precios los valida `validarPaquete` por opción. */
export function validarEntradaPaqueteTotal(e: EntradaPaqueteTotal, destinos: DestinoPais[] = []): string[] {
  const m: string[] = [];
  if (!e.nombre.trim()) m.push("El nombre es obligatorio.");
  if (!e.destinoId) m.push("Elige el destino principal.");
  if (e.moneda !== "COP" && e.moneda !== "USD") m.push("La moneda debe ser COP o USD.");
  if (!e.usaVuelo && !e.usaHotel && !e.usaServicios) m.push("Marca al menos un componente: vuelo, hotel o servicios.");
  if (!Number.isInteger(e.noches) || e.noches < 1 || e.noches > 60) m.push("Las noches deben estar entre 1 y 60.");
  if (e.esquema === "neta_markup" && !(e.pctMkPct >= 0 && e.pctMkPct < 100)) m.push("El markup debe estar entre 0 y 99,99 %.");
  if (e.esquema === "solo_pvp" && !e.pvpModo) m.push("En solo PVP elige precio general o PVP por componente.");
  if (e.esquema === "solo_pvp" && e.pvpModo === "general" && !e.pvpGeneral && !e.hoteles.some((h) => h.pvpGeneral)) m.push("Carga el precio general por acomodación.");
  for (const [n, f] of [["compra", [e.compraInicio, e.compraFin]], ["viaje", [e.viajeInicio, e.viajeFin]]] as const) {
    const [a, b] = f;
    if ((a && !ISO.test(a)) || (b && !ISO.test(b))) m.push(`Fechas de ${n} inválidas.`);
    else if (a && b && b < a) m.push(`La vigencia de ${n} termina antes de empezar.`);
  }
  m.push(...validarMultidestino({ multidestino: e.multidestino, destinoId: e.destinoId, destinosExtra: e.destinosExtra, destinos }));
  const dest = new Set([e.destinoId, ...e.destinosExtra].filter(Boolean));
  if (e.usaHotel) for (const h of e.hoteles) {
    if (h.hotelId != null) continue;
    const c = validarConfigMenoresManual({ capacidadNinos: h.capacidadNinos, edadInfanteMax: h.edadInfanteMax, edadNinoMax: h.edadNinoMax });
    if (!c.ok) m.push(`Hotel «${h.nombre || "manual"}»: ${c.error}`);
  }
  if (e.usaHotel) for (const h of e.hoteles) {
    if (h.estrellas != null && !(Number.isInteger(h.estrellas) && h.estrellas >= 1 && h.estrellas <= 5)) m.push(`Hotel «${h.nombre || "manual"}»: las estrellas deben ser un número entero de 1 a 5.`);
    if (h.ubicacion.length > 500) m.push(`Hotel «${h.nombre || "manual"}»: la ubicación es demasiado larga (máximo 500 caracteres).`);
  }
  // Sin Multidestino el destino de todo vuelo es el principal: uno de otro destino NO se reasigna en silencio, se rechaza.
  for (const v of e.vuelos) if (v.destinoId && !dest.has(v.destinoId)) m.push(e.multidestino ? "Un vuelo es de un destino que no está en el paquete (agrégalo como destino adicional)." : "Un vuelo es de un destino distinto al principal y Multidestino está desactivado: actívalo o cambia el destino del vuelo.");
  for (const s of e.servicios) if (s.destinoId && !dest.has(s.destinoId)) m.push(`El servicio «${s.nombre}» es de un destino que no está en el paquete.`);
  for (const v of e.vuelos) if (v.empaquetadoId == null) m.push(...erroresIataVuelo(v.origenIata, v.destinoIata));
  for (const v of e.vuelos) {
    if (v.fechaIda && v.fechaRegreso && v.fechaRegreso < v.fechaIda) m.push("Un vuelo regresa antes de salir.");
    // La estadía del paquete son `noches`: un vuelo con ambas fechas debe durar exactamente eso (la base lo exige al cotizar).
    else if (ISO.test(v.fechaIda) && ISO.test(v.fechaRegreso)) {
      const d = Math.round((Date.parse(`${v.fechaRegreso}T00:00:00Z`) - Date.parse(`${v.fechaIda}T00:00:00Z`)) / 86_400_000);
      if (d !== e.noches) m.push(`Un vuelo dura ${d} noches y el paquete ${e.noches}: ajusta las fechas del vuelo o las noches del paquete.`);
    }
  }
  return m;
}
