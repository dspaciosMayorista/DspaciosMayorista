// ─────────────────────────────────────────────────────────────────────────
// Puente PURO entre una fila REAL de catálogo (hotel_temporadas / programas /
// armado_paquetes, migración 164) y las formas que consume el motor
// (`condicionPago.ts`) y el snapshot (`snapshotCondiciones.ts`) — NINGUNO de
// los dos se toca; este módulo solo TRADUCE columnas ya persistidas a los
// tipos que ellos ya saben interpretar.
//
// Por qué existe: hoy la única cotización con congelado resuelto es la
// MANUAL (`lib/cotizacion/componentesManual.ts`), y sus servicios son texto
// libre sin FK a ningún catálogo — por diseño (ver cabecera de ese archivo),
// no por omisión — así que NUNCA pueden alimentarse de una condición
// configurada aquí. Este módulo es el punto de enganche para el día en que
// una cotización/contrato SÍ nazca de una fila real de catálogo (tarifario,
// reservar, "Commit 5/6" de conversión): cuando eso exista, construye su lista
// de componentes llamando estas funciones sobre las filas reales — nunca
// inventando `condicion: null` / `restriccionComercial: "normal"` a mano.
// ─────────────────────────────────────────────────────────────────────────

import type { CondicionCompuesta, CondicionTipo, RestriccionComercial } from "./condicionPago.ts";
import type { ComponenteSnapshot, VigenciaHotelCondicion } from "./snapshotCondiciones.ts";
import { restriccionImplicitaHotel } from "./condicionPagoCatalogo.ts";

/** Subconjunto plano de columnas 164 comunes a las tres tablas de catálogo. */
export interface FilaCondicionPago {
  condicion_pago_tipo: string;
  condicion_pago_pct_inicial: number | null;
  condicion_pago_dias_saldo: number | null;
}

function aCondicionCompuesta(row: FilaCondicionPago): CondicionCompuesta {
  return {
    // Los tres valores posibles por universo (hotel/producto) están impuestos
    // por el CHECK real de la migración 164 — una fila leída de la BD ya viene
    // saneada; no hay "modo estricto" que aplicar aquí (a diferencia del
    // formulario, que sí trata la entrada como `unknown`).
    tipo: row.condicion_pago_tipo as CondicionTipo,
    pctInicial: row.condicion_pago_pct_inicial,
    diasSaldo: row.condicion_pago_dias_saldo,
  };
}

/** Subconjunto plano de una fila REAL de `hotel_temporadas`. */
export interface HotelTemporadaCatalogo extends FilaCondicionPago {
  id: number;
  nombre: string;
  fecha_inicio: string;
  fecha_fin: string;
}

/**
 * Traduce una vigencia de hotel REAL a `VigenciaHotelCondicion` — incluida su
 * restricción comercial, que NUNCA se lee de una columna (no existe en
 * `hotel_temporadas`): se deriva 100% implícita de `condicion_pago_tipo`,
 * igual que en el formulario (`restriccionImplicitaHotel`).
 */
export function condicionDeVigenciaHotel(row: HotelTemporadaCatalogo): VigenciaHotelCondicion {
  return {
    ...aCondicionCompuesta(row),
    hotelTemporadaId: row.id,
    nombre: row.nombre,
    fechaInicio: row.fecha_inicio,
    fechaFin: row.fecha_fin,
    restriccionComercial: restriccionImplicitaHotel(row.condicion_pago_tipo),
  };
}

/** Subconjunto plano de una fila REAL de `armado_paquetes` o `programas`. */
export interface CondicionProductoCatalogo extends FilaCondicionPago {
  restriccion_comercial: string;
}

/**
 * Traduce la condición de un paquete/programa REAL a los dos campos que
 * `ComponenteSnapshot` necesita (`condicion` + `restriccionComercial`). El
 * llamador arma el resto del componente (`id`, `valor`, `referencia`,
 * `fechaViaje`) con los datos propios de esa cotización/contrato — este
 * módulo no los conoce.
 */
export function condicionDeProductoCatalogo(
  row: CondicionProductoCatalogo,
): { condicion: CondicionCompuesta; restriccionComercial: RestriccionComercial } {
  return {
    condicion: aCondicionCompuesta(row),
    restriccionComercial: row.restriccion_comercial as RestriccionComercial,
  };
}

/** Arma el `ComponenteSnapshot` de un PAQUETE a partir de su fila real de `armado_paquetes`. */
export function componenteDeArmadoPaquete(
  row: CondicionProductoCatalogo,
  info: { id: string; valor: number; referencia?: string | null; fechaViaje?: string | null },
): ComponenteSnapshot {
  const { condicion, restriccionComercial } = condicionDeProductoCatalogo(row);
  return {
    id: info.id,
    tipo: "paquete",
    valor: info.valor,
    condicion,
    fechaViaje: info.fechaViaje ?? null,
    referencia: info.referencia ?? null,
    restriccionComercial,
  };
}

/** Arma el `ComponenteSnapshot` de un PROGRAMA a partir de su fila real de `programas`. */
export function componenteDePrograma(
  row: CondicionProductoCatalogo,
  info: { id: string; valor: number; referencia?: string | null; fechaViaje?: string | null },
): ComponenteSnapshot {
  const { condicion, restriccionComercial } = condicionDeProductoCatalogo(row);
  return {
    id: info.id,
    tipo: "programa",
    valor: info.valor,
    condicion,
    fechaViaje: info.fechaViaje ?? null,
    referencia: info.referencia ?? null,
    restriccionComercial,
  };
}
