// ─────────────────────────────────────────────────────────────────────────
// #90 I — TRM de COSTOS de la conversión de un carrito. Módulo PURO (sin I/O).
//
// Una conversión de carrito en USD puede deber a sus proveedores en USD. Esas obligaciones (CxP) conservan su valor y moneda ORIGINALES y llevan,
// además, su equivalente en COP congelado a UNA tasa — la TRM de costos — para que el libro en pesos devengue el costo por su importe real y no por
// el nominal en dólares. Esa tasa:
//   · es DISTINTA de la TRM de cobro (`ventas.trm_cobro`, 235), que solo convierte el total a cobrar al cliente: dos tasas, dos propósitos, nunca se mezclan;
//   · la ingresa el personal interno al convertir (no se infiere del parámetro de referencia: sin tasa ingresada no hay contrato);
//   · queda congelada en `cotizaciones.detalle.costo` desde el primer contrato (un reintento no la cambia) y en cada CxP (`trm_costo`, migración 236);
//   · solo se pide si alguna obligación positiva está en USD (en una oferta COP o sin costos en dólares no existe ni se guarda).
// ─────────────────────────────────────────────────────────────────────────

/** Tope exclusivo de una TRM (el mismo que la TRM de cobro y que numeric(15,4)). */
export const TRM_COSTO_MAXIMA = 100000000000;

export const MENSAJE_TRM_COSTO_REQUERIDA =
  "Esta conversión tiene costos con proveedores en USD: ingresa la TRM de costos (pesos por dólar) para congelar su equivalente en pesos. Es distinta de la TRM de cobro.";
export const MENSAJE_TRM_COSTO_INVALIDA = "La TRM de costos debe ser un número positivo y finito (pesos por dólar).";
export const MENSAJE_TRM_COSTO_SOLO_INTERNO = "Solo el personal interno puede ingresar la TRM de costos de una conversión con proveedores en USD.";
export const MENSAJE_TRM_COSTO_CAMBIO =
  "La TRM de costos de esta conversión ya quedó congelada con el primer contrato y no se cambia. Reintenta con la misma TRM o, si necesitas otra, genera una cotización nueva.";

const cuatroDecimales = (n: number) => Math.round(n * 10000) / 10000;

/** Valida la TRM recibida del navegador (número o texto, coma decimal admitida) con el mismo rango que la base. */
export function validarTrmCosto(v: unknown): { ok: true; trm: number } | { ok: false; error: string } {
  if (v == null || typeof v === "boolean" || (typeof v === "string" && v.trim() === "")) return { ok: false, error: MENSAJE_TRM_COSTO_REQUERIDA };
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || Math.round(n * 10000) <= 0 || n >= TRM_COSTO_MAXIMA) return { ok: false, error: MENSAJE_TRM_COSTO_INVALIDA };
  return { ok: true, trm: cuatroDecimales(n) };
}

/** Equivalente en COP de un valor en USD a la TRM de costos, a centavos (numeric(15,2)), sin el error de coma flotante de `x*100`. */
export function equivalenteCopCosto(valorUsd: number, trm: number): number {
  const n = Math.max(0, Number(valorUsd) || 0) * trm;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100 + 1e-9) / 100;
}

/** TRM de costos ya congelada en `cotizaciones.detalle.costo`, sin confiar en su forma. `null` = nunca se congeló una. */
export function leerTrmCostoCongelada(detalle: unknown): number | null {
  const c = ((detalle ?? null) as { costo?: unknown } | null)?.costo as { trm?: unknown } | null | undefined;
  if (!c || typeof c !== "object") return null;
  const n = c.trm == null ? NaN : Number(c.trm);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Decide la TRM de costos de la conversión. Sin obligaciones en USD no hay TRM (se conserva la ya congelada, si la hay, para no perderla del detalle).
 * Con ellas: solo personal interno; la TRM es obligatoria y válida; y si ya hay una congelada, la recibida debe coincidir a 4 decimales.
 */
export function decidirTrmCosto(a: {
  requiere: boolean; recibida: unknown; esInterno: boolean; congelada: number | null;
}): { ok: true; trm: number | null } | { ok: false; error: string } {
  if (!a.requiere) return { ok: true, trm: a.congelada };
  if (!a.esInterno) return { ok: false, error: MENSAJE_TRM_COSTO_SOLO_INTERNO };
  const v = validarTrmCosto(a.recibida);
  if (!v.ok) return v;
  if (a.congelada != null && cuatroDecimales(a.congelada) !== v.trm) return { ok: false, error: MENSAJE_TRM_COSTO_CAMBIO };
  return { ok: true, trm: v.trm };
}

/**
 * Un reintento NUNCA cambia la TRM de costos ya congelada, aunque el grupo pendiente no genere CxP en USD o la cotización ya esté convertida entera.
 * Sin TRM congelada o sin TRM recibida no hay nada que comparar; una recibida inválida o distinta (a 4 decimales) se rechaza. La misma es idempotente.
 */
export function compararTrmCostoConCongelada(a: { congelada: number | null; recibida: unknown }): { ok: true } | { ok: false; error: string } {
  if (a.congelada == null) return { ok: true };
  const r = a.recibida;
  if (r == null || (typeof r === "string" && r.trim() === "")) return { ok: true };
  const v = validarTrmCosto(r);
  if (!v.ok) return v;
  return cuatroDecimales(a.congelada) === v.trm ? { ok: true } : { ok: false, error: MENSAJE_TRM_COSTO_CAMBIO };
}
