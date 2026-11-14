// Cobertura declarada por el carrito (#94/#52) — lectura y validación PURA de la entrada cruda. Solo identifica; nunca trae importes.
//   cobertura: {
//     cupos:   { "<posición del hotel en items>": { "<clave>": [ordinales activos] } },
//     tours:   { "<posición en tours>":    { hotel?: <posición del hotel>, cubre?: ["clave#ordinal", …] } },
//     manuales:{ "<posición en manuales>": { hotel?: <posición del hotel>, cubre?: ["clave#ordinal", …] } }
//   `hotel` es la asignación EXPLÍCITA de un servicio que no está ligado a un hotel; el servidor nunca la deduce.
//   }
export type ServicioCobertura = { hotel: number | null; cubre: string[] | null };
export type CoberturaEntrada = {
  cupos: Record<number, Record<string, number[]>>;
  tours: Record<number, ServicioCobertura>;
  manuales: Record<number, ServicioCobertura>;
};

const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const MAX = 200;

export function leerCobertura(inputRaw: unknown): { ok: true; cobertura: CoberturaEntrada | null } | { ok: false; error: string } {
  const c = obj(inputRaw) ? inputRaw.cobertura : undefined;
  if (c === undefined || c === null) return { ok: true, cobertura: null };
  const bad = (m: string) => ({ ok: false as const, error: `Cobertura de servicios inválida: ${m}.` });
  if (!obj(c)) return bad("formato");
  const pos = (k: string) => (/^\d{1,4}$/.test(k) ? Number(k) : null);
  const ids = (v: unknown): string[] | null => {
    if (!Array.isArray(v) || v.length > MAX) return null;
    const out: string[] = [];
    for (const x of v) { if (typeof x !== "string" || !/^[\w:.\-]{1,60}#[1-9]\d{0,5}$/.test(x)) return null; out.push(x); }
    return new Set(out).size === out.length ? out : null;
  };
  const r: CoberturaEntrada = { cupos: {}, tours: {}, manuales: {} };
  if (obj(c.cupos)) for (const [k, porClave] of Object.entries(c.cupos)) {
    const p = pos(k); if (p == null || !obj(porClave)) return bad("cupos");
    const m: Record<string, number[]> = {};
    for (const [clave, ords] of Object.entries(porClave)) {
      if (!/^[\w:.\-]{1,60}$/.test(clave) || !Array.isArray(ords) || ords.length > MAX || !ords.every((n) => Number.isSafeInteger(n) && n >= 1)) return bad("cupos");
      m[clave] = ords as number[];
    }
    r.cupos[p] = m;
  }
  for (const campo of ["tours", "manuales"] as const) {
    const src = c[campo];
    if (src === undefined) continue;
    if (!obj(src)) return bad(campo);
    for (const [k, v] of Object.entries(src)) {
      const p = pos(k);
      if (p == null || !obj(v)) return bad(campo);
      const hotel = v.hotel === undefined || v.hotel === null ? null : Number.isSafeInteger(v.hotel) && (v.hotel as number) >= 0 && (v.hotel as number) < 10000 ? (v.hotel as number) : undefined;
      const cubre = v.cubre === undefined || v.cubre === null ? null : ids(v.cubre);
      if (hotel === undefined || (v.cubre != null && !cubre)) return bad(campo);
      r[campo][p] = { hotel, cubre };
    }
  }
  return { ok: true, cobertura: r };
}

/**
 * Venta B2B de UN hotel por persona: el checkout no deja elegir pasajeros (eso es solo de la cotización normal), pero un servicio que cubre a TODOS los pasajeros del hotel (`pax` igual al del hotel)
 * queda declarado como suyo, igual que en la cotización normal, donde ese es el valor por defecto. Sin esta declaración el servidor no sabe a qué hotel pertenece y no genera el desglose por pasajero.
 * Un servicio que cubre a menos (o ya ligado a un hotel) NO se declara aquí: su cobertura no se adivina. El servidor revalida el `pax` contra lo que liquidó.
 */
export function coberturaTotalB2B(paxHotel: number, tours: readonly { pax: number; ligado: boolean }[], manuales: readonly { pax: number }[]): CoberturaEntrada | null {
  const r: CoberturaEntrada = { cupos: {}, tours: {}, manuales: {} };
  tours.forEach((t, i) => { if (!t.ligado && t.pax === paxHotel) r.tours[i] = { hotel: 0, cubre: null }; });
  manuales.forEach((m, i) => { if (m.pax === paxHotel) r.manuales[i] = { hotel: 0, cubre: null }; });
  return Object.keys(r.tours).length || Object.keys(r.manuales).length ? r : null;
}
