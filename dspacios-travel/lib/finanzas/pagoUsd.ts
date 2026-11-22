// ─────────────────────────────────────────────────────────────────────────
// #126-A — Pagos a contratos en USD con TRM PROPIA de cada pago. Módulo PURO (sin I/O).
//
// El principal en USD del contrato es la autoridad. Cada pago en COP trae SU TRM explícita y acredita USD = COP / TRM
// (a centavos, igual que `abonos.valor_abono numeric(15,2)` y que `registrar_abono_base`); un pago nativo en USD acredita
// exactamente lo digitado y su TRM solo sirve para el equivalente en pesos del asiento contable. Lo realmente cobrado en COP
// es la suma de `monto_cop`; lo que falta por cobrar en USD solo admite una ESTIMACIÓN provisional en pesos, nunca un total final.
// ─────────────────────────────────────────────────────────────────────────

/** Tolerancia de saldo en USD (misma que `registrar_abono_base`: v_tol = 0.01). */
export const TOLERANCIA_USD = 0.01;
/** Una TRM es pesos por dólar (miles): por debajo de 100 es casi seguro un valor en dólares, un decimal mal escrito («4.1» por 4.100) o el campo equivocado. */
export const TRM_PAGO_MINIMA = 100;
export const TRM_PAGO_MAXIMA_EXCLUSIVA = 100_000_000_000;

export const MENSAJE_TRM_PAGO_REQUERIDA = "Indica la TRM de este pago (pesos por 1 USD). Cada pago usa su propia TRM.";
export const MENSAJE_TRM_PAGO_INVALIDA = "La TRM del pago debe ser pesos por dólar, por ejemplo 4.100 (no se admite menos de 100).";

export type ModoPagoUsd = "cop" | "usd";

export function centavos(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Valida la TRM de UN pago. Sin valor por defecto: vacío, 0, negativo, < 100, NaN o desmesurado se rechazan. */
export function validarTrmPago(trm: unknown): { ok: true; trm: number } | { ok: false; error: string } {
  if (trm == null || (typeof trm === "string" && trm.trim() === "")) return { ok: false, error: MENSAJE_TRM_PAGO_REQUERIDA };
  if (typeof trm === "boolean") return { ok: false, error: MENSAJE_TRM_PAGO_INVALIDA };
  // Texto con formato colombiano ("4.100" o "4.100,50"): el punto es de miles, no decimal; "4100.5"/"4100,5" siguen siendo decimales.
  const texto = typeof trm === "string" ? trm.trim() : null;
  const colombiano = texto != null && /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(texto);
  const n = typeof trm === "number" ? trm : Number(colombiano ? texto!.replace(/\./g, "").replace(",", ".") : String(trm).replace(",", "."));
  if (!Number.isFinite(n)) return { ok: false, error: MENSAJE_TRM_PAGO_INVALIDA };
  if (n === 0) return { ok: false, error: MENSAJE_TRM_PAGO_REQUERIDA };
  if (!(n >= TRM_PAGO_MINIMA) || n >= TRM_PAGO_MAXIMA_EXCLUSIVA) return { ok: false, error: MENSAJE_TRM_PAGO_INVALIDA };
  return { ok: true, trm: n };
}

/**
 * La TRM del pago YA normalizada (la misma que ve la vista previa), o `null` si no es válida. ÚNICA fuente para todo lo que sale de un formulario de pago:
 * vista previa, envío, confirmación de excedente, reintento y comparación de «¿cambió el formulario?». Nunca `Number(texto)`: «4.100» es 4100, no 4,1.
 */
export function trmNormalizada(trm: unknown): number | null {
  const t = validarTrmPago(trm);
  return t.ok ? t.trm : null;
}

/** USD que acredita un pago en COP con su TRM (a centavos). `null` si la TRM no es válida. */
export function usdAcreditadoDeCop(montoCop: number, trm: unknown): number | null {
  const t = validarTrmPago(trm);
  if (!t.ok || !Number.isFinite(montoCop) || !(montoCop > 0)) return null;
  return centavos(montoCop / t.trm);
}

/** Equivalente en pesos de un pago nativo en USD (para el asiento): USD × TRM a centavos. */
export function copDeUsdNativo(montoUsd: number, trm: unknown): number | null {
  const t = validarTrmPago(trm);
  if (!t.ok || !Number.isFinite(montoUsd) || !(montoUsd > 0)) return null;
  return centavos(montoUsd * t.trm);
}

/** `moneda_pago`: 'USD' = dólares recibidos (`monto_cop` es su equivalente CONTABLE a `trm`, no pesos recibidos); 'COP' o ausente = pesos recibidos (abonos previos incluidos). */
export type AbonoUsd = { valor_abono: number | string | null; monto_cop: number | string | null; moneda_pago?: string | null };
export const esDolaresRecibidos = (a: { moneda_pago?: string | null }): boolean => a.moneda_pago === "USD";

export type ResumenCobroUsd = {
  principal: number;
  /** USD realmente acreditados (suma de `valor_abono`). */
  abonado: number;
  /** USD que faltan (nunca negativo; 0 dentro de la tolerancia). */
  saldo: number;
  /** COP realmente RECIBIDOS: suma de `monto_cop` de los pagos en pesos. Es un hecho, no una estimación; NO incluye el equivalente de dólares recibidos. */
  cobradoCop: number;
  /** USD recibidos como dólares (pagos nativos en USD). */
  recibidoUsd: number;
  /** Equivalente CONTABLE en pesos de esos dólares (a la TRM de cada pago): va al libro, pero no es dinero recibido en pesos. */
  equivalenteContableCop: number;
  /** TRM efectiva de lo cobrado (COP cobrados / USD acreditados); null sin pagos. */
  trmPromedio: number | null;
  /** Estimación PROVISIONAL en pesos del saldo en USD (null si no hay TRM de referencia o no hay saldo). */
  estimadoSaldoCop: number | null;
  /** TRM usada para la estimación; null si no se estimó. */
  trmEstimacion: number | null;
  /** true solo cuando el saldo en USD es 0: entonces el total en pesos (recibido + equivalente contable) queda fijado. */
  definitivo: boolean;
  /** Total en pesos: definitivo = cobrado; si no, cobrado + estimación (provisional) o null sin estimación. */
  totalCop: number | null;
};

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;

/** Resumen de un contrato en USD: lo cobrado en pesos es hecho; lo pendiente solo se estima y se marca provisional. */
export function resumenCobroUsd(principalUsd: number, abonos: AbonoUsd[], trmReferencia?: number | null): ResumenCobroUsd {
  const principal = centavos(principalUsd);
  const abonado = centavos(abonos.reduce((s, a) => s + n(a.valor_abono), 0));
  const cobradoCop = centavos(abonos.filter((a) => !esDolaresRecibidos(a)).reduce((s, a) => s + n(a.monto_cop), 0));
  const recibidoUsd = centavos(abonos.filter(esDolaresRecibidos).reduce((s, a) => s + n(a.valor_abono), 0));
  const equivalenteContableCop = centavos(abonos.filter(esDolaresRecibidos).reduce((s, a) => s + n(a.monto_cop), 0));
  const totalContableCop = centavos(cobradoCop + equivalenteContableCop);
  const bruto = centavos(principal - abonado);
  const saldo = bruto <= TOLERANCIA_USD ? 0 : bruto;
  const definitivo = saldo === 0;
  const trmPromedio = abonado > 0 && totalContableCop > 0 ? totalContableCop / abonado : null;
  const ref = trmReferencia != null && Number.isFinite(trmReferencia) && trmReferencia > 1 ? trmReferencia : trmPromedio;
  const estimadoSaldoCop = !definitivo && ref != null ? centavos(saldo * ref) : null;
  return {
    principal, abonado, saldo, cobradoCop, recibidoUsd, equivalenteContableCop, trmPromedio,
    estimadoSaldoCop,
    trmEstimacion: estimadoSaldoCop != null ? ref : null,
    definitivo,
    totalCop: definitivo ? totalContableCop : estimadoSaldoCop != null ? centavos(totalContableCop + estimadoSaldoCop) : null,
  };
}

/** Vista previa del formulario: USD que acredita este pago y saldo resultante (misma regla que la base). */
export function previsualizarPagoUsd(a: {
  principalUsd: number; abonadoUsd: number; modo: ModoPagoUsd; monto: number; trm: unknown;
}): { usdAcreditado: number; copEquivalente: number; saldoDespues: number; excede: boolean } | { error: string } {
  const t = validarTrmPago(a.trm);
  if (!t.ok) return { error: t.error };
  if (!Number.isFinite(a.monto) || !(a.monto > 0)) return { error: "Indica un valor mayor a 0." };
  const usd = a.modo === "usd" ? centavos(a.monto) : centavos(a.monto / t.trm);
  const cop = a.modo === "usd" ? centavos(a.monto * t.trm) : centavos(a.monto);
  const saldoBruto = centavos(a.principalUsd - a.abonadoUsd - usd);
  return { usdAcreditado: usd, copEquivalente: cop, saldoDespues: Math.max(saldoBruto, 0), excede: saldoBruto < -TOLERANCIA_USD };
}
