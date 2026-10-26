// ─────────────────────────────────────────────────────────────────────────
// #90 F/I — MONEDA REAL de las obligaciones (CxP) que genera la conversión de un carrito. Módulo PURO (sin I/O).
//
// Regla única (la usan la revisión previa, que corre ANTES de numerar, y `pushCxP`, que crea la CxP):
//   · cada obligación usa la moneda REAL de su costo (hotel, vuelo, servicio de HOY en el catálogo), nunca la del contrato en bloque, y la envía EXPLÍCITA;
//   · la moneda del costo debe ser la de la OFERTA del carrito (`ventas.moneda`). Una obligación positiva en OTRA moneda —un servicio que desde la
//     cotización pasó de USD a COP, o al revés— detiene la conversión: nunca se suman importes de monedas distintas en `ventas.costo_*` ni se devenga un
//     importe nominal como si fuera la moneda del contrato (H-1). Un costo en cero no es obligación y no bloquea;
//   · una obligación en USD dentro de una oferta en USD SÍ se registra (I): conserva su valor y moneda originales y lleva su equivalente en COP congelado a
//     la TRM de COSTOS (`valor_cop_costo`/`trm_costo`, migración 236), distinta de la TRM de cobro. Por eso la revisión informa si la conversión la necesita.
// ─────────────────────────────────────────────────────────────────────────

/** `valor` = importe nominal de la CxP que se crearía; solo las de importe POSITIVO existen (misma condición que `pushCxP`). */
export type Obligacion = { origen: string; moneda: unknown; valor: number };

/** ¿Una obligación con este importe se crea? Condición ÚNICA, usada por la revisión previa y por `pushCxP`. */
export function obligacionPositiva(valor: unknown): boolean {
  return typeof valor === "number" && valor > 0;
}

function normalizar(v: unknown): "COP" | "USD" | "" | "invalida" {
  if (v == null || (typeof v === "string" && v.trim() === "")) return "";
  const m = String(v).trim().toUpperCase();
  return m === "COP" || m === "USD" ? m : "invalida";
}

export const mensajeObligacionMonedaDistinta = (origen: string, moneda: "COP" | "USD", monedaOferta: "COP" | "USD") =>
  `${origen}: su costo con el proveedor está hoy en ${moneda} y la oferta del carrito está en ${monedaOferta}; no se mezclan monedas entre el precio y los costos. `
  + `No se crea ningún contrato: recotiza el carrito desde el tarifario o corrige la moneda del servicio en el catálogo.`;
export const mensajeObligacionSinMoneda = (origen: string) =>
  `${origen}: no se puede determinar la moneda de su costo con el proveedor en un contrato en USD; no se crea ningún contrato.`;
export const mensajeObligacionMonedaInvalida = (origen: string, moneda: unknown) =>
  `${origen}: la moneda de su costo con el proveedor (${String(moneda)}) no es COP ni USD; no se crea ningún contrato.`;

/**
 * Evalúa UNA obligación contra la moneda de la oferta. Misma moneda → válida (COP o USD) con su moneda EXPLÍCITA. Otra moneda → rechazada (H-1 y su
 * caso inverso). Sin moneda: en una oferta COP es COP (el default histórico, sin asignar nada en bloque); en una oferta USD no se puede determinar y se
 * rechaza. Cualquier otra moneda se rechaza.
 */
export function evaluarObligacion(a: { origen: string; moneda: unknown; monedaContrato: unknown }): { ok: true; moneda: "COP" | "USD" } | { ok: false; error: string } {
  const m = normalizar(a.moneda);
  const oferta: "COP" | "USD" = normalizar(a.monedaContrato) === "USD" ? "USD" : "COP";
  if (m === "invalida") return { ok: false, error: mensajeObligacionMonedaInvalida(a.origen, a.moneda) };
  if (m === "") return oferta === "USD" ? { ok: false, error: mensajeObligacionSinMoneda(a.origen) } : { ok: true, moneda: "COP" };
  if (m !== oferta) return { ok: false, error: mensajeObligacionMonedaDistinta(a.origen, m, oferta) };
  return { ok: true, moneda: m };
}

export type DecisionCxP = { accion: "omitir" } | { accion: "crear"; moneda: "COP" | "USD" } | { accion: "rechazar"; error: string };

/**
 * DECISIÓN ÚNICA sobre una obligación: sin importe positivo no existe (omitir); con importe positivo se crea con su moneda real EXPLÍCITA o se rechaza.
 * La usan la revisión previa (`evaluarObligaciones`) y `pushCxP` en la creación — por eso coinciden siempre.
 */
export function decidirCxP(a: { origen: string; moneda: unknown; valor: unknown; monedaContrato: unknown }): DecisionCxP {
  if (!obligacionPositiva(a.valor)) return { accion: "omitir" };
  const ev = evaluarObligacion({ origen: a.origen, moneda: a.moneda, monedaContrato: a.monedaContrato });
  return ev.ok ? { accion: "crear", moneda: ev.moneda } : { accion: "rechazar", error: ev.error };
}

/**
 * Evalúa las obligaciones de una conversión QUE SE CREARÍAN (importe positivo); devuelve el primer rechazo (antes de numerar o escribir nada) o,
 * si todas valen, si alguna está en USD y por tanto la conversión necesita la TRM de costos.
 */
export function evaluarObligaciones(a: { monedaContrato: unknown; obligaciones: Obligacion[] }): { ok: true; requiereTrmCosto: boolean } | { ok: false; error: string } {
  let requiereTrmCosto = false;
  for (const o of a.obligaciones) {
    const d = decidirCxP({ origen: o.origen, moneda: o.moneda, valor: o.valor, monedaContrato: a.monedaContrato });
    if (d.accion === "rechazar") return { ok: false, error: d.error };
    if (d.accion === "crear" && d.moneda === "USD") requiereTrmCosto = true;
  }
  return { ok: true, requiereTrmCosto };
}
