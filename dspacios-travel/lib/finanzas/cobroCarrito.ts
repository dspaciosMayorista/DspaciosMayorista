// ─────────────────────────────────────────────────────────────────────────
// #90 F — MONEDA DE COBRO al convertir una cotización de CARRITO (varios contratos). Módulo PURO (sin I/O).
//
// Misma regla aprobada para las ofertas #63 (`lib/finanzas/cobro.ts`, migración 235), aplicada al carrito:
//   · quien convierte (personal interno) ELIGE expresamente COP o USD antes de generar los contratos —incluso si coincide con la moneda de la
//     cotización—; sin elección no se genera nada;
//   · si elige la otra moneda, ingresa UNA TRM positiva; el total de CADA contrato generado se convierte UNA sola vez (sobre su `precio_venta`) y se
//     redondea hacia arriba (COP al mil, USD al dólar entero); la moneda e importes de la oferta, los costos y las CxP no cambian;
//   · UNA sola elección sirve a todos los contratos de la conversión (modo «todo» o «por destino»);
//   · la elección queda congelada en `cotizaciones.detalle.cobro` al primer contrato; un reintento (tras crear el primer contrato) con otra moneda u
//     otra TRM se rechaza. Una conversión parcial anterior a este cambio (contratos sin elección de cobro) solo admite continuar en la moneda de la oferta.
// La base solo comprueba la COHERENCIA de las tres columnas (`ventas_cobro_chk`, 235): el cálculo vive aquí y el servidor lo aplica.
// ─────────────────────────────────────────────────────────────────────────
import { totalCobroConvertido, validarEleccionCobro, type MonedaCobro } from "./cobro.ts";

export const MENSAJE_COBRO_CARRITO_CAMBIO =
  "La moneda o la TRM de cobro de esta conversión ya quedaron congeladas con el primer contrato y no se cambian. Reintenta con la misma elección o, si necesitas otra, genera una cotización nueva.";
export const MENSAJE_COBRO_CARRITO_HISTORICO =
  "Esta cotización ya tiene contratos creados antes de elegir una moneda de cobro: se cobran en la moneda de la oferta. Continúa eligiendo esa misma moneda (sin TRM).";
export const MENSAJE_COBRO_CARRITO_TOTAL_INVALIDO =
  "El total convertido para cobrar no es válido (el contrato no tiene un valor positivo para convertir).";

/**
 * Moneda de la oferta de una cotización de carrito para validar la ELECCIÓN de cobro desde el primer momento: la de la cotización; si falta (dato
 * histórico), la primera moneda explícita del payload (ítems Bernalo / tours); y si ninguna la trae, COP. La conversión la revalida después contra la
 * moneda real de cada unidad (`resolverMonedaOferta`).
 */
export function monedaOfertaDeCotizacion(monedaCotizacion: unknown, payload: unknown): MonedaCobro {
  const norm = (v: unknown): MonedaCobro | "" => {
    const m = String(v ?? "").trim().toUpperCase();
    return m === "COP" || m === "USD" ? m : "";
  };
  const c = norm(monedaCotizacion);
  if (c) return c;
  const p = (payload ?? {}) as { items?: Array<{ moneda?: unknown }>; tours?: Array<{ moneda?: unknown }> };
  for (const u of [...(p.items ?? []), ...(p.tours ?? [])]) {
    const m = norm(u?.moneda);
    if (m) return m;
  }
  return "COP";
}

export type UnidadMoneda = { origen: string; moneda: unknown };
export type GrupoMonedas = { etiqueta: string; unidades: UnidadMoneda[] };

/**
 * Moneda de la OFERTA de los contratos de una conversión de carrito. Todas las unidades —hoteles y tours de cada grupo— deben estar en la moneda de la
 * cotización; nunca se suman importes de monedas distintas. Reglas:
 *   · la moneda de la cotización manda cuando existe; si falta (dato histórico), manda la primera moneda EXPLÍCITA de una unidad, y si ninguna
 *     la trae, COP (como siempre);
 *   · una unidad sin moneda declarada (tour histórico) hereda la de la cotización — nunca se le inventa otra;
 *   · una moneda explícita distinta, o que no sea COP/USD, es un dato incoherente: se rechaza ANTES de numerar o escribir el primer contrato.
 * Un grupo de solo tours (sin hoteles) toma así la moneda de la cotización, no un COP supuesto.
 */
export function resolverMonedaOferta(a: { monedaCotizacion: unknown; grupos: GrupoMonedas[] }): { ok: true; moneda: MonedaCobro } | { ok: false; error: string } {
  const norm = (v: unknown): MonedaCobro | "" | "invalida" => {
    if (v == null || (typeof v === "string" && v.trim() === "")) return "";
    const m = String(v).trim().toUpperCase();
    return m === "COP" || m === "USD" ? m : "invalida";
  };
  const cot = norm(a.monedaCotizacion);
  if (cot === "invalida") return { ok: false, error: `La moneda de la cotización (${String(a.monedaCotizacion)}) no es COP ni USD; no se crea ningún contrato.` };
  let esperada: MonedaCobro | "" = cot;
  if (!esperada) {
    for (const g of a.grupos) for (const u of g.unidades) { const m = norm(u.moneda); if (m && m !== "invalida") { esperada = m; break; } }
    if (!esperada) esperada = "COP";
  }
  for (const g of a.grupos) {
    for (const u of g.unidades) {
      const m = norm(u.moneda);
      if (m === "") continue;
      if (m === "invalida" || m !== esperada) {
        return { ok: false, error: `${u.origen}${g.etiqueta ? ` (contrato ${g.etiqueta})` : ""}: su moneda (${String(u.moneda)}) no coincide con la de la cotización (${esperada}); no se mezclan monedas en un contrato y no se crea ningún contrato. Recotiza el carrito desde el tarifario.` };
      }
    }
  }
  return { ok: true, moneda: esperada };
}

export type EleccionCobroCarrito = { monedaCobro: MonedaCobro; trmCobro: number | null };
export type CobroCongelado = { moneda: MonedaCobro; trm: number | null };

function moneda(v: unknown): MonedaCobro {
  return String(v ?? "COP").toUpperCase() === "USD" ? "USD" : "COP";
}
const cuatroDecimales = (n: number) => Math.round(n * 10000) / 10000;

/** Valida la elección recibida del navegador: obligatoria, solo interno, TRM obligatoria si difiere de la oferta (reutiliza la regla de la 235). */
export function validarEleccionCarrito(a: {
  monedaOferta: unknown; monedaCobro: unknown; trmCobro: unknown; esInterno: boolean;
}): { ok: true; eleccion: EleccionCobroCarrito } | { ok: false; error: string } {
  const r = validarEleccionCobro({ monedaOferta: a.monedaOferta, monedaCobro: a.monedaCobro, trmCobro: a.trmCobro, esInterno: a.esInterno });
  if (!r.ok) return r;
  return { ok: true, eleccion: { monedaCobro: r.monedaCobro, trmCobro: r.trmCobro } };
}

/** Lee la elección ya congelada en `cotizaciones.detalle.cobro` sin confiar en su forma. `null` = nunca se congeló. */
export function leerCobroCongelado(detalle: unknown): CobroCongelado | null {
  const d = (detalle ?? null) as { cobro?: unknown } | null;
  const c = (d?.cobro ?? null) as { moneda?: unknown; trm?: unknown } | null;
  if (!c || typeof c !== "object") return null;
  if (c.moneda !== "COP" && c.moneda !== "USD") return null;
  const trm = c.trm == null ? null : Number(c.trm);
  return { moneda: c.moneda, trm: trm != null && Number.isFinite(trm) && trm > 0 ? trm : null };
}

/**
 * Un reintento no puede cambiar lo congelado. Con elección congelada: misma moneda y misma TRM (a 4 decimales). Sin ella pero con contratos ya creados
 * (conversión parcial o completa anterior a este cambio): esos contratos se cobran en la moneda de la oferta, así que solo se admite esa moneda.
 * Sin contratos creados, la elección es libre.
 */
export function compararConCongelado(a: {
  eleccion: EleccionCobroCarrito; congelado: CobroCongelado | null; hayContratos: boolean; monedaOferta: unknown;
}): { ok: true } | { ok: false; error: string } {
  if (a.congelado) {
    const mismaTrm = (a.congelado.trm == null && a.eleccion.trmCobro == null)
      || (a.congelado.trm != null && a.eleccion.trmCobro != null && cuatroDecimales(a.congelado.trm) === cuatroDecimales(a.eleccion.trmCobro));
    if (a.congelado.moneda !== a.eleccion.monedaCobro || !mismaTrm) return { ok: false, error: MENSAJE_COBRO_CARRITO_CAMBIO };
    return { ok: true };
  }
  if (a.hayContratos && (a.eleccion.monedaCobro !== moneda(a.monedaOferta) || a.eleccion.trmCobro != null)) {
    return { ok: false, error: MENSAJE_COBRO_CARRITO_HISTORICO };
  }
  return { ok: true };
}

export type CobroDeContrato = { moneda_cobro: MonedaCobro; trm_cobro: number | null; total_cobro: number | null };

/**
 * Columnas de cobro de UN contrato del carrito. Misma moneda: sin TRM ni total (coherente con `ventas_cobro_chk`). Otra moneda: total = precio_venta
 * convertido UNA vez con la TRM y redondeado hacia arriba; debe ser positivo.
 */
export function cobroDeContratoCarrito(a: {
  precioVenta: number; monedaContrato: unknown; eleccion: EleccionCobroCarrito;
}): { ok: true; cobro: CobroDeContrato } | { ok: false; error: string } {
  if (moneda(a.monedaContrato) === a.eleccion.monedaCobro) {
    return { ok: true, cobro: { moneda_cobro: a.eleccion.monedaCobro, trm_cobro: null, total_cobro: null } };
  }
  const total = totalCobroConvertido(a.precioVenta, a.monedaContrato, a.eleccion.monedaCobro, a.eleccion.trmCobro);
  if (total == null || !(total > 0)) return { ok: false, error: MENSAJE_COBRO_CARRITO_TOTAL_INVALIDO };
  return { ok: true, cobro: { moneda_cobro: a.eleccion.monedaCobro, trm_cobro: a.eleccion.trmCobro, total_cobro: total } };
}

/**
 * Vista previa para la pantalla: el total a cobrar de cada contrato (`totalesPorContrato` en la moneda de la oferta). `null` mientras falte una TRM
 * válida. Es SOLO una vista previa — el servidor recalcula el precio de cada contrato y congela el total real.
 */
export function totalesACobrar(totalesPorContrato: number[], monedaOferta: unknown, monedaCobro: unknown, trm: number | null | undefined): Array<number | null> {
  if (moneda(monedaOferta) === moneda(monedaCobro)) return totalesPorContrato.map((t) => (Number.isFinite(t) ? t : null));
  return totalesPorContrato.map((t) => totalCobroConvertido(t, monedaOferta, monedaCobro, trm));
}
