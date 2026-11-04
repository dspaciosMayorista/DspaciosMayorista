// #90 — Reglas de promoción configurables por hotel (EBB y Long Stay).
//
// BASE DEL DESCUENTO: la NETA HOTELERA de la estadía (suma noche por noche ya
// liquidada, de cualquier acomodación o menor), ANTES del markup. Nunca toca
// vuelo ni servicios: quien llama aplica esto solo a `costoHotel` y luego marca.
//
// - EBB ('ebb'): umbral = días entre la fecha de reserva y el check-in (>=).
// - Long Stay ('long_stay'): umbral = noches de la estadía (>=).
// - Varias cumplidas => UN solo descuento: el mayor %. Nunca se suman ni se encadenan.
// - Ninguna cumplida => factor 1 (tarifa base).
//
// Funciones puras. La "fecha de reserva" la entrega el SERVIDOR (fechaNegocio,
// America/Bogota); este módulo nunca lee el reloj por su cuenta.

import { marcar, redondearVenta } from "./paquetes.ts";
import { aMoneda63 } from "../reservar/ofertaDinamica63.ts";
import type { BaseMotor } from "../cotizacion/composicionPrecio.ts";

export type TipoReglaDescuento = "ebb" | "long_stay";

export interface ReglaDescuentoHotel {
  tipo: TipoReglaDescuento;
  /** EBB: días de anticipación mínimos. Long Stay: noches mínimas. */
  umbral: number;
  /** Porcentaje (18 = 18 %). */
  pct: number;
  activa?: boolean;
}

export interface DescuentoAplicado {
  tipo: TipoReglaDescuento;
  umbral: number;
  pct: number;
}


const MS_DIA = 86_400_000;

/** Días enteros de `desde` a `hasta` (yyyy-mm-dd). NaN si alguna es inválida. */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / MS_DIA);
}

/**
 * Regla ganadora (mayor %) para una estadía, o null. Reglas inválidas
 * (pct fuera de (0,100), umbral no finito o <1) o inactivas se ignoran: fallan
 * hacia "sin descuento", nunca hacia un descuento inventado.
 */
export function resolverDescuentoHotel(
  reglas: readonly ReglaDescuentoHotel[] | null | undefined,
  args: { fechaReserva: string; fechaIda: string; numNoches: number }
): DescuentoAplicado | null {
  if (!reglas?.length) return null;
  const dias = diasEntre(args.fechaReserva, args.fechaIda);
  let mejor: DescuentoAplicado | null = null;
  for (const r of reglas) {
    if (r.activa === false) continue;
    const pct = Number(r.pct);
    const umbral = Number(r.umbral);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100 || !Number.isFinite(umbral) || umbral < 1) continue;
    const cumple = r.tipo === "ebb"
      ? Number.isFinite(dias) && dias >= umbral
      : r.tipo === "long_stay" && args.numNoches >= umbral;
    if (cumple && (mejor == null || pct > mejor.pct)) mejor = { tipo: r.tipo, umbral, pct };
  }
  return mejor;
}

/** Aplica el descuento a una neta; redondea a centavos (USD) o peso (COP). */
export function aplicarDescuentoNeta(neta: number, d: DescuentoAplicado | null, moneda: string): number {
  if (!d) return neta;
  const v = neta * (1 - d.pct / 100);
  return moneda === "USD" ? Math.round(v * 100) / 100 : Math.round(v);
}

/**
 * Precio publicado (bloqueo / empaquetado / salida) CON el descuento de hoy.
 *
 * El tarifario publicado guarda siempre la tarifa BASE (un % que depende del día de la compra no puede quedar congelado en una fila: se vencería sin avisar).
 * Al cotizar o convertir se recompone el precio desde la composición que guardó el generador: misma fórmula y mismo redondeo que `evaluarHotelPorFechas`
 * (hotel marcado sobre la neta descontada + servicios + vuelo, redondeo de venta; el fee de infante del vuelo va exacto después).
 * Devuelve null si el precio publicado no es exactamente el que describe la composición (no se inventa un precio): quien llama debe fallar cerrado.
 * Un PVP fijo de infante no se compone: queda como está (el descuento recae sobre la neta del hotel y ese precio no la usa).
 */
export function pvpPublicadoConDescuento(
  base: Pick<BaseMotor, "pctMk" | "vuelo" | "feeInfante" | "fijo" | "pvps" | "servicios" | "netos" | "netosOrigen" | "trm">,
  a: { clave: string; pvpPublicado: number; menorDeDos: boolean; descuento: DescuentoAplicado | null; moneda: string },
): { pvp: number; neto: number } | null {
  const neto = base.netos[a.clave];
  if (neto == null || !Number.isFinite(neto)) return null;
  if (!a.descuento) return { pvp: a.pvpPublicado, neto };
  if (a.clave === "infante" && (a.menorDeDos ? base.fijo?.menor2 : base.fijo?.mayor2)) return { pvp: a.pvpPublicado, neto };
  const esperado = base.pvps?.[a.clave];
  if (!esperado || (a.menorDeDos ? esperado.pvpMenor2 : esperado.pvp) !== a.pvpPublicado) return null;
  // Hotel y paquete en monedas distintas (TRM): la neta se descuenta en la moneda del HOTEL (centavos USD / peso COP, igual que el costo y la CxP) y luego se convierte,
  // así PVP, costo del contrato y CxP parten del mismo importe. Descontar la neta ya convertida desfasaría hasta (centavos × TRM) entre precio y costo.
  const org = base.netosOrigen?.[a.clave];
  const netoD = org && base.trm != null && base.trm > 0 && org.monto > 0
    ? aMoneda63(aplicarDescuentoNeta(org.monto, a.descuento, org.moneda), org.moneda, a.moneda, base.trm)
    : aplicarDescuentoNeta(neto, a.descuento, a.moneda);
  const hotel = marcar(netoD, base.pctMk);
  const servicios = base.servicios.reduce((t, s) => t + marcar(a.menorDeDos ? s.netoMenor : s.neto, base.pctMk), 0);
  const pvp = a.menorDeDos
    ? redondearVenta(hotel + servicios, a.moneda) + (base.feeInfante > 0 ? base.feeInfante : 0)
    : redondearVenta(hotel + servicios + base.vuelo, a.moneda);
  return { pvp, neto: netoD };
}
