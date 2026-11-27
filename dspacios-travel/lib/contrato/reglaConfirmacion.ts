// Regla ÚNICA del mínimo para CONFIRMAR un contrato por pago (#75, Parte 3; #53, migración 307). Espejo PURO de `p75_priv.regla_confirmacion` / `estado_minimo`: la pantalla, el
// documento y la confirmación por abono leen la MISMA regla; la base es la autoridad y esta función existe para PRESENTAR exactamente lo que la base va a exigir.
//
// NETO y PVP se resuelven IGUAL (decisión del dueño, #53). Precedencia:
//  · acuerdo              mínimo fijado por superadmin (porcentaje, importe o total = 100 %), siempre sobre el total de COBRO del contrato. Manda sobre lo demás.
//  · condicion_congelada  contrato con condiciones congeladas: Σ monto_exigido, en la moneda y con la TRM CONGELADAS de esas condiciones (un hotel que exige el 100 % ya viene así).
//  · legacy_pct           sin condiciones (histórico o snapshot ausente): % de config_cobros (30 % por defecto). MISMA política para NETO y PVP.
//
// DISTINTO por diseño: el mínimo para EMITIR/CONVERTIR una cotización (pagos previos ≥ monto exigido congelado de la cotización). Los dos se rotulan distinto en la interfaz (`ROTULO_MINIMO_*`).

export type ReglaConfirmacion = "acuerdo" | "condicion_congelada" | "legacy_pct";
export type MonedaRegla = "COP" | "USD";

/** Último acuerdo de `contrato_minimo_acuerdo` (en `porcentaje`, una fracción 0..1). */
export type AcuerdoMinimo =
  | { tipo: "total" }
  | { tipo: "porcentaje"; porcentaje: number }
  | { tipo: "importe"; importe: number; moneda: string };

/** Fila de `contrato_minimo_acuerdo` → acuerdo; null si es incoherente. Pura (se prueba sin base). */
export function acuerdoDeFila(f: { tipo: string; porcentaje: number | string | null; importe: number | string | null; moneda: string | null }): AcuerdoMinimo | null {
  if (f.tipo === "total") return { tipo: "total" };
  if (f.tipo === "porcentaje" && Number(f.porcentaje) > 0) return { tipo: "porcentaje", porcentaje: Number(f.porcentaje) };
  if (f.tipo === "importe" && Number(f.importe) > 0 && f.moneda) return { tipo: "importe", importe: Number(f.importe), moneda: f.moneda };
  return null;
}

/**
 * Resultado de LEER el acuerdo vigente (F5): la ausencia VERIFICADA no es lo mismo que un fallo de lectura.
 *  · ausente  → la base respondió y no hay acuerdo: manda la condición congelada / el % de siempre.
 *  · acuerdo  → hay uno vigente.
 *  · error    → NO se sabe (error de lectura, clave de servidor ausente, fila ilegible): jamás se sustituye por otro mínimo.
 */
export type LecturaAcuerdo =
  | { estado: "ausente" }
  | { estado: "acuerdo"; acuerdo: AcuerdoMinimo; /** Id de la fila leída (cargarAcuerdoMinimo): sirve para detectar que el acuerdo cambió mientras se generaba un plan. */ id?: number | null }
  | { estado: "error"; motivo: string };

/** Respuesta cruda de PostgREST (`maybeSingle`) → LecturaAcuerdo. Una fila que no se entiende es ERROR, no ausencia. */
export function interpretarLecturaAcuerdo(r: { data: unknown; error: { message?: string } | null }): LecturaAcuerdo {
  if (r.error) return { estado: "error", motivo: r.error.message ?? "error de lectura" };
  if (r.data == null) return { estado: "ausente" };
  const a = acuerdoDeFila(r.data as { tipo: string; porcentaje: number | string | null; importe: number | string | null; moneda: string | null });
  return a ? { estado: "acuerdo", acuerdo: a } : { estado: "error", motivo: "acuerdo ilegible" };
}

export type EntradaRegla = {
  /** Total de cobro y su moneda (cobroDeVenta: la moneda de cobro si difiere de la del contrato y trae total y TRM; si no, precio_venta en la moneda del contrato). */
  totalCobro: number;
  monedaCobro: MonedaRegla;
  /** Filas de contrato_condiciones (cualquier orden). Vacío = contrato histórico sin condiciones. */
  condiciones: ReadonlyArray<{ monto_exigido: number | string | null; moneda?: string | null; trm?: number | string | null }>;
  /** config_cobros.pct_abono del tipo de paquete (0..1); solo se usa en legacy_pct. */
  pctLegacy?: number | null;
  /** Acuerdo vigente del contrato (el último), si lo hay. */
  acuerdo?: AcuerdoMinimo | null;
};

export type SalidaRegla = { regla: ReglaConfirmacion; minimo: number; moneda: MonedaRegla; trm: number | null };

export const ROTULO_MINIMO_CONFIRMAR = "Pago mínimo para confirmar";
export const ROTULO_MINIMO_CONVERTIR = "Pago mínimo para generar el contrato desde la cotización";

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const moneda = (v: unknown, defecto: MonedaRegla): MonedaRegla => (String(v ?? "").toUpperCase() === "USD" ? "USD" : String(v ?? "").toUpperCase() === "COP" ? "COP" : defecto);

export function reglaConfirmacion(e: EntradaRegla): SalidaRegla {
  if (e.acuerdo) {
    const total = num(e.totalCobro);
    const a = e.acuerdo;
    if (a.tipo === "porcentaje") return { regla: "acuerdo", minimo: Math.round(total * num(a.porcentaje) * 100) / 100, moneda: e.monedaCobro, trm: null };
    // Importe en otra moneda que la de cobro: no se adivina una conversión; se exige el total (igual que la base, que falla cerrado).
    if (a.tipo === "importe" && moneda(a.moneda, e.monedaCobro) === e.monedaCobro) return { regla: "acuerdo", minimo: Math.min(num(a.importe), total), moneda: e.monedaCobro, trm: null };
    return { regla: "acuerdo", minimo: total, moneda: e.monedaCobro, trm: null };
  }
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
  const motivo = r.regla === "acuerdo" ? "mínimo acordado" : r.regla === "condicion_congelada" ? "condición de pago congelada" : "regla histórica (sin condiciones congeladas)";
  return `${ROTULO_MINIMO_CONFIRMAR}: $${monto} ${r.moneda} (${motivo})`;
}

/**
 * Documento de CLIENTE (2026-11-18): en un contrato cuya oferta es USD pero se cobra en COP (conversión congelada), el mínimo para confirmar se expresa en la
 * moneda del contrato con la TRM de cobro congelada (COP 1.230.000 / 4.100 = USD 300). SOLO presentación: la regla, el monto exigido y la TRM guardados no cambian,
 * y la instrucción de cobro en COP queda en la vista operativa interna. Redondea hacia ARRIBA al centavo para no mostrar menos de lo exigido.
 * Devuelve el texto original si no aplica (misma moneda, sin conversión, sin TRM, o un texto que no es el del mínimo para confirmar).
 */
export function textoMinimoEnMonedaOferta(
  texto: string,
  r: SalidaRegla | null | undefined,
  cobro: { moneda: MonedaRegla; monedaOferta: MonedaRegla; convertido: boolean; trm: number | null } | null | undefined,
): string {
  if (!r || !cobro || !cobro.convertido || !cobro.trm || cobro.trm <= 0) return texto;
  if (!texto.startsWith(ROTULO_MINIMO_CONFIRMAR)) return texto;
  if (r.moneda !== cobro.moneda || r.moneda === cobro.monedaOferta) return texto;
  const valor = cobro.moneda === "COP" ? r.minimo / cobro.trm : r.minimo * cobro.trm;
  return textoMinimoConfirmar({ ...r, minimo: Math.ceil(valor * 100 - 1e-9) / 100, moneda: cobro.monedaOferta });
}
