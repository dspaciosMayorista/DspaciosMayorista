// Motor de cálculo del armado de paquetes (funciones puras y testeables).
//
// Flujo de negocio:  PRODUCTO (costos netos) → PAQUETES (margen) → TARIFARIO.
//
// Tarifa por persona por paquete:
//   aporte_hotel    = costo_hotel / (1 - %mk)          (hotel SIEMPRE con mk)
//   aporte_servicio = costo_serv  / (1 - %mk)          (servicio SIEMPRE con mk)
//   aporte_vuelo    = aplica_mk ? costo_tiquete/(1-%mk) : costo_tiquete + TA
//                     (solo el VUELO decide mk o TA = Tarifa Administrativa)
//   PVP             = aporte_hotel + Σ aporte_servicio + aporte_vuelo
//   impuesto (BNC)  = valor neto del tiquete  ó  valor fijo
//   base_comisionable = PVP − impuesto                 (⇒ PVP − IMP = base)
//
// El hotel se liquida NOCHE POR NOCHE: si la estadía cruza dos temporadas del
// hotel, cada noche usa la tarifa de la temporada en que cae esa fecha.

const MS_DIA = 86_400_000;

export type TemporadaTipo = "tarifa" | "descuento_pct" | "descuento_monto" | "promo_noche_gratis";

export interface RangoFechas { fecha_inicio: string; fecha_fin: string }

export interface TemporadaRango {
  nombre: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  // Fase 2/3: prioridad (gana la más alta), vigencia de compra y promociones.
  prioridad?: number;            // default 1
  compra_inicio?: string | null; // vigencia de compra (null = siempre disponible)
  compra_fin?: string | null;
  tipo?: TemporadaTipo;          // default 'tarifa'
  descuento_valor?: number | null; // % (descuento_pct) o monto por pax (descuento_monto)
  // Fase 4: múltiples rangos de cobertura + black-outs (exclusiones).
  rangos?: RangoFechas[];        // si está vacío, se usa fecha_inicio/fecha_fin
  blackouts?: RangoFechas[];     // fechas excluidas de la cobertura
  min_noches?: number;           // mínimo de noches de esta vigencia (default 1)
  // Fase 5: restringir esta vigencia a UN régimen (null = aplica a todos). Para
  // 'promo_noche_gratis', min_noches se reinterpreta como "noches mínimas de la
  // ESTADÍA para que la promo aplique" (no es un mínimo de noches para vender).
  regimen_restringido?: string | null;
}

/** Fecha de hoy (yyyy-mm-dd) en zona horaria Colombia, para la vigencia de compra. */
export function hoyISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

function enRango(t0: number, ini: string | null, fin: string | null): boolean {
  if (!ini || !fin) return false;
  const i = new Date(`${ini}T00:00:00`).getTime();
  const f = new Date(`${fin}T00:00:00`).getTime();
  return t0 >= i && t0 <= f;
}

// Motivo detallado por el que UNA temporada, aislada, no cubre una fecha —
// antes de mirar vigencia de compra ni régimen. `cubre`: la fecha cae en
// alguno de sus rangos Y no está en blackout. `en_blackout`: cae en un
// rango, pero también en un blackout que lo excluye. `sin_rango`: no cae en
// ningún rango de esta temporada (blackout ni se evalúa: es irrelevante si
// el rango base ya no cubre).
type CoberturaTemporada = "cubre" | "en_blackout" | "sin_rango";

function coberturaTemporada(t: TemporadaRango, t0: number): CoberturaTemporada {
  // Cobertura: si hay rangos múltiples, se usan; si no, el rango simple legado.
  const rangos = t.rangos && t.rangos.length
    ? t.rangos
    : (t.fecha_inicio && t.fecha_fin ? [{ fecha_inicio: t.fecha_inicio, fecha_fin: t.fecha_fin }] : []);
  const dentro = rangos.some((r) => enRango(t0, r.fecha_inicio, r.fecha_fin));
  if (!dentro) return "sin_rango";
  // Black-out: si la fecha cae en una exclusión, la temporada NO cubre esa noche.
  if (t.blackouts && t.blackouts.some((b) => enRango(t0, b.fecha_inicio, b.fecha_fin))) return "en_blackout";
  return "cubre";
}

// `cubreFecha` sigue siendo el booleano que ya usaba el resto del motor —
// se redefine EN TÉRMINOS de `coberturaTemporada` (no se duplica ninguna
// regla): mismo comportamiento exacto, ahora con el detalle observable
// disponible para quien lo necesite (ver `resolverNocheDetallado`).
function cubreFecha(t: TemporadaRango, t0: number): boolean {
  return coberturaTemporada(t, t0) === "cubre";
}

/** ¿La vigencia de compra cubre HOY? (sin rango = siempre disponible). */
function compraVigente(t: TemporadaRango, hoy: string): boolean {
  if (t.compra_inicio && hoy < t.compra_inicio) return false;
  if (t.compra_fin && hoy > t.compra_fin) return false;
  return true;
}

/**
 * Entradas que cubren la fecha, están en vigencia de compra y (si la vigencia
 * está restringida a un régimen) coinciden con el régimen que se está
 * liquidando, por prioridad desc. `regimen` se omite para usos ajenos al hotel
 * (ej. servicio_temporadas, que no tiene este campo).
 */
function entradasNoche(t0: number, temporadas: TemporadaRango[], hoy: string, regimen?: string): TemporadaRango[] {
  return temporadas
    .filter((t) => cubreFecha(t, t0) && compraVigente(t, hoy) && (t.regimen_restringido == null || t.regimen_restringido === regimen))
    .sort((a, b) => (b.prioridad ?? 1) - (a.prioridad ?? 1));
}

// Motivo por el que una NOCHE completa (todas las temporadas del hotel, ya
// combinadas) no resolvió ninguna entrada — lo que `entradasNoche` colapsa
// hoy en una lista vacía sin decir por qué. `en_blackout`: existe al menos
// una temporada cuyo RANGO cubriría la fecha, pero un blackout la excluye
// (se prioriza este motivo sobre los demás: es la señal más específica —
// "sí hay una tarifa para esta fecha, pero está bloqueada a propósito").
// `fuera_de_vigencia_compra`: ninguna está en blackout, pero al menos una
// cubre el rango (y el régimen) y solo falla por `compraVigente`.
// `sin_cobertura`: ninguna temporada, de ningún tipo, tiene un rango que
// toque esta fecha (con el régimen pedido).
export type MotivoNocheNoResuelta = "en_blackout" | "fuera_de_vigencia_compra" | "sin_cobertura";

export type ResolucionNocheDetallada =
  | { ok: true; temporada: TemporadaRango }
  | { ok: false; motivo: MotivoNocheNoResuelta; temporadasImplicadas: TemporadaRango[] };

/**
 * Igual que `entradasNoche(...)[0]`, pero cuando NO hay ganadora explica
 * POR QUÉ — reutilizando exactamente los mismos helpers de cobertura/
 * blackout/vigencia de compra, sin duplicar ni relajar ninguna regla. La
 * selección real (prioridad, régimen, vigencia de compra) es idéntica a la
 * de `entradasNoche`: este resolver solo hace observable la razón que antes
 * se perdía al colapsar todo en `null`.
 */
export function resolverNocheDetallado(
  t0: number,
  temporadas: TemporadaRango[],
  hoy: string,
  regimen?: string
): ResolucionNocheDetallada {
  const ents = entradasNoche(t0, temporadas, hoy, regimen);
  if (ents.length > 0) return { ok: true, temporada: ents[0] };

  const coincideRegimen = (t: TemporadaRango) => t.regimen_restringido == null || t.regimen_restringido === regimen;

  const enBlackout = temporadas.filter((t) => coincideRegimen(t) && coberturaTemporada(t, t0) === "en_blackout");
  if (enBlackout.length > 0) {
    return { ok: false, motivo: "en_blackout", temporadasImplicadas: enBlackout };
  }

  const cubrenPeroSinCompraVigente = temporadas.filter(
    (t) => coincideRegimen(t) && coberturaTemporada(t, t0) === "cubre" && !compraVigente(t, hoy)
  );
  if (cubrenPeroSinCompraVigente.length > 0) {
    return { ok: false, motivo: "fuera_de_vigencia_compra", temporadasImplicadas: cubrenPeroSinCompraVigente };
  }

  return { ok: false, motivo: "sin_cobertura", temporadasImplicadas: [] };
}

/** Normaliza un valor jsonb a una lista de rangos de fechas válidos. */
export function normRangos(v: unknown): RangoFechas[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (r): r is RangoFechas =>
      !!r && typeof r === "object" &&
      typeof (r as { fecha_inicio?: unknown }).fecha_inicio === "string" &&
      typeof (r as { fecha_fin?: unknown }).fecha_fin === "string"
  );
}

/** Mapea una fila de `hotel_temporadas` (con los campos de promo) a TemporadaRango. */
export function toTemporadaRango(t: {
  nombre: string; fecha_inicio: string | null; fecha_fin: string | null;
  prioridad?: number | null; compra_inicio?: string | null; compra_fin?: string | null;
  tipo?: string | null; descuento_valor?: number | null;
  rangos?: unknown; blackouts?: unknown; min_noches?: number | null;
  regimen_restringido?: string | null;
}): TemporadaRango {
  return {
    nombre: t.nombre,
    fecha_inicio: t.fecha_inicio,
    fecha_fin: t.fecha_fin,
    prioridad: t.prioridad ?? 1,
    compra_inicio: t.compra_inicio ?? null,
    compra_fin: t.compra_fin ?? null,
    tipo: (t.tipo ?? "tarifa") as TemporadaTipo,
    descuento_valor: t.descuento_valor ?? null,
    rangos: normRangos(t.rangos),
    blackouts: normRangos(t.blackouts),
    min_noches: t.min_noches ?? 1,
    regimen_restringido: t.regimen_restringido ?? null,
  };
}

/**
 * Mínimo de noches aplicable a una estadía: el de la temporada (vigencia) que
 * cubre la NOCHE DE ENTRADA (la de mayor prioridad). Default 1 si no aplica.
 * Sirve para filtrar hoteles cuando se busca menos noches de las exigidas.
 */
export function minNochesAplicable(temporadas: TemporadaRango[], fechaIda: string, hoy = hoyISO()): number {
  const t0 = new Date(`${fechaIda}T00:00:00`).getTime();
  // 'promo_noche_gratis' no participa: su min_noches significa otra cosa (ver
  // promoNocheGratisFactor), no un mínimo de noches para poder vender.
  const top = entradasNoche(t0, temporadas, hoy).filter((t) => (t.tipo ?? "tarifa") !== "promo_noche_gratis")[0];
  return Math.max(1, top?.min_noches ?? 1);
}

/** Redondeo a peso entero (COP). */
export function redondear(n: number): number {
  return Math.round(n);
}

/**
 * Redondea un precio de VENTA hacia ARRIBA al siguiente múltiplo de mil (COP).
 * Ej.: 1.625.200 → 1.626.000 · 1.625.001 → 1.626.000 · 1.625.000 → 1.625.000.
 */
export function redondearMilArriba(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n / 1000) * 1000;
}

/** Noches entre dos fechas ISO (yyyy-mm-dd). */
export function noches(fechaIda: string, fechaRegreso: string): number {
  const a = new Date(`${fechaIda}T00:00:00`).getTime();
  const b = new Date(`${fechaRegreso}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / MS_DIA));
}

/**
 * Nombre de la temporada-base (tipo 'tarifa') de mayor prioridad que cubre una
 * fecha. Ignora la vigencia de compra (es para diagnóstico de tarifas faltantes).
 */
export function temporadaParaFecha(
  fecha: Date,
  temporadas: TemporadaRango[]
): string | null {
  const t0 = fecha.getTime();
  const base = temporadas
    .filter((t) => (t.tipo ?? "tarifa") === "tarifa" && cubreFecha(t, t0))
    .sort((a, b) => (b.prioridad ?? 1) - (a.prioridad ?? 1))[0];
  return base?.nombre ?? null;
}

/**
 * Nombre de la temporada de mayor prioridad que cubre una fecha Y está en
 * vigencia de compra. Para SERVICIOS por temporada: la fecha del viaje elige la
 * tarifa, respetando la vigencia de compra (igual que el hotel). Devuelve null si
 * ninguna temporada con fechas aplica (→ se usa la tarifa 'GENERAL').
 *
 * Contrato público sin cambios: delega en `resolverNocheDetallado` (mismo
 * `entradasNoche[0]` de siempre) y solo se queda con el nombre — quien
 * necesite distinguir blackout de "sin cobertura" debe llamar al resolver
 * detallado directamente.
 */
export function temporadaVigenteParaFecha(
  fecha: Date,
  temporadas: TemporadaRango[],
  hoy: string = hoyISO()
): string | null {
  const r = resolverNocheDetallado(fecha.getTime(), temporadas, hoy);
  return r.ok ? r.temporada.nombre : null;
}

/**
 * Neto efectivo de UNA noche, resolviendo por prioridad + vigencia de compra.
 *
 * Regla definitiva (corrección de esta ronda): una vigencia de
 * `hotel_temporadas` NUNCA genera, deriva ni modifica precios — solo define
 * nombre, fechas, prioridad, restricciones y clasificación. El ÚNICO precio
 * válido es una fila materializada en `tarifa_hotel` (`netoPorTemporada[nombre]
 * != null` para el combo categoría/régimen/acomodación actual). Por eso se
 * recorren las vigencias candidatas EN ORDEN DE PRIORIDAD y se usa la
 * PRIMERA que tenga neto materializado para este combo — sea de tipo
 * 'tarifa' (la base) o una promoción (`descuento_pct`/`descuento_monto`) con
 * su propia fila (típicamente generada por `generarTarifasDubai`, ver
 * migración 179). Una vigencia de tipo descuento SIN fila materializada para
 * este combo NUNCA calcula nada desde una base — se ignora por completo y la
 * resolución sigue bajando por prioridad hasta encontrar una que sí tenga
 * precio (puede ser la base, u otra promoción de menor prioridad). Si
 * ninguna vigencia candidata tiene neto materializado, devuelve `null` (no
 * se publica esa noche) — nunca se inventa un precio.
 *
 * Antes existía un camino "legacy" que, para una promoción sin fila propia,
 * recalculaba `baseNeto × (1 − descuento_valor/100)` desde la tarifa-base —
 * quedó RETIRADO explícitamente: cambiar `descuento_valor` de una vigencia
 * sin regenerar tarifas ya NO cambia ningún precio publicado.
 */
export function resolverNetoNocheDetallado(
  t0: number,
  temporadas: TemporadaRango[],
  netoPorTemporada: Record<string, number | null | undefined>,
  hoy: string,
  regimen?: string,
  // Nombres de temporada cuya fila de `tarifa_hotel` es PRECIO FINAL
  // AUTORITATIVO — típicamente una promoción Dubai generada por
  // `generarTarifasDubai` (`tarifa_hotel.precio_final_autoritativo`, ver
  // migración 179). Ya NO decide si una vigencia puede ganar (eso lo decide
  // únicamente tener neto materializado, ver arriba) — solo alimenta el
  // detalle `precioFinalAutoritativo` del resultado (trazabilidad/auditoría,
  // persistido en `tarifario_resultado`, nunca usado para el cálculo).
  // `undefined`/set vacío → `precioFinalAutoritativo` sale `false` siempre.
  precioFinalTemporadas?: ReadonlySet<string>
): {
  neto: number;
  /** Nombre de la fila de `tarifa_hotel` que aportó el NETO — SIEMPRE la
   * MISMA vigencia que `temporadaGanadora` (ya no hay camino que recalcule
   * desde una base distinta a la que ganó). Fuente para resolver edad/
   * condiciones de tarifa (ver `liquidarHotelNochesConTemporadas`). */
  temporadaTarifa: string;
  /** Nombre de la vigencia que ganó esta noche — la primera, por prioridad,
   * que tuviera neto materializado para este combo. Idéntico a
   * `temporadaTarifa` (se conservan ambos campos por compatibilidad con los
   * llamadores existentes). */
  temporadaGanadora: string;
  /** `true` si la vigencia ganadora es de tipo distinto a 'tarifa' (cualquier
   * descuento_pct/descuento_monto/promo_noche_gratis, generado por Dubai o
   * creado a mano) — clasificación GENERAL, independiente de
   * `precioFinalAutoritativo` (ver lib/tarifario/identidadTemporada.ts, que
   * reusa este mismo criterio). */
  esPromocion: boolean;
  /** `true` si la fila que aportó el neto está marcada
   * `tarifa_hotel.precio_final_autoritativo` (migración 179) — detalle
   * técnico de trazabilidad, NUNCA usar para decidir "es promoción" en UI. */
  precioFinalAutoritativo: boolean;
} | null {
  // 'promo_noche_gratis' no es un precio por noche (ver promoNocheGratisFactor):
  // se excluye de la resolución por-noche para que nunca "gane" un slot aquí.
  const ents = entradasNoche(t0, temporadas, hoy, regimen).filter((t) => (t.tipo ?? "tarifa") !== "promo_noche_gratis");
  for (const entry of ents) {
    const neto = netoPorTemporada[entry.nombre];
    // Sin fila materializada para ESTE combo → esta vigencia no puede
    // aportar un precio (ni recalculado, ni de ningún tipo) — se ignora y se
    // sigue bajando por prioridad a la siguiente candidata.
    if (neto == null) continue;
    const esPromocion = (entry.tipo ?? "tarifa") !== "tarifa";
    return {
      neto,
      temporadaTarifa: entry.nombre,
      temporadaGanadora: entry.nombre,
      esPromocion,
      precioFinalAutoritativo: esPromocion && !!precioFinalTemporadas?.has(entry.nombre),
    };
  }
  return null;
}

export function netoNoche(
  t0: number,
  temporadas: TemporadaRango[],
  netoPorTemporada: Record<string, number | null | undefined>,
  hoy: string,
  regimen?: string,
  precioFinalTemporadas?: ReadonlySet<string>
): number | null {
  const r = resolverNetoNocheDetallado(t0, temporadas, netoPorTemporada, hoy, regimen, precioFinalTemporadas);
  return r ? r.neto : null;
}

/**
 * Resolución DETALLADA y determinista de "N noches, 1 gratis" para una
 * estadía — a diferencia de tarifa/descuento_pct/descuento_monto (resueltas
 * NOCHE POR NOCHE), esta promo depende del TOTAL de noches de la estadía, así
 * que no cabe en `resolverNetoNocheDetallado`/`netoNoche`. Se ancla a la
 * NOCHE DE ENTRADA (igual criterio que `minNochesAplicable`): entre las
 * vigencias que cubren esa noche, están en vigencia de compra y coinciden en
 * régimen (si están restringidas) — el MISMO orden de prioridad que usa
 * `entradasNoche` en todo el resto del motor — toma la primera de tipo
 * 'promo_noche_gratis' cuya estadía cumpla su `min_noches`. Si aplica, se
 * regala EXACTAMENTE 1 noche sin importar si la estadía tiene 3, 4 o 10
 * (`factor = (N-1)/N`). `procedencia` ya viene con la forma exacta que exige
 * la agregación de `ProcedenciaNoche` (`esPromocion: true` — es una promo —,
 * `precioFinalAutoritativo: false` — no aporta una fila de neto propia, solo
 * descuenta el total ya liquidado) para que ningún llamador tenga que
 * reconstruirla ni pueda hacerlo distinto. Única fuente de verdad: TODOS los
 * liquidadores (`liquidarHotelNoches`/`liquidarHotelNochesConTemporadas`/
 * `liquidarHotelMasBarato`/`liquidarHotelMasBaratoConTemporada`) llaman a
 * ESTA función — nunca reimplementan el criterio de selección — así que
 * cálculo y procedencia nunca pueden divergir. `null` = no aplica ninguna
 * promo "N noches, 1 gratis" (estadía de 1 noche, sin vigencia que la cubra,
 * o ninguna cumple `min_noches`).
 */
export function resolverNocheGratisDetallado(
  temporadas: TemporadaRango[],
  fechaIda: string,
  numNoches: number,
  hoy: string = hoyISO(),
  regimen?: string
): { factor: number; procedencia: ProcedenciaNoche } | null {
  if (numNoches <= 1) return null;
  const t0 = new Date(`${fechaIda}T00:00:00`).getTime();
  if (Number.isNaN(t0)) return null;
  const top = entradasNoche(t0, temporadas, hoy, regimen)
    .find((t) => (t.tipo ?? "tarifa") === "promo_noche_gratis" && numNoches >= (t.min_noches ?? 1));
  if (!top) return null;
  return {
    factor: (numNoches - 1) / numNoches,
    procedencia: { temporadaGanadora: top.nombre, esPromocion: true, precioFinalAutoritativo: false },
  };
}

/**
 * ¿Aplica una promo "N noches, 1 gratis" para esta estadía? Envoltorio
 * delgado sobre `resolverNocheGratisDetallado` — SOLO el factor, sin
 * identidad. Devuelve 1 = sin promo; (N-1)/N = 1 noche gratis de N.
 */
export function promoNocheGratisFactor(
  temporadas: TemporadaRango[],
  fechaIda: string,
  numNoches: number,
  hoy: string = hoyISO(),
  regimen?: string
): number {
  return resolverNocheGratisDetallado(temporadas, fechaIda, numNoches, hoy, regimen)?.factor ?? 1;
}

/**
 * Liquida el costo neto del hotel para una estadía, sumando noche por noche.
 * `netoPorTemporada` mapea nombre-de-temporada → neto de la acomodación elegida.
 * `hoy` (yyyy-mm-dd) evalúa la vigencia de compra; por defecto, hoy en Colombia.
 * `regimen` filtra vigencias restringidas a un solo régimen (ver `regimen_restringido`)
 * y también gobierna si aplica una promo "N noches, 1 gratis" (`promoNocheGratisFactor`).
 * Devuelve `null` si alguna noche no tiene tarifa aplicable.
 */
export function liquidarHotelNoches(args: {
  fechaIda: string;
  numNoches: number;
  temporadas: TemporadaRango[];
  netoPorTemporada: Record<string, number | null | undefined>;
  hoy?: string;
  regimen?: string;
  precioFinalTemporadas?: ReadonlySet<string>;
}): number | null {
  if (args.numNoches <= 0) return null;
  const base = new Date(`${args.fechaIda}T00:00:00`).getTime();
  if (Number.isNaN(base)) return null;
  const hoy = args.hoy ?? hoyISO();
  let total = 0;
  for (let n = 0; n < args.numNoches; n++) {
    const neto = netoNoche(base + n * MS_DIA, args.temporadas, args.netoPorTemporada, hoy, args.regimen, args.precioFinalTemporadas);
    if (neto == null) return null;
    total += neto;
  }
  const nocheGratis = resolverNocheGratisDetallado(args.temporadas, args.fechaIda, args.numNoches, hoy, args.regimen);
  return nocheGratis ? total * nocheGratis.factor : total;
}

/** Identidad de la vigencia que ganó UNA noche — temporada, si es promoción
 * (`hotel_temporadas.tipo !== 'tarifa'`) y si esa fila está marcada precio
 * final autoritativo (migración 179). Unidad de agregación de `procedencia`
 * (ver `liquidarHotelNochesConTemporadas`/`liquidarHotelMasBaratoConTemporada`). */
export type ProcedenciaNoche = {
  temporadaGanadora: string;
  esPromocion: boolean;
  precioFinalAutoritativo: boolean;
};

/** Deduplica una lista de identidades de noche por la TUPLA completa
 * `[temporadaGanadora, esPromocion, precioFinalAutoritativo]` — nunca solo
 * por nombre (dos entradas con el mismo nombre pero booleanos distintos, ej.
 * por un dato mal cargado, no deben colapsar en una sola silenciosamente) ni
 * por concatenación de string (`"${a}|${b}"` es ambigua: un nombre de
 * temporada con "|" literal podría colisionar con otro). La clave es un mapa
 * anidado real (temporada → esPromocion → Set de precioFinalAutoritativo) —
 * comparación estructural determinista, sin construir ningún string.
 * Conserva el orden de PRIMERA aparición (cronológico: noche 1 antes que
 * noche 2), para que el resultado sea determinista y legible sin depender
 * del orden de iteración de un Map/Set. */
function deduplicarProcedencia(entradas: ProcedenciaNoche[]): ProcedenciaNoche[] {
  const vistos = new Map<string, Map<boolean, Set<boolean>>>();
  const out: ProcedenciaNoche[] = [];
  for (const e of entradas) {
    let porPromocion = vistos.get(e.temporadaGanadora);
    if (!porPromocion) {
      porPromocion = new Map<boolean, Set<boolean>>();
      vistos.set(e.temporadaGanadora, porPromocion);
    }
    let porAutoritativo = porPromocion.get(e.esPromocion);
    if (!porAutoritativo) {
      porAutoritativo = new Set<boolean>();
      porPromocion.set(e.esPromocion, porAutoritativo);
    }
    if (porAutoritativo.has(e.precioFinalAutoritativo)) continue;
    porAutoritativo.add(e.precioFinalAutoritativo);
    out.push(e);
  }
  return out;
}

/**
 * Igual que `liquidarHotelNoches`, pero además devuelve:
 *  - el nombre de CADA temporada 'tarifa' que aportó neto/precio a alguna
 *    noche de la estadía (`temporadasTarifa`, sin duplicados) — para
 *    resolver, después, la regla de edad efectiva a partir de las filas de
 *    `tarifa_hotel` que realmente se usaron;
 *  - `procedencia`: la identidad REAL de TODAS las noches que aportaron al
 *    total, deduplicada por temporada — NUNCA solo la de la noche de
 *    entrada (defecto corregido: una estadía fija que cruza temporadas, ej.
 *    noche 1 tarifa base + noche 2 promoción, reportaba antes SOLO la
 *    identidad del checkin, aunque el total ya sumara ambas). Si la estadía
 *    completa resolvió una única temporada, `procedencia` trae UN solo
 *    elemento (identidad "uniforme" para quien la consuma); si cruzó más de
 *    una, trae varios — nunca se elige arbitrariamente una sola.
 * Devuelve `null` en los mismos casos que `liquidarHotelNoches`.
 */
export function liquidarHotelNochesConTemporadas(args: {
  fechaIda: string;
  numNoches: number;
  temporadas: TemporadaRango[];
  netoPorTemporada: Record<string, number | null | undefined>;
  hoy?: string;
  regimen?: string;
  precioFinalTemporadas?: ReadonlySet<string>;
}): {
  total: number;
  temporadasTarifa: string[];
  procedencia: ProcedenciaNoche[];
} | null {
  if (args.numNoches <= 0) return null;
  const base = new Date(`${args.fechaIda}T00:00:00`).getTime();
  if (Number.isNaN(base)) return null;
  const hoy = args.hoy ?? hoyISO();
  let total = 0;
  const vistas = new Set<string>();
  const procedenciaCruda: ProcedenciaNoche[] = [];
  for (let n = 0; n < args.numNoches; n++) {
    const r = resolverNetoNocheDetallado(base + n * MS_DIA, args.temporadas, args.netoPorTemporada, hoy, args.regimen, args.precioFinalTemporadas);
    if (r == null) return null;
    total += r.neto;
    vistas.add(r.temporadaTarifa);
    procedenciaCruda.push({ temporadaGanadora: r.temporadaGanadora, esPromocion: r.esPromocion, precioFinalAutoritativo: r.precioFinalAutoritativo });
  }
  // "N noches, 1 gratis" no aporta neto propio (descuenta el total ya
  // liquidado noche por noche), pero SÍ es procedencia real de la estadía —
  // sin esto, una estadía toda en tarifa base con noche gratis se mostraría
  // como "Tarifa base" ocultando que una noche completa salió gratis.
  const nocheGratis = resolverNocheGratisDetallado(args.temporadas, args.fechaIda, args.numNoches, hoy, args.regimen);
  if (nocheGratis) procedenciaCruda.push(nocheGratis.procedencia);
  return {
    total: nocheGratis ? total * nocheGratis.factor : total,
    temporadasTarifa: Array.from(vistas),
    procedencia: deduplicarProcedencia(procedenciaCruda),
  };
}

/**
 * Costo del hotel para el TARIFARIO ("desde"): la opción más económica.
 * Recorre noche por noche la ventana de viaje [desde, hasta] (resolviendo
 * prioridad, vigencia de compra y promos por día) y toma el menor neto/noche;
 * lo multiplica por `numNoches`. Así el tarifario publica la tarifa más baja
 * disponible (baja/promo) sin atarse a un mes; al reservar se re-liquida por la
 * fecha real. Devuelve `null` si ninguna noche de la ventana tiene tarifa.
 */
type ArgsMasBarato = {
  desde: string;
  hasta: string;
  numNoches: number;
  temporadas: TemporadaRango[];
  netoPorTemporada: Record<string, number | null | undefined>;
  hoy?: string;
  regimen?: string;
  precioFinalTemporadas?: ReadonlySet<string>;
};

/**
 * Busca, noche por noche en [desde, hasta], la de MENOR neto — devuelve su
 * resolución DETALLADA completa (no solo el número), para que tanto el total
 * como la IDENTIDAD (qué vigencia ganó esa noche puntual, no la de `desde`)
 * salgan de la MISMA búsqueda. Única implementación del recorrido — usada por
 * `liquidarHotelMasBarato` (solo el número, compatibilidad) y por
 * `liquidarHotelMasBaratoConTemporada` (número + procedencia).
 */
function buscarNocheMasBarata(args: ArgsMasBarato): NonNullable<ReturnType<typeof resolverNetoNocheDetallado>> | null {
  if (args.numNoches <= 0) return null;
  const lo = new Date(`${args.desde}T00:00:00`).getTime();
  const hi = new Date(`${args.hasta}T00:00:00`).getTime();
  if (Number.isNaN(lo) || Number.isNaN(hi) || hi < lo) return null;
  const hoy = args.hoy ?? hoyISO();
  let mejor: NonNullable<ReturnType<typeof resolverNetoNocheDetallado>> | null = null;
  for (let t0 = lo; t0 <= hi; t0 += MS_DIA) {
    const r = resolverNetoNocheDetallado(t0, args.temporadas, args.netoPorTemporada, hoy, args.regimen, args.precioFinalTemporadas);
    if (r != null && (mejor == null || r.neto < mejor.neto)) mejor = r;
  }
  return mejor;
}

/**
 * Costo del hotel para el TARIFARIO ("desde"): la opción más económica.
 * Recorre noche por noche la ventana de viaje [desde, hasta] (resolviendo
 * prioridad, vigencia de compra y promos por día) y toma el menor neto/noche;
 * lo multiplica por `numNoches`. Así el tarifario publica la tarifa más baja
 * disponible (baja/promo) sin atarse a un mes; al reservar se re-liquida por la
 * fecha real. Devuelve `null` si ninguna noche de la ventana tiene tarifa.
 */
export function liquidarHotelMasBarato(args: ArgsMasBarato): number | null {
  const mejor = buscarNocheMasBarata(args);
  if (mejor == null) return null;
  const hoy = args.hoy ?? hoyISO();
  // Ancla la promo "N noches, 1 gratis" a `desde` (fecha de entrada de la
  // ventana): es el precio "desde" publicado, se re-liquida real al reservar.
  const nocheGratis = resolverNocheGratisDetallado(args.temporadas, args.desde, args.numNoches, hoy, args.regimen);
  const factor = nocheGratis ? nocheGratis.factor : 1;
  return mejor.neto * args.numNoches * factor;
}

/**
 * Igual que `liquidarHotelMasBarato`, pero además devuelve la IDENTIDAD de la
 * noche que realmente ganó dentro de la ventana [desde, hasta] — que puede
 * ser CUALQUIER fecha del rango, no necesariamente `desde`. Defecto que
 * corrige: antes solo se conocía el TOTAL; un consumidor que quisiera mostrar
 * "Base"/"Promoción" no tenía forma de saberlo sin adivinar (y adivinar con
 * `fecha_ida` es Exactamente el error confirmado — el precio ganador puede
 * venir de una fecha posterior promocional, o al revés).
 *
 * A diferencia de `liquidarHotelNochesConTemporadas` (que suma TODAS las
 * noches reales de una estadía fija y por eso puede cruzar varias
 * temporadas), acá el "desde" publicado es el precio de UNA sola noche
 * representativa (la más barata) multiplicado por `numNoches` — nunca la
 * suma de noches distintas — así que `procedencia` trae la identidad exacta
 * de esa noche mínima, MÁS la de "N noches, 1 gratis" si aplica (misma
 * fuente que el factor que ya multiplica el total — nunca puede divergir).
 * Sin noche gratis, sigue trayendo exactamente 1 elemento; con ella, 2 (o 1
 * si por coincidencia comparten la misma tupla). Mismo tipo de retorno
 * (`procedencia: ProcedenciaNoche[]`) que la variante de fechas fijas, para
 * que el llamador (`paquetes/actions.ts`) use un único camino de
 * persistencia sin importar el módulo.
 */
export function liquidarHotelMasBaratoConTemporada(args: ArgsMasBarato): {
  total: number;
  procedencia: ProcedenciaNoche[];
} | null {
  const mejor = buscarNocheMasBarata(args);
  if (mejor == null) return null;
  const hoy = args.hoy ?? hoyISO();
  const nocheGratis = resolverNocheGratisDetallado(args.temporadas, args.desde, args.numNoches, hoy, args.regimen);
  const factor = nocheGratis ? nocheGratis.factor : 1;
  const procedenciaCruda: ProcedenciaNoche[] = [
    { temporadaGanadora: mejor.temporadaGanadora, esPromocion: mejor.esPromocion, precioFinalAutoritativo: mejor.precioFinalAutoritativo },
  ];
  if (nocheGratis) procedenciaCruda.push(nocheGratis.procedencia);
  return {
    total: mejor.neto * args.numNoches * factor,
    procedencia: deduplicarProcedencia(procedenciaCruda),
  };
}

/** Marca un costo con el margen del paquete: costo / (1 - %mk). */
export function marcar(costo: number, pctMk: number): number {
  if (pctMk >= 1) return 0; // margen inválido (no se puede dividir por ≤ 0)
  return costo / (1 - pctMk);
}

/**
 * Aporte del VUELO al precio de venta.
 * Si aplica el margen: costo / (1 - %mk). Si no: costo + TA (Tarifa Administrativa).
 * `pctMk` es fracción (0.20 = 20 %).
 */
export function aporteVuelo(
  costoTiquete: number,
  aplicaMk: boolean,
  pctMk: number,
  ta: number
): number {
  return aplicaMk ? marcar(costoTiquete, pctMk) : costoTiquete + ta;
}

export interface TarifaPaquete {
  baseComisionable: number;
  impuesto: number;
  pvp: number;
}

/**
 * Compone la tarifa final por persona por paquete.
 * PVP = hotel + servicios + vuelo (todos ya marginados).
 * El impuesto (BNC) se RESTA del PVP para obtener la base comisionable;
 * no se suma encima (ya está contenido en el aporte del vuelo / hotel).
 */
/**
 * Redondeo de venta según la MONEDA:
 *  - COP: hacia arriba al siguiente múltiplo de mil (pesos).
 *  - USD: hacia arriba al dólar entero.
 */
export function redondearVenta(n: number, moneda = "COP"): number {
  if ((moneda ?? "COP").toUpperCase() === "USD") return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
  return redondearMilArriba(n);
}

export function componerTarifa(args: {
  aporteHotel: number;
  aporteServicios: number;
  aporteVuelo: number;
  impuesto: number;
  moneda?: string;
}): TarifaPaquete {
  // El PVP (precio de venta) se redondea hacia ARRIBA según la moneda (mil en COP,
  // dólar entero en USD).
  const pvp = redondearVenta(args.aporteHotel + args.aporteServicios + args.aporteVuelo, args.moneda);
  return {
    pvp,
    impuesto: redondear(args.impuesto),
    baseComisionable: redondear(pvp - args.impuesto),
  };
}

export type GrupoTier = { pax_desde: number; pax_hasta: number; precio: number };

/**
 * Precio total de un servicio según el modo y la cantidad de pax.
 *  - 'persona': precioPersona × pax.
 *  - 'grupo':   el precio del rango que cubra `pax` (fijo). Si ninguno cubre,
 *               usa el rango con mayor pax_hasta como aproximación.
 * `precioPersona` y `grupos[].precio` deben venir ya con el margen aplicado
 * (PVP) si se quiere el total de venta, o netos si se quiere el costo.
 */
export function precioServicio(
  modo: "persona" | "grupo",
  precioPersona: number | null | undefined,
  grupos: GrupoTier[],
  pax: number
): number {
  if (modo === "persona") return (Number(precioPersona) || 0) * Math.max(0, pax);
  if (!grupos.length) return 0;
  const cubre = grupos.find((g) => pax >= g.pax_desde && pax <= g.pax_hasta);
  if (cubre) return Number(cubre.precio) || 0;
  const mayor = grupos.reduce((a, b) => (b.pax_hasta > a.pax_hasta ? b : a), grupos[0]);
  return Number(mayor.precio) || 0;
}

/** Liquida un servicio según su modo: por noche, por día o por paquete. */
export function costoServicio(
  tarifaNeta: number,
  liquidacion: 'dia' | 'noche' | 'paquete',
  numNoches: number
): number {
  switch (liquidacion) {
    case 'noche':
      return tarifaNeta * numNoches;
    case 'dia':
      return tarifaNeta * (numNoches + 1); // n noches = n+1 días
    case 'paquete':
    default:
      return tarifaNeta;
  }
}

/** Multiplicador del servicio según su tipo de cobro: 'noche' × noches,
 *  'dia' × (noches+1), 'paquete' × 1. Para amarrar el cobro a la duración. */
export function factorLiquidacion(liquidacion: string | null | undefined, numNoches: number): number {
  if (liquidacion === "noche") return Math.max(1, numNoches);
  if (liquidacion === "dia") return Math.max(1, numNoches + 1);
  return 1;
}
