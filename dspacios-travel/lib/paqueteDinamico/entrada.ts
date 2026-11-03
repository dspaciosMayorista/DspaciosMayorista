// Entrada del formulario de administración del paquete dinámico (#82) y su validación de forma. PURO.
import type { Esquema, PrecioAcom, PrecioVuelo, PvpModo } from "@/lib/paqueteDinamico/calculo";

export const ROLES_PRODUCTO = ["superadmin", "gerencia", "administracion", "operaciones"] as const;

export type EntradaVuelo = {
  empaquetadoId: number | null; destinoId: number | null; aerolinea: string; ruta: string; fechaIda: string; fechaRegreso: string;
  proveedor: string; neto: Partial<PrecioVuelo>; pvp: Partial<PrecioVuelo>;
};
export type EntradaHotel = {
  hotelId: number | null; nombre: string; categoria: string; regimen: string; descripcion: string; fotoUrl: string; proveedor: string;
  neto: PrecioAcom; pvp: PrecioAcom; pvpGeneral: PrecioAcom | null;
};
export type EntradaServicio = { servicioId: number | null; destinoId: number | null; nombre: string; proveedor: string; neto: number | null; pvp: number | null };

export type EntradaPaqueteTotal = {
  id?: number; nombre: string; destinoId: number | null; destinosExtra: number[]; moneda: "COP" | "USD"; esquema: Esquema; pvpModo: PvpModo | null;
  pctMkPct: number; usaVuelo: boolean; usaHotel: boolean; usaServicios: boolean; noches: number;
  compraInicio: string; compraFin: string; viajeInicio: string; viajeFin: string;
  pvpGeneral: PrecioAcom | null; totalDeclarado: PrecioAcom | null; descripcion: string; incluye: string; noIncluye: string;
  vuelos: EntradaVuelo[]; hoteles: EntradaHotel[]; servicios: EntradaServicio[];
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Forma del formulario (campos, fechas, checks). Los precios los valida `validarPaquete` por opción. */
export function validarEntradaPaqueteTotal(e: EntradaPaqueteTotal): string[] {
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
  const dest = new Set([e.destinoId, ...e.destinosExtra].filter(Boolean));
  for (const v of e.vuelos) if (v.destinoId && !dest.has(v.destinoId)) m.push("Un vuelo es de un destino que no está en el paquete (agrégalo como destino adicional).");
  for (const s of e.servicios) if (s.destinoId && !dest.has(s.destinoId)) m.push(`El servicio «${s.nombre}» es de un destino que no está en el paquete.`);
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
