// #103 (C) — required promotion codes: which coded validity covers a stay, and whether a request may be sent with the code the sender chose. PURE (no I/O).
// A code is configured PER VALIDITY/PROMOTION of a hotel (`hotel_codigos_promocion`, migration 328). Nothing here reads prices; nothing derives a code from a name.
import { msDeIso, nochesDeRangos, sumarDias, nochesEntre, type RangoFechas } from "../hoteles/conjuntosFechas.ts";

export type VigenciaConCodigo = {
  /** hotel_codigos_promocion.id */ codigoId: number;
  hotelId: number; vigenciaId: number; nombre: string;
  fechaInicio: string | null; fechaFin: string | null; rangos: unknown; blackouts: unknown;
  requerido: boolean; codigo: string | null;
};
export type EleccionCodigo = { codigoId?: number | null; sinPromocion?: boolean };
export type CodigoResuelto = { codigoId: number; hotelId: number; texto: string; promocion: string } | null;
export type ResultadoCodigo = { ok: true; codigo: CodigoResuelto; sinPromocion: boolean } | { ok: false; error: string };

const comoRangos = (v: unknown): RangoFechas[] => (Array.isArray(v) ? v.filter((r): r is RangoFechas => !!r && typeof (r as RangoFechas).fecha_inicio === "string" && typeof (r as RangoFechas).fecha_fin === "string") : []);

/** Occupied nights of a stay: check-in … the night before check-out. Reversed or invalid dates → none. */
export function nochesDeEstancia(ingreso: string | null | undefined, salida: string | null | undefined): string[] {
  if (!ingreso || !salida || msDeIso(ingreso) == null || msDeIso(salida) == null || salida <= ingreso) return [];
  return nochesEntre(ingreso, sumarDias(salida, -1));
}

/** Nights the validity sells: its ranges (or the single start/end pair) minus its own exclusions. Same coverage rule as the database (`tarifario_vigencia_aplica`). */
export function nochesDeVigencia(v: Pick<VigenciaConCodigo, "fechaInicio" | "fechaFin" | "rangos" | "blackouts">): Set<string> {
  const rangos = comoRangos(v.rangos);
  const base = rangos.length ? rangos : v.fechaInicio && v.fechaFin ? [{ fecha_inicio: v.fechaInicio, fecha_fin: v.fechaFin }] : [];
  const fuera = new Set(nochesDeRangos(comoRangos(v.blackouts)));
  return new Set(nochesDeRangos(base).filter((n) => !fuera.has(n)));
}

/** Coded validities that require a code and cover AT LEAST ONE occupied night of the stay. */
export function vigenciasQueExigenCodigo(todas: readonly VigenciaConCodigo[], hotelId: number, ingreso: string | null, salida: string | null): VigenciaConCodigo[] {
  const noches = nochesDeEstancia(ingreso, salida);
  if (!noches.length) return [];
  return todas.filter((v) => v.hotelId === hotelId && v.requerido && (() => { const s = nochesDeVigencia(v); return noches.some((n) => s.has(n)); })());
}

export type Estancia = { ingreso: string | null; salida: string | null };
/** Coded validities covering ANY of several stays of the same hotel (each stay judged on its own nights; gaps between stays are not nights). */
export function vigenciasQueExigenCodigoEn(todas: readonly VigenciaConCodigo[], hotelId: number, estancias: readonly Estancia[]): VigenciaConCodigo[] {
  const vistas = new Map<number, VigenciaConCodigo>();
  for (const e of estancias) for (const v of vigenciasQueExigenCodigo(todas, hotelId, e.ingreso, e.salida)) vistas.set(v.codigoId, v);
  return [...vistas.values()];
}

/**
 * The sender must be EXPLICIT: when the stay falls in a validity that requires a code, either choose that validity's code or declare «this stay does not use the promotion».
 * A missing code value, a code of another hotel/validity, or a choice that does not cover the stay is rejected — never silently replaced.
 */
export function resolverCodigo(args: { candidatas: readonly VigenciaConCodigo[]; hotelId: number; ingreso?: string | null; salida?: string | null; estancias?: readonly Estancia[]; eleccion: EleccionCodigo }): ResultadoCodigo {
  const cubren = vigenciasQueExigenCodigoEn(args.candidatas, args.hotelId, args.estancias ?? [{ ingreso: args.ingreso ?? null, salida: args.salida ?? null }]);
  const { codigoId, sinPromocion } = args.eleccion;
  if (codigoId != null && sinPromocion) return { ok: false, error: "Elige un código o indica que no usa la promoción, no ambas cosas." };
  if (codigoId != null) {
    const v = args.candidatas.find((c) => c.codigoId === codigoId);
    if (!v || v.hotelId !== args.hotelId) return { ok: false, error: "El código elegido no pertenece al hotel de esta solicitud." };
    if (!cubren.some((c) => c.codigoId === codigoId)) return { ok: false, error: `La promoción «${v.nombre}» no cubre las fechas de esta estancia: no se puede usar su código.` };
    if (!v.codigo) return { ok: false, error: `Falta digitar el código de la promoción «${v.nombre}» (configúralo en el hotel antes de enviar).` };
    return { ok: true, codigo: { codigoId: v.codigoId, hotelId: v.hotelId, texto: v.codigo, promocion: v.nombre }, sinPromocion: false };
  }
  if (!cubren.length) return { ok: true, codigo: null, sinPromocion: false };
  if (sinPromocion) return { ok: true, codigo: null, sinPromocion: true };
  return { ok: false, error: `Estas fechas caen en ${cubren.length === 1 ? `la promoción «${cubren[0].nombre}»` : `${cubren.length} promociones (${cubren.map((c) => `«${c.nombre}»`).join(", ")})`} que exige${cubren.length === 1 ? "" : "n"} código del hotel: elige el código a usar o indica que esta reserva no usa la promoción.` };
}
