// ─────────────────────────────────────────────────────────────────────────
// Liquidación de un hotel por FECHAS — fórmula ÚNICA, extraída de
// `liquidarHotelPaquete` (lib/reservar/cotizar.ts) en dos piezas:
//  - `evaluarHotelPorFechas`: PURA, decide con datos YA CONSULTADOS (nunca
//    toca Supabase) — misma lógica exacta de siempre (temporada por noche,
//    blackouts totales/parciales, filtro categoría/régimen, servicios
//    incluidos, min_noches), byte a byte igual que antes de este refactor.
//  - El llamador (`cargarDatosHotelPaquete` en cotizar.ts, que sí toca
//    Supabase) consulta UNA sola vez por hotel/paquete y le pasa los datos
//    crudos acá — nunca vuelve a consultar por cada fecha candidata.
//
// Se extrae para reutilizar EXACTAMENTE el mismo motor en dos lugares:
//  1) `liquidarHotelPaquete` (sin cambios de comportamiento — computo.ts, el
//     motor autoritativo de reservar/checkout, sigue viéndolo idéntico).
//  2) `generarSugerenciasFechas` (nuevo, esta ronda): cuando la fecha
//     pedida por el cliente NO tiene tarifa, prueba un conjunto ACOTADO de
//     fechas candidatas contra este MISMO evaluador puro — nunca asume que
//     una temporada cargada equivale a una fecha cotizable (blackouts,
//     vigencia de compra, min_noches y la propia tarifa cargada pueden
//     negarla) — la validación real es la única fuente de verdad.
//
// Import relativo (no `@/…`) a propósito: mismo motivo que
// `distribucionHabitaciones.ts`/`edadesMenores.ts`/`liquidacionServicio.ts`
// — este módulo se importa DIRECTO desde `node --test` sin bundler.
// ─────────────────────────────────────────────────────────────────────────

import {
  liquidarHotelNoches, marcar, componerTarifa, toTemporadaRango, minNochesAplicable,
  factorLiquidacion, normRangos, hoyISO, type TemporadaRango,
} from "../calc/paquetes.ts";
import { type AcomRoom } from "../acomodaciones.ts";
import {
  clasificarMenoresPorEdad, verificarTarifasMenoresDisponibles, type ClasificacionMenores,
} from "./edadesMenores.ts";
import { distribuirPorHabitaciones, type HabitacionConsultada } from "./distribucionHabitaciones.ts";
import {
  condicionHotelEstadia, barridoRestriccionEstadia, type VigenciaHotelCondicion,
} from "../cotizacion/snapshotCondiciones.ts";
import { condicionDeVigenciaHotel, type HotelTemporadaCatalogo } from "../cotizacion/condicionDesdeCatalogo.ts";
import { type CondicionTipo } from "../cotizacion/condicionPago.ts";

const MS_DIA = 86_400_000;

// Acomodaciones (incluye niños e infante) y su columna neta en tarifa_hotel —
// idéntico a la constante que tenía `cotizar.ts` antes de este refactor.
const ACOM_ALL = ["sencilla", "doble", "triple", "multiple", "nino", "nino2", "infante"] as const;
const COL_NETO: Record<string, string> = {
  sencilla: "neto_sencilla", doble: "neto_doble", triple: "neto_triple",
  multiple: "neto_multiple", nino: "neto_nino", nino2: "neto_nino2", infante: "neto_infante",
};

export type ComboCotizado = { categoria: string; regimen: string; precios: Record<string, number>; netos?: Record<string, number> };

// ── Datos crudos, YA CONSULTADOS por el llamador (una sola vez por hotel/
// paquete, sin importar cuántas fechas se evalúen después) — mismos campos
// exactos que ya seleccionaban las 6 consultas de `liquidarHotelPaquete`. ──
export type FilaArmadoPaqueteHotel = {
  pct_mk: number | null;
  impuesto_fijo: number | null;
  destino_nombre: string | null;
  fecha_viaje_inicio: string | null;
  fecha_viaje_fin: string | null;
};
export type FilaArmadoHotel = {
  categorias: string[] | null;
  regimenes: string[] | null;
  hotel_nombre: string | null;
  hotel_moneda: string | null;
} | null; // null = no hay fila armado_hoteles para este par (mismo comportamiento que antes: sin filtro, moneda COP)
export type FilaTemporadaHotelRaw = {
  // `id`/`condicion_pago_*` = migración 164 (condiciones de pago por
  // componente). Opcionales porque no todos los llamadores de este tipo los
  // seleccionan todavía — solo los necesita `condicionHotelFechas` más abajo,
  // nunca la liquidación de precio (que sigue igual, byte a byte).
  id?: number | null;
  nombre: string; fecha_inicio: string | null; fecha_fin: string | null;
  prioridad?: number | null; compra_inicio?: string | null; compra_fin?: string | null;
  tipo?: string | null; descuento_valor?: number | null;
  rangos?: unknown; blackouts?: unknown; min_noches?: number | null;
  regimen_restringido?: string | null;
  condicion_pago_tipo?: string | null;
  condicion_pago_pct_inicial?: number | null;
  condicion_pago_dias_saldo?: number | null;
};
export type FilaTarifaHotelRaw = Record<string, unknown>; // tipo_habitacion, alimentacion, temporada, neto_*
export type FilaServicioIncluidoRaw = { incluido: boolean; precio_persona: number | null; liquidacion: string | null };
export type FilaBlackoutHotelRaw = { fecha_inicio: string; fecha_fin: string; total: boolean; acomodaciones: string[] | null; categorias: string[] | null };

export type DatosHotelPaquete = {
  paquete: FilaArmadoPaqueteHotel;
  armadoHotel: FilaArmadoHotel;
  temporadas: FilaTemporadaHotelRaw[];
  tarifas: FilaTarifaHotelRaw[];
  serviciosIncluidos: FilaServicioIncluidoRaw[];
  blackouts: FilaBlackoutHotelRaw[];
};

export type ResultadoHotelFechas = {
  combos: ComboCotizado[]; destinoNombre: string | null; hotelNombre: string | null; minNoches: number; moneda: string;
};

/**
 * Evalúa un hotel/paquete para UNA fecha/duración — PURA, sin I/O. Lógica
 * idéntica a la que tenía `liquidarHotelPaquete` (cotizar.ts) antes de este
 * refactor: temporada noche por noche, blackout total/parcial (por
 * categoría/acomodación), filtro de categorías/régimen del armado, servicios
 * incluidos horneados en el PVP, min_noches de la temporada de entrada.
 */
export function evaluarHotelPorFechas(
  datos: DatosHotelPaquete,
  fechaIda: string,
  numNoches: number
): ResultadoHotelFechas | null {
  if (numNoches <= 0) return null;
  const pctMk = Number(datos.paquete.pct_mk) || 0;
  const impuesto = Number(datos.paquete.impuesto_fijo) || 0;
  const destinoNombre = datos.paquete.destino_nombre;

  const nochesStay: string[] = [];
  { const base = new Date(`${fechaIda}T00:00:00`).getTime(); for (let n = 0; n < numNoches; n++) nochesStay.push(new Date(base + n * MS_DIA).toISOString().slice(0, 10)); }
  const reglasCierre: { categorias: string[]; acomodaciones: string[] }[] = [];
  let cierreTotal = false;
  for (const b of datos.blackouts) {
    const cubre = nochesStay.some((d) => b.fecha_inicio <= d && d <= b.fecha_fin);
    if (!cubre) continue;
    if (b.total) { cierreTotal = true; continue; }
    reglasCierre.push({ categorias: b.categorias ?? [], acomodaciones: b.acomodaciones ?? [] });
  }
  const estaCerrada = (categoria: string, acom: string) =>
    reglasCierre.some((r) =>
      (r.categorias.length === 0 || r.categorias.includes(categoria)) &&
      (r.acomodaciones.length === 0 || r.acomodaciones.includes(acom))
    );
  const monedaHotel = (datos.armadoHotel?.hotel_moneda ?? "COP") === "USD" ? "USD" : "COP";
  if (cierreTotal) return { combos: [], destinoNombre, hotelNombre: datos.armadoHotel?.hotel_nombre ?? null, minNoches: 1, moneda: monedaHotel };
  const filtroCat = datos.armadoHotel?.categorias ?? null;
  const filtroReg = datos.armadoHotel?.regimenes ?? null;
  const hotelNombre = datos.armadoHotel?.hotel_nombre ?? null;
  const temporadas: TemporadaRango[] = datos.temporadas.map(toTemporadaRango);

  let aporteServ = 0;
  for (const s of datos.serviciosIncluidos) {
    if (!s.incluido) continue;
    if (s.precio_persona == null) continue;
    aporteServ += marcar(Number(s.precio_persona) || 0, pctMk) * factorLiquidacion(s.liquidacion, numNoches);
  }

  const grupos = new Map<string, Map<string, FilaTarifaHotelRaw>>();
  for (const r of datos.tarifas) {
    const cat = (r.tipo_habitacion as string) ?? "";
    const reg = (r.alimentacion as string) ?? "";
    const key = `${cat}|||${reg}`;
    if (!grupos.has(key)) grupos.set(key, new Map());
    grupos.get(key)!.set((r.temporada as string) ?? "", r);
  }

  const combos: ComboCotizado[] = [];
  for (const [key, tempMap] of grupos) {
    const [categoria, regimen] = key.split("|||");
    if (filtroCat && filtroCat.length && !filtroCat.includes(categoria)) continue;
    if (filtroReg && filtroReg.length && !filtroReg.includes(regimen)) continue;
    const precios: Record<string, number> = {};
    const netos: Record<string, number> = {};
    for (const acom of ACOM_ALL) {
      const col = COL_NETO[acom];
      const netoPorTemporada: Record<string, number | null> = {};
      for (const [temp, row] of tempMap) { const v = row[col]; netoPorTemporada[temp] = v == null ? null : Number(v); }
      const costoHotel = liquidarHotelNoches({ fechaIda, numNoches, temporadas, netoPorTemporada, regimen });
      const esRoom = acom !== "nino" && acom !== "nino2" && acom !== "infante";
      if (costoHotel == null) continue;
      if (esRoom && costoHotel <= 0) continue;
      const t = componerTarifa({ aporteHotel: marcar(costoHotel, pctMk), aporteServicios: aporteServ, aporteVuelo: 0, impuesto, moneda: monedaHotel });
      precios[acom] = t.pvp;
      netos[acom] = costoHotel;
    }
    if (Object.keys(precios).length) combos.push({ categoria, regimen, precios, netos });
  }
  if (reglasCierre.length) {
    for (const c of combos) {
      for (const a of Object.keys(c.precios)) {
        if (estaCerrada(c.categoria, a)) { delete c.precios[a]; delete c.netos?.[a]; }
      }
    }
  }
  const combosF = combos.filter((c) => Object.keys(c.precios).some((a) => a !== "nino" && a !== "nino2" && a !== "infante"));
  return { combos: combosF, destinoNombre, hotelNombre, minNoches: minNochesAplicable(temporadas, fechaIda), moneda: monedaHotel };
}

// ── Condición de pago del hotel para un rango de fechas (badge, solo lectura) ──
//
// Deliberadamente SEPARADA de `evaluarHotelPorFechas`: esa función es el
// motor de PRECIO (probado exhaustivamente, byte a byte igual desde el
// refactor) y no se toca para agregar esto. La condición de pago de una
// temporada es intrínseca al RANGO DE FECHAS de la vigencia (no varía por
// categoría/régimen — la tarifa neta sí, la condición comercial no), así que
// se resuelve UNA sola vez por hotel+estadía, no por combo.
export type CondicionHotelFechas = {
  condicionPagoTipo: CondicionTipo;
  pctInicial: number | null;
  diasSaldo: number | null;
  /** true = no reembolsable Y no endosable (siempre las dos juntas, ver `restriccionImplicitaHotel`). */
  restringido: boolean;
};

/**
 * Condición de pago comercial vigente para un hotel en `[fechaIda, fechaRegreso)`
 * — SOLO para mostrarla al usuario (badge en booking/carrito), NUNCA para
 * calcular precio. Reutiliza el MISMO motor puro que congela la condición en
 * el contrato al reservar (`lib/contrato/congelarCondicionesContrato.ts`,
 * Rama B / PR #282: `condicionHotelEstadia` + `barridoRestriccionEstadia`),
 * así que el badge que ve el usuario ANTES de reservar es exactamente la
 * misma condición que queda congelada en el contrato después — una sola
 * fórmula, nunca dos criterios distintos que puedan divergir.
 *
 * Devuelve `null` — nunca una condición neutra inventada — si ninguna
 * temporada de este hotel trae `id`/fechas/`condicion_pago_tipo` completos
 * (dato incompleto: mismo criterio que `vigenciasCondicionDeHotel`). Si SÍ
 * hay vigencias pero ninguna cubre las noches pedidas (huecos/temporadas
 * futuras), resuelve a la condición neutra real (`sin_condicion`, sin
 * restricción) — es la respuesta correcta, no un dato faltante.
 *
 * `fechaPago` (default: hoy real) solo afecta el bump de cierre de
 * `anticipo_saldo` (dentro de los últimos `diasSaldo` días antes del viaje ya
 * no se acepta saldo, se exige el 100%) — igual mecánica que
 * `condicionHotelEstadia`. Se expone explícito para que las pruebas nunca
 * dependan de la fecha real del sistema (mismo criterio que el resto de
 * `pruebas/liquidacionHotel.test.ts`).
 */
export function condicionHotelFechas(
  temporadas: FilaTemporadaHotelRaw[],
  estadia: { fechaIda: string; fechaRegreso: string },
  fechaPago?: string,
): CondicionHotelFechas | null {
  const vigencias: VigenciaHotelCondicion[] = [];
  for (const t of temporadas) {
    if (t.id == null || t.fecha_inicio == null || t.fecha_fin == null || t.condicion_pago_tipo == null) continue;
    const fila: HotelTemporadaCatalogo = {
      id: t.id,
      nombre: t.nombre,
      fecha_inicio: t.fecha_inicio,
      fecha_fin: t.fecha_fin,
      condicion_pago_tipo: t.condicion_pago_tipo,
      condicion_pago_pct_inicial: t.condicion_pago_pct_inicial ?? null,
      condicion_pago_dias_saldo: t.condicion_pago_dias_saldo ?? null,
    };
    vigencias.push(condicionDeVigenciaHotel(fila));
  }
  if (!vigencias.length) return null;
  const exigencia = condicionHotelEstadia(estadia, vigencias, { fechaPago });
  const barrido = barridoRestriccionEstadia(estadia, vigencias);
  return {
    condicionPagoTipo: exigencia.tipo,
    pctInicial: exigencia.pctInicial,
    diasSaldo: exigencia.diasSaldo,
    restringido: barrido.tocaRestriccion,
  };
}

// ── Sugerencias de fecha ────────────────────────────────────────────────
export type SugerenciaFecha = { fechaIda: string; fechaRegreso: string; noches: number; etiqueta: string };

// Composición (habitaciones + menores) opcional: cuando el llamador ya la
// conoce (búsqueda general — `buscarHoteles`), una sugerencia solo es real
// si ADEMÁS de tener tarifa, esa composición cabe — nunca una fecha con
// tarifa pero incompatible con Adults Only, capacidad de habitación o la
// tarifa de niño/infante que hace falta. Cuando no se conoce todavía (el
// selector por fechas de UN hotel, antes de elegir habitaciones), se omite
// y la sugerencia solo exige "al menos un combo cotizable".
export type ComposicionSugerencia = {
  adultosDeclarados: number;
  habitacionesConsultadas: HabitacionConsultada[];
  edadesMenores: number[];
  edadInfanteMax: number;
  edadNinoMax: number;
  adultsOnly: boolean;
};

function compatibleConComposicion(resultado: ResultadoHotelFechas, comp: ComposicionSugerencia): boolean {
  if (comp.adultsOnly && comp.edadesMenores.length > 0) return false;
  const porAcom = new Map<AcomRoom, number>();
  for (const h of comp.habitacionesConsultadas) porAcom.set(h.acom, (porAcom.get(h.acom) ?? 0) + 1);
  let ninos = 0, ninos2 = 0, infantes = 0;
  // `distribuirPorHabitaciones` valida SIEMPRE (no solo cuando hay menores):
  // también es la única fuente de verdad de "¿la cantidad de adultos
  // declarada cuadra con las habitaciones elegidas?" (adultosDeclarados vs.
  // Σ pax_tarifa) y de la coherencia de configuración de cada habitación —
  // un problema de capacidad/configuración es de COMPOSICIÓN, ninguna fecha
  // lo arregla, así que nunca debe colarse una sugerencia cuando esto falla.
  const rClasif = comp.edadesMenores.length > 0
    ? clasificarMenoresPorEdad(comp.edadesMenores, comp.edadInfanteMax, comp.edadNinoMax)
    : { ok: true as const, c: { ninos: 0, infantes: 0 } };
  if (!rClasif.ok) return false;
  const rDist = distribuirPorHabitaciones({
    adultosDeclarados: comp.adultosDeclarados, ninos: rClasif.c.ninos, infantes: rClasif.c.infantes,
    habitaciones: comp.habitacionesConsultadas,
  });
  if (!rDist.ok) return false;
  ninos = rDist.totales.nino; ninos2 = rDist.totales.nino2; infantes = rDist.totales.infantes;
  const menoresTotales: ClasificacionMenores = { infantes, nino: ninos, nino2: ninos2 };
  for (const combo of resultado.combos) {
    const errTarifa = verificarTarifasMenoresDisponibles(menoresTotales, { nino: combo.precios["nino"] != null, nino2: combo.precios["nino2"] != null });
    if (errTarifa) continue;
    let ok = true;
    for (const acom of porAcom.keys()) { if (combo.precios[acom] == null) { ok = false; break; } }
    if (ok) return true;
  }
  return false;
}

/** Suma `dias` días a una fecha ISO (yyyy-mm-dd). */
export function addDiasISO(fechaISO: string, dias: number): string {
  const t = new Date(`${fechaISO}T00:00:00`).getTime() + dias * MS_DIA;
  return new Date(t).toISOString().slice(0, 10);
}

// Techo ESTRICTO de candidatos evaluados por hotel — nunca un barrido diario
// sin límite. `PASOS_DIARIOS` es un barrido local ACOTADO (2 semanas,
// bidireccional) para encontrar fechas cercanas primero (lo que de verdad
// quiere el cliente); `PASOS_SEMANALES` extiende la búsqueda hasta el
// horizonte en saltos de 7 días (también bidireccional). Ambos son semillas
// de BARRIDO — nunca se aceptan sin pasar por `evaluarHotelPorFechas` (el
// motor real), y nunca desplazan a una semilla ESTRUCTURAL (ver más abajo).
const MAX_CANDIDATOS = 60;
const PASOS_DIARIOS = 13;
const PASOS_SEMANALES = 50;

function distanciaDiasFirmada(fecha: string, referencia: string): number {
  return Math.round(
    (new Date(`${fecha}T00:00:00`).getTime() - new Date(`${referencia}T00:00:00`).getTime()) / MS_DIA
  );
}

/**
 * Compara dos fechas ISO por CERCANÍA a `referencia` — nunca por orden
 * cronológico simple (ronda 2, defecto real corregido: `candidatosFecha`
 * ordenaba `[...set].sort()`, así que una temporada vieja-pero-todavía-
 * futura podía aparecer antes que una fecha a un solo día de la solicitada).
 * Criterio: 1) menor distancia absoluta en días gana; 2) en empate, la fecha
 * POSTERIOR a `referencia` gana (más útil para replanificar el viaje que una
 * que ya casi pasó); 3) último desempate, orden ISO determinista.
 */
export function compararPorCercania(a: string, b: string, referencia: string): number {
  const da = Math.abs(distanciaDiasFirmada(a, referencia));
  const db = Math.abs(distanciaDiasFirmada(b, referencia));
  if (da !== db) return da - db;
  const posA = a > referencia;
  const posB = b > referencia;
  if (posA !== posB) return posA ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Candidatas de fecha de ida — semillas ACOTADAS, sin duplicados, dentro de
 * [ventanaInicio, ventanaFin], nunca la fecha ya solicitada, ordenadas por
 * CERCANÍA a `fechaIdaSolicitada` (ver `compararPorCercania`). Dos familias
 * de semillas, con prioridad estricta entre ellas (ronda 2, reestructurado):
 *
 * 1) ESTRUCTURALES (inicio de cada rango de cobertura de temporada, fin+1 de
 *    cada black-out de temporada/hotel) — SIEMPRE entran primero, sin que el
 *    barrido las desplace: una temporada corta y lejana solo existe en este
 *    candidate-set por su fecha de inicio, y ningún salto diario/semanal
 *    garantiza caer justo dentro de ella. `compra_inicio` NUNCA es semilla:
 *    es vigencia de COMPRA (cuándo se puede reservar), no una fecha para
 *    HOSPEDARSE — presentarla como tal sugeriría una fecha de viaje sin
 *    relación real con la disponibilidad de esa noche (puede influir en la
 *    validación del motor, pero nunca como semilla de viaje por sí sola).
 * 2) BARRIDO (diario cercano bidireccional + saltos semanales bidireccionales
 *    hasta el horizonte) — solo llena lo que sobra del cupo después de las
 *    estructurales, nunca las desplaza.
 *
 * Ninguna de las dos familias se devuelve "tal cual" como sugerencia: son
 * solo semillas — cada candidata pasa después por `evaluarHotelPorFechas`
 * (el motor real) en `generarSugerenciasFechas`.
 */
export function candidatosFecha(
  datos: DatosHotelPaquete,
  fechaIdaSolicitada: string,
  ventanaInicio: string,
  ventanaFin: string
): string[] {
  const dentro = (f: string | null | undefined): f is string =>
    !!f && f >= ventanaInicio && f <= ventanaFin && f !== fechaIdaSolicitada;
  const porCercania = (a: string, b: string) => compararPorCercania(a, b, fechaIdaSolicitada);

  const estructurales = new Set<string>();
  for (const t of datos.temporadas) {
    const rangos = normRangos(t.rangos);
    const base = rangos.length ? rangos : (t.fecha_inicio && t.fecha_fin ? [{ fecha_inicio: t.fecha_inicio, fecha_fin: t.fecha_fin }] : []);
    for (const r of base) if (dentro(r.fecha_inicio)) estructurales.add(r.fecha_inicio);
    for (const b of normRangos(t.blackouts)) { const f = addDiasISO(b.fecha_fin, 1); if (dentro(f)) estructurales.add(f); }
  }
  for (const b of datos.blackouts) { const f = addDiasISO(b.fecha_fin, 1); if (dentro(f)) estructurales.add(f); }

  const barrido = new Set<string>();
  for (let i = 1; i <= PASOS_DIARIOS; i++) {
    const adelante = addDiasISO(fechaIdaSolicitada, i); if (dentro(adelante)) barrido.add(adelante);
    const atras = addDiasISO(fechaIdaSolicitada, -i); if (dentro(atras)) barrido.add(atras);
  }
  for (let i = 1; i <= PASOS_SEMANALES; i++) {
    const adelante = addDiasISO(fechaIdaSolicitada, i * 7); if (dentro(adelante)) barrido.add(adelante);
    const atras = addDiasISO(fechaIdaSolicitada, -i * 7); if (dentro(atras)) barrido.add(atras);
  }

  // Las estructurales entran primero (sin que el barrido las desplace); si
  // por sí solas ya llenan el cupo se priorizan también por cercanía. El
  // barrido solo agrega lo que sobra, sin duplicar una fecha ya incluida.
  const resultado = [...estructurales].sort(porCercania).slice(0, MAX_CANDIDATOS);
  if (resultado.length < MAX_CANDIDATOS) {
    const yaIncluidas = new Set(resultado);
    const restante = MAX_CANDIDATOS - resultado.length;
    const extra = [...barrido].filter((f) => !yaIncluidas.has(f)).sort(porCercania).slice(0, restante);
    resultado.push(...extra);
  }
  return resultado.sort(porCercania);
}

const MESES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function etiquetaRango(fechaIda: string, fechaRegreso: string, noches: number, extendida: boolean): string {
  const iM = Number(fechaIda.slice(5, 7)) - 1, iD = Number(fechaIda.slice(8, 10));
  const rM = Number(fechaRegreso.slice(5, 7)) - 1, rD = Number(fechaRegreso.slice(8, 10));
  const rango = iM === rM ? `${iD}–${rD} ${MESES_ES[iM]}` : `${iD} ${MESES_ES[iM]} – ${rD} ${MESES_ES[rM]}`;
  const nochesTxt = `${noches} noche${noches === 1 ? "" : "s"}`;
  return extendida ? `${rango} · ${nochesTxt} (mínimo del hotel)` : `${rango} · ${nochesTxt}`;
}

export const MAX_SUGERENCIAS_FECHAS = 4;
export const HORIZONTE_DIAS_SUGERENCIAS = 365;

/**
 * Hasta `maxSugerencias` fechas REALES (validadas por `evaluarHotelPorFechas`,
 * nunca solo por límites de temporada) donde este hotel/paquete SÍ tiene
 * tarifa — para cuando la fecha pedida por el cliente no tiene. Preserva la
 * duración solicitada cuando es posible; si la temporada de la fecha
 * candidata exige más noches, sugiere esa duración mínima con la etiqueta
 * indicándolo. Solo fechas futuras dentro de [hoy, fecha_viaje_fin del
 * paquete o 12 meses — lo que ocurra primero], ordenadas de la más cercana a
 * la más lejana, sin duplicados.
 */
export function generarSugerenciasFechas(args: {
  datos: DatosHotelPaquete;
  fechaIdaSolicitada: string;
  numNochesSolicitadas: number;
  hoy?: string;
  maxSugerencias?: number;
  horizonteDias?: number;
  composicion?: ComposicionSugerencia | null;
}): SugerenciaFecha[] {
  if (args.numNochesSolicitadas <= 0) return [];
  if (args.composicion?.adultsOnly && args.composicion.edadesMenores.length > 0) return [];

  const hoy = args.hoy ?? hoyISO();
  const max = args.maxSugerencias ?? MAX_SUGERENCIAS_FECHAS;
  const horizonte = args.horizonteDias ?? HORIZONTE_DIAS_SUGERENCIAS;
  const finHorizonte = addDiasISO(hoy, horizonte);
  const fvi = args.datos.paquete.fecha_viaje_inicio;
  const fvf = args.datos.paquete.fecha_viaje_fin;
  const ventanaInicio = fvi && fvi > hoy ? fvi : hoy;
  const ventanaFin = fvf && fvf < finHorizonte ? fvf : finHorizonte;
  if (ventanaFin < ventanaInicio) return [];

  const candidatos = candidatosFecha(args.datos, args.fechaIdaSolicitada, ventanaInicio, ventanaFin);
  const sugerencias: SugerenciaFecha[] = [];

  for (const candidato of candidatos) {
    if (sugerencias.length >= max) break;
    const directa = evaluarHotelPorFechas(args.datos, candidato, args.numNochesSolicitadas);
    if (!directa) continue;

    if (directa.combos.length > 0 && args.numNochesSolicitadas >= directa.minNoches) {
      // La estancia con la duración PEDIDA nunca puede terminar después del
      // cierre de la ventana (fecha_viaje_fin del paquete, u horizonte) —
      // ronda 2, defecto real corregido: antes solo se acotaba `fechaIda`
      // contra la ventana, nunca el `fechaRegreso` resultante de sumarle las
      // noches, así que una candidata a 1–2 días del cierre "se veía" válida
      // y `cotizarPorFechas` la rechazaba igual al pulsarla.
      const fechaRegreso = addDiasISO(candidato, args.numNochesSolicitadas);
      if (fechaRegreso <= ventanaFin && (!args.composicion || compatibleConComposicion(directa, args.composicion))) {
        sugerencias.push({ fechaIda: candidato, fechaRegreso, noches: args.numNochesSolicitadas, etiqueta: etiquetaRango(candidato, fechaRegreso, args.numNochesSolicitadas, false) });
      }
      continue;
    }
    // El hotel exige más noches en esta fecha candidata que las pedidas:
    // se reintenta SOLO con el mínimo real de esa temporada (nunca menos de
    // lo pedido) — la etiqueta lo deja explícito. La EXTENSIÓN por mínimo
    // tampoco puede cruzar el cierre de la ventana (mismo defecto, mismo
    // candado que arriba).
    if (directa.minNoches > args.numNochesSolicitadas) {
      const fechaRegreso = addDiasISO(candidato, directa.minNoches);
      if (fechaRegreso > ventanaFin) continue;
      const extendido = evaluarHotelPorFechas(args.datos, candidato, directa.minNoches);
      if (extendido && extendido.combos.length > 0 && (!args.composicion || compatibleConComposicion(extendido, args.composicion))) {
        sugerencias.push({ fechaIda: candidato, fechaRegreso, noches: directa.minNoches, etiqueta: etiquetaRango(candidato, fechaRegreso, directa.minNoches, true) });
      }
    }
  }
  // Desempate final explícito (defensivo): `candidatosFecha` ya devuelve las
  // semillas ordenadas por cercanía, pero el resultado de ESTA función se
  // reordena igual para que sea correcto por construcción, no solo porque su
  // entrada ya lo esté (el rechazo por `fechaRegreso > ventanaFin` puede
  // saltarse una candidata cercana y aceptar una más lejana en su lugar).
  sugerencias.sort((a, b) => compararPorCercania(a.fechaIda, b.fechaIda, args.fechaIdaSolicitada));
  return sugerencias;
}

/**
 * Consolida las sugerencias de VARIOS hoteles en un solo resultado GLOBAL —
 * ronda 4, defecto real corregido: `sugerenciasBusquedaGeneral` (cotizar.ts)
 * antes recorría los hoteles candidatos y cortaba el bucle en cuanto el
 * PRIMER hotel aportaba 4 sugerencias (`if (sugerencias.length >= 4) break`),
 * así que un hotel evaluado DESPUÉS con una fecha mucho más cercana a la
 * solicitada nunca llegaba a evaluarse; y el resultado final se reordenaba
 * con `localeCompare` (cronológico simple), no con el criterio de cercanía
 * compartido. Esta función pura recibe el lote COMPLETO ya evaluado (un
 * arreglo por hotel, cada uno ya acotado internamente por
 * `generarSugerenciasFechas` a `MAX_SUGERENCIAS_FECHAS`), deduplica por
 * `fechaIda`+`fechaRegreso` y ordena el conjunto GLOBAL con el MISMO
 * `compararPorCercania` — nunca una fórmula de orden distinta — antes de
 * cortar a `max`.
 */
export function consolidarSugerenciasGlobales(
  porHotel: SugerenciaFecha[][],
  fechaIdaSolicitada: string,
  max: number = MAX_SUGERENCIAS_FECHAS
): SugerenciaFecha[] {
  const vistas = new Set<string>();
  const todas: SugerenciaFecha[] = [];
  for (const lote of porHotel) {
    for (const s of lote) {
      const key = `${s.fechaIda}|${s.fechaRegreso}`;
      if (vistas.has(key)) continue;
      vistas.add(key);
      todas.push(s);
    }
  }
  todas.sort((a, b) => compararPorCercania(a.fechaIda, b.fechaIda, fechaIdaSolicitada));
  return todas.slice(0, max);
}
