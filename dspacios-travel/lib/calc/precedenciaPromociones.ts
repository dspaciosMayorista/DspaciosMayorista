// #43/#60 entrega 5 — Acumulación y precedencia entre promociones y reglas EBB / Long Stay (puro, sin lecturas).
// Especificación §5; historial Q, R (R.4 algoritmo), S.1; diseño AK.
//
//  · Sin promoción aplicada en la estadía: regla vigente exacta — entre EBB y Long Stay gana el MAYOR % y no se suman.
//  · Con promoción heredada (coincidencia que ya existía al aplicar la 301) o sin fila: como hasta hoy, la regla del mayor % se
//    descuenta sobre el total ya con la promoción.
//  · Con promoción configurada: se recorren, en el ORDEN del proveedor, solo las alternativas que esta reserva cumple; se
//    incluye la primera y cada siguiente solo si acumula con todas las ya incluidas (EBB y Long Stay nunca acumulan
//    entre sí). Si la promoción queda fuera, la regla actúa sobre el neto SIN la promoción.
//  · Configurada sin respuesta para una regla que esta reserva cumple, o configuraciones distintas en la misma estadía: falla cerrado (no se
//    elige nada implícito; no se vende y se informa).
import { resolverDescuentoHotel, type DescuentoAplicado, type ReglaDescuentoHotel } from "./descuentoHotel.ts";

import { normCombinacion, type Alternativa, type CombinacionPromo } from "./promocionesGrupo.ts";
export { normCombinacion, type Alternativa, type CombinacionPromo };

/** Promoción que efectivamente aplicó en la estadía (por noche o de estadía), con su combinación (null = sin fila). */
export interface PromoAplicada { nombre: string; combinacion: CombinacionPromo | null }

export type DecisionPrecedencia =
  | { ok: true; usarPromocion: boolean; descuento: DescuentoAplicado | null; via: "sin_promocion" | "heredada" | "configurada" | "sin_regla" }
  | { ok: false; motivo: "sin_configurar" | "contradiccion"; detalle: string };

const mejorDe = (reglas: readonly ReglaDescuentoHotel[], tipo: "ebb" | "long_stay", args: { fechaReserva: string; fechaIda: string; numNoches: number }) =>
  resolverDescuentoHotel(reglas.filter((r) => r.tipo === tipo), args);

/** Misma decisión para las reglas que esta reserva cumple (igual criterio que `_e5_misma_config` en la 301). */
function mismaConfig(a: CombinacionPromo, b: CombinacionPromo, cumplen: readonly ("ebb" | "long_stay")[]): boolean {
  const com = cumplen.filter((f) => a.alternativas.includes(f) && b.alternativas.includes(f));
  const ac = (c: CombinacionPromo, f: "ebb" | "long_stay") => (f === "ebb" ? c.acumulable_ebb : c.acumulable_long_stay) ?? null;
  if (com.some((f) => ac(a, f) !== ac(b, f))) return false;
  if (com.length < 2 && com.every((f) => ac(a, f) === true)) return true;
  const rel = (c: CombinacionPromo) => (c.orden ?? []).filter((x) => x === "promocion" || (com as string[]).includes(x)).join(">");
  return rel(a) === rel(b);
}

const TEXTO_ALT: Record<Alternativa, string> = { promocion: "promoción", ebb: "compra anticipada (EBB)", long_stay: "larga estadía (Long Stay)" };

/** Qué decisión difiere entre dos combinaciones que `mismaConfig` declaró distintas (misma redacción que `_e5_texto_diferencia` en la 301). */
export function textoDiferenciaPromociones(na: string, a: CombinacionPromo, nb: string, b: CombinacionPromo, cumplen: readonly ("ebb" | "long_stay")[]): string {
  const com = (["ebb", "long_stay"] as const).filter((f) => cumplen.includes(f) && a.alternativas.includes(f) && b.alternativas.includes(f));
  const ac = (c: CombinacionPromo, f: "ebb" | "long_stay") => (f === "ebb" ? c.acumulable_ebb : c.acumulable_long_stay) ?? null;
  const f = com.find((x) => ac(a, x) !== ac(b, x));
  if (f) return `«${na}» ${ac(a, f) ? "acumula" : "no acumula"} con ${TEXTO_ALT[f]} y «${nb}» ${ac(b, f) ? "sí" : "no"}`;
  const orden = (c: CombinacionPromo) => (c.orden ?? []).filter((x) => x === "promocion" || (com as readonly string[]).includes(x)).map((x) => TEXTO_ALT[x]).join(" → ");
  return `el orden de aplicación: «${na}» ${orden(a)}; «${nb}» ${orden(b)}`;
}

const ddmmaaaa = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

function acumulan(c: CombinacionPromo, x: Alternativa, y: Alternativa): boolean {
  const par = new Set([x, y]);
  if (par.has("ebb") && par.has("long_stay")) return false; // relación vigente: nunca se suman
  if (par.has("ebb")) return c.acumulable_ebb === true;
  if (par.has("long_stay")) return c.acumulable_long_stay === true;
  return false;
}

/** R.4: qué descuentos se aplican a esta estadía. */
export function resolverPrecedencia(a: {
  promos: readonly PromoAplicada[];
  reglas: readonly ReglaDescuentoHotel[] | null | undefined;
  fechaReserva: string; fechaIda: string; numNoches: number;
}): DecisionPrecedencia {
  const reglas = a.reglas ?? [];
  const args = { fechaReserva: a.fechaReserva, fechaIda: a.fechaIda, numNoches: a.numNoches };
  if (!a.promos.length) return { ok: true, usarPromocion: false, descuento: resolverDescuentoHotel(reglas, args), via: "sin_promocion" };
  const ebb = mejorDe(reglas, "ebb", args), ls = mejorDe(reglas, "long_stay", args);
  const cumplen: ("ebb" | "long_stay")[] = [...(ebb ? ["ebb" as const] : []), ...(ls ? ["long_stay" as const] : [])];
  if (!cumplen.length) return { ok: true, usarPromocion: true, descuento: null, via: "sin_regla" };

  const configuradas = a.promos.filter((p) => p.combinacion?.estado === "configurada");
  // Sin promoción configurada (heredadas, o sin fila porque la base no registró coincidencia): el comportamiento VIGENTE de siempre —
  // la regla del mayor % se descuenta sobre el total con la promoción. Así ninguna promoción existente cambia (golden 264.000).
  if (!configuradas.length) return { ok: true, usarPromocion: true, descuento: resolverDescuentoHotel(reglas, args), via: "heredada" };
  const c = configuradas[0].combinacion!;
  const otra = configuradas.find((p) => !mismaConfig(p.combinacion!, c, cumplen));
  if (otra) {
    const n = a.numNoches;
    return { ok: false, motivo: "contradiccion", detalle: `«${configuradas[0].nombre}» y «${otra.nombre}» aplican en esta estadía (entrada ${ddmmaaaa(a.fechaIda)}, ${n} noche${n === 1 ? "" : "s"}) y deciden distinto frente a EBB / Long Stay: ${textoDiferenciaPromociones(configuradas[0].nombre, c, otra.nombre, otra.combinacion!, cumplen)}. No se vende hasta que tengan la misma configuración o se separen sus fechas, compra o régimen.` };
  }
  if (cumplen.some((f) => !c.alternativas.includes(f))) {
    return { ok: false, motivo: "sin_configurar", detalle: `«${configuradas[0].nombre}» coincide con ${cumplen.join(" y ")} sin configuración.` };
  }
  // Sin orden (todo acumulable con la promoción y una sola regla): se aplican todas las que cumplen.
  const orden: Alternativa[] = c.orden?.length ? c.orden : ["promocion", ...c.alternativas];
  const incluidas: Alternativa[] = [];
  for (const alt of orden) {
    if (alt !== "promocion" && !cumplen.includes(alt)) continue;
    if (incluidas.every((x) => acumulan(c, x, alt))) incluidas.push(alt);
  }
  const regla = incluidas.find((x) => x !== "promocion") as "ebb" | "long_stay" | undefined;
  return { ok: true, usarPromocion: incluidas.includes("promocion"), descuento: regla === "ebb" ? ebb : regla === "long_stay" ? ls : null, via: "configurada" };
}

// ── Liquidación de una acomodación con la precedencia aplicada (R.4) ─────────────────────────────────
import { liquidarHotelNochesConTemporadas, promosAplicadas, soloBases, type ArgsLiquidar } from "./paquetes.ts";

export type LiquidacionConPrecedencia =
  | { ok: true; r: NonNullable<ReturnType<typeof liquidarHotelNochesConTemporadas>>; descuento: DescuentoAplicado | null; sinPromocion: boolean }
  | { ok: false; motivo: "sin_configurar" | "contradiccion"; detalle: string };

/** Liquida la estadía y decide qué descuentos aplican. Si la promoción queda fuera (una regla prevalece), se
 * re-liquida SOLO con las vigencias base (la promoción no crea disponibilidad: sin base, no hay tarifa ⇒ null).
 * `null` = sin tarifa. `ok: false` = coincidencia sin respuesta: la acomodación no se vende. */
export function liquidarConPrecedencia(args: ArgsLiquidar, ctx: { reglas: readonly ReglaDescuentoHotel[] | null | undefined; fechaReserva: string }): LiquidacionConPrecedencia | null {
  const r = liquidarHotelNochesConTemporadas(args);
  if (!r) return null;
  const d = resolverPrecedencia({ promos: promosAplicadas(r.procedencia, args.temporadas), reglas: ctx.reglas, fechaReserva: ctx.fechaReserva, fechaIda: args.fechaIda, numNoches: args.numNoches });
  if (!d.ok) return d;
  if (d.usarPromocion) return { ok: true, r, descuento: d.descuento, sinPromocion: false };
  const rb = liquidarHotelNochesConTemporadas({ ...args, temporadas: soloBases(args.temporadas) });
  return rb ? { ok: true, r: rb, descuento: d.descuento, sinPromocion: true } : null;
}

/** Mismo descuento aplicado (misma regla y %), o los dos ausentes. */
export const mismoDescuento = (a: DescuentoAplicado | null | undefined, b: DescuentoAplicado | null | undefined): boolean =>
  (a ?? null) === (b ?? null) || (!!a && !!b && a.tipo === b.tipo && a.umbral === b.umbral && a.pct === b.pct);


const NOMBRE_ACOM: Record<string, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple", nino: "Niño 1", nino2: "Niño 2", infante: "Infante" };
const ORDEN_ACOM = Object.keys(NOMBRE_ACOM);
/** Etiqueta EBB / Long Stay que se MUESTRA. Mixta (`porAcomodacion`, sin tipo/umbral/pct) cuando la precedencia decidió distinto por acomodación. */
export type DescuentoMostrado = { etiqueta: string; tipo?: DescuentoAplicado["tipo"]; umbral?: number; pct?: number; porAcomodacion?: { acom: string; etiqueta: string | null }[] };

/**
 * Lo que se muestra del EBB / Long Stay de una cotización con estas acomodaciones: si todas usan el mismo, ese (como siempre); si la
 * precedencia decidió distinto por acomodación, una etiqueta por acomodación («Doble: EBB · 30+ días · 12 % · Triple: sin EBB / Long
 * Stay»): nunca la de una como si fuera de todas. Solo presentación: ningún importe depende de esto.
 */
export function descuentoMostrado(stay: DescuentoAplicado | null | undefined, porAcom: Record<string, DescuentoAplicado | null> | undefined, acoms: readonly string[]): DescuentoMostrado | null {
  const plano = (d: DescuentoAplicado | null | undefined): DescuentoMostrado | null => (d?.etiqueta ? { etiqueta: d.etiqueta, tipo: d.tipo, umbral: d.umbral, pct: d.pct } : null);
  const usadas = [...new Set(acoms)].sort((a, b) => ORDEN_ACOM.indexOf(a) - ORDEN_ACOM.indexOf(b));
  const de = (a: string) => (porAcom && a in porAcom ? porAcom[a] : stay ?? null);
  if (!usadas.length || usadas.every((a) => mismoDescuento(de(a), de(usadas[0])))) return plano(usadas.length ? de(usadas[0]) : stay);
  const porAcomodacion = usadas.map((a) => ({ acom: a, etiqueta: de(a)?.etiqueta ?? null }));
  return { etiqueta: porAcomodacion.map((x) => `${NOMBRE_ACOM[x.acom] ?? x.acom}: ${x.etiqueta ?? "sin EBB / Long Stay"}`).join(" · "), porAcomodacion };
}
