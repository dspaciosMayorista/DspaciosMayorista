// ─────────────────────────────────────────────────────────────────────────
// Validación/normalización PURA de "condición de pago" para las TRES fuentes
// de catálogo que la definen (migración 164): vigencias de hotel
// (`hotel_temporadas`), programas (`programas`) y paquetes (`armado_paquetes`).
//
// No es el motor de exigencia (`condicionPago.ts`, no se toca) ni el snapshot
// (`snapshotCondiciones.ts`, no se toca): es la frontera entre el FORMULARIO
// (porcentaje 1–99, `unknown` desde el cliente) y la COLUMNA (fracción 0–1),
// reutilizada por los tres Server Actions para no duplicar la validación ni
// arriesgar que un servidor confíe en un `disabled`/`hidden` del navegador.
//
// Restricción comercial — nomenclatura final por tabla (espejo EXACTO de los
// CHECK de la migración 164, ya aplicada e inmutable):
//   · `hotel_temporadas`  no tiene columna `restriccion_comercial`: la
//     restricción es 100% IMPLÍCITA — cualquier condición de pago distinta de
//     `sin_condicion` es automáticamente no reembolsable/no endosable. No
//     agregar selector ni columna independiente para hoteles.
//   · `armado_paquetes`/`programas` SÍ tienen columna, pero su CHECK
//     (`armado_paquetes_restriccion_check`/`programas_restriccion_check`) solo
//     permite dos valores: `normal` | `promocional_no_reembolsable_no_endosable`.
//     `no_reembolsable_no_endosable` NO es válido para estas dos tablas (a
//     diferencia de `cotizacion_condiciones`/`contrato_condiciones`, cuyo CHECK
//     sí admite los tres) — intentar guardarlo lo rechazaría Postgres.
// ─────────────────────────────────────────────────────────────────────────

import type { RestriccionComercial } from "./condicionPago.ts";

export type CondicionPagoTipoHotel = "sin_condicion" | "pago_total" | "anticipo_saldo";
export type CondicionPagoTipoProducto = "normal" | "pago_total" | "anticipo_saldo";

const TIPOS_HOTEL: ReadonlySet<string> = new Set(["sin_condicion", "pago_total", "anticipo_saldo"]);
const TIPOS_PRODUCTO: ReadonlySet<string> = new Set(["normal", "pago_total", "anticipo_saldo"]);

/** Columnas 164 comunes a las tres tablas, ya normalizadas (fracción 0–1, entero de días). */
export interface CondicionPagoPersistible {
  condicion_pago_tipo: string;
  condicion_pago_pct_inicial: number | null;
  condicion_pago_dias_saldo: number | null;
}

/** Entrada cruda del formulario, tratada como `unknown` en el límite del servidor. */
export interface CondicionPagoEntrada {
  tipo: unknown;
  /** Porcentaje mostrado al usuario como 1–99 (NO fracción). */
  pctInicial: unknown;
  diasSaldo: unknown;
}

type ResultadoValidacion =
  | { ok: true; value: CondicionPagoPersistible }
  | { ok: false; error: string };

/**
 * Valida y normaliza la condición de pago de una vigencia de hotel o de un
 * paquete/programa. `universo` decide el enum válido de `tipo` (distinto entre
 * hoteles y catálogo de producto — ver cabecera). Cuando el tipo no es
 * `anticipo_saldo`, fuerza `pct_inicial`/`dias_saldo` a NULL (nunca deja un
 * residuo de una condición anterior).
 */
export function validarCondicionPago(
  input: CondicionPagoEntrada,
  universo: "hotel" | "producto",
): ResultadoValidacion {
  const tipos = universo === "hotel" ? TIPOS_HOTEL : TIPOS_PRODUCTO;
  const tipo = typeof input.tipo === "string" ? input.tipo.trim() : "";
  if (!tipo || !tipos.has(tipo)) {
    return { ok: false, error: "Condición de pago inválida." };
  }

  if (tipo !== "anticipo_saldo") {
    return {
      ok: true,
      value: { condicion_pago_tipo: tipo, condicion_pago_pct_inicial: null, condicion_pago_dias_saldo: null },
    };
  }

  // OJO: Number("") === 0 en JS — un campo vacío NO es "0 días"/"0 %", debe
  // rechazarse explícitamente antes de convertir (mismo cuidado que `num()` en
  // programas/actions.ts).
  const pctVacio = input.pctInicial == null || (typeof input.pctInicial === "string" && input.pctInicial.trim() === "");
  const pctCrudo = pctVacio ? NaN : Number(input.pctInicial);
  if (!Number.isFinite(pctCrudo) || pctCrudo < 1 || pctCrudo > 99) {
    return { ok: false, error: "El porcentaje inicial del anticipo debe estar entre 1 % y 99 %." };
  }
  const diasVacio = input.diasSaldo == null || (typeof input.diasSaldo === "string" && input.diasSaldo.trim() === "");
  const diasCrudo = diasVacio ? NaN : Number(input.diasSaldo);
  if (!Number.isFinite(diasCrudo) || !Number.isInteger(diasCrudo) || diasCrudo < 0) {
    return { ok: false, error: "Los días para pagar el saldo deben ser un número entero mayor o igual a 0." };
  }

  return {
    ok: true,
    value: {
      condicion_pago_tipo: tipo,
      condicion_pago_pct_inicial: Math.round(pctCrudo) / 100,
      condicion_pago_dias_saldo: Math.trunc(diasCrudo),
    },
  };
}

/** 0–1 (BD) → 1–99 para mostrar en el formulario. null si no aplica. */
export function pctInicialParaFormulario(fraccion: number | null | undefined): string {
  if (fraccion == null || !Number.isFinite(Number(fraccion))) return "";
  return String(Math.round(Number(fraccion) * 100));
}

/**
 * Restricción comercial IMPLÍCITA de una vigencia de hotel — nunca se guarda
 * (no hay columna en `hotel_temporadas`), se DERIVA en el momento de leer la
 * vigencia para construir una componente condicionable (`ComponenteSnapshot`/
 * `VigenciaHotelCondicion`): cualquier condición distinta de `sin_condicion`
 * es automáticamente no reembolsable y no endosable.
 */
export function restriccionImplicitaHotel(condicionPagoTipo: string): RestriccionComercial {
  return condicionPagoTipo !== "sin_condicion" ? "no_reembolsable_no_endosable" : "normal";
}

// Únicos dos valores que aceptan los CHECK de `armado_paquetes`/`programas`.
const RESTRICCIONES_CATALOGO: ReadonlySet<string> = new Set([
  "normal",
  "promocional_no_reembolsable_no_endosable",
]);

/**
 * Valida la restricción comercial de un paquete o programa contra el CHECK
 * real de la migración 164 (`armado_paquetes_restriccion_check`/
 * `programas_restriccion_check`): solo `normal` o
 * `promocional_no_reembolsable_no_endosable`. `no_reembolsable_no_endosable`
 * NO es válido aquí (sí lo es en `cotizacion_condiciones`/`contrato_condiciones`,
 * que es un CHECK distinto) — devolver ese valor lo rechazaría Postgres.
 */
export function validarRestriccionComercialCatalogo(
  input: unknown,
): { ok: true; value: "normal" | "promocional_no_reembolsable_no_endosable" } | { ok: false; error: string } {
  const v = typeof input === "string" ? input.trim() : "";
  if (!RESTRICCIONES_CATALOGO.has(v)) {
    return { ok: false, error: "Restricción comercial inválida." };
  }
  return { ok: true, value: v as "normal" | "promocional_no_reembolsable_no_endosable" };
}
