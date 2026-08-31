// ─────────────────────────────────────────────────────────────────────────
// Calculadora de precios de PROGRAMAS (terceros que dan tarifa comisionable)
//
// Algunos proveedores no entregan el neto: dan una TARIFA y una regla para
// sacar la base comisionable. La comisión es nuestra ganancia, así que el
// NETO (lo que le pagamos al proveedor = lo que montamos) = Tarifa − comisión.
//
//   base_comisionable =
//     · 'pct'      → Tarifa × (1 − pct/100)     (ej. Tarifa − 3%)
//     · 'impuesto' → Tarifa − impuesto (monto)  (ej. Tarifa − impuestos)
//     · 'ninguno'  → Tarifa                     (no se resta nada)
//   comision = base_comisionable × (pct_comision/100)
//   neto     = Tarifa − comision   ← lo que se monta (luego: MK + asistencia + fee)
// ─────────────────────────────────────────────────────────────────────────

export type ModoBaseComisionable = "pct" | "impuesto" | "ninguno";

export type CalcProgramaInput = {
  tarifa: number;
  modo: ModoBaseComisionable;
  valor: number;          // pct (modo 'pct') o monto del impuesto (modo 'impuesto')
  pctComision: number;    // % de comisión sobre la base
};

export type CalcProgramaResult = {
  baseComisionable: number;
  comision: number;
  neto: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calcularNetoPrograma(input: CalcProgramaInput): CalcProgramaResult {
  const tarifa = Number(input.tarifa) || 0;
  const valor = Number(input.valor) || 0;
  const pctCom = Number(input.pctComision) || 0;

  let base = tarifa;
  if (input.modo === "pct") base = tarifa * (1 - valor / 100);
  else if (input.modo === "impuesto") base = tarifa - valor;
  // 'ninguno' → base = tarifa

  const comision = base * (pctCom / 100);
  const neto = tarifa - comision;
  return { baseComisionable: r2(base), comision: r2(comision), neto: r2(neto) };
}

// ─────────────────────────────────────────────────────────────────────────
// Recalcular los netos de UNA salida cuando cambia la regla (modo/valor/%
// comisión), no la tarifa. Usa `calcularNetoPrograma` (sin tocarla) por cada
// acomodación por separado — nunca cruza el valor de una acomodación con
// otra. Una acomodación sin tarifa del proveedor (null/vacía/<=0) no se
// toca: su neto puede venir de una carga manual y no hay nada que recalcular.
// ─────────────────────────────────────────────────────────────────────────

export type TarifasProveedorSalida = {
  sencilla: number | null;
  doble: number | null;
  triple: number | null;
  multiple: number | null;
};

export type NetosRecalculados = {
  sencilla: number | null;
  doble: number | null;
  triple: number | null;
  multiple: number | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Modalidad de MK (migración 161) — el dueño pidió una SEGUNDA forma de
// aplicar el markup del programa (`pct_mk`) sobre lo que sale de la
// calculadora de arriba:
//
//   'historica'                    (default, SIN CAMBIOS de comportamiento):
//     Venta = (base_neta + montoNoComisionable) / divisorMK
//           = neto / divisorMK               ← neto YA incluye ambos, como
//                                                siempre calculó `calcularNetoPrograma`.
//   'base_neta_impuestos_al_final' (nueva):
//     Venta = (base_neta / divisorMK) + montoNoComisionable
//           ← el MK NUNCA se aplica sobre `montoNoComisionable` (el monto que
//             la regla resta de la tarifa para llegar a la base comisionable
//             — "impuestos" en el modo 'impuesto', o el equivalente en pesos
//             del % restado en modo 'pct'; 0 en modo 'ninguno'). Se suma
//             DESPUÉS de dividir por el MK, antes del fee bancario (ver
//             `pvpPrograma`, lib/programas.ts — el fee SÍ sigue aplicando
//             sobre el total: es un costo de procesamiento de pago
//             proporcional al precio final, no al costo interno).
//
// `netoParaMarkup`/`montoSinMarkup` son los dos números que de verdad
// consume `pvpPrograma()` — separar la decisión de "qué modalidad" de "cómo
// se marca" en un solo lugar es lo que permite que el editor en vivo, la
// validación (cliente y servidor) y la generación real del tarifario usen
// SIEMPRE la misma función, nunca una fórmula reescrita en cada sitio.
// ─────────────────────────────────────────────────────────────────────────

export type ModalidadMk = "historica" | "base_neta_impuestos_al_final";

export const MODALIDADES_MK: readonly ModalidadMk[] = ["historica", "base_neta_impuestos_al_final"];

export function esModalidadMkValida(v: unknown): v is ModalidadMk {
  return v === "historica" || v === "base_neta_impuestos_al_final";
}

export type CalcProgramaConModalidadResult = CalcProgramaResult & {
  /** baseComisionable − comision. El "costo real" del proveedor después de la comisión. */
  baseNeta: number;
  /**
   * Tarifa − baseComisionable (= neto − baseNeta). El monto que la regla NO
   * considera comisionable — "impuestos" en el modo del mismo nombre,
   * generalizado a los 3 modos (siempre ≥ 0, por construcción: `valor`≥0 en
   * modo 'impuesto', `valor` en [0,100] en modo 'pct' sobre una `tarifa`≥0,
   * y 0 en modo 'ninguno' — ver `validarReglaComisionable`/los CHECK de la
   * migración 151, que ya garantizan estos rangos).
   */
  montoNoComisionable: number;
  /** Lo que `pvpPrograma` debe marcar con MK/fee (1er argumento). */
  netoParaMarkup: number;
  /** Lo que `pvpPrograma` debe sumar DESPUÉS del MK, antes del fee (3er argumento). 0 en modalidad histórica. */
  montoSinMarkup: number;
};

/**
 * Única función que decide, según la modalidad, cómo repartir el resultado
 * de `calcularNetoPrograma()` entre "lo que se marca con MK" y "lo que se
 * suma sin marcar". NUNCA duplica la fórmula de arriba — siempre parte de
 * `calcularNetoPrograma(input)` y solo reacomoda sus 3 salidas.
 */
export function calcularNetoProgramaConModalidad(
  input: CalcProgramaInput,
  modalidadMk: ModalidadMk
): CalcProgramaConModalidadResult {
  const base = calcularNetoPrograma(input);
  const baseNeta = r2(base.baseComisionable - base.comision);
  const montoNoComisionable = r2(base.neto - baseNeta);
  const esNueva = modalidadMk === "base_neta_impuestos_al_final";
  return {
    ...base,
    baseNeta,
    montoNoComisionable,
    netoParaMarkup: esNueva ? baseNeta : base.neto,
    montoSinMarkup: esNueva ? montoNoComisionable : 0,
  };
}

export function recalcularNetosPorTarifa(
  tarifas: TarifasProveedorSalida,
  regla: { modo: ModoBaseComisionable; valor: number; pctComision: number }
): NetosRecalculados {
  const calc = (tarifa: number | null): number | null => {
    if (tarifa == null || !Number.isFinite(tarifa) || tarifa <= 0) return null;
    return calcularNetoPrograma({ tarifa, modo: regla.modo, valor: regla.valor, pctComision: regla.pctComision }).neto;
  };
  return {
    sencilla: calc(tarifas.sencilla),
    doble: calc(tarifas.doble),
    triple: calc(tarifas.triple),
    multiple: calc(tarifas.multiple),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Validación de la regla comisionable — MISMA función en el navegador (para
// no recalcular con 0 mientras el usuario escribe) y en la Server Action
// (para no depender solo del navegador). Antes, un campo vacío se convertía
// con `Number(cValor) || 0` — un cero SILENCIOSO que ya recalculaba los
// netos en pantalla, mientras el payload guardado mandaba `null`. Al volver
// a entrar, `null` se mostraba como el default "3"/"10", distinto del cero
// que se había usado para calcular — la regla mostrada y la usada divergían.
//
// Reglas (solo cuando `activa` es true — inactiva no tiene restricciones,
// los valores solo se conservan tal cual para poder reactivar sin perder
// nada):
//   · pctComision: siempre obligatorio, número finito en [0, 100].
//   · valor:
//       - modo 'pct'      → obligatorio, número finito en [0, 100].
//       - modo 'impuesto' → obligatorio, número finito ≥ 0 (sin tope: es un
//         monto en la moneda del programa, no un porcentaje).
//       - modo 'ninguno'  → no participa en el cálculo, no se valida (puede
//         traer cualquier valor previo, sirve para volver al modo anterior).
// ─────────────────────────────────────────────────────────────────────────

export type ReglaComisionableEstado = {
  activa: boolean;
  modo: ModoBaseComisionable;
  valor: number | null;
  pctComision: number | null;
  // Migración 161 — igual criterio que `modo`: se valida INCONDICIONALMENTE
  // (mismo CHECK de Postgres, que no mira `regla_comisionable`), nunca solo
  // cuando la regla está activa.
  modalidadMk: ModalidadMk;
};

export type ValidacionRegla = { ok: true } | { ok: false; error: string };

const enRango = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;

export function validarReglaComisionable(regla: ReglaComisionableEstado): ValidacionRegla {
  if (!esModalidadMkValida(regla.modalidadMk)) {
    return { ok: false, error: "La modalidad de MK no es válida." };
  }
  if (!regla.activa) return { ok: true };

  if (regla.pctComision == null || !enRango(regla.pctComision, 0, 100)) {
    return { ok: false, error: "El % de comisión debe ser un número entre 0 y 100." };
  }

  if (regla.modo === "pct") {
    if (regla.valor == null || !enRango(regla.valor, 0, 100)) {
      return { ok: false, error: "El % a restar debe ser un número entre 0 y 100." };
    }
  } else if (regla.modo === "impuesto") {
    if (regla.valor == null || !Number.isFinite(regla.valor) || regla.valor < 0) {
      return { ok: false, error: "El impuesto debe ser un número mayor o igual a 0." };
    }
  }
  // modo 'ninguno': valor no participa, no se valida.

  return { ok: true };
}

// "" / espacios / no numérico → null (nunca 0 por defecto). Mismo criterio
// que `num()` en actions.ts, expuesto aquí para que el navegador y el
// servidor partan SIEMPRE del mismo número (o de la misma ausencia de él).
export function parseNumOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
