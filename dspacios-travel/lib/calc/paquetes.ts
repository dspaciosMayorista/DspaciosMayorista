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

export type TemporadaTipo = "tarifa" | "descuento_pct" | "descuento_monto";

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

function cubreFecha(t: TemporadaRango, t0: number): boolean {
  // Cobertura: si hay rangos múltiples, se usan; si no, el rango simple legado.
  const rangos = t.rangos && t.rangos.length
    ? t.rangos
    : (t.fecha_inicio && t.fecha_fin ? [{ fecha_inicio: t.fecha_inicio, fecha_fin: t.fecha_fin }] : []);
  const dentro = rangos.some((r) => enRango(t0, r.fecha_inicio, r.fecha_fin));
  if (!dentro) return false;
  // Black-out: si la fecha cae en una exclusión, la temporada NO cubre esa noche.
  if (t.blackouts && t.blackouts.some((b) => enRango(t0, b.fecha_inicio, b.fecha_fin))) return false;
  return true;
}

/** ¿La vigencia de compra cubre HOY? (sin rango = siempre disponible). */
function compraVigente(t: TemporadaRango, hoy: string): boolean {
  if (t.compra_inicio && hoy < t.compra_inicio) return false;
  if (t.compra_fin && hoy > t.compra_fin) return false;
  return true;
}

/** Entradas que cubren la fecha y están en vigencia de compra, por prioridad desc. */
function entradasNoche(t0: number, temporadas: TemporadaRango[], hoy: string): TemporadaRango[] {
  return temporadas
    .filter((t) => cubreFecha(t, t0) && compraVigente(t, hoy))
    .sort((a, b) => (b.prioridad ?? 1) - (a.prioridad ?? 1));
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
  rangos?: unknown; blackouts?: unknown;
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
  };
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
 * Neto efectivo de UNA noche, resolviendo por prioridad + vigencia de compra:
 *  - gana la entrada de mayor prioridad que cubra la fecha y esté en vigencia de compra;
 *  - si es 'tarifa', usa su neto cargado;
 *  - si es un descuento, lo aplica sobre la tarifa-base (la 'tarifa' de mayor
 *    prioridad por debajo, con neto cargado).
 * Devuelve null si no hay tarifa aplicable (no se publica esa noche).
 */
export function netoNoche(
  t0: number,
  temporadas: TemporadaRango[],
  netoPorTemporada: Record<string, number | null | undefined>,
  hoy: string
): number | null {
  const ents = entradasNoche(t0, temporadas, hoy);
  if (!ents.length) return null;
  const top = ents[0];
  const tipoTop = top.tipo ?? "tarifa";
  if (tipoTop === "tarifa") {
    const v = netoPorTemporada[top.nombre];
    if (v != null) return v;
    // La temporada de mayor prioridad NO tiene neto para ESTE combo (categoría/
    // régimen) — p. ej. "BAJA" es de PAM y este combo es PC. Cae a la 'tarifa' de
    // mayor prioridad que cubra la fecha Y tenga neto para este combo ("BAJA PC").
    const baseT = ents.find((t) => (t.tipo ?? "tarifa") === "tarifa" && netoPorTemporada[t.nombre] != null);
    return baseT ? (netoPorTemporada[baseT.nombre] as number) : null;
  }
  // Descuento: necesita una tarifa-base por debajo, con neto cargado.
  const base = ents.find((t) => (t.tipo ?? "tarifa") === "tarifa" && netoPorTemporada[t.nombre] != null);
  if (!base) return null;
  const baseNeto = netoPorTemporada[base.nombre] as number;
  const val = Number(top.descuento_valor) || 0;
  if (tipoTop === "descuento_pct") return Math.round(baseNeto * (1 - val / 100));
  return Math.max(0, Math.round(baseNeto - val)); // descuento_monto (por pax)
}

/**
 * Liquida el costo neto del hotel para una estadía, sumando noche por noche.
 * `netoPorTemporada` mapea nombre-de-temporada → neto de la acomodación elegida.
 * `hoy` (yyyy-mm-dd) evalúa la vigencia de compra; por defecto, hoy en Colombia.
 * Devuelve `null` si alguna noche no tiene tarifa aplicable.
 */
export function liquidarHotelNoches(args: {
  fechaIda: string;
  numNoches: number;
  temporadas: TemporadaRango[];
  netoPorTemporada: Record<string, number | null | undefined>;
  hoy?: string;
}): number | null {
  if (args.numNoches <= 0) return null;
  const base = new Date(`${args.fechaIda}T00:00:00`).getTime();
  if (Number.isNaN(base)) return null;
  const hoy = args.hoy ?? hoyISO();
  let total = 0;
  for (let n = 0; n < args.numNoches; n++) {
    const neto = netoNoche(base + n * MS_DIA, args.temporadas, args.netoPorTemporada, hoy);
    if (neto == null) return null;
    total += neto;
  }
  return total;
}

/**
 * Costo del hotel para el TARIFARIO ("desde"): la opción más económica.
 * Recorre noche por noche la ventana de viaje [desde, hasta] (resolviendo
 * prioridad, vigencia de compra y promos por día) y toma el menor neto/noche;
 * lo multiplica por `numNoches`. Así el tarifario publica la tarifa más baja
 * disponible (baja/promo) sin atarse a un mes; al reservar se re-liquida por la
 * fecha real. Devuelve `null` si ninguna noche de la ventana tiene tarifa.
 */
export function liquidarHotelMasBarato(args: {
  desde: string;
  hasta: string;
  numNoches: number;
  temporadas: TemporadaRango[];
  netoPorTemporada: Record<string, number | null | undefined>;
  hoy?: string;
}): number | null {
  if (args.numNoches <= 0) return null;
  const lo = new Date(`${args.desde}T00:00:00`).getTime();
  const hi = new Date(`${args.hasta}T00:00:00`).getTime();
  if (Number.isNaN(lo) || Number.isNaN(hi) || hi < lo) return null;
  const hoy = args.hoy ?? hoyISO();
  let min: number | null = null;
  for (let t0 = lo; t0 <= hi; t0 += MS_DIA) {
    const n = netoNoche(t0, args.temporadas, args.netoPorTemporada, hoy);
    if (n != null && (min == null || n < min)) min = n;
  }
  return min == null ? null : min * args.numNoches;
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
export function componerTarifa(args: {
  aporteHotel: number;
  aporteServicios: number;
  aporteVuelo: number;
  impuesto: number;
}): TarifaPaquete {
  // El PVP (precio de venta) se redondea hacia ARRIBA al siguiente múltiplo de mil.
  const pvp = redondearMilArriba(args.aporteHotel + args.aporteServicios + args.aporteVuelo);
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
