// #125 — «Un niño gratis por habitación» (con al menos 2 adultos) de una promoción por noche. PURO (sin I/O), compartido por Reservar, el buscador y la vista previa.
//
// Reglas aprobadas:
//  · Se evalúa HABITACIÓN por habitación; nunca se juntan adultos ni cupos entre habitaciones.
//  · Una habitación califica con al menos 2 adultos y al menos 1 niño ELEGIBLE; recibe UN solo niño gratis aunque tenga dos.
//  · Elegible = niño de tarifa Niño 1 / Niño 2 según la regla de edad del hotel (la que ya clasificó a los menores) y, SOLO si la promoción configura
//    su propia edad, además dentro de ese rango (años cumplidos, extremos incluidos). El infante nunca es elegible y conserva su tarifa base.
//  · F2 (auditoría): cada niño tiene una relación VERIFICABLE edad ↔ habitación ↔ tarifa cobrada (`asignarMenores`). El sistema cobra por ranura de tarifa (Niño 1 / Niño 2) de
//    cada habitación; la convención ya vigente en `distribuirPorHabitaciones` es: los niños, en el ORDEN EN QUE SE DECLARARON, ocupan las habitaciones en orden y, dentro de cada
//    una, el primero es Niño 1 y el segundo Niño 2. Con ella cada edad queda atada a una habitación y a una ranura, y el niño gratis es el PRIMER niño ELEGIBLE de la
//    habitación (en ese orden): se condona la tarifa REAL de ESE niño (la de su ranura), nunca «la primera» por defecto. La asignación se muestra en la descripción.
//  · El beneficio es SOLO alojamiento del hotel promocionado: se calcula con el neto de hotel PAGADERO de las NOCHES que ganó la promoción (motor compartido, ya con la promoción de estadía
//    y el descuento EBB/Long Stay aplicados), nunca con el PVP del paquete, que puede incluir vuelo, asistencia, traslados o tours.
//  · Si la promoción exige una edad propia y las edades exactas no están disponibles, el beneficio NO se puede resolver: se devuelve `bloqueo` con una explicación accionable
//    (quien llama rechaza la cotización); no se concede ni se retiene en silencio.

import { marcar, type NocheNinoGratis } from "../calc/paquetes.ts";

export const ADULTOS_MINIMOS_NINO_GRATIS = 2;

export type HabitacionOcupada = { indice: number; adultos: number; nino: number; nino2: number; infantes: number };
export type EdadNinoGratis = { edadMin: number | null; edadMax: number | null };
export type MotivoNinoGratis = "ok" | "adultos_insuficientes" | "sin_nino" | "sin_nino_elegible" | "edades_no_disponibles";
export type ClaseNinoGratis = "nino" | "nino2";
export const ETIQUETA_CLASE: Record<ClaseNinoGratis, string> = { nino: "Niño 1", nino2: "Niño 2" };

/** Un niño con su habitación y su tarifa cobrada. `habitacion` = `indice` de la habitación; `orden` = posición entre los niños, en el orden declarado. */
export type MenorAsignado = { orden: number; edad: number | null; habitacion: number; clase: ClaseNinoGratis };

export type ResultadoHabitacion = { indice: number; adultos: number; motivo: MotivoNinoGratis; gratis: MenorAsignado | null };
export type EvaluacionNinoGratis = {
  habitaciones: ResultadoHabitacion[];
  gratis: { nino: number; nino2: number };
  /** Hay una condición que no se puede evaluar con los datos recibidos (edad propia sin edades exactas): hay que pedirlas o rechazar; no se concede ni se retiene. */
  sinResolver: boolean;
};

const tieneRango = (c: EdadNinoGratis | null | undefined): c is EdadNinoGratis => !!c && (c.edadMin != null || c.edadMax != null);
export const edadEnRango = (edad: number, c: EdadNinoGratis): boolean =>
  Number.isFinite(edad) && (c.edadMin == null || edad >= c.edadMin) && (c.edadMax == null || edad <= c.edadMax);

/**
 * Relación niño ↔ habitación ↔ tarifa. Las «ranuras» se enumeran en el orden de la distribución (habitación 1: Niño 1, Niño 2; habitación 2: …) y el niño k, en el orden
 * declarado, ocupa la ranura k. `edades` = años cumplidos de los niños de tarifa NIÑO (sin infantes) de toda la reserva; si no coinciden en cantidad con las ranuras, `edad` queda null.
 */
export function asignarMenores(habitaciones: readonly HabitacionOcupada[], edades?: readonly number[] | null): MenorAsignado[] {
  const ranuras: { habitacion: number; clase: ClaseNinoGratis }[] = [];
  for (const h of habitaciones) {
    if (h.nino > 0) ranuras.push({ habitacion: h.indice, clase: "nino" });
    if (h.nino2 > 0) ranuras.push({ habitacion: h.indice, clase: "nino2" });
  }
  const conEdades = !!edades && edades.length === ranuras.length;
  return ranuras.map((r, orden) => ({ orden, edad: conEdades ? (edades as readonly number[])[orden] : null, habitacion: r.habitacion, clase: r.clase }));
}

/**
 * Decide, habitación por habitación, si recibe un niño gratis y CUÁL (el primer niño elegible de la habitación, con su tarifa real).
 * Sin edad propia de la promoción, todo niño de tarifa Niño es elegible (rige la regla de edad del hotel) y no hacen falta las edades exactas.
 */
export function evaluarNinoGratis(a: { habitaciones: readonly HabitacionOcupada[]; edad?: EdadNinoGratis | null; edades?: readonly number[] | null }): EvaluacionNinoGratis {
  const menores = asignarMenores(a.habitaciones, a.edades);
  const conRango = tieneRango(a.edad);
  const sinEdades = conRango && menores.some((m) => m.edad == null);
  const out: ResultadoHabitacion[] = [];
  const gratis = { nino: 0, nino2: 0 };
  let sinResolver = false;
  for (const h of a.habitaciones) {
    const base = { indice: h.indice, adultos: h.adultos };
    const suyos = menores.filter((m) => m.habitacion === h.indice);
    if (h.adultos < ADULTOS_MINIMOS_NINO_GRATIS) { out.push({ ...base, motivo: "adultos_insuficientes", gratis: null }); continue; }
    if (suyos.length === 0) { out.push({ ...base, motivo: "sin_nino", gratis: null }); continue; }
    if (sinEdades) { sinResolver = true; out.push({ ...base, motivo: "edades_no_disponibles", gratis: null }); continue; }
    const elegido = suyos.find((m) => !conRango || edadEnRango(m.edad as number, a.edad as EdadNinoGratis));
    if (!elegido) { out.push({ ...base, motivo: "sin_nino_elegible", gratis: null }); continue; }
    gratis[elegido.clase] += 1;
    out.push({ ...base, motivo: "ok", gratis: elegido });
  }
  return { habitaciones: out, gratis, sinResolver };
}

/** Cuánto aportó UNA promoción a lo condonado de un niño (procedencia). Σ `venta` de las promociones = `venta` del niño (el último absorbe el residuo del reparto). */
export type AporteNinoGratis = { promocion: string; noches: number; neto: number; venta: number };
/**
 * Un niño gratis concedido, UNO por niño real (habitación + posición + ranura), aunque varias promociones sucesivas le regalen noches distintas (R1 de la re-auditoría): se suma TODO el
 * alojamiento pagadero condonado de ese niño y su precio de venta se recompone y redondea UNA sola vez; las promociones quedan en `promociones` solo como procedencia.
 */
export type NinoGratisConcedido = {
  /** Nombres de las promociones que le dieron noches gratis, unidos por «, ». */
  promocion: string; promociones: AporteNinoGratis[];
  habitacion: number; orden: number; edad: number | null; clase: ClaseNinoGratis;
  noches: number; /** Neto de hotel pagadero condonado, sumado de TODAS sus promociones (moneda de los netos recibidos). */ neto: number; /** Aporte de ese neto al precio de venta (con el markup y, si hay TRM, convertido), recompuesto una vez. */ venta: number;
};
export type BeneficioNinoGratis = {
  /** Venta a restar (negativa o 0): Σ de lo condonado de cada niño gratis. SOLO alojamiento. */
  total: number;
  /** Costo neto del hotel que deja de generarse (positivo), en la moneda de los netos recibidos. */
  costoNeto: number;
  ninos: NinoGratisConcedido[];
  /** Habitaciones sin beneficio con su motivo. */
  sinBeneficio: ResultadoHabitacion[];
  /** Texto para la línea del contrato/cotización: promoción, habitación, edad y ranura. Sin importes internos. */
  descripcion: string;
  /** Explicaciones para quien cotiza (también de lo NO concedido). */
  explicaciones: string[];
  /** No se puede resolver con los datos recibidos: quien llama debe rechazar con este texto (no conceder ni retener en silencio). */
  bloqueo: string | null;
};

const c2 = (n: number) => Math.round(n * 100) / 100;
type SumaNoches = { neto: number; noches: number; edad: EdadNinoGratis; primera: number };
function sumasPorPromocion(noches: readonly NocheNinoGratis[] | undefined): Map<string, SumaNoches> {
  const m = new Map<string, SumaNoches>();
  for (const n of noches ?? []) {
    const x = m.get(n.promocion) ?? { neto: 0, noches: 0, edad: { edadMin: n.edadMin, edadMax: n.edadMax }, primera: n.indice };
    x.primera = Math.min(x.primera, n.indice); x.neto += n.neto; if (n.neto > 0) x.noches += 1; m.set(n.promocion, x);
  }
  return m;
}
const textoRango = (e: EdadNinoGratis) => (e.edadMin != null && e.edadMax != null ? `${e.edadMin}–${e.edadMax} años` : e.edadMin != null ? `desde ${e.edadMin} años` : `hasta ${e.edadMax} años`);

/**
 * Importe del beneficio. Cada promoción se evalúa por separado sobre SUS noches (una noche la gana una sola promoción: nunca dos niños gratis en la misma habitación y noche).
 * `nochesNino`/`nochesNino2` salen del motor (`ninoGratisNoches` al liquidar esas acomodaciones): netos YA pagaderos tras la promoción de estadía.
 */
export function calcularBeneficioNinoGratis(a: {
  habitaciones: readonly HabitacionOcupada[];
  edades?: readonly number[] | null;
  nochesNino?: readonly NocheNinoGratis[];
  nochesNino2?: readonly NocheNinoGratis[];
  pctMk: number;
  /** Aplica a la SUMA pagadera de las noches de una promoción el mismo descuento EBB / Long Stay / redondeo con que se calculó el neto de esa clase (por defecto, tal cual). */
  ajustarNeto?: (neto: number) => number;
  /** Neto de hotel (moneda del hotel) → moneda de la oferta, solo para la VENTA (TRM). Por defecto, tal cual. El costo queda en la moneda del hotel. */
  aMonedaVenta?: (neto: number) => number;
  /**
   * Lo que se condona del PRECIO DE VENTA del niño (con su redondeo). Si se da, sustituye a «neto con markup»: el llamador lo calcula con el MISMO compositor del precio
   * (`componerTarifa`): PVP del niño − PVP del niño sin el alojamiento condonado (vuelo y servicios se conservan y el redondeo se rehace sobre lo que sí se cobra), de modo que un niño
   * totalmente gratis no queda cobrado por un residuo de redondeo. `neto` = neto condonado, ya ajustado y en la moneda del hotel.
   */
  ventaCondonada?: (clase: ClaseNinoGratis, neto: number) => number;
}): BeneficioNinoGratis | null {
  const ajustar = a.ajustarNeto ?? ((n: number) => n);
  const aVenta = a.aMonedaVenta ?? ((n: number) => n);
  const pNino = sumasPorPromocion(a.nochesNino);
  const pNino2 = sumasPorPromocion(a.nochesNino2);
  // Orden cronológico (primera noche de cada promoción), no alfabético: así la procedencia se lee en el orden de la estadía.
  const primera = (n: string) => Math.min(pNino.get(n)?.primera ?? Infinity, pNino2.get(n)?.primera ?? Infinity);
  const nombres = [...new Set([...pNino.keys(), ...pNino2.keys()])].sort((x, y) => primera(x) - primera(y) || x.localeCompare(y));
  if (!nombres.length) return null;
  const ninos: NinoGratisConcedido[] = [];
  const sin = new Map<number, ResultadoHabitacion>();
  const explicaciones: string[] = [];
  let bloqueo: string | null = null;
  let total = 0, costo = 0;
  // R1: lo concedido se junta por NIÑO REAL antes de calcular su precio de venta.
  const porNino = new Map<string, { m: MenorAsignado; aportes: { promocion: string; noches: number; neto: number }[] }>();
  for (const nombre of nombres) {
    const ref = pNino.get(nombre) ?? pNino2.get(nombre)!;
    const ev = evaluarNinoGratis({ habitaciones: a.habitaciones, edad: ref.edad, edades: a.edades });
    if (ev.sinResolver) {
      bloqueo ??= `La promoción «${nombre}» incluye un niño gratis por habitación solo para niños de ${textoRango(ref.edad)}; para saber si aplica hace falta la edad de cada niño. Declara la edad de cada niño en la cotización (no solo la cantidad).`;
      continue;
    }
    for (const h of ev.habitaciones) {
      if (h.gratis) continue;
      if (!sin.has(h.indice)) sin.set(h.indice, h);
      const motivo = h.motivo === "adultos_insuficientes" ? `tiene menos de ${ADULTOS_MINIMOS_NINO_GRATIS} adultos`
        : h.motivo === "sin_nino_elegible" ? `ningún niño está entre ${textoRango(ref.edad)}` : null;
      if (motivo) explicaciones.push(`Niño gratis de «${nombre}» no aplica en la habitación ${h.indice + 1}: ${motivo}.`);
    }
    for (const h of ev.habitaciones) {
      const m = h.gratis;
      if (!m) continue;
      const fuente = (m.clase === "nino" ? pNino : pNino2).get(nombre);
      if (!fuente) continue; // esa ranura no tuvo noches de esta promoción: nada que condonar
      const clave = `${m.habitacion}|${m.orden}`;
      const x = porNino.get(clave) ?? { m, aportes: [] };
      x.aportes.push({ promocion: nombre, noches: fuente.noches, neto: fuente.neto });
      porNino.set(clave, x);
      explicaciones.push(`Niño gratis de «${nombre}»: habitación ${m.habitacion + 1}, ${m.edad != null ? `niño de ${m.edad} años` : "primer niño"}, tarifa ${ETIQUETA_CLASE[m.clase]}.`);
    }
  }
  for (const { m, aportes } of porNino.values()) {
    // El ajuste (EBB / Long Stay / redondeo por moneda) se aplica UNA vez a la suma pagadera de todas las promociones de ese niño: así, si todas sus noches fueron gratis,
    // lo condonado es exactamente lo que habría pagado (igual que el neto de su clase) y no sobra ni falta una unidad.
    const bruto = aportes.reduce((t, x) => t + x.neto, 0);
    const neto = ajustar(bruto);
    const venta = c2(a.ventaCondonada ? a.ventaCondonada(m.clase, neto) : marcar(aVenta(neto), a.pctMk));
    let resto = venta;
    const promociones: AporteNinoGratis[] = aportes.map((x, i) => {
      const parte = i === aportes.length - 1 ? c2(resto) : c2(bruto > 0 ? venta * (x.neto / bruto) : 0);
      resto -= parte;
      return { promocion: x.promocion, noches: x.noches, neto: c2(bruto > 0 ? neto * (x.neto / bruto) : 0), venta: parte };
    });
    ninos.push({
      promocion: aportes.map((x) => x.promocion).join(", "), promociones, habitacion: m.habitacion, orden: m.orden, edad: m.edad, clase: m.clase,
      noches: aportes.reduce((t, x) => t + x.noches, 0), neto: c2(neto), venta,
    });
    total += venta; costo += neto;
  }
  const sinBeneficio = [...sin.values()];
  if (!ninos.length) return { total: 0, costoNeto: 0, ninos, sinBeneficio, descripcion: "", explicaciones, bloqueo };
  const partes = ninos.map((n) => `hab. ${n.habitacion + 1}: ${n.edad != null ? `niño de ${n.edad} años` : "niño"} (${ETIQUETA_CLASE[n.clase]})`);
  const promos = [...new Set(ninos.flatMap((n) => n.promociones.map((p) => p.promocion)))].join(", ");
  return {
    total: -c2(total), costoNeto: c2(costo), ninos, sinBeneficio, explicaciones, bloqueo,
    descripcion: `Niño gratis por habitación · ${promos} (${partes.join("; ")})`,
  };
}

export const EDAD_NINO_GRATIS_TOPE = 17;
export type EntradaNinoGratis = { activo: boolean; edadMin?: number | null; edadMax?: number | null };

/**
 * Validación ÚNICA (formulario, Server Action y CHECK de la base): «un niño gratis» solo en una promoción de porcentaje con reglas; la edad propia es opcional,
 * pero si se configura lleva AMBOS extremos (enteros, 0–17, mínimo ≤ máximo). Sin edad propia rige la regla de edad del hotel; no hay edad por defecto.
 */
export function validarNinoGratis(e: EntradaNinoGratis, ctx: { tipo: string | null | undefined; conReglas: boolean }):
  { ok: true; valor: { nino_gratis: boolean; nino_gratis_edad_min: number | null; nino_gratis_edad_max: number | null } } | { ok: false; error: string } {
  const vacio = { nino_gratis: false, nino_gratis_edad_min: null, nino_gratis_edad_max: null };
  if (!e.activo) {
    if (e.edadMin != null || e.edadMax != null) return { ok: false, error: "La edad del niño gratis solo se guarda con «Un niño gratis por habitación» activo." };
    return { ok: true, valor: vacio };
  }
  if ((ctx.tipo ?? "tarifa") !== "descuento_pct") return { ok: false, error: "«Un niño gratis por habitación» solo se combina con una promoción de porcentaje." };
  if (!ctx.conReglas) return { ok: false, error: "«Un niño gratis por habitación» exige que la promoción tenga reglas (base vinculada o seguir la base ganadora)." };
  const min = e.edadMin ?? null, max = e.edadMax ?? null;
  if (min == null && max == null) return { ok: true, valor: { nino_gratis: true, nino_gratis_edad_min: null, nino_gratis_edad_max: null } };
  if (min == null || max == null) return { ok: false, error: "Indica la edad mínima y la máxima del niño gratis, o deja ambas vacías para usar la edad del hotel." };
  if (![min, max].every((n) => Number.isInteger(n) && n >= 0 && n <= EDAD_NINO_GRATIS_TOPE)) return { ok: false, error: `Las edades del niño gratis son años enteros entre 0 y ${EDAD_NINO_GRATIS_TOPE}.` };
  if (min > max) return { ok: false, error: "La edad mínima del niño gratis no puede ser mayor que la máxima." };
  return { ok: true, valor: { nino_gratis: true, nino_gratis_edad_min: min, nino_gratis_edad_max: max } };
}
