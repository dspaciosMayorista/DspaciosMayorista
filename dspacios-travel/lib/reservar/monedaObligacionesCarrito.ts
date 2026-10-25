// ─────────────────────────────────────────────────────────────────────────
// #90 F — MONEDA REAL de las obligaciones (CxP) que genera la conversión de un carrito. Módulo PURO (sin I/O).
//
// El límite que esto protege: `registrar_financiero_contrato` guarda la moneda que se le manda (`'COP'` si no se manda) y el asiento de devengo
// (`postearAsientoCxP` → `resolverImporteContable63`) contabiliza una CxP SIN marca de oferta #63 por su valor NOMINAL. Una CxP en dólares del carrito no
// tiene esa marca ni el equivalente en COP congelado a una TRM, así que se registraría como pesos (USD 200 → $200) o con moneda COP mal puesta.
// Mientras la ruta financiera del carrito no sepa devengar el equivalente en COP, la conversión:
//   · usa la moneda REAL de cada costo (hotel, vuelo, servicio), nunca la del contrato en bloque, y la envía EXPLÍCITA en cada CxP;
//   · se DETIENE antes de numerar o escribir cualquier contrato si alguna obligación está en USD, o si su moneda no se puede determinar en un contrato USD.
// Los importes nominales no se tocan.
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

export const mensajeObligacionUsd = (origen: string) =>
  `${origen}: su costo con el proveedor está en USD y la ruta financiera del carrito todavía no registra obligaciones en dólares con su equivalente en pesos `
  + `(se contabilizaría como si fueran pesos). No se crea ningún contrato; este carrito no se puede convertir hasta que esa ruta lo soporte.`;
export const mensajeObligacionSinMoneda = (origen: string) =>
  `${origen}: no se puede determinar la moneda de su costo con el proveedor en un contrato en USD; no se crea ningún contrato.`;
export const mensajeObligacionMonedaInvalida = (origen: string, moneda: unknown) =>
  `${origen}: la moneda de su costo con el proveedor (${String(moneda)}) no es COP ni USD; no se crea ningún contrato.`;

/**
 * Evalúa UNA obligación. COP → válida, con `moneda: "COP"` explícita. USD → rechazada. Sin moneda: en un contrato COP es COP (el default histórico de siempre,
 * sin asignar nada en bloque); en un contrato USD no se puede determinar y se rechaza. Cualquier otra moneda se rechaza.
 */
export function evaluarObligacion(a: { origen: string; moneda: unknown; monedaContrato: unknown }): { ok: true; moneda: "COP" } | { ok: false; error: string } {
  const m = normalizar(a.moneda);
  if (m === "COP") return { ok: true, moneda: "COP" };
  if (m === "USD") return { ok: false, error: mensajeObligacionUsd(a.origen) };
  if (m === "invalida") return { ok: false, error: mensajeObligacionMonedaInvalida(a.origen, a.moneda) };
  if (normalizar(a.monedaContrato) === "USD") return { ok: false, error: mensajeObligacionSinMoneda(a.origen) };
  return { ok: true, moneda: "COP" };
}

export type DecisionCxP = { accion: "omitir" } | { accion: "crear"; moneda: "COP" } | { accion: "rechazar"; error: string };

/**
 * DECISIÓN ÚNICA sobre una obligación: sin importe positivo no existe (omitir); con importe positivo se crea con su moneda real EXPLÍCITA (COP) o se rechaza.
 * La usan la revisión previa (`evaluarObligaciones`) y `pushCxP` en la creación — por eso coinciden siempre.
 */
export function decidirCxP(a: { origen: string; moneda: unknown; valor: unknown; monedaContrato: unknown }): DecisionCxP {
  if (!obligacionPositiva(a.valor)) return { accion: "omitir" };
  const ev = evaluarObligacion({ origen: a.origen, moneda: a.moneda, monedaContrato: a.monedaContrato });
  return ev.ok ? { accion: "crear", moneda: ev.moneda } : { accion: "rechazar", error: ev.error };
}

/** Evalúa las obligaciones de una conversión QUE SE CREARÍAN (importe positivo); devuelve el primer rechazo (antes de numerar o escribir nada). */
export function evaluarObligaciones(a: { monedaContrato: unknown; obligaciones: Obligacion[] }): { ok: true } | { ok: false; error: string } {
  for (const o of a.obligaciones) {
    const d = decidirCxP({ origen: o.origen, moneda: o.moneda, valor: o.valor, monedaContrato: a.monedaContrato });
    if (d.accion === "rechazar") return { ok: false, error: d.error };
  }
  return { ok: true };
}
