// ─────────────────────────────────────────────────────────────────────────
// #63 — importe en COP de una obligación (CxP) del modo `cop_trm_63`.
//
// En ese modo el contrato se vende en COP pero hotel y servicios pueden deberse
// en USD (la CxP conserva SU moneda de origen y su valor original). Para el
// libro contable, la cobertura de costos y los reportes en COP, cada obligación
// lleva su equivalente en COP CONGELADO a la TRM del paquete (`valor_cop_63`,
// `trm_63`): la contabilidad nunca registra el nominal USD como si fueran pesos
// ni reconvierte con otra TRM. Módulo PURO (sin I/O).
// ─────────────────────────────────────────────────────────────────────────

import { aCop63, aMoneda63, monedaNormalizada63, redondearCentavos63, validarTrm63 } from "./ofertaDinamica63.ts";

/** Equivalente en COP de un valor en `moneda`, a la TRM del paquete, con centavos. */
export function equivalenteCop63(valor: number, moneda: unknown, trm: number | null): number {
  return redondearCentavos63(aCop63(Math.max(0, Number(valor) || 0), moneda, trm));
}

/**
 * Valor de ORIGEN expresado en la moneda de la OFERTA (la de publicación/contrato: COP o USD), con centavos. Misma moneda → exacto,
 * sin TRM; USD→COP × TRM; COP→USD / TRM. Es la cifra de las columnas `ventas.costo_*` del contrato.
 */
export function equivalenteOferta63(valor: number, origen: unknown, monedaOferta: unknown, trm: number | null): number {
  return redondearCentavos63(aMoneda63(Math.max(0, Number(valor) || 0), origen, monedaOferta, trm));
}

/** Valida que una obligación del modo 63 traiga TRM y equivalente coherentes (fail-closed antes de escribir). */
export function validarObligacion63(o: { moneda?: string | null; valor_total: number; valor_cop?: number | null; trm?: number | null }): { ok: true } | { ok: false; error: string } {
  // #93: una obligación en COP de una oferta SIN TRM (todo COP) es válida sin TRM; una en USD siempre la exige.
  const sinTrm = o.trm == null && monedaNormalizada63(o.moneda) !== "USD";
  const t = sinTrm ? { ok: true as const, trm: null } : validarTrm63(o.trm);
  if (!t.ok) return { ok: false, error: t.error };
  if (o.valor_cop == null || !Number.isFinite(o.valor_cop) || o.valor_cop < 0) return { ok: false, error: "La obligación no trae su equivalente en COP." };
  const esperado = equivalenteCop63(o.valor_total, o.moneda, t.trm);
  if (Math.abs(esperado - o.valor_cop) > 0.01) return { ok: false, error: "El equivalente en COP de la obligación no coincide con la TRM del paquete." };
  return { ok: true };
}

// ── Importe CONTABLE de una CxP (fail-closed) ───────────────────────────────

/** Columnas de `cuentas_por_pagar` que decide el importe contable de una obligación. */
export type FilaCxP63 = {
  numero_contrato?: string | null;
  tenant?: string | null;
  aceptacion_63_id?: number | string | null;
  obligacion_63?: string | null;
  valor_cop_63?: number | string | null;
  trm_63?: number | string | null;
  /** #93: moneda de origen de la obligación; sin TRM solo es válida si es COP. */
  moneda?: string | null;
};

export const MENSAJE_LECTURA_CXP_63 =
  "No se pudo leer la obligación para contabilizarla; no se registra el asiento con el valor nominal. Se reintenta desde la reconciliación.";

/**
 * Resuelve el importe en COP con el que se devenga el asiento de una CxP. Es el ÚNICO punto que decide:
 *   · obligación de siempre (sin marca #63 ni equivalente) → su `valorTotal` de siempre;
 *   · obligación aceptada (marca + equivalente COP + TRM, del mismo contrato/agencia) → su equivalente en COP congelado;
 *   · cualquier otra cosa (fila inexistente, marca sin equivalente, equivalente sin marca, otro contrato) → ERROR: jamás
 *     se cae al nominal (un USD 210 nunca se registra como $210). Un error de LECTURA tampoco es "no es #63".
 */
export function resolverImporteContable63(
  fila: FilaCxP63 | null | undefined,
  ctx: { numeroContrato: string; tenant?: string | null; valorTotal: number }
): { ok: true; importe: number } | { ok: false; error: string } {
  if (!fila) return { ok: false, error: "No se encontró la obligación para contabilizarla; no se registra el asiento." };
  const marcada = fila.aceptacion_63_id != null || (fila.obligacion_63 != null && String(fila.obligacion_63) !== "");
  const conEquivalente = fila.valor_cop_63 != null || fila.trm_63 != null;
  if (!marcada && !conEquivalente) return { ok: true, importe: ctx.valorTotal };
  // #93: una obligación COP de una oferta aceptada SIN TRM lleva su equivalente (igual a su valor) y no tiene TRM.
  const sinTrmCop = marcada && fila.trm_63 == null && fila.valor_cop_63 != null && fila.moneda === "COP" && Number(fila.valor_cop_63) === Number(ctx.valorTotal);
  if (!marcada || fila.valor_cop_63 == null || (fila.trm_63 == null && !sinTrmCop)) {
    return { ok: false, error: "La obligación de la oferta aceptada no trae su marca o su equivalente en COP completos; no se registra el asiento." };
  }
  if (fila.numero_contrato != null && fila.numero_contrato !== ctx.numeroContrato) {
    return { ok: false, error: "La obligación pertenece a otro contrato; no se registra el asiento." };
  }
  if (ctx.tenant != null && fila.tenant != null && fila.tenant !== ctx.tenant) {
    return { ok: false, error: "La obligación pertenece a otra agencia; no se registra el asiento." };
  }
  const cop = Number(fila.valor_cop_63);
  const trm = fila.trm_63 == null ? null : Number(fila.trm_63);
  if (!Number.isFinite(cop) || cop < 0 || (trm !== null && (!Number.isFinite(trm) || trm <= 0))) {
    return { ok: false, error: "El equivalente en COP de la obligación aceptada es inválido; no se registra el asiento." };
  }
  return { ok: true, importe: cop };
}
