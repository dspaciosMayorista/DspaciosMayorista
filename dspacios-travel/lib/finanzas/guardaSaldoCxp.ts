// Funciones PURAS de la guarda de saldo de cuentas por pagar (migración 228, #90 E5a).
// La guarda real vive en PostgreSQL (triggers); aquí solo se traducen sus errores a mensajes
// SIN importes y se calculan las cifras del pago a saldo exacto.

export type ErrorGuarda = { code?: string | null; message?: string | null } | null | undefined;

// Espejo de public.cxp_tolerancia(): la fuente de verdad es la base; esto solo sirve para tests/UI.
export function toleranciaCxp(moneda: string | null | undefined): number {
  const m = (moneda ?? "").trim().toUpperCase();
  return m === "COP" ? 10 : m === "USD" ? 0.1 : 0;
}

const redondear = (n: number, d: number) => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d;
export const redondear2 = (n: number) => redondear(n, 2);
export const redondear4 = (n: number) => redondear(n, 4);

/** Mensaje para el usuario ante un error de la guarda, o null si el error no es de la guarda. Nunca incluye importes. */
export function mensajeGuardaSaldo(error: ErrorGuarda, contexto: "pago" | "retencion" = "pago"): string | null {
  const code = error?.code ?? "";
  const msg = error?.message ?? "";
  switch (code) {
    case "Z9601":
      return contexto === "retencion"
        ? "La retención supera el saldo pendiente de la cuenta. Actualiza la página y revisa el saldo."
        : "El pago supera el saldo pendiente de la cuenta. Actualiza la página y revisa el saldo.";
    case "Z9602": return "No se puede cambiar la moneda de una cuenta que ya tiene pagos o retenciones.";
    case "Z9603": return "El valor total no puede quedar por debajo de lo ya pagado y retenido.";
    case "Z9604": return "El valor debe ser positivo.";
    case "Z9605": return "Un pago o retención no se puede mover a otra cuenta.";
    case "Z9606": return "La cuenta por pagar no está disponible.";
    case "Z9607": return "No se pudo validar el saldo de forma segura en esta operación. Intenta de nuevo.";
  }
  if (code === "42501" && /row-level security/i.test(msg)) {
    return "No tienes permiso para registrar movimientos sobre esa cuenta por pagar.";
  }
  return null;
}

/** Saldo nominal pendiente en la moneda de la CxP (nunca negativo). */
export function saldoNominalCxp(valorTotal: number, pagado: number, retenido: number): number {
  return Math.max(redondear2((Number(valorTotal) || 0) - (Number(pagado) || 0) - (Number(retenido) || 0)), 0);
}

/** S4 (1): COP máximo pagable a una TRM, para que el usuario no digite más de lo que la obligación admite. */
export function copMaximoPagable(saldoNominal: number, trm: number): number | null {
  if (!(trm > 0) || !(saldoNominal > 0)) return null;
  return Math.floor(saldoNominal * trm);
}

/**
 * S4 (2) / C2: "Pagar saldo exacto". El usuario digita el COP REAL pagado; el nominal es el saldo exacto
 * y la TRM efectiva = COP / nominal a 4 decimales. El asiento de pago usa ese COP real.
 */
export function pagoSaldoExacto(saldoNominal: number, copPagado: number):
  | { ok: true; nominal: number; trm: number; cop: number }
  | { ok: false; error: string } {
  const nominal = redondear2(saldoNominal);
  if (!(nominal > 0)) return { ok: false, error: "La cuenta no tiene saldo pendiente." };
  const cop = Number(copPagado);
  if (!Number.isFinite(cop) || !(cop > 0)) return { ok: false, error: "Indica el valor pagado en COP." };
  const trm = redondear4(cop / nominal);
  if (!(trm > 0)) return { ok: false, error: "El valor pagado es demasiado pequeño para el saldo." };
  return { ok: true, nominal, trm, cop: redondear2(cop) };
}

/** Id de la CxP en una referencia "saldo-cxp:N" de Conciliaciones, o null si la referencia es de otro tipo. */
export function idSaldoCxp(ref: string): number | null {
  const m = /^saldo-cxp:(\d+)$/.exec(ref);
  return m ? Number(m[1]) : null;
}

/**
 * S5: las referencias "saldo-cxp:N" se procesan en orden ASCENDENTE de id (las demás van al final, en su orden
 * original) para que dos conciliaciones concurrentes tomen los bloqueos de la guarda en el mismo orden.
 */
export function ordenarPorSaldoCxp<T extends { ref: string }>(items: readonly T[]): T[] {
  return items
    .map((item, i) => ({ item, i, id: idSaldoCxp(item.ref) }))
    .sort((a, b) => (a.id ?? Infinity) - (b.id ?? Infinity) || a.i - b.i)
    .map((x) => x.item);
}
