// Moneda de la fuente en Bloqueos (#90, Entrega B, migración 231). Funciones PURAS compartidas por los formularios (cliente), las
// acciones de servidor (crear/editar/CSV) y el generador de tarifario. La decisión D2 del dueño es que los Bloqueos EXISTENTES se
// acreditan en COP por un script aparte; un Bloqueo nuevo nunca se supone en COP: la moneda se elige.

import { camposSospechososUsd, esMonedaVuelo, mensajeValorSospechoso, type MonedaVuelo } from "@/lib/vuelos/monedaSospechosa";

export type TarifasBloqueo = {
  tarifaNeta?: number | string | null;
  tarifaParaEmpaquetar?: number | string | null;
  feeInfante?: number | string | null;
};

/** Campos de importe de un Bloqueo con la etiqueta que ve el usuario (las mismas del formulario). */
export function camposTarifaBloqueo(t: TarifasBloqueo): { etiqueta: string; valor: number | string | null | undefined }[] {
  return [
    { etiqueta: "Tarifa neta (pago aerolínea)", valor: t.tarifaNeta },
    { etiqueta: "Tarifa empaquetar (reventa)", valor: t.tarifaParaEmpaquetar },
    { etiqueta: "Fee de infante", valor: t.feeInfante },
  ];
}

export type ResultadoMonedaBloqueo = { ok: true; moneda: MonedaVuelo } | { ok: false; error: string };

/**
 * Validación de crear un Bloqueo (formulario y servidor): la moneda es OBLIGATORIA (COP o USD) y en COP ningún importe positivo puede
 * ser menor a 1.000 ("¿Este valor está en USD?").
 */
export function validarMonedaBloqueo(moneda: unknown, tarifas: TarifasBloqueo): ResultadoMonedaBloqueo {
  if (!esMonedaVuelo(moneda)) return { ok: false, error: "Elige la moneda de las tarifas del Bloqueo (COP o USD)." };
  const sospechosos = camposSospechososUsd(moneda, camposTarifaBloqueo(tarifas));
  if (sospechosos.length > 0) return { ok: false, error: mensajeValorSospechoso(sospechosos) };
  return { ok: true, moneda };
}

/**
 * Validación de EDITAR un Bloqueo: la moneda es opcional (un Bloqueo sin acreditar se puede seguir editando sin tocarla), pero si viene
 * debe ser COP o USD y pasar la misma regla de importes. `undefined`/vacío = no se toca la moneda.
 */
export function validarMonedaBloqueoEdicion(moneda: unknown, tarifas: TarifasBloqueo): { ok: true; moneda: MonedaVuelo | null } | { ok: false; error: string } {
  if (moneda === undefined || moneda === null || moneda === "") return { ok: true, moneda: null };
  const r = validarMonedaBloqueo(moneda, tarifas);
  return r.ok ? { ok: true, moneda: r.moneda } : r;
}

/**
 * Fuera del modo cop_trm_63 un tarifario es de UNA moneda (regla D8). Devuelve el motivo de rechazo o null si el Bloqueo encaja.
 * Sin acreditar (null) se lee como COP —así se vendió siempre— y por eso solo se rechaza contra un paquete en USD.
 */
export function motivoMonedaBloqueoVsPaquete(
  monedaBloqueo: string | null | undefined,
  monedaPaquete: MonedaVuelo,
  etiquetaBloqueo: string
): string | null {
  if (monedaBloqueo === null || monedaBloqueo === undefined || monedaBloqueo === "") {
    return monedaPaquete === "USD"
      ? `El Bloqueo ${etiquetaBloqueo} no tiene la moneda de sus tarifas acreditada y este paquete se publica en USD. Acredita la moneda del Bloqueo (Vuelos → Editar bloqueo) o usa un Bloqueo en USD.`
      : null;
  }
  if (monedaBloqueo !== "COP" && monedaBloqueo !== "USD") {
    return `El Bloqueo ${etiquetaBloqueo} tiene una moneda inválida (${monedaBloqueo}). Corrígela en Vuelos → Editar bloqueo.`;
  }
  if (monedaBloqueo === monedaPaquete) return null;
  return `El Bloqueo ${etiquetaBloqueo} está en ${monedaBloqueo} pero este paquete se publica en ${monedaPaquete}. Un paquete debe ser de una sola moneda: usa un hotel de la misma moneda o un Bloqueo en ${monedaPaquete}.`;
}

/** Quita el prefijo técnico `MONEDA_BLOQUEO:` de los errores de la base (trigger 231 y crear_bloqueo) para mostrarlos al usuario. */
export function mensajeErrorMonedaBloqueo(mensaje: string | null | undefined): string {
  return String(mensaje ?? "").replace(/^MONEDA_BLOQUEO:\s*/, "").trim();
}
