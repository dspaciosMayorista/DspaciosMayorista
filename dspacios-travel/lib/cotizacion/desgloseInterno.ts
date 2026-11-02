// Desglose INTERNO de una cotización: lee SOLO los renglones que quedaron congelados al cotizar (`detalle.items`).
// No recalcula con tarifas vigentes ni reparte el total: lo que el modelo no guardó, o guardó inválido, se declara (nunca se vuelve $0 ni se adivina el concepto).
// PURO (sin I/O; imports relativos con extensión para probarlo con `node --test`).

import { esLineaAjusteRedondeo } from "../reservar/solicitudHotel.ts";
import { esLineaVueloManual } from "../cart/servicioManual.ts";

export type GrupoDesglose = "hotel" | "paquete" | "vuelo" | "servicio" | "suplemento" | "ajuste" | "otro";

export type LineaDesglose = {
  grupo: GrupoDesglose;
  descripcion: string;
  cantidad: number | null;
  unitario: number | null;
  /** null = el importe guardado falta o es inválido (la línea cuenta como detalle incompleto). */
  subtotal: number | null;
  incompleta: boolean;
};

export type DesgloseInterno = {
  lineas: LineaDesglose[];
  /** Suma SOLO de los subtotales válidos. */
  suma: number;
  /** null = el total guardado falta o es inválido. */
  total: number | null;
  /** total guardado − suma; 0 cuando cuadra; null si no se puede afirmar. */
  diferencia: number | null;
  cuadra: boolean;
  /** Alguna línea o el total no se pudo leer: la suma NO es confiable. */
  incompleto: boolean;
  avisos: string[];
};

const cent = (n: number) => Math.round(n * 100);
const fin = (v: unknown): boolean => v != null && v !== "" && typeof v !== "boolean" && Number.isFinite(Number(v));
const num = (v: unknown) => Number(v);

// Hotel: SOLO por patrón positivo de lo que escriben los motores. Lo que no calce NO es hotel.
const RE_HABITACION = /\d+ hab \S+ \(\d+ pax\)/;
const RE_MENOR = /(Niño 1|Niño 2|Infante)( \([^)]*\))? · .+ \/ .+/;
const RE_UNIDAD = /habitación\(es\), \d+ viajero\(s\)/;

function grupoDe(d: string): GrupoDesglose {
  if (esLineaAjusteRedondeo(d)) return "ajuste";
  if (esLineaVueloManual(d)) return "vuelo";
  if (d.startsWith("Servicio · ") || d.endsWith("Servicios incluidos por grupo")) return "servicio";
  if (d.startsWith("Mascota · ") || d === "Cargo de mascota") return "suplemento";
  if (d.startsWith("PAQUETE TURÍSTICO") || d === "Tarifa por niño") return "paquete";
  if (RE_HABITACION.test(d) || RE_MENOR.test(d) || RE_UNIDAD.test(d)) return "hotel";
  return "otro";
}

function leerLinea(raw: unknown): LineaDesglose {
  if (typeof raw !== "object" || raw === null) return { grupo: "otro", descripcion: "(renglón ilegible)", cantidad: null, unitario: null, subtotal: null, incompleta: true };
  const r = raw as Record<string, unknown>;
  const sinTexto = typeof r.descripcion !== "string" || !r.descripcion.trim();
  const descripcion = sinTexto ? "(sin descripción)" : (r.descripcion as string);
  const grupo = sinTexto ? "otro" : grupoDe(descripcion);
  const mala = (cantidad: number | null = null, unitario: number | null = null): LineaDesglose => ({ grupo, descripcion, cantidad, unitario, subtotal: null, incompleta: true });

  // Forma de la cotización manual: { cantidad, tarifa_unit, valor }.
  if (r.valor !== undefined || r.cantidad !== undefined) {
    if (!fin(r.valor)) return mala(fin(r.cantidad) ? num(r.cantidad) : null, fin(r.tarifa_unit) ? num(r.tarifa_unit) : null);
    return { grupo, descripcion, cantidad: fin(r.cantidad) ? num(r.cantidad) : null, unitario: fin(r.tarifa_unit) ? num(r.tarifa_unit) : null, subtotal: num(r.valor), incompleta: sinTexto };
  }
  if (r.modo_precio === "total") {
    return fin(r.valor_total) ? { grupo, descripcion, cantidad: null, unitario: null, subtotal: num(r.valor_total), incompleta: sinTexto } : mala();
  }
  if (!fin(r.adultos) || !fin(r.ninos) || !fin(r.tarifa_adulto) || !fin(r.tarifa_nino)) return mala();
  const adultos = num(r.adultos), ninos = num(r.ninos), ta = num(r.tarifa_adulto), tn = num(r.tarifa_nino);
  // Fila con adultos y niños a la vez no tiene un único unitario: se deja sin él en vez de inventarlo.
  const unitario = ninos === 0 ? ta : adultos === 0 ? tn : null;
  return { grupo, descripcion, cantidad: adultos + ninos, unitario, subtotal: adultos * ta + ninos * tn, incompleta: sinTexto };
}

/** `null` = la cotización no conserva renglones (solo total). */
export function desgloseInterno(cot: { precio_venta: number | null; detalle: unknown }): DesgloseInterno | null {
  const d = (cot.detalle ?? {}) as { items?: unknown; vuelos?: unknown };
  if (!Array.isArray(d.items) || !d.items.length) return null;
  const lineas = d.items.map(leerLinea);

  const total = fin(cot.precio_venta) ? num(cot.precio_venta) : null;
  const suma = lineas.reduce((s, l) => s + (l.subtotal ?? 0), 0);
  const incompleto = total === null || lineas.some((l) => l.incompleta);
  const diferencia = total === null || incompleto ? null : (cent(total) - cent(suma)) / 100;
  const avisos: string[] = [];
  if (Array.isArray(d.vuelos) && d.vuelos.length > 0 && !lineas.some((l) => l.grupo === "vuelo")) {
    avisos.push("El vuelo va dentro del precio por persona de las habitaciones: la cotización no guardó su importe por separado.");
  }
  return { lineas, suma, total, diferencia, cuadra: diferencia === 0, incompleto, avisos };
}
