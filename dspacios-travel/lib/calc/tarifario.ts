export const COMISION_AGENCIA = 0.12;

export interface PreciosTarifa {
  precioVenta: number;
  impuestoNoComisionable: number;
  baseComisionable: number;
  tarifaNetaAgencia: number;
  comisionAgencia: number;
}

/** Calcula todos los valores derivados a partir del precio de venta de una tarifa */
export function calcPreciosTarifa(
  precioVenta: number,
  impuestoNoComisionable: number = 0
): PreciosTarifa {
  const baseComisionable = precioVenta - impuestoNoComisionable;
  const comisionAgencia = baseComisionable * COMISION_AGENCIA;
  const tarifaNetaAgencia = baseComisionable * (1 - COMISION_AGENCIA) + impuestoNoComisionable;

  return {
    precioVenta,
    impuestoNoComisionable,
    baseComisionable,
    tarifaNetaAgencia,
    comisionAgencia,
  };
}

/** Calcula el PVP usando margen sobre precio: pvp = costo / (1 - margen%) */
export function calcPrecioDesdeProducto(
  costoBase: number,
  pctMargen: number
): number {
  if (pctMargen >= 100) return 0;
  return costoBase / (1 - pctMargen / 100);
}

/** Verifica el margen efectivo: (pvp - costo) / pvp */
export function calcMargenEfectivo(pvp: number, costo: number): number {
  if (pvp === 0) return 0;
  return ((pvp - costo) / pvp) * 100;
}
