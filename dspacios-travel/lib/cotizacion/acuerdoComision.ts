// #97 — Acuerdo de comisión del aliado en la cotización dinámica B2B: reglas PURAS (sin I/O). Espejo de `p97_priv.importes` (migración 286).
//
// Regla de negocio (confirmada por el dueño):
//   base        = total − BNC − (participaciónAliadoEnRecobro > 0 ? recobroTotal : 0)
//   totalAliado = comisiónOrdinaria(base, %) + participaciónAliadoEnRecobro
// El recobro sale de la base SOLO cuando el aliado recibe algo de él; la condición se evalúa sobre el IMPORTE MONETARIO FINAL
// que le corresponde (ya redondeado), no sobre el porcentaje: un 0,4 % de 100 = 0,4 → 0 pesos → el recobro permanece en la base.

export type ParticipacionRecobro = { modo: "valor"; valor: number } | { modo: "pct"; pct: number };

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Redondeo a la unidad de moneda, mitades hacia arriba (igual que `round()` de Postgres con importes ≥ 0). */
export const redondear = (x: number): number => Math.round(Number(x.toFixed(6)));

/** Importe monetario que se le paga al aliado del recobro: por valor o por porcentaje (fracción 0–1), acotado a [0, recobro]. */
export function participacionAliado(recobroTotal: number, p: ParticipacionRecobro): number {
  const rec = Math.max(n(recobroTotal), 0);
  const bruto = p.modo === "valor" ? n(p.valor) : rec * Math.min(Math.max(n(p.pct), 0), 1);
  return Math.min(Math.max(redondear(bruto), 0), rec);
}

export type EntradaAcuerdo = { total: number; bnc: number; recobroTotal: number; participacion: number; pct: number };
export type ResultadoAcuerdo = { base: number; ordinaria: number; participacion: number; totalAliado: number; excluyeRecobro: boolean };

export function acuerdoComision(e: EntradaAcuerdo): ResultadoAcuerdo {
  const recobro = Math.max(n(e.recobroTotal), 0);
  const participacion = Math.min(Math.max(n(e.participacion), 0), recobro);
  const excluyeRecobro = participacion > 0;
  const base = Math.max(n(e.total) - n(e.bnc) - (excluyeRecobro ? recobro : 0), 0);
  const ordinaria = redondear(base * n(e.pct));
  return { base, ordinaria, participacion, totalAliado: ordinaria + participacion, excluyeRecobro };
}

/** BNC explícita: vacío / ausente / no numérico ≠ 0. El 0 hay que escribirlo. Debe estar entre 0 y el total. */
export function validarBnc(crudo: unknown, total: number): { ok: true; bnc: number } | { ok: false; error: string } {
  if (crudo === null || crudo === undefined || (typeof crudo === "string" && crudo.trim() === "")) {
    return { ok: false, error: "Indica la base no comisionable (BNC). Escribe 0 si no hay." };
  }
  const v = typeof crudo === "number" ? crudo : Number(String(crudo).trim());
  if (!Number.isFinite(v) || v < 0) return { ok: false, error: "La base no comisionable debe ser un número mayor o igual a 0." };
  if (v > total) return { ok: false, error: "La base no comisionable no puede superar el total de la cotización." };
  return { ok: true, bnc: v };
}
