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

export interface TemporadaRango {
  nombre: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
}

/** Redondeo a peso entero (COP). */
export function redondear(n: number): number {
  return Math.round(n);
}

/** Noches entre dos fechas ISO (yyyy-mm-dd). */
export function noches(fechaIda: string, fechaRegreso: string): number {
  const a = new Date(`${fechaIda}T00:00:00`).getTime();
  const b = new Date(`${fechaRegreso}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / MS_DIA));
}

/** Devuelve el nombre de la temporada del hotel en la que cae una fecha. */
export function temporadaParaFecha(
  fecha: Date,
  temporadas: TemporadaRango[]
): string | null {
  const t0 = fecha.getTime();
  for (const t of temporadas) {
    if (!t.fecha_inicio || !t.fecha_fin) continue;
    const i = new Date(`${t.fecha_inicio}T00:00:00`).getTime();
    const f = new Date(`${t.fecha_fin}T00:00:00`).getTime();
    if (t0 >= i && t0 <= f) return t.nombre;
  }
  return null;
}

/**
 * Liquida el costo neto del hotel para una estadía, sumando noche por noche.
 * `netoPorTemporada` mapea nombre-de-temporada → neto de la acomodación elegida.
 * Devuelve `null` si alguna noche no tiene temporada o no tiene tarifa cargada
 * (tarifa incompleta ⇒ esa combinación no se publica).
 */
export function liquidarHotelNoches(args: {
  fechaIda: string;
  numNoches: number;
  temporadas: TemporadaRango[];
  netoPorTemporada: Record<string, number | null | undefined>;
}): number | null {
  if (args.numNoches <= 0) return null;
  const base = new Date(`${args.fechaIda}T00:00:00`).getTime();
  if (Number.isNaN(base)) return null;
  let total = 0;
  for (let n = 0; n < args.numNoches; n++) {
    const d = new Date(base + n * MS_DIA);
    const temp = temporadaParaFecha(d, args.temporadas);
    if (!temp) return null;
    const neto = args.netoPorTemporada[temp];
    if (neto == null) return null;
    total += neto;
  }
  return total;
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
  const pvp = args.aporteHotel + args.aporteServicios + args.aporteVuelo;
  return {
    pvp: redondear(pvp),
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
