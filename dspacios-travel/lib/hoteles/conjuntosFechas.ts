// Block 2026-11-22 (D) — exclusions of a hotel validity as a set of NIGHTS, and reusable named date sets. PURE (no I/O).
// A validity (`hotel_temporadas.rangos`) keeps its own exclusions (`blackouts`, migration 053) as inclusive ranges {fecha_inicio, fecha_fin}. The calendar works on single nights;
// these helpers convert both ways without loss, and apply a named set by COPYING its nights (never linking).
// Dates are ISO `YYYY-MM-DD` strings handled in UTC (no time zone can shift a night).

export type RangoFechas = { fecha_inicio: string; fecha_fin: string };

/** Safety cap: one validity cannot meaningfully span more nights than this (≈ 10 years); keeps accidental huge ranges from freezing the page. */
export const MAX_NOCHES = 3660;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;

/** `YYYY-MM-DD` → UTC midnight ms, or null if it is not a REAL calendar date (2027-02-31 → null). */
export function msDeIso(iso: string): number | null {
  if (!ISO.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const f = new Date(ms);
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? ms : null;
}
export const isoDeMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const sumarDias = (iso: string, n: number): string => { const ms = msDeIso(iso); return ms == null ? iso : isoDeMs(ms + n * DIA_MS); };

/** Every night of the inclusive ranges, ascending, de-duplicated. Invalid or reversed ranges are skipped; the total is capped at MAX_NOCHES. */
export function nochesDeRangos(rangos: readonly RangoFechas[]): string[] {
  const set = new Set<number>();
  for (const r of rangos) {
    const a = msDeIso(r.fecha_inicio), b = msDeIso(r.fecha_fin);
    if (a == null || b == null || b < a) continue;
    for (let ms = a; ms <= b && set.size < MAX_NOCHES; ms += DIA_MS) set.add(ms);
  }
  return [...set].sort((x, y) => x - y).map(isoDeMs);
}

/** Nights → minimal inclusive ranges (consecutive nights merge). Lossless inverse of `nochesDeRangos` for valid input. */
export function rangosDeNoches(noches: Iterable<string>): RangoFechas[] {
  const ms = [...new Set([...noches].map(msDeIso).filter((x): x is number => x != null))].sort((x, y) => x - y);
  const out: RangoFechas[] = [];
  for (const m of ms) {
    const ult = out[out.length - 1];
    if (ult && msDeIso(ult.fecha_fin)! + DIA_MS === m) ult.fecha_fin = isoDeMs(m);
    else out.push({ fecha_inicio: isoDeMs(m), fecha_fin: isoDeMs(m) });
  }
  return out;
}

/** Normalises a list of ranges (sorted, merged, valid only). Existing saved data passes through unchanged in meaning. */
export const normalizarRangos = (rangos: readonly RangoFechas[]): RangoFechas[] => rangosDeNoches(nochesDeRangos(rangos));

/** Nights between `a` and `b` inclusive, whichever order they were clicked (for shift-click range selection). */
export function nochesEntre(a: string, b: string): string[] {
  const x = msDeIso(a), y = msDeIso(b);
  if (x == null || y == null) return [];
  const [ini, fin] = x <= y ? [x, y] : [y, x];
  const out: string[] = [];
  for (let ms = ini; ms <= fin && out.length < MAX_NOCHES; ms += DIA_MS) out.push(isoDeMs(ms));
  return out;
}

export type ResultadoAplicar = {
  /** Exclusions after applying the set: previous exclusions ∪ the set's nights that fall inside the validity. */
  blackouts: RangoFechas[];
  /** Nights newly excluded by this application (were not already excluded). */
  agregadas: number;
  /** Nights of the set that were already excluded (nothing to do). */
  yaExcluidas: number;
  /** Nights of the set OUTSIDE the validity: NOT copied (reported, never silently dropped). */
  fueraDeVigencia: string[];
};

/** Applies a named set to a validity by COPYING its nights. Only nights inside the validity are kept: exclusions outside it would be rejected by `validarTemporada` and mean nothing. */
export function aplicarConjunto(vigencia: readonly RangoFechas[], blackoutsActuales: readonly RangoFechas[], conjunto: readonly RangoFechas[]): ResultadoAplicar {
  const dentro = new Set(nochesDeRangos(vigencia));
  const actuales = new Set(nochesDeRangos(blackoutsActuales));
  const delConjunto = nochesDeRangos(conjunto);
  const fuera: string[] = [];
  let agregadas = 0, yaExcluidas = 0;
  for (const n of delConjunto) {
    if (!dentro.has(n)) { fuera.push(n); continue; }
    if (actuales.has(n)) { yaExcluidas++; continue; }
    actuales.add(n); agregadas++;
  }
  return { blackouts: rangosDeNoches(actuales), agregadas, yaExcluidas, fueraDeVigencia: fuera };
}

/** Exclusions that sit outside the validity (what the server would reject): useful to warn when the validity is shortened after choosing exclusions. */
export function exclusionesFueraDeVigencia(vigencia: readonly RangoFechas[], blackouts: readonly RangoFechas[]): string[] {
  const dentro = new Set(nochesDeRangos(vigencia));
  return nochesDeRangos(blackouts).filter((n) => !dentro.has(n));
}

export type ConjuntoFechas = { id: number; nombre: string; anio: number; tipo: string; rangos: RangoFechas[]; nota: string | null };
export const TIPOS_CONJUNTO = [
  { valor: "festivos", etiqueta: "Festivos" },
  { valor: "semana_santa", etiqueta: "Semana Santa" },
  { valor: "receso_escolar", etiqueta: "Receso escolar" },
  { valor: "mitad_de_anio", etiqueta: "Mitad de año" },
  { valor: "personalizado", etiqueta: "Personalizado" },
] as const;

/** Validates a set before saving. Returns the normalised ranges or the Spanish message to show. */
export function validarConjunto(input: { nombre: string; anio: number; tipo: string; rangos: readonly RangoFechas[]; nota?: string | null }):
  { ok: true; nombre: string; anio: number; tipo: string; rangos: RangoFechas[]; nota: string | null } | { ok: false; error: string } {
  const nombre = (input.nombre ?? "").trim();
  if (!nombre) return { ok: false, error: "Indica un nombre para el conjunto." };
  if (nombre.length > 80) return { ok: false, error: "El nombre no puede pasar de 80 caracteres." };
  if (!Number.isInteger(input.anio) || input.anio < 2000 || input.anio > 2100) return { ok: false, error: "Indica el año del conjunto (entre 2000 y 2100)." };
  if (!TIPOS_CONJUNTO.some((t) => t.valor === input.tipo)) return { ok: false, error: "Tipo de conjunto no válido." };
  for (const r of input.rangos) {
    const a = msDeIso(r.fecha_inicio), b = msDeIso(r.fecha_fin);
    if (a == null || b == null) return { ok: false, error: "Hay una fecha no válida en el conjunto." };
    if (b < a) return { ok: false, error: "En un rango, la fecha fin no puede ser anterior a la de inicio." };
  }
  const rangos = normalizarRangos(input.rangos);
  if (!rangos.length) return { ok: false, error: "El conjunto no tiene fechas: selecciona al menos una noche." };
  const nota = (input.nota ?? "").trim();
  if (nota.length > 500) return { ok: false, error: "La nota no puede pasar de 500 caracteres." };
  return { ok: true, nombre, anio: input.anio, tipo: input.tipo, rangos, nota: nota || null };
}
