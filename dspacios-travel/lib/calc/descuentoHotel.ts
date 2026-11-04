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
  /** «EBB 2 · 60+ días · 23 %» o «Long Stay · 25 %»: la regla que ganó (nunca inferida del importe). La fija `resolverDescuentoHotel`. */
  etiqueta?: string;
}

const pctTexto = (pct: number) => `${String(Math.round(pct * 100) / 100).replace(".", ",")} %`;

/**
 * Etiqueta de la regla ganadora. EBB se numera por escalón: la posición (1, 2, 3…) de la regla entre las EBB vigentes del hotel ordenadas por días mínimos.
 * Long Stay lleva solo su porcentaje. Función pura sobre la regla usada; no depende de ningún importe.
 */
export function etiquetaReglaGanadora(ganadora: Pick<DescuentoAplicado, "tipo" | "umbral" | "pct">, reglas: readonly ReglaDescuentoHotel[]): string {
  if (ganadora.tipo === "long_stay") return `Long Stay · ${pctTexto(ganadora.pct)}`;
  const escalones = [...new Set(reglas.filter((r) => r.tipo === "ebb" && r.activa !== false && Number.isFinite(Number(r.umbral)) && Number(r.umbral) >= 1 && Number(r.pct) > 0 && Number(r.pct) < 100).map((r) => Number(r.umbral)))].sort((a, b) => a - b);
  const n = escalones.indexOf(ganadora.umbral) + 1;
  return `EBB ${n > 0 ? `${n} · ` : ""}${ganadora.umbral}+ días · ${pctTexto(ganadora.pct)}`;
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
  return mejor ? { ...mejor, etiqueta: etiquetaReglaGanadora(mejor, reglas) } : null;
}

/** Aplica el descuento a una neta; redondea a centavos (USD) o peso (COP). */
export function aplicarDescuentoNeta(neta: number, d: DescuentoAplicado | null, moneda: string): number {
  if (!d) return neta;
  const v = neta * (1 - d.pct / 100);
  return moneda === "USD" ? Math.round(v * 100) / 100 : Math.round(v);
}

type BaseDescuento = Pick<BaseMotor, "pctMk" | "vuelo" | "feeInfante" | "fijo" | "pvps" | "servicios" | "netos" | "netosOrigen" | "trm">;

/**
 * Neta hotelera de UNA clave con el descuento aplicado. Hotel y paquete en monedas distintas (TRM): la neta se descuenta en la moneda del HOTEL (centavos USD / peso COP,
 * igual que el costo y la CxP) y luego se convierte, así PVP, costo del contrato y CxP parten del mismo importe. Descontar la neta ya convertida desfasaría hasta
 * (centavos × TRM) entre precio y costo.
 */
function netoDescontada(base: BaseDescuento, clave: string, neto: number, d: DescuentoAplicado, moneda: string): number {
  const org = base.netosOrigen?.[clave];
  return org && base.trm != null && base.trm > 0 && org.monto > 0
    ? aMoneda63(aplicarDescuentoNeta(org.monto, d, org.moneda), org.moneda, moneda, base.trm)
    : aplicarDescuentoNeta(neto, d, moneda);
}

/**
 * Precio NORMAL del infante (migración 254, `precio_pvp[_menor2]_sin_fijo`) CON el descuento de hoy: el que se cobra cuando un servicio opcional le cobra al infante y el PVP fijo
 * deja de aplicar. Misma composición y misma regla ganadora que `pvpPublicadoConDescuento`: el % recae SOLO sobre la neta del hotel del infante; vuelo, fee y servicios no se descuentan.
 * La composición guarda el fijo (no el normal) en `pvps.infante`, así que se verifica de otra forma: recomponer SIN descuento debe reproducir exactamente el normal publicado.
 * null si no lo reproduce (no se inventa un precio): quien llama debe fallar cerrado.
 */
export function pvpInfanteNormalConDescuento(
  base: BaseDescuento,
  a: { pvpNormalPublicado: number; menorDeDos: boolean; descuento: DescuentoAplicado | null; moneda: string },
): number | null {
  const neto = base.netos["infante"];
  if (neto == null || !Number.isFinite(neto)) return null;
  const componer = (netoHotel: number) => {
    const hotel = marcar(netoHotel, base.pctMk);
    const servicios = base.servicios.reduce((t, s) => t + marcar(a.menorDeDos ? s.netoMenor : s.neto, base.pctMk), 0);
    return a.menorDeDos
      ? redondearVenta(hotel + servicios, a.moneda) + (base.feeInfante > 0 ? base.feeInfante : 0)
      : redondearVenta(hotel + servicios + base.vuelo, a.moneda);
  };
  if (componer(neto) !== a.pvpNormalPublicado) return null;
  return a.descuento ? componer(netoDescontada(base, "infante", neto, a.descuento, a.moneda)) : a.pvpNormalPublicado;
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
  base: BaseDescuento,
  a: { clave: string; pvpPublicado: number; menorDeDos: boolean; descuento: DescuentoAplicado | null; moneda: string },
): { pvp: number; neto: number } | null {
  const neto = base.netos[a.clave];
  if (neto == null || !Number.isFinite(neto)) return null;
  if (!a.descuento) return { pvp: a.pvpPublicado, neto };
  if (a.clave === "infante" && (a.menorDeDos ? base.fijo?.menor2 : base.fijo?.mayor2)) return { pvp: a.pvpPublicado, neto };
  const esperado = base.pvps?.[a.clave];
  if (!esperado || (a.menorDeDos ? esperado.pvpMenor2 : esperado.pvp) !== a.pvpPublicado) return null;
  const netoD = netoDescontada(base, a.clave, neto, a.descuento, a.moneda);
  const hotel = marcar(netoD, base.pctMk);
  const servicios = base.servicios.reduce((t, s) => t + marcar(a.menorDeDos ? s.netoMenor : s.neto, base.pctMk), 0);
  const pvp = a.menorDeDos
    ? redondearVenta(hotel + servicios, a.moneda) + (base.feeInfante > 0 ? base.feeInfante : 0)
    : redondearVenta(hotel + servicios + base.vuelo, a.moneda);
  return { pvp, neto: netoD };
}
