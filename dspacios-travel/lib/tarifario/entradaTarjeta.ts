// #90 — Entrada y tipos de la cotización de la tarjeta pública (ver app/tarifario/cotizarTarjetaActions.ts). Validación pura, sin tocar la base.
import { validarRangoFechasConsulta } from "../reservar/edadesMenores.ts";

export type DescuentoTarjeta = { etiqueta: string; tipo: "ebb" | "long_stay"; umbral: number; pct: number };
/** Precios por persona (con la regla de HOY ya aplicada) de UNA categoría/régimen para las fechas cotizadas: lo que el modal «Ver opciones» muestra en vez del publicado. */
export type ComboTarjeta = { categoria: string; regimen: string; precios: Record<string, number>; preciosMenor2: Record<string, number>; infanteSinFijo: { mayor2: number | null; menor2: number | null }; descuento: DescuentoTarjeta | null };
export const MENSAJE_TARJETA = "No pudimos calcular el precio para esas fechas. Elige otras o intenta de nuevo.";
const MENSAJE = MENSAJE_TARJETA;
export type EntradaTarjeta = {
  modulo: "bloqueo" | "porcion_terrestre" | "dinamico";
  paqueteId: number; hotelId: number;
  bloqueoId?: number | null; empaquetadoId?: number | null; salidaId?: number | null;
  fechaIda?: string; fechaRegreso?: string;
  combos: { categoria: string; regimen: string }[];
};

const entero = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const texto = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= 120;
const opcional = (v: unknown) => v == null || entero(v);

export function validarEntradaTarjeta(raw: unknown): { ok: true; entrada: EntradaTarjeta } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: MENSAJE };
  const o = raw as Record<string, unknown>;
  if (o.modulo !== "bloqueo" && o.modulo !== "porcion_terrestre" && o.modulo !== "dinamico") return { ok: false, error: MENSAJE };
  if (!entero(o.paqueteId) || !entero(o.hotelId) || !opcional(o.bloqueoId) || !opcional(o.empaquetadoId) || !opcional(o.salidaId)) return { ok: false, error: MENSAJE };
  if (!Array.isArray(o.combos) || o.combos.length < 1 || o.combos.length > 12) return { ok: false, error: MENSAJE };
  const combos: { categoria: string; regimen: string }[] = [];
  for (const c of o.combos) {
    const x = c as { categoria?: unknown; regimen?: unknown } | null;
    if (!x || !texto(x.categoria) || !texto(x.regimen)) return { ok: false, error: MENSAJE };
    combos.push({ categoria: x.categoria, regimen: x.regimen });
  }
  const modulo: EntradaTarjeta["modulo"] = o.modulo;
  const base = { modulo, paqueteId: o.paqueteId, hotelId: o.hotelId, bloqueoId: (o.bloqueoId as number | null | undefined) ?? null, empaquetadoId: (o.empaquetadoId as number | null | undefined) ?? null, salidaId: (o.salidaId as number | null | undefined) ?? null, combos };
  if (o.modulo === "porcion_terrestre") {
    const v = validarRangoFechasConsulta(o.fechaIda, o.fechaRegreso);
    if (!v.ok) return { ok: false, error: v.error };
    return { ok: true, entrada: { ...base, fechaIda: v.fechaIda, fechaRegreso: v.fechaRegreso } };
  }
  if (o.modulo === "dinamico" && !base.salidaId) return { ok: false, error: MENSAJE };
  if (o.modulo === "bloqueo" && !base.bloqueoId && !base.empaquetadoId) return { ok: false, error: MENSAJE };
  return { ok: true, entrada: base };
}

