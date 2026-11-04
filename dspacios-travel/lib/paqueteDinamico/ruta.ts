// Reglas puras de multidestino, ruta de vuelo y proveedor de servicios vinculados (#82, migración 276). Espejo de los triggers de la base
// (`tg_din_paquete_reglas`, `tg_din_vuelo_reglas`, `tg_din_servicio_reglas`): aquí se dan mensajes claros ANTES de ir a la base; la base es la frontera real.

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
