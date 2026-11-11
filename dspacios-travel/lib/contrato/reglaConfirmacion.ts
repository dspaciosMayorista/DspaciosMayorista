// Regla ÚNICA del mínimo para CONFIRMAR un contrato por pago (#75, Parte 3). Espejo PURO de `p75_priv.regla_confirmacion` / `estado_minimo` (migración 288): la pantalla, el
// documento y la confirmación por abono leen la MISMA regla; la base es la autoridad y esta función existe para PRESENTAR exactamente lo que la base va a exigir.
//
//  · neto_total           NETO aliado (comision_estado = 'descontada'): TOTAL NETO exigible (100 % de precio_venta) en la moneda de cobro.
//  · condicion_congelada  contrato con condiciones congeladas: Σ monto_exigido, en la moneda y con la TRM CONGELADAS de esas condiciones.
//  · legacy_pct           SOLO contratos históricos sin condiciones: % de config_cobros (30 % por defecto). Nunca para NETO ni para contratos con condiciones.
//
// DISTINTO por diseño: el mínimo para EMITIR/CONVERTIR una cotización (pagos previos ≥ monto exigido congelado de la cotización). Para contratos con condiciones coinciden; en
// NETO el de confirmar es el total (mayor). Los dos se rotulan distinto en la interfaz (`ROTULO_MINIMO_*`).

export type ReglaConfirmacion = "neto_total" | "condicion_congelada" | "legacy_pct";
export type MonedaRegla = "COP" | "USD";

export type EntradaRegla = {
  /** ventas.comision_estado === 'descontada' (contrato NETO de aliado). */
  netoAliado: boolean;
  /** Total de cobro y su moneda (cobroDeVenta: la moneda de cobro si difiere de la del contrato y trae total y TRM; si no, precio_venta en la moneda del contrato). */
  totalCobro: number;
  monedaCobro: MonedaRegla;
  /** Filas de contrato_condiciones (cualquier orden). Vacío = contrato histórico sin condiciones. */
  condiciones: ReadonlyArray<{ monto_exigido: number | string | null; moneda?: string | null; trm?: number | string | null }>;
  /** config_cobros.pct_abono del tipo de paquete (0..1); solo se usa en legacy_pct. */
  pctLegacy?: number | null;
};

export type SalidaRegla = { regla: ReglaConfirmacion; minimo: number; moneda: MonedaRegla; trm: number | null };

export const ROTULO_MINIMO_CONFIRMAR = "Pago mínimo para confirmar";
export const ROTULO_MINIMO_CONVERTIR = "Pago mínimo para generar el contrato desde la cotización";

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const moneda = (v: unknown, defecto: MonedaRegla): MonedaRegla => (String(v ?? "").toUpperCase() === "USD" ? "USD" : String(v ?? "").toUpperCase() === "COP" ? "COP" : defecto);

export function reglaConfirmacion(e: EntradaRegla): SalidaRegla {
  if (e.netoAliado) return { regla: "neto_total", minimo: num(e.totalCobro), moneda: e.monedaCobro, trm: null };
  if (e.condiciones.length > 0) {
    const minimo = Math.round(e.condiciones.reduce((s, c) => s + num(c.monto_exigido), 0) * 100) / 100;
    const m = moneda(e.condiciones.map((c) => String(c.moneda ?? "").toUpperCase()).filter(Boolean).sort()[0], e.monedaCobro);
    const trms = e.condiciones.map((c) => num(c.trm)).filter((t) => t > 0);
    return { regla: "condicion_congelada", minimo, moneda: m, trm: trms.length ? Math.max(...trms) : null };
  }
  return { regla: "legacy_pct", minimo: num(e.totalCobro) * (e.pctLegacy != null && Number.isFinite(Number(e.pctLegacy)) ? Number(e.pctLegacy) : 0.3), moneda: e.monedaCobro, trm: null };
}

/** Frase de presentación (ficha y documento): dice el monto, la moneda y POR QUÉ regla se exige. */
export function textoMinimoConfirmar(r: SalidaRegla): string {
  const monto = new Intl.NumberFormat("es-CO", { maximumFractionDigits: r.moneda === "USD" ? 2 : 0 }).format(r.minimo);
  const motivo = r.regla === "neto_total" ? "total NETO exigible" : r.regla === "condicion_congelada" ? "condición de pago congelada" : "regla histórica (sin condiciones congeladas)";
  return `${ROTULO_MINIMO_CONFIRMAR}: $${monto} ${r.moneda} (${motivo})`;
}
