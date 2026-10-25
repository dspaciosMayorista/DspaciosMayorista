// ─────────────────────────────────────────────────────────────────────────
// #90 Entrega F — MONEDA DE COBRO del contrato (migración 235). Módulo PURO (sin I/O).
//
// Un contrato tiene DOS monedas distintas y nunca se confunden:
//   · la de la OFERTA (`ventas.moneda`, `ventas.precio_venta`): lo que se publicó, cotizó y de lo que salen los costos y las CxP;
//   · la de COBRO (`ventas.moneda_cobro`): en la que se le cobra al cliente y se llevan abonos y saldo.
// Casi siempre son la misma. Si quien convierte la cotización elige la otra, el total a cobrar se convierte UNA sola vez con la TRM de
// cobro que ingresa (congelada en `trm_cobro`/`total_cobro`); la oferta conserva su moneda e importes y no se reconvierte nada.
// Un contrato sin elección (`moneda_cobro` NULL: anterior a la 235 o fuera del modo #63) se cobra en su moneda de siempre.
// ─────────────────────────────────────────────────────────────────────────

export type MonedaCobro = "COP" | "USD";

/** Tope exclusivo de una TRM (mismo que la base: CHECK de armado_paquetes y guardas de las RPC #63). */
export const TRM_COBRO_MAXIMA = 100000000000;

export const MENSAJE_TRM_COBRO_REQUERIDA = "Cobrar en una moneda distinta de la de la oferta exige la TRM de cobro (pesos por dólar).";
export const MENSAJE_TRM_COBRO_INVALIDA = "La TRM de cobro debe ser un número positivo (pesos por dólar).";
export const MENSAJE_COBRO_SOLO_INTERNO = "Solo el personal interno puede elegir una moneda de cobro distinta de la de la oferta.";
export const MENSAJE_COBRO_INVALIDO = "La moneda de cobro debe ser COP o USD.";
export const MENSAJE_COBRO_REQUERIDO = "Elige la moneda de cobro (COP o USD) antes de generar el contrato.";

function moneda(v: unknown): MonedaCobro {
  return String(v ?? "COP").toUpperCase() === "USD" ? "USD" : "COP";
}

/** Redondeo a centavos sin el error de coma flotante de `x*100` (misma técnica que `redondearCentavos63`). */
function centavos(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Total a cobrar cuando la moneda de cobro difiere de la de la oferta. ESPEJO de `p63_total_cobro` (base de datos, autoritativa):
 * USD→COP = base × TRM con COP al mil hacia arriba; COP→USD = base / TRM con USD al dólar hacia arriba; a centavos antes de redondear.
 * `null` si no hay conversión (misma moneda) o falta una TRM válida. Sirve para MOSTRAR la vista previa; lo que se cobra lo congela la base.
 */
export function totalCobroConvertido(base: number, monedaOferta: unknown, monedaCobro: unknown, trm: number | null | undefined): number | null {
  const o = moneda(monedaOferta);
  const c = moneda(monedaCobro);
  if (o === c) return null;
  if (!Number.isFinite(base) || trm == null || !Number.isFinite(trm) || !(trm > 0)) return null;
  if (c === "COP") return Math.ceil(centavos(base * trm) / 1000) * 1000;
  return Math.ceil(centavos(base / trm));
}

/**
 * Valida la elección de quien convierte una oferta #63 NUEVA. La elección es OBLIGATORIA y EXPRESA: sin moneda se rechaza (no hay valor por defecto).
 * Elegir la misma moneda de la oferta es válido y queda registrado (sin conversión y sin TRM de cobro); la otra exige personal interno y TRM.
 */
export function validarEleccionCobro(a: {
  monedaOferta: unknown;
  monedaCobro: unknown;
  trmCobro: unknown;
  esInterno: boolean;
}): { ok: true; monedaCobro: MonedaCobro; trmCobro: number | null } | { ok: false; error: string } {
  const vacia = a.monedaCobro == null || (typeof a.monedaCobro === "string" && a.monedaCobro.trim() === "");
  const trmVacia = a.trmCobro == null || (typeof a.trmCobro === "string" && a.trmCobro.trim() === "");
  if (vacia) {
    // Una TRM sin moneda es ambigua: no se adivina. Y sin moneda no hay contrato: la elección no tiene valor por defecto.
    if (!trmVacia) return { ok: false, error: MENSAJE_COBRO_INVALIDO };
    return { ok: false, error: MENSAJE_COBRO_REQUERIDO };
  }
  const m = String(a.monedaCobro).trim().toUpperCase();
  if (m !== "COP" && m !== "USD") return { ok: false, error: MENSAJE_COBRO_INVALIDO };
  const elegida = m as MonedaCobro;
  if (elegida === moneda(a.monedaOferta)) {
    // Misma moneda: nunca lleva TRM (no se convierte dos veces ni se arrastra una tasa que no se usa).
    return { ok: true, monedaCobro: elegida, trmCobro: null };
  }
  if (!a.esInterno) return { ok: false, error: MENSAJE_COBRO_SOLO_INTERNO };
  if (trmVacia) return { ok: false, error: MENSAJE_TRM_COBRO_REQUERIDA };
  if (typeof a.trmCobro === "boolean") return { ok: false, error: MENSAJE_TRM_COBRO_INVALIDA };
  const n = typeof a.trmCobro === "number" ? a.trmCobro : Number(String(a.trmCobro).replace(",", "."));
  // Mismo rango que la base (numeric(15,4): finita, > 0 tras redondear a 4 decimales y < 1e11).
  if (!Number.isFinite(n) || Math.round(n * 10000) <= 0 || n >= TRM_COBRO_MAXIMA) return { ok: false, error: MENSAJE_TRM_COBRO_INVALIDA };
  return { ok: true, monedaCobro: elegida, trmCobro: n };
}

export type VentaCobro = {
  moneda?: string | null;
  precio_venta?: number | string | null;
  moneda_cobro?: string | null;
  trm_cobro?: number | string | null;
  total_cobro?: number | string | null;
};

export type CobroContrato = {
  /** Moneda en la que se cobra, se llevan los abonos y se calcula el saldo. */
  moneda: MonedaCobro;
  /** Total a cobrar en `moneda`: el convertido y congelado, o el precio de venta si no hay conversión. */
  total: number;
  /** ¿Se cobra en una moneda distinta de la de la oferta (conversión congelada)? */
  convertido: boolean;
  /** TRM de cobro congelada (solo si `convertido`). */
  trm: number | null;
  /** Moneda e importe de la OFERTA (ventas.moneda / ventas.precio_venta), que no cambian. */
  monedaOferta: MonedaCobro;
  precioOferta: number;
};

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Cómo se cobra un contrato. Es el ÚNICO lugar que decide la moneda y el total de abonos, saldos y documentos:
 *   · sin elección (columnas NULL) o con la misma moneda que la oferta → moneda y precio de siempre;
 *   · con conversión → la moneda de cobro y el `total_cobro` congelado. Si la fila trae una moneda de cobro distinta sin total ni TRM
 *     (la base lo impide con ventas_cobro_chk) NO se inventa un importe: se cobra en la moneda de la oferta.
 */
export function cobroDeVenta(v: VentaCobro | null | undefined): CobroContrato {
  const monedaOferta = moneda(v?.moneda);
  const precioOferta = num(v?.precio_venta);
  const mc = v?.moneda_cobro == null ? null : moneda(v.moneda_cobro);
  const total = num(v?.total_cobro);
  const trm = num(v?.trm_cobro);
  if (mc && mc !== monedaOferta && total > 0 && trm > 0) {
    return { moneda: mc, total, convertido: true, trm, monedaOferta, precioOferta };
  }
  return { moneda: monedaOferta, total: precioOferta, convertido: false, trm: null, monedaOferta, precioOferta };
}
