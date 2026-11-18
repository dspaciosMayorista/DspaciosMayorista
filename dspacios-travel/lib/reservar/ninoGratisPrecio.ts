// #125 (corrección de la auditoría F1/F4) — piezas PURAS que el niño gratis comparte con Reservar, el buscador y el carrito.
//
// 1) `ajustarNochesNinoGratis`: el descuento EBB / Long Stay (y el redondeo por moneda) del neto de una clase se aplica sobre su TOTAL pagadero, no noche por noche; para que la suma
//    de las noches de una promoción sea exactamente ese total ajustado se reescalan las noches (misma proporción). Así «todo el alojamiento del niño» se condona sin sobrar ni faltar centavos.
// 2) `ventaNinoCondonada`: lo que sale del PRECIO DE VENTA del niño al condonar su alojamiento. El PVP del niño se redondea hacia arriba (mil COP / dólar entero) y puede traer vuelo y
//    servicios; se recompone con el MISMO compositor (`componerTarifa`) el PVP SIN el alojamiento condonado (vuelo, servicios e impuesto se conservan; el redondeo se rehace sobre lo que
//    sí se cobra). Condonado = PVP cobrado − PVP recompuesto: un niño de solo hotel queda en 0; uno con vuelo+servicio nunca pierde más que su parte de hotel.
import { marcar, componerTarifa, precioMenorDeDos, type NocheNinoGratis } from "../calc/paquetes.ts";
import type { BaseMotor } from "../cotizacion/composicionPrecio.ts";

/** Aplica `ajustar` a la SUMA de TODAS las noches con niño gratis de la clase (varias promociones sucesivas incluidas) y reparte el resultado entre ellas en la misma proporción. */
export function ajustarNochesNinoGratis(noches: readonly NocheNinoGratis[] | undefined, ajustar: (suma: number) => number): NocheNinoGratis[] | undefined {
  if (!noches?.length) return undefined;
  // R1: un solo grupo por clase. Con dos promociones sucesivas sobre las mismas noches pagaderas, ajustar cada suma por separado redondearía dos veces.
  const suma = noches.reduce((t, n) => t + n.neto, 0);
  return noches.map((n) => {
    if (!(suma > 0)) return { ...n };
    // Se redondea la suma a 1e-6 para que el error de coma flotante del reparto no cambie el redondeo por moneda del total.
    const ajustada = ajustar(Math.round(suma * 1e6) / 1e6);
    return { ...n, neto: n.neto * (ajustada / suma) };
  });
}

export type BaseVentaNino = Pick<BaseMotor, "pctMk" | "impuesto" | "vuelo" | "feeInfante" | "servicios">;

/**
 * Importe del PRECIO DE VENTA de un niño (Niño 1 / Niño 2) que se condona al no cobrarle `netoCondonado` de alojamiento.
 * `netoPagadero` y `netoCondonado` en la moneda del HOTEL (ya con EBB/Long Stay); `aMonedaVenta` los lleva a la moneda de la oferta (TRM) solo para la venta.
 * `menorDeDos`: el niño paga la tarifa de menor de 2 años (techo solo a hotel + servicios; el fee del vuelo exacto después).
 */
export function ventaNinoCondonada(a: {
  pvpCobrado: number;
  netoPagadero: number;
  netoCondonado: number;
  base: BaseVentaNino;
  moneda: string;
  aMonedaVenta?: (neto: number) => number;
  menorDeDos?: boolean;
}): number {
  const conv = a.aMonedaVenta ?? ((n: number) => n);
  // Medio centavo de tolerancia: el neto condonado sale de repartir/sumar noches en coma flotante y, si lo condonado es TODO lo pagadero, un resto de 1e-11 no debe cobrar una unidad de redondeo.
  const resto = a.netoPagadero - a.netoCondonado;
  const restante = resto < 0.005 ? 0 : resto;
  const aporteHotel = marcar(conv(restante), a.base.pctMk);
  const sinHotel = a.menorDeDos
    ? precioMenorDeDos({ aporteHotel, aporteServiciosMenor: a.base.servicios.reduce((t, s) => t + marcar(s.netoMenor, a.base.pctMk), 0), feeInfante: a.base.feeInfante, moneda: a.moneda })
    : componerTarifa({ aporteHotel, aporteServicios: a.base.servicios.reduce((t, s) => t + marcar(s.neto, a.base.pctMk), 0), aporteVuelo: a.base.vuelo, impuesto: a.base.impuesto, moneda: a.moneda }).pvp;
  return Math.max(0, a.pvpCobrado - sinHotel);
}
