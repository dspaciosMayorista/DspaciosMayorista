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

import { fechaNegocio } from "../fechaNegocio.ts";
import { claveNeto, diaSemanaNoche, gruposActivos, grupoQueCubre, type GrupoDias } from "./gruposDias.ts";
import { decidirNivel, type CandidatoNivel } from "./empatesPrioridad.ts";
import { registrarConflictoEmpate } from "./registroConflictos.ts";
import {
  netoConRegla, netoHabitacionConDescuento, nocheABonificar, normDias, normCombinacion, type CombinacionPromo, normReglas, esReglaNocheGratis, esUnidadMonto,
  type ReglaNocheGratis, type ReglaPromo, type UnidadMonto,
} from "./promocionesGrupo.ts";

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
  // #43/#60: id de la vigencia (cuando el cargador lo lee) y sus grupos de días ACTIVOS.
  // Sin grupos activos (todo el dato actual: la 293 los obliga a estar inactivos) la
  // vigencia se resuelve exactamente como antes.
  id?: number | null;
  grupos?: GrupoDias[];
  // #43/#60 entrega 4 (migración 300). Todo nulo/ausente = promoción existente: sin cambios.
  promo_base_id?: number | null;           // promoción por noche con reglas, vinculada a esta base
  descuento_unidad?: UnidadMonto | null;   // monto fijo: unidad elegida (null = «unidad anterior»)
  noche_gratis_regla?: ReglaNocheGratis | null; // null = promedio heredado
  dias_promo?: number[] | null;            // noche gratis: días bonificables; persona/estadía: días de entrada (null = todos)
  reglas?: ReglaPromo[];                   // reglas por grupo de la base
  // #43/#60 entrega 5 (301): acumulación y orden frente a EBB / Long Stay. 'pendiente' = promoción nueva sin
  // configurar donde coincide: NO se vende (el motor la ignora). null/ausente = sin coincidencias registradas.
  combinacion?: CombinacionPromo | null;
}

/** Contexto de una liquidación que las promociones necesitan (entrega 4). Sin él, las promociones
 * nuevas por noche no aplican y las existentes vinculadas a una base con grupos tampoco. */
export interface ContextoPromoNoche {
  /** `tarifa_hotel.temporada_base` por clave (ver `basesPromoDeFilas`). */
  basePromoPorClave?: Record<string, string | null | undefined>;
  /** Acomodación que se liquida (sencilla/doble/triple/multiple/nino/nino2/infante). */
  acomodacion?: string;
  /** Noches de la estadía (mínimo de noches de una promoción con reglas). */
  numNoches?: number;
  /** Ocupantes TARIFADOS de una habitación de esta acomodación (configuración del hotel, `pax_tarifa`).
   * Necesario para el descuento por habitación; sin él ese descuento no aplica (nunca se supone 1/2/3/4). */
  ocupantes?: number;
}

const tipoDe = (t: TemporadaRango) => t.tipo ?? "tarifa";
/** Promoción por noche con reglas por grupo (nueva): vinculada a una base, sin fila propia. */
export function esPromoConReglas(t: TemporadaRango): boolean {
  const tipo = tipoDe(t);
  if (t.promo_base_id == null) return false;
  return tipo === "descuento_pct" || (tipo === "descuento_monto" && (t.descuento_unidad === "persona_noche" || t.descuento_unidad === "habitacion_noche"));
}
/** Promoción que se resuelve a nivel de ESTADÍA: «N noches, 1 gratis» y monto por persona/estadía. */
export function esPromoEstadia(t: TemporadaRango): boolean {
  const tipo = tipoDe(t);
  return tipo === "promo_noche_gratis" || (tipo === "descuento_monto" && t.descuento_unidad === "persona_estadia");
}
/** Entradas que compiten por el PRECIO de una noche como hasta hoy (bases y promociones con fila). */
const porNoche = (t: TemporadaRango) => !esPromoEstadia(t) && !esPromoConReglas(t);

/** Fecha de hoy (yyyy-mm-dd) en zona horaria Colombia, para la vigencia de compra. */
export function hoyISO(): string {
  return fechaNegocio();
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

/** ¿El rango de VIAJE de la temporada cubre la fecha (sin blackout)? Ignora
 * vigencia de compra y régimen. Exportada para enlazar una promoción con su
 * base en la calculadora (`lib/calc/promoCalculadora.ts`) con la MISMA regla
 * de cobertura del motor. */
export function temporadaCubreFecha(t: TemporadaRango, t0: number): boolean {
  return cubreFecha(t, t0);
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
    .filter((t) => cubreFecha(t, t0) && compraVigente(t, hoy) && (t.regimen_restringido == null || t.regimen_restringido === regimen)
      && t.combinacion?.estado !== "pendiente") // entrega 5: promoción nueva sin configurar donde coincide: no se vende
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
  id?: number | null;
  hotel_temporada_grupos?: unknown;
  promo_base_id?: number | null;
  descuento_unidad?: string | null;
  noche_gratis_regla?: string | null;
  dias_promo?: unknown;
  hotel_promocion_reglas?: unknown;
  hotel_promocion_combinacion?: unknown;
}): TemporadaRango {
  const grupos = gruposActivos(t.hotel_temporada_grupos);
  return {
    ...(t.id != null ? { id: t.id } : {}),
    ...(grupos.length ? { grupos } : {}),
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
    ...(t.promo_base_id != null ? { promo_base_id: Number(t.promo_base_id) } : {}),
    ...(esUnidadMonto(t.descuento_unidad) ? { descuento_unidad: t.descuento_unidad } : {}),
    ...(esReglaNocheGratis(t.noche_gratis_regla) ? { noche_gratis_regla: t.noche_gratis_regla } : {}),
    ...(normDias(t.dias_promo) ? { dias_promo: normDias(t.dias_promo) } : {}),
    ...(normReglas(t.hotel_promocion_reglas).length ? { reglas: normReglas(t.hotel_promocion_reglas) } : {}),
    ...(normCombinacion(t.hotel_promocion_combinacion) ? { combinacion: normCombinacion(t.hotel_promocion_combinacion) } : {}),
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
  // #43/#60: una vigencia con grupos activos que no cubre el día de la entrada no aplica a
  // esa noche (§3.1), así que tampoco fija su mínimo. Sin grupos, igual que antes.
  // Entrega 4: las promociones de estadía y las de reglas tampoco (no fijan cuánto se vende).
  const top = entradasNoche(t0, temporadas, hoy)
    .filter(porNoche)
    .filter((t) => !gruposDe(t).length || grupoQueCubre(gruposDe(t), t0) != null)[0];
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
  precioFinalTemporadas?: ReadonlySet<string>,
  // #43/#60 entrega 4: vínculo de las filas de promoción, acomodación y noches (ver ContextoPromoNoche).
  ctx?: ContextoPromoNoche
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
  /** #43/#60: grupo de días que aportó el neto (`null` = tarifa de todos los días). */
  grupoGanador: string | null;
  /** Entrega 4: descuento por habitación aplicado esta noche a UNA habitación (importe exacto, sin
   * dividir) y el neto exacto de esa habitación. Solo cuando ganó una regla «por habitación y noche». */
  habitacion?: { neto: number; descuento: number };
} | null {
  // 'promo_noche_gratis' y el monto por persona/estadía no son un precio por noche (se resuelven
  // sobre la estadía); las promociones con reglas no tienen fila propia: ninguna «gana» un slot aquí.
  const todas = entradasNoche(t0, temporadas, hoy, regimen);
  const ents = todas.filter(porNoche);
  const basePromo = ctx?.basePromoPorClave;
  // Una promoción existente cuya fila se calculó desde una base CON grupos está en el alcance con
  // grupos (X.3.1): solo puede actuar cuando su base gana la noche (abajo), nunca por el recorrido
  // de siempre. Sin el vínculo (cargador sin `basePromoPorClave`) no se puede saber: se conserva.
  const conGrupos = new Set(temporadas.filter((t) => gruposDe(t).length > 0).map((t) => t.nombre.trim()));
  const vinculoAConGrupos = (t: TemporadaRango) =>
    tipoDe(t) !== "tarifa" && conGrupos.has((basePromo?.[t.nombre] ?? "").trim());
  const legado = resolverPorNiveles(conGrupos.size ? ents.filter((t) => !vinculoAConGrupos(t)) : ents, t0, netoPorTemporada, regimen);
  if (typeof legado !== "object" || legado == null) return null;

  // N1 (§4.1): primero la BASE de la noche (solo vigencias 'tarifa', mismas reglas de cobertura,
  // disponibilidad y empates); después, solo una promoción vinculada a ESA base puede aplicar.
  const baseR = tipoDe(legado.entry) === "tarifa" ? legado : resolverPorNiveles(ents.filter((t) => tipoDe(t) === "tarifa"), t0, netoPorTemporada, regimen);
  // Una base con grupos cubre la noche sin poder venderla (sin tarifa o empatada): ninguna
  // promoción la rescata, tampoco una sin vínculo (O.1.2, X.3.5). Solo ocurre con grupos activos.
  if (baseR === "no_vende" || baseR === "empate") return null;
  const base = baseR;
  const conReglas = base && base.entry.id != null
    ? todas.filter((t) => esPromoConReglas(t) && t.promo_base_id === base.entry.id)
    : [];
  const baseConGrupos = base != null && base.grupo != null;
  if (!base || (!baseConGrupos && conReglas.length === 0)) return armar(legado);

  type Cand = { entry: TemporadaRango; neto: number; clave: string; reglas: boolean; hab?: { neto: number; descuento: number } };
  const cands: Cand[] = [];
  const prioBase = base.entry.prioridad ?? 1;
  if (baseConGrupos) {
    // Promociones existentes (fila propia) calculadas desde ESTA base (por nombre, `temporada_base`).
    for (const t of ents) {
      if (tipoDe(t) === "tarifa" || (t.prioridad ?? 1) < prioBase) continue;
      const neto = netoPorTemporada[t.nombre];
      if (neto == null || (basePromo?.[t.nombre] ?? "").trim() !== base.entry.nombre.trim()) continue;
      cands.push({ entry: t, neto, clave: t.nombre, reglas: false });
    }
  } else if (legado !== base) {
    cands.push({ entry: legado.entry, neto: legado.neto, clave: legado.clave, reglas: false }); // promoción que hoy ya ganaba
  }
  const dia = diaSemanaNoche(t0);
  for (const t of conReglas) {
    if ((t.prioridad ?? 1) < prioBase) continue; // menor que su base: no aplica (X.3.3)
    if ((ctx?.numNoches ?? 1) < (t.min_noches ?? 1)) continue;
    const regla = t.reglas?.find((r) => r.grupo_id === base.grupo);
    if (!regla || (regla.dias && !regla.dias.includes(dia))) continue; // grupo o día sin regla: conserva la base
    const neto = netoConRegla(tipoDe(t) as "descuento_pct" | "descuento_monto", t.descuento_unidad, regla.valor, base.neto, ctx?.acomodacion, ctx?.ocupantes);
    if (neto == null) continue; // monto mayor que su unidad: no aplica ni cuenta (§T.4)
    const hab = t.descuento_unidad === "habitacion_noche"
      ? { neto: netoHabitacionConDescuento(regla.valor, base.neto, ctx?.acomodacion, ctx?.ocupantes) as number, descuento: regla.valor }
      : undefined;
    cands.push({ entry: t, neto, clave: t.nombre, reglas: true, ...(hab ? { hab } : {}) });
  }
  if (!cands.length) return armar(base);
  const top = Math.max(...cands.map((c) => c.entry.prioridad ?? 1));
  const arriba = cands.filter((c) => (c.entry.prioridad ?? 1) === top);
  if (top === prioBase || arriba.length > 1) { // empate con su base o entre promociones (N4, X.3.3/X.3.4)
    registrarEmpate(top === prioBase ? [base.entry, ...arriba.map((c) => c.entry)] : arriba.map((c) => c.entry), top, t0, regimen);
    return null;
  }
  const c = arriba[0];
  return {
    neto: c.neto,
    // Con reglas el precio sale de la fila de la BASE (edad y condiciones se leen de ella).
    temporadaTarifa: c.reglas ? base.entry.nombre : c.entry.nombre,
    temporadaGanadora: c.entry.nombre,
    esPromocion: true,
    precioFinalAutoritativo: !c.reglas && !!precioFinalTemporadas?.has(c.clave),
    grupoGanador: c.reglas ? base.grupo : null,
    ...(c.hab ? { habitacion: c.hab } : {}),
  };

  function armar(v: { entry: TemporadaRango; clave: string; neto: number; grupo: string | null }) {
    const esPromocion = tipoDe(v.entry) !== "tarifa";
    return {
      neto: v.neto,
      temporadaTarifa: v.entry.nombre,
      temporadaGanadora: v.entry.nombre,
      esPromocion,
      precioFinalAutoritativo: esPromocion && !!precioFinalTemporadas?.has(v.clave),
      grupoGanador: v.grupo,
    };
  }
}

/** Recorrido por NIVELES de prioridad (la lista ya viene ordenada de mayor a menor, estable en el
 * orden de lectura). Sin grupos activos, `decidirNivel` elige la primera con precio del nivel y, si
 * ninguna tiene, se baja al siguiente: idéntico al recorrido anterior (una vigencia sin fila
 * materializada para ESTE combo no aporta precio y se sigue bajando). */
function resolverPorNiveles(
  ents: TemporadaRango[], t0: number, netoPorTemporada: Record<string, number | null | undefined>, regimen?: string,
): { entry: TemporadaRango; clave: string; neto: number; grupo: string | null } | "no_vende" | "empate" | null {
  for (let i = 0; i < ents.length; ) {
    const prioridad = ents[i].prioridad ?? 1;
    const nivel: CandidatoNivel<{ entry: TemporadaRango; clave: string; neto: number | null; grupo: string | null }>[] = [];
    for (; i < ents.length && (ents[i].prioridad ?? 1) === prioridad; i++) nivel.push(candidatoNoche(ents[i], t0, netoPorTemporada));
    const d = decidirNivel(nivel);
    if (d.tipo === "sigue") continue;
    if (d.tipo === "no_vende") return "no_vende";  // §3.2: el grupo cubre la noche sin tarifa: no se rescata
    if (d.tipo === "empate") {                     // §3.7 (N4): no se elige ninguna y se registra el motivo
      registrarEmpate(d.empatadas.map((c) => c.valor.entry), prioridad, t0, regimen);
      return "empate";
    }
    const v = d.candidato.valor;
    return { ...v, neto: v.neto as number };
  }
  return null;
}

/** Los grupos de días son de las vigencias 'tarifa'. Las promociones por grupo (entrega 4) no
 * tienen grupos propios: sus reglas apuntan a los grupos de su base (`esPromoConReglas`). */
function gruposDe(t: TemporadaRango): GrupoDias[] {
  return (t.tipo ?? "tarifa") === "tarifa" && t.grupos?.length ? t.grupos : [];
}

function candidatoNoche(entry: TemporadaRango, t0: number, netoPorTemporada: Record<string, number | null | undefined>) {
  const grupos = gruposDe(entry);
  if (!grupos.length) {
    const neto = netoPorTemporada[entry.nombre] ?? null;
    return { valor: { entry, clave: entry.nombre, neto, grupo: null }, conGrupos: false, estado: neto == null ? "sin_precio" : "precio" } as const;
  }
  const g = grupoQueCubre(grupos, t0);
  if (!g) return { valor: { entry, clave: entry.nombre, neto: null, grupo: null }, conGrupos: true, estado: "no_cubre" } as const; // §3.1
  const clave = claveNeto(entry.nombre, g.id);
  const neto = netoPorTemporada[clave] ?? null;
  return { valor: { entry, clave, neto, grupo: g.id }, conGrupos: true, estado: neto == null ? "sin_precio" : "precio" } as const;
}

function fechaDeNoche(t0: number): string {
  const d = new Date(t0 + 12 * 3_600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function registrarEmpate(empatadas: TemporadaRango[], prioridad: number, t0: number, regimen?: string): void {
  // Las vigencias se identifican por id (único en todo el sistema, distingue hoteles) cuando el
  // cargador lo trae; si no, por nombre. Orden fijo: el registro no depende del orden de lectura.
  const ids = empatadas.map((t) => (t.id != null ? `#${t.id}` : t.nombre)).sort();
  registrarConflictoEmpate({
    vigencias: empatadas.map((t) => t.nombre).sort(),
    prioridad,
    fecha: fechaDeNoche(t0),
    clave: `${ids.join(",")}|${regimen ?? ""}`,
  });
}

export function netoNoche(
  t0: number,
  temporadas: TemporadaRango[],
  netoPorTemporada: Record<string, number | null | undefined>,
  hoy: string,
  regimen?: string,
  precioFinalTemporadas?: ReadonlySet<string>,
  ctx?: ContextoPromoNoche
): number | null {
  const r = resolverNetoNocheDetallado(t0, temporadas, netoPorTemporada, hoy, regimen, precioFinalTemporadas, ctx);
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
 * reconstruirla ni pueda hacerlo distinto. Desde la entrega 4 los liquidadores
 * usan `resolverPromoEstadia`, que para estas mismas promociones (sin regla)
 * da exactamente este factor; esta función queda como lectura del legado.
 * `null` = no aplica ninguna
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
 * #43/#60 entrega 4 — promoción de ESTADÍA, sobre las noches YA valoradas (base o promoción por
 * noche, §P.3): la primera, por prioridad, entre las que cubren la noche de entrada (compra y
 * régimen incluidos) y APLICAN a esta estadía. Una sola por estadía (no se acumulan entre sí;
 * la acumulación nueva es la entrega 5).
 *  · «N noches, 1 gratis» sin regla (todas las existentes): promedio heredado, `total × (N−1)/N`,
 *    idéntico a `resolverNocheGratisDetallado`.
 *  · Con regla: se resta UNA noche (más barata, más cara o última) entre las PERMITIDAS; «última»
 *    con su día no permitido o sin noche permitida ⇒ no aplica (Y.1.2).
 *  · Monto por persona/estadía: una vez, si el día de entrada está permitido y no supera el total
 *    de la estadía de la persona (igual ⇒ 0; §T.1, Y.1.3).
 * `total` lo pasa el llamador tal como lo calculaba (así el legado da exactamente el mismo número).
 */
export function resolverPromoEstadia(
  temporadas: TemporadaRango[],
  fechaIda: string,
  precios: readonly number[],
  total: number,
  hoy: string = hoyISO(),
  regimen?: string,
): { total: number; procedencia: ProcedenciaNoche; ajuste: AjusteEstadia } | null {
  const n = precios.length;
  const t0 = new Date(`${fechaIda}T00:00:00`).getTime();
  if (n <= 0 || Number.isNaN(t0)) return null;
  for (const t of entradasNoche(t0, temporadas, hoy, regimen)) {
    if (!esPromoEstadia(t) || n < (t.min_noches ?? 1)) continue;
    let nuevo: number;
    let ajuste: AjusteEstadia;
    if (tipoDe(t) === "promo_noche_gratis") {
      if (n <= 1) continue;
      if (!t.noche_gratis_regla) { nuevo = total * ((n - 1) / n); ajuste = { tipo: "factor", factor: (n - 1) / n }; }
      else {
        const dias = precios.map((_, i) => diaSemanaNoche(t0 + i * MS_DIA));
        const i = nocheABonificar(precios, dias, t.noche_gratis_regla, t.dias_promo ?? null);
        if (i == null) continue;
        nuevo = total - precios[i];
        ajuste = { tipo: "noche", indice: i };
      }
    } else {
      if (t.dias_promo && !t.dias_promo.includes(diaSemanaNoche(t0))) continue;
      const d = Number(t.descuento_valor);
      if (!(d > 0) || d > total) continue;
      nuevo = total - d;
      ajuste = { tipo: "monto_persona", monto: d };
    }
    return { total: nuevo, procedencia: { temporadaGanadora: t.nombre, esPromocion: true, precioFinalAutoritativo: false }, ajuste };
  }
  return null;
}

/** Qué hizo la promoción de estadía, para aplicarlo igual al total de UNA habitación (reparto exacto). */
export type AjusteEstadia =
  | { tipo: "factor"; factor: number }
  | { tipo: "noche"; indice: number }
  | { tipo: "monto_persona"; monto: number };

/** Entrega 5: promociones que aplicaron en la estadía (de la procedencia del liquidador), con su combinación. */
export function promosAplicadas(procedencia: readonly ProcedenciaNoche[], temporadas: readonly TemporadaRango[]): { nombre: string; combinacion: CombinacionPromo | null }[] {
  const nombres = [...new Set(procedencia.filter((p) => p.esPromocion).map((p) => p.temporadaGanadora))];
  return nombres.map((n) => ({ nombre: n, combinacion: temporadas.find((t) => t.nombre === n && tipoDe(t) !== "tarifa")?.combinacion ?? null }));
}
/** Entrega 5: solo las vigencias base (sin ninguna promoción) — el neto «sin la promoción» cuando una regla prevalece. */
export const soloBases = (temporadas: readonly TemporadaRango[]): TemporadaRango[] => temporadas.filter((t) => tipoDe(t) === "tarifa");

/** Argumentos comunes de los liquidadores. `basePromoPorClave`, `acomodacion` y `ocupantes` (entrega 4)
 * los pasan los cargadores; sin ellos las promociones nuevas por noche (y por habitación) no aplican. */
export type ArgsLiquidar = {
  fechaIda: string;
  numNoches: number;
  temporadas: TemporadaRango[];
  netoPorTemporada: Record<string, number | null | undefined>;
  hoy?: string;
  regimen?: string;
  precioFinalTemporadas?: ReadonlySet<string>;
  basePromoPorClave?: Record<string, string | null | undefined>;
  acomodacion?: string;
  /** Ocupantes tarifados de una habitación de `acomodacion` (configuración del hotel). */
  ocupantes?: number;
};

/**
 * Liquida el costo neto del hotel para una estadía, sumando noche por noche.
 * `netoPorTemporada` mapea nombre-de-temporada → neto de la acomodación elegida.
 * `hoy` (yyyy-mm-dd) evalúa la vigencia de compra; por defecto, hoy en Colombia.
 * `regimen` filtra vigencias restringidas a un solo régimen (ver `regimen_restringido`)
 * y también gobierna si aplica una promo "N noches, 1 gratis" (`promoNocheGratisFactor`).
 * Devuelve `null` si alguna noche no tiene tarifa aplicable.
 */
export function liquidarHotelNoches(args: ArgsLiquidar): number | null {
  return liquidarHotelNochesConTemporadas(args)?.total ?? null;
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
export function liquidarHotelNochesConTemporadas(args: ArgsLiquidar): {
  total: number;
  temporadasTarifa: string[];
  procedencia: ProcedenciaNoche[];
  /** Entrega 4 (reparto exacto, T.3): solo si alguna noche llevó un descuento por habitación. `total` = neto
   * EXACTO de UNA habitación en toda la estadía (sin pasar por la tarifa por persona) y `descuento` = lo que
   * se le descontó; el `total` por persona de arriba es solo `habitacion.total / ocupantes` (presentación). */
  habitacion?: { ocupantes: number; total: number; descuento: number };
} | null {
  if (args.numNoches <= 0) return null;
  const base = new Date(`${args.fechaIda}T00:00:00`).getTime();
  if (Number.isNaN(base)) return null;
  const hoy = args.hoy ?? hoyISO();
  const ctx: ContextoPromoNoche = { basePromoPorClave: args.basePromoPorClave, acomodacion: args.acomodacion, numNoches: args.numNoches, ocupantes: args.ocupantes };
  let total = 0;
  const precios: number[] = [];
  const occ = args.ocupantes ?? 0;
  const preciosHab: number[] = [];
  let descuentoHab = 0;
  const vistas = new Set<string>();
  const procedenciaCruda: ProcedenciaNoche[] = [];
  for (let n = 0; n < args.numNoches; n++) {
    const r = resolverNetoNocheDetallado(base + n * MS_DIA, args.temporadas, args.netoPorTemporada, hoy, args.regimen, args.precioFinalTemporadas, ctx);
    if (r == null) return null;
    total += r.neto;
    precios.push(r.neto);
    preciosHab.push(r.habitacion ? r.habitacion.neto : r.neto * occ);
    if (r.habitacion) descuentoHab += r.habitacion.descuento;
    vistas.add(r.temporadaTarifa);
    procedenciaCruda.push({ temporadaGanadora: r.temporadaGanadora, esPromocion: r.esPromocion, precioFinalAutoritativo: r.precioFinalAutoritativo });
  }
  // La promoción de estadía no aporta neto propio (descuenta el total ya liquidado noche por
  // noche), pero SÍ es procedencia real de la estadía — sin esto, una estadía toda en tarifa base
  // con noche gratis se mostraría como "Tarifa base" ocultando que una noche salió gratis.
  const estadia = resolverPromoEstadia(args.temporadas, args.fechaIda, precios, total, hoy, args.regimen);
  if (estadia) procedenciaCruda.push(estadia.procedencia);
  const comun = { temporadasTarifa: Array.from(vistas), procedencia: deduplicarProcedencia(procedenciaCruda) };
  // Sin descuento por habitación: exactamente el cálculo de siempre (mismo número, sin reordenar sumas).
  if (descuentoHab === 0) return { total: estadia ? estadia.total : total, ...comun };
  let hab = preciosHab.reduce((a, b) => a + b, 0);
  if (estadia) {
    const aj = estadia.ajuste;
    hab = aj.tipo === "factor" ? hab * aj.factor : aj.tipo === "noche" ? hab - preciosHab[aj.indice] : hab - aj.monto * occ;
  }
  return { total: hab / occ, ...comun, habitacion: { ocupantes: occ, total: hab, descuento: descuentoHab } };
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
  basePromoPorClave?: Record<string, string | null | undefined>;
  acomodacion?: string;
  ocupantes?: number;
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
  // #43/#60: «noche más barata × noches» no es una estadía vendible cuando los precios
  // cambian por día de la semana. Mientras no exista el «Desde» por estadía real (entrega 6),
  // un hotel con grupos activos NO publica un «desde» aproximado: falla cerrado.
  if (args.temporadas.some((t) => gruposDe(t).length > 0)) return null;
  const lo = new Date(`${args.desde}T00:00:00`).getTime();
  const hi = new Date(`${args.hasta}T00:00:00`).getTime();
  if (Number.isNaN(lo) || Number.isNaN(hi) || hi < lo) return null;
  const hoy = args.hoy ?? hoyISO();
  let mejor: NonNullable<ReturnType<typeof resolverNetoNocheDetallado>> | null = null;
  const ctx: ContextoPromoNoche = { basePromoPorClave: args.basePromoPorClave, acomodacion: args.acomodacion, numNoches: args.numNoches, ocupantes: args.ocupantes };
  for (let t0 = lo; t0 <= hi; t0 += MS_DIA) {
    const r = resolverNetoNocheDetallado(t0, args.temporadas, args.netoPorTemporada, hoy, args.regimen, args.precioFinalTemporadas, ctx);
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
  return liquidarHotelMasBaratoConTemporada(args)?.total ?? null;
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
  // La promoción de estadía se ancla a `desde` (entrada de la ventana) sobre N noches iguales a la
  // más barata: es el «desde» publicado (sin grupos); se re-liquida real al reservar.
  const total = mejor.neto * args.numNoches;
  const estadia = resolverPromoEstadia(args.temporadas, args.desde, Array(args.numNoches).fill(mejor.neto), total, hoy, args.regimen);
  const procedenciaCruda: ProcedenciaNoche[] = [
    { temporadaGanadora: mejor.temporadaGanadora, esPromocion: mejor.esPromocion, precioFinalAutoritativo: mejor.precioFinalAutoritativo },
  ];
  if (estadia) procedenciaCruda.push(estadia.procedencia);
  return {
    total: estadia ? estadia.total : total,
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

/**
 * Precio de venta de un MENOR DE 2 AÑOS (migración 226) — regla B del dueño:
 * el techo al mil (COP) / dólar entero (USD) se aplica SOLO a hotel +
 * servicios; el fee de infante del vuelo se suma EXACTO después, porque es
 * precio = costo (sin markup, sin TA, sin redondeo propio).
 *
 * `aporteHotel` ya viene marcado (clase de hotel que corresponda: infante,
 * niño 1 o niño 2); `aporteServiciosMenor` ya viene marcado (servicios
 * incluidos con su precio de infante, o el de adulto si el servicio no lo
 * tiene configurado). `feeInfante` es el fee de la fuente de vuelo (0 sin
 * vuelo).
 */
export function precioMenorDeDos(args: {
  aporteHotel: number;
  aporteServiciosMenor: number;
  feeInfante: number;
  moneda?: string;
}): number {
  const fee = Number.isFinite(args.feeInfante) && args.feeInfante > 0 ? args.feeInfante : 0;
  return redondearVenta(args.aporteHotel + args.aporteServiciosMenor, args.moneda) + fee;
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
