// Reglas puras de multidestino, ruta de vuelo y proveedor de servicios vinculados (#82, migración 276). Espejo de los triggers de la base
// (`tg_din_paquete_reglas`, `tg_din_vuelo_reglas`, `tg_din_servicio_reglas`): aquí se dan mensajes claros ANTES de ir a la base; la base es la frontera real.

import { codigoIataDeCiudad, IATA_CIUDAD } from "@/lib/iata";

const IATA = /^[A-Z]{3}$/;

/** Código IATA normalizado ("bog " → "BOG") o "" si no es de 3 letras. */
export function normalizarIata(v: string | null | undefined): string {
  const x = String(v ?? "").trim().toUpperCase();
  return IATA.test(x) ? x : "";
}

/** Igual que `public.pais_comparable_67` (220): sin espacios de más, sin tildes ni mayúsculas; null si queda vacío. */
export function paisComparable(p: string | null | undefined): string | null {
  const x = String(p ?? "").replace(/\s+/g, " ").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return x === "" ? null : x;
}

/**
 * Ruta de un vuelo MANUAL, derivada de sus campos de origen y destino (nunca texto libre). Ida y vuelta si hay fecha de regreso.
 * Devuelve null si falta o es inválido alguno de los dos códigos, o si son iguales.
 */
export function derivarRutaManual(origen: string, destino: string, conRegreso: boolean): string | null {
  const o = normalizarIata(origen), d = normalizarIata(destino);
  if (!o || !d || o === d) return null;
  return conRegreso ? `${o} - ${d} - ${o}` : `${o} - ${d}`;
}

// ── Selector de código IATA del vuelo manual: busca en el catálogo (`lib/iata.ts`) por código o ciudad y deja escribir cualquier código válido de 3 letras ──
export type OpcionIata = { codigo: string; ciudad: string; etiqueta: string };
const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toLowerCase();

/** Catálogo ordenado por ciudad (solo entradas con código de 3 letras). */
export const OPCIONES_IATA: readonly OpcionIata[] = Object.entries(IATA_CIUDAD)
  .filter(([c]) => IATA.test(c))
  .map(([codigo, ciudad]) => ({ codigo, ciudad, etiqueta: `${ciudad} (${codigo})` }))
  .sort((a, b) => a.ciudad.localeCompare(b.ciudad, "es"));

/** Opciones que coinciden con lo escrito: el código empieza igual o la ciudad lo contiene (sin tildes ni mayúsculas). Vacío = todo el catálogo. */
export function buscarIata(texto: string): OpcionIata[] {
  const t = sinTildes(texto);
  if (!t) return [...OPCIONES_IATA];
  return OPCIONES_IATA.filter((o) => o.codigo.toLowerCase().startsWith(t) || sinTildes(o.ciudad).includes(t));
}

/**
 * Código IATA que representa lo escrito: «Ciudad (COD)», un código de 3 letras (esté o no en el catálogo) o el nombre EXACTO y único de una ciudad del catálogo.
 * "" si no es ninguna de las tres (nunca se adivina).
 */
export function resolverIata(texto: string | null | undefined): string {
  const t = String(texto ?? "").trim();
  if (!t) return "";
  const par = /\(([A-Za-z]{3})\)\s*$/.exec(t);
  if (par) return normalizarIata(par[1]);
  return normalizarIata(t) || codigoIataDeCiudad(t) || "";
}

/** Motivos por los que el origen/destino de un vuelo manual no sirve (vacío = válido). Los usan el formulario y el servidor. */
export function erroresIataVuelo(origen: string, destino: string): string[] {
  const m: string[] = [];
  const o = normalizarIata(origen), d = normalizarIata(destino);
  if (!o) m.push("Un vuelo manual necesita el origen como código IATA de 3 letras.");
  if (!d) m.push("Un vuelo manual necesita el destino como código IATA de 3 letras.");
  if (o && d && o === d) m.push("El origen y el destino de un vuelo manual deben ser distintos.");
  return m;
}

// ── Destino de los vuelos y Multidestino ──
/**
 * Al cambiar el destino principal, los vuelos MANUALES que seguían al anterior (o no tenían destino) siguen al nuevo: es la asignación automática, no una elección.
 * Los vinculados a Empaquetados y los que el usuario dirigió a otro destino NO se tocan: el formulario los señala y el servidor los rechaza.
 */
export function seguirDestinoPrincipal<V extends { empaquetadoId: number | null; destinoId: number | null }>(vuelos: V[], anterior: number | null, nuevo: number | null): V[] {
  return vuelos.map((v) => (v.empaquetadoId == null && (v.destinoId == null || v.destinoId === anterior) ? { ...v, destinoId: nuevo } : v));
}

/** Cuántos vuelos y servicios están dirigidos a un destino distinto del principal (impiden desactivar Multidestino: no se reasignan en silencio). */
export function ajenosAlPrincipal(e: { destinoId: number | null; vuelos: { destinoId: number | null }[]; servicios: { destinoId: number | null }[] }): { vuelos: number; servicios: number } {
  const ajeno = (x: { destinoId: number | null }) => x.destinoId != null && x.destinoId !== e.destinoId;
  return { vuelos: e.vuelos.filter(ajeno).length, servicios: e.servicios.filter(ajeno).length };
}

export type DestinoPais = { id: number; pais: string | null };

/** Multidestino: apagado → sin adicionales; activo → todos del mismo país que el principal. Devuelve los mensajes (vacío = válido). */
export function validarMultidestino(a: { multidestino: boolean; destinoId: number | null; destinosExtra: number[]; destinos: DestinoPais[] }): string[] {
  const m: string[] = [];
  if (!a.multidestino) {
    if (a.destinosExtra.length) m.push("Activa «multidestino» para usar destinos adicionales.");
    return m;
  }
  if (!a.destinosExtra.length) return m;
  if (!a.destinoId) return ["Elige el destino principal antes de agregar destinos adicionales."];
  if (a.destinosExtra.includes(a.destinoId)) return ["El destino principal no puede repetirse como adicional."];
  const por = new Map(a.destinos.map((d) => [d.id, d.pais]));
  const pp = paisComparable(por.get(a.destinoId));
  if (!pp) return ["El destino principal no tiene país cargado; completa su ficha de destino."];
  const ajenos = a.destinosExtra.filter((id) => paisComparable(por.get(id)) !== pp);
  if (ajenos.length) m.push("Los destinos adicionales deben ser del mismo país que el principal.");
  return m;
}

/**
 * Guarda de ficha fuente: el destino de la ficha vinculada (empaquetado / servicio) debe ser el declarado en el paquete (el del ítem o, si va vacío,
 * el principal). Ficha sin destino (servicio nacional) no se compara. Un destino_id válido pero distinto al de la ficha es una discrepancia.
 */
export function destinoCoincide(destinoFicha: number | null | undefined, destinoDeclarado: number | null | undefined, destinoPrincipal: number | null | undefined): boolean {
  if (destinoFicha == null) return true;
  return destinoFicha === (destinoDeclarado ?? destinoPrincipal ?? null);
}

/** Servicios vinculados cuya ficha no tiene proveedor: sin él no se puede publicar ni convertir (no hay a quién registrar el costo). */
export function serviciosSinProveedor(servicios: { servicioId: number | null; nombre: string; proveedorId: number | null }[]): string[] {
  return servicios.filter((s) => s.servicioId != null && s.proveedorId == null).map((s) => s.nombre);
}

export const mensajeSinProveedor = (nombres: string[]): string =>
  `La ficha de ${nombres.join(", ")} no tiene proveedor: cárgalo en Producto > Servicios para poder publicar y convertir.`;
