// #43/#60 entrega 4 — Promociones por grupo (puro, sin lecturas).
//
// Especificación §4 (historial X, Y, P, S, T, O). Aquí solo vive la ARITMÉTICA y la
// clasificación; el orden de resolución (base primero, luego su promoción) está en
// `lib/calc/paquetes.ts`, que llama a estas funciones.
//
// Tres familias de promoción, sin mezclar:
//  · Legado (todo lo que existía): precio = fila materializada de `tarifa_hotel`; «N noches,
//    1 gratis» sin regla = promedio (N−1)/N; monto fijo sin unidad = «unidad anterior» (su fila).
//    Nada de esto cambia.
//  · Por noche con reglas (nuevas): vinculadas a UNA base (`promo_base_id`); una regla por grupo
//    de la base (o una sola si la base no tiene grupos) con su valor y sus días. El precio sale de
//    la tarifa de la base que GANA esa noche: porcentaje, monto por persona/noche o por
//    habitación/noche. No crean disponibilidad (sin tarifa base no hay nada que descontar).
//  · De estadía (nuevas o legado): «N noches, 1 gratis» y monto por persona/estadía, ancladas a
//    la noche de entrada.
//
// El monto fijo NO aplica si supera el importe de su unidad (igual ⇒ 0) — §T.1.

export type UnidadMonto = "persona_noche" | "habitacion_noche" | "persona_estadia";
export type ReglaNocheGratis = "mas_barata" | "mas_cara" | "ultima";

/** Fragmento de `select` de `hotel_temporadas` con lo que la entrega 4 necesita, DENTRO de la
 * lectura de vigencias que cada cargador ya hace (0 solicitudes nuevas). Exige la 300 aplicada. */
export const SELECT_PROMO_VIGENCIA = "promo_base_id, descuento_unidad, noche_gratis_regla, dias_promo, hotel_promocion_reglas(grupo_id, valor, dias), hotel_promocion_combinacion(estado, alternativas, acumulable_ebb, acumulable_long_stay, orden)";

/** Acomodación de una columna de neto de `tarifa_hotel` (`neto_doble` → `doble`). */
export function acomodacionDeColumna(col: string): string {
  return col.startsWith("neto_") ? col.slice(5) : col;
}

export const UNIDADES_MONTO: readonly UnidadMonto[] = ["persona_noche", "habitacion_noche", "persona_estadia"];
export const REGLAS_NOCHE_GRATIS: readonly ReglaNocheGratis[] = ["mas_barata", "mas_cara", "ultima"];

export const ETIQUETA_UNIDAD: Record<UnidadMonto, string> = {
  persona_noche: "Por persona y noche",
  habitacion_noche: "Por habitación y noche",
  persona_estadia: "Por persona por estadía",
};
export const ETIQUETA_REGLA_NOCHE: Record<ReglaNocheGratis, string> = {
  mas_barata: "La noche más barata",
  mas_cara: "La noche más cara",
  ultima: "La última noche",
};

/** Regla de una promoción por noche para UN grupo de su base (`grupo_id` null = base sin grupos).
 * `dias` null = todos los días del grupo; si no, subconjunto no vacío (lo valida la base). */
export interface ReglaPromo {
  grupo_id: string | null;
  valor: number;
  dias: number[] | null;
}

/** Acomodaciones de habitación. Niños e infantes no generan habitación: no reciben el descuento por
 * habitación ni cuentan como ocupantes tarifados (S.2). Los ocupantes tarifados de cada habitación los
 * da la configuración del hotel (`hotel_acomodaciones.pax_tarifa`, con el mismo valor por defecto que
 * usa la reserva, `PAX_TARIFA_DEFAULT`): el motor nunca los supone. */
export const ACOMODACIONES_HABITACION: ReadonlySet<string> = new Set(["sencilla", "doble", "triple", "multiple"]);

/** Neto de UNA habitación en una noche con un descuento por habitación (T.1): `null` si no aplica
 * (no es habitación, ocupantes desconocidos, o el monto supera la tarifa de la habitación). Se calcula
 * sobre la habitación completa, sin dividir: el reparto por ocupante es solo de presentación. */
export function netoHabitacionConDescuento(valor: number, netoPersonaBase: number, acomodacion: string | undefined, ocupantes: number | undefined): number | null {
  if (!acomodacion || !ACOMODACIONES_HABITACION.has(acomodacion)) return null;
  if (!Number.isInteger(ocupantes) || (ocupantes as number) <= 0 || !Number.isFinite(valor) || valor <= 0) return null;
  const habitacion = netoPersonaBase * (ocupantes as number);
  return valor <= habitacion ? habitacion - valor : null;
}

/** Normaliza las reglas incrustadas (`hotel_promocion_reglas`) de una vigencia. Forma inesperada ⇒ fuera. */
export function normReglas(v: unknown): ReglaPromo[] {
  if (!Array.isArray(v)) return [];
  const out: ReglaPromo[] = [];
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const { grupo_id, valor, dias } = r as { grupo_id?: unknown; valor?: unknown; dias?: unknown };
    const val = Number(valor);
    if (!Number.isFinite(val) || val <= 0) continue;
    const ds = Array.isArray(dias) ? dias.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7) : null;
    if (ds && !ds.length) continue; // «elegir días» sin días no es una regla válida
    out.push({ grupo_id: typeof grupo_id === "string" ? grupo_id : null, valor: val, dias: ds });
  }
  return out;
}

/** Normaliza una lista de días (1–7); vacía o inválida ⇒ null (= todos). */
export function normDias(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const ds = [...new Set(v.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
  return ds.length ? ds : null;
}

export function esUnidadMonto(v: unknown): v is UnidadMonto {
  return typeof v === "string" && (UNIDADES_MONTO as readonly string[]).includes(v);
}
export function esReglaNocheGratis(v: unknown): v is ReglaNocheGratis {
  return typeof v === "string" && (REGLAS_NOCHE_GRATIS as readonly string[]).includes(v);
}

/**
 * Neto de una persona en UNA noche con la regla de una promoción por noche, sobre el neto de la
 * base ganadora. `null` = la regla no aplica (monto mayor que su unidad, acomodación sin
 * habitación, valor inválido): la noche conserva la base y la promoción no cuenta (§T.1, T.4).
 */
export function netoConRegla(
  tipo: "descuento_pct" | "descuento_monto",
  unidad: UnidadMonto | null | undefined,
  valor: number,
  netoBase: number,
  acomodacion: string | undefined,
  ocupantes?: number,
): number | null {
  if (!Number.isFinite(valor) || valor <= 0 || !Number.isFinite(netoBase)) return null;
  if (tipo === "descuento_pct") return valor < 100 ? netoBase * (1 - valor / 100) : null;
  if (unidad === "persona_noche") return valor <= netoBase ? netoBase - valor : null;
  if (unidad === "habitacion_noche") {
    // Por persona = presentación del total de la habitación; el total exacto lo lleva el motor aparte.
    const hab = netoHabitacionConDescuento(valor, netoBase, acomodacion, ocupantes);
    return hab == null ? null : hab / (ocupantes as number);
  }
  return null; // persona/estadía se resuelve a nivel de estadía
}

/** Índice de la noche a bonificar según la regla, entre las PERMITIDAS (Y.1.2). Empate de importe
 * ⇒ la primera en el calendario (P.1.5). `null` = no aplica (ninguna permitida, o «última» con su
 * día no permitido: no se sustituye por otra). */
export function nocheABonificar(precios: readonly number[], diasSemana: readonly number[], regla: ReglaNocheGratis, permitidos: readonly number[] | null): number | null {
  const ok = (i: number) => !permitidos || permitidos.includes(diasSemana[i]);
  if (regla === "ultima") {
    const i = precios.length - 1;
    return i >= 0 && ok(i) ? i : null;
  }
  let mejor: number | null = null;
  for (let i = 0; i < precios.length; i++) {
    if (!ok(i)) continue;
    if (mejor == null || (regla === "mas_barata" ? precios[i] < precios[mejor] : precios[i] > precios[mejor])) mejor = i;
  }
  return mejor;
}

/**
 * Reparto EXACTO de presentación de un importe entre `partes` ocupantes (§T.3): se expresa en la
 * unidad mínima de la moneda (`decimales`), cada uno recibe el cociente y los primeros `residuo`
 * ocupantes, en orden fijo, una unidad mínima más. La suma es siempre el importe exacto.
 * Ej.: 20.000 entre 3 con 2 decimales ⇒ 6.666,67 + 6.666,67 + 6.666,66.
 */
export function repartirExacto(importe: number, partes: number, decimales = 2): number[] {
  if (!Number.isInteger(partes) || partes <= 0) return [];
  const escala = 10 ** decimales;
  const total = Math.round(importe * escala);
  const signo = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const q = Math.floor(abs / partes), r = abs % partes;
  return Array.from({ length: partes }, (_, i) => (signo * (q + (i < r ? 1 : 0))) / escala);
}

// ── Entrega 5 (301): combinación de una promoción con EBB / Long Stay ─────────────────────────────
export type Alternativa = "promocion" | "ebb" | "long_stay";
export interface CombinacionPromo {
  estado: "heredada" | "configurada" | "pendiente";
  alternativas: ("ebb" | "long_stay")[];
  acumulable_ebb?: boolean | null;
  acumulable_long_stay?: boolean | null;
  orden?: Alternativa[] | null;
}
/** Normaliza la fila incrustada (`hotel_promocion_combinacion`, objeto o arreglo de uno). Forma inesperada ⇒ null. */
export function normCombinacion(v: unknown): CombinacionPromo | null {
  const o = Array.isArray(v) ? v[0] : v;
  if (!o || typeof o !== "object") return null;
  const c = o as Record<string, unknown>;
  if (c.estado !== "heredada" && c.estado !== "configurada" && c.estado !== "pendiente") return null;
  const alts = Array.isArray(c.alternativas) ? c.alternativas.filter((x): x is "ebb" | "long_stay" => x === "ebb" || x === "long_stay") : [];
  const orden = Array.isArray(c.orden) ? c.orden.filter((x): x is Alternativa => x === "promocion" || x === "ebb" || x === "long_stay") : null;
  return { estado: c.estado, alternativas: alts, acumulable_ebb: c.acumulable_ebb as boolean | null, acumulable_long_stay: c.acumulable_long_stay as boolean | null, orden };
}

