// ─────────────────────────────────────────────────────────────────────────
// Cotización EN VIVO de hoteles por fechas (porción/dinámico) — solo lectura.
// Extraído de app/(dashboard)/dashboard/reservar/actions.ts (paso 1 de la
// separación de ese archivo): liquidarHotelPaquete, cotizarPorFechas y
// buscarHoteles no insertan/actualizan nada, solo consultan y calculan.
// Requiere service-role porque `tarifa_hotel` es interno.
// ─────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import {
  noches,
  temporadaParaFecha,
  toTemporadaRango,
} from "@/lib/calc/paquetes";
import { defaultAcomConfig, type AcomRoom, type AcomConfig } from "@/lib/acomodaciones";
import {
  validarCantidadMenores,
  validarEdadesMenores,
  validarHabitacionesConsultadas,
  validarAdultosDeclarados,
  validarDestinoConsulta,
  validarPaxTotalConsulta,
  validarPaxServicioConsulta,
  validarRangoFechasConsulta,
  validarEntradaCotizarPorFechas,
  clasificarMenoresPorEdad,
  verificarTarifasMenoresDisponibles,
  type ClasificacionMenores,
} from "@/lib/reservar/edadesMenores";
import { distribuirPorHabitaciones, type HabitacionConsultada } from "@/lib/reservar/distribucionHabitaciones";
import { ejecutarConsultaPaginada } from "@/lib/tarifario/paginacion";
import {
  construirContextoServicios, calcularResultadoServicio, resolverLiquidacionServicioPuntual,
  respuestaPublicaServicioPuntual, formatearLogLiquidacionServicioPuntual, fallaErrorConsulta,
  type DatosServicioPar, type ResultadoServicio, type RespuestaPublicaServicioPuntual,
} from "@/lib/reservar/liquidacionServicio";
import {
  evaluarHotelPorFechas, generarSugerenciasFechas, consolidarSugerenciasGlobales,
  type ComboCotizado, type DatosHotelPaquete, type FilaTemporadaHotelRaw, type FilaTarifaHotelRaw,
  type FilaBlackoutHotelRaw, type SugerenciaFecha, type ComposicionSugerencia,
} from "@/lib/reservar/liquidacionHotel";

export type { ComboCotizado, SugerenciaFecha };

// Mensajes públicos FIJOS para fallos técnicos al cargar un hotel/paquete
// (ronda "fechas sugeridas") — nunca `error.message` de Supabase, nunca
// nombres de tabla/columna/policy, nunca "falta service-role". El detalle
// técnico real se registra SOLO server-side (console.error), con la etapa
// que falló — ver `cargarDatosHotelPaquete` más abajo.
const MENSAJE_HOTEL_ERROR_TECNICO = "No pudimos cotizar este hotel en este momento. Intenta nuevamente.";
const MENSAJE_HOTEL_SIN_TARIFA = "Para las fechas elegidas no encontramos una tarifa.";
const MENSAJE_BUSQUEDA_HOTELES_NO_DISPONIBLE = "Búsqueda no disponible en este momento. Intenta nuevamente.";

type ResultadoCargaHotelPaquete =
  | { ok: true; datos: DatosHotelPaquete }
  | { ok: false; motivo: "paquete_no_encontrado" }
  | { ok: false; motivo: "hotel_no_asociado" }
  | { ok: false; motivo: "error_consulta"; etapa: string; detalleInterno: string };

// ── Carga EN VIVO (una sola vez por hotel/paquete, sin importar cuántas
// fechas se evalúen después) de todo lo que necesita `evaluarHotelPorFechas`
// (lib/reservar/liquidacionHotel.ts, módulo PURO — no toca Supabase). Cada
// una de las 6 consultas revisa su propio `error`: un fallo técnico real
// (RLS, tabla renombrada, columna eliminada) NUNCA debe verse igual que "no
// hay tarifa para esas fechas" — antes de esta ronda sí ocurría, porque el
// código seguía con `?? []`/`undefined` sin mirar el error de ninguna de
// estas consultas.
//
// Ronda 3, defecto real corregido (combinación paquete+hotel manipulable):
// si `armado_hoteles` NO tiene fila para este (paquete_id, hotel_id), esta
// función ANTES seguía adelante con `armadoHotel: null`, que
// `evaluarHotelPorFechas` interpreta como "sin filtro de categoría/régimen,
// moneda COP" — es decir, cotizaba usando el margen/impuesto/destino/
// servicios incluidos del PAQUETE junto con las tarifas/temporadas del
// HOTEL, aunque ese hotel nunca hubiera sido asociado a ese paquete. Se
// auditaron los 3 llamadores (`liquidarHotelPaquete`/`cotizarPorFechas`/
// `buscarHoteles`) y el checkout (`computo.ts` vía `liquidarHotelPaquete`,
// con `paqueteId`/`hotelId` que llegan del carrito público solo validados
// por TIPO, nunca por existencia del vínculo): ninguno re-valida el vínculo
// `armado_hoteles` de forma independiente, así que el candado tiene que
// vivir acá, en el ÚNICO punto que consulta esa tabla. No existe ningún
// flujo de negocio documentado que dependa de cotizar un hotel sin esa
// fila — el único caso real donde `hsel` puede faltar es un `tarifario_
// resultado` desactualizado (un hotel se desmarcó de un paquete sin
// regenerar el tarifario), que es justamente el caso en el que NO se debe
// seguir cotizando con datos mezclados. Ahora falla cerrado con un motivo
// ESTRUCTURADO (`hotel_no_asociado`, nunca un mensaje de texto) para que
// cada llamador decida su propio mensaje comercial/log sin tener que
// adivinar la causa.
async function cargarDatosHotelPaquete(
  admin: ReturnType<typeof createAdminClient>,
  paqueteId: number,
  hotelId: number
): Promise<ResultadoCargaHotelPaquete> {
  const { data: pq, error: pqErr } = await admin
    .from("armado_paquetes")
    .select("pct_mk, impuesto_fijo, destino_id, destinos(nombre), fecha_viaje_inicio, fecha_viaje_fin")
    .eq("id", paqueteId)
    .maybeSingle();
  if (pqErr) return { ok: false, motivo: "error_consulta", etapa: "armado_paquetes", detalleInterno: pqErr.message };
  if (!pq) return { ok: false, motivo: "paquete_no_encontrado" };

  const [
    { data: hsel, error: hselErr },
    { data: temps, error: tempsErr },
    { data: tarifas, error: tarifasErr },
    { data: servSel, error: servSelErr },
    { data: blackouts, error: blackoutsErr },
  ] = await Promise.all([
    admin.from("armado_hoteles").select("categorias, regimenes, hoteles(nombre, moneda)").eq("paquete_id", paqueteId).eq("hotel_id", hotelId).maybeSingle(),
    admin.from("hotel_temporadas").select("nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts, min_noches, regimen_restringido").eq("hotel_id", hotelId),
    admin.from("tarifa_hotel").select("*").eq("hotel_id", hotelId),
    admin.from("armado_servicios").select("incluido, servicios_adicionales(precio_persona, liquidacion)").eq("paquete_id", paqueteId),
    admin.from("hotel_blackouts").select("fecha_inicio, fecha_fin, total, acomodaciones, categorias").eq("hotel_id", hotelId),
  ]);
  if (hselErr) return { ok: false, motivo: "error_consulta", etapa: "armado_hoteles", detalleInterno: hselErr.message };
  if (!hsel) return { ok: false, motivo: "hotel_no_asociado" };
  if (tempsErr) return { ok: false, motivo: "error_consulta", etapa: "hotel_temporadas", detalleInterno: tempsErr.message };
  if (tarifasErr) return { ok: false, motivo: "error_consulta", etapa: "tarifa_hotel", detalleInterno: tarifasErr.message };
  if (servSelErr) return { ok: false, motivo: "error_consulta", etapa: "armado_servicios", detalleInterno: servSelErr.message };
  if (blackoutsErr) return { ok: false, motivo: "error_consulta", etapa: "hotel_blackouts", detalleInterno: blackoutsErr.message };

  const hotelMeta = hsel.hoteles as unknown as { nombre: string; moneda?: string | null } | null;
  const destinoNombre = (pq.destinos as unknown as { nombre: string } | null)?.nombre ?? null;

  const datos: DatosHotelPaquete = {
    paquete: {
      pct_mk: pq.pct_mk, impuesto_fijo: pq.impuesto_fijo, destino_nombre: destinoNombre,
      fecha_viaje_inicio: pq.fecha_viaje_inicio, fecha_viaje_fin: pq.fecha_viaje_fin,
    },
    armadoHotel: {
      categorias: (hsel.categorias as string[] | null) ?? null,
      regimenes: (hsel.regimenes as string[] | null) ?? null,
      hotel_nombre: hotelMeta?.nombre ?? null,
      hotel_moneda: hotelMeta?.moneda ?? null,
    },
    temporadas: (temps ?? []) as FilaTemporadaHotelRaw[],
    tarifas: (tarifas ?? []) as FilaTarifaHotelRaw[],
    serviciosIncluidos: (servSel ?? []).map((s) => ({
      incluido: !!s.incluido,
      precio_persona: (s.servicios_adicionales as unknown as { precio_persona: number | null } | null)?.precio_persona ?? null,
      liquidacion: (s.servicios_adicionales as unknown as { liquidacion: string | null } | null)?.liquidacion ?? null,
    })),
    blackouts: (blackouts ?? []) as FilaBlackoutHotelRaw[],
  };
  return { ok: true, datos };
}

// ── Liquidación EN VIVO de un hotel para fechas elegidas (motor por fechas) ──
// Reutiliza el mismo motor del generador de tarifario, pero para las noches que
// el asesor elige en Reservar (porción/dinámico). Devuelve SOLO PVP por
// categoría/régimen/acomodación (los costos netos no se exponen al cliente;
// sí se devuelven aquí como `netos`, autoritativos, para uso interno del
// cómputo de la reserva).
//
// Envoltorio delgado (ronda "fechas sugeridas"): la carga (I/O, con revisión
// de error por consulta) vive en `cargarDatosHotelPaquete`; el cálculo
// (idéntico al de siempre, byte a byte) vive en `evaluarHotelPorFechas`
// (lib/reservar/liquidacionHotel.ts, módulo PURO, testeable sin Supabase).
// Firma y contrato de retorno SIN CAMBIOS — `computo.ts` (el motor
// autoritativo de reservar/checkout) sigue viendo exactamente el mismo
// `{...} | null`: un fallo técnico ahora se comporta igual que "paquete no
// encontrado" se comportaba antes (`null`), nunca peor ni distinto para ese
// consumidor — el manejo de error MÁS específico (mensaje sanado + log) vive
// en `cotizarPorFechas`/`buscarHoteles`, que sí llaman `cargarDatosHotelPaquete`
// directo para poder distinguirlo.
export async function liquidarHotelPaquete(
  admin: ReturnType<typeof createAdminClient>,
  paqueteId: number,
  hotelId: number,
  fechaIda: string,
  numNoches: number
): Promise<{ combos: ComboCotizado[]; destinoNombre: string | null; hotelNombre: string | null; minNoches: number; moneda: string } | null> {
  if (numNoches <= 0) return null;
  const carga = await cargarDatosHotelPaquete(admin, paqueteId, hotelId);
  if (!carga.ok) {
    // Ronda 2, defecto real corregido: un fallo TÉCNICO al cargar (RLS,
    // tabla renombrada, columna eliminada) se devolvía como `null` sin dejar
    // rastro — indistinguible en los logs de "paquete/hotel no encontrado".
    // Ronda 3: mismo criterio para `hotel_no_asociado` — este es el ÚNICO
    // llamador que alimenta directamente el checkout (computo.ts), con
    // `paqueteId`/`hotelId` que llegan del carrito público validados solo
    // por tipo, así que un intento de combinar un paquete real con un hotel
    // no asociado a él debe quedar registrado acá. El contrato de retorno
    // (`null`) no cambia en ningún caso — `computo.ts` sigue viendo
    // exactamente lo mismo — solo se agrega el registro server-side.
    if (carga.motivo === "error_consulta") {
      console.error(`[liquidarHotelPaquete] etapa=${carga.etapa} paqueteId=${paqueteId} hotelId=${hotelId} detalle=${carga.detalleInterno}`);
    } else if (carga.motivo === "hotel_no_asociado") {
      console.error(`[liquidarHotelPaquete] etapa=hotel_no_asociado paqueteId=${paqueteId} hotelId=${hotelId} detalle=el hotel no tiene fila armado_hoteles para este paquete — combinación rechazada`);
    }
    return null;
  }
  return evaluarHotelPorFechas(carga.datos, fechaIda, numNoches);
}

export type CotizarResult =
  | { ok: true; combos: ComboCotizado[]; noches: number; moneda: string }
  | { ok: false; error: string; sugerencias: SugerenciaFecha[] };

/**
 * Cotiza un hotel para las fechas que elige el asesor/cliente (porción/
 * dinámico). Cuando la fecha pedida no tiene tarifa (o exige más noches),
 * devuelve además hasta 4 `sugerencias` de fechas cercanas donde este MISMO
 * hotel/paquete SÍ cotiza — validadas con el mismo motor real
 * (`generarSugerenciasFechas`, lib/reservar/liquidacionHotel.ts), nunca
 * derivadas solo de los límites de una temporada. `sugerencias` es siempre
 * un arreglo (vacío si no aplica o si el fallo fue técnico) para que el
 * llamador no tenga que distinguir `undefined` de "no hay".
 *
 * FRONTERA PÚBLICA: `inputRaw` se trata como `unknown` (ronda 2, defecto real
 * corregido: esta función seguía tipada como `{ paqueteId; hotelId; fechaIda;
 * fechaRegreso }` directo, sin validar la forma — un caller manipulado podía
 * mandar `null`, un arreglo, ids decimales/negativos/`Infinity` o fechas
 * imposibles). `validarEntradaCotizarPorFechas` (lib/reservar/edadesMenores.ts)
 * valida objeto → ids enteros seguros positivos → fechas reales → rango →
 * "no antes de hoy" → noches acotadas, ANTES de leer una sola propiedad para
 * tocar Supabase. El detalle interno de un fallo técnico o de catálogo
 * (mensaje real de Supabase, o qué temporada específica falta cargar) NUNCA
 * cruza hacia el navegador — se registra con `console.error` server-side; el
 * cliente recibe siempre uno de dos mensajes fijos y comerciales
 * (`MENSAJE_HOTEL_SIN_TARIFA`/`MENSAJE_HOTEL_ERROR_TECNICO`).
 */
export async function cotizarPorFechas(inputRaw: unknown): Promise<CotizarResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[cotizarPorFechas] etapa=arranque detalle=SUPABASE_SERVICE_ROLE_KEY no configurada");
    return { ok: false, error: MENSAJE_HOTEL_ERROR_TECNICO, sugerencias: [] };
  }
  const vEntrada = validarEntradaCotizarPorFechas(inputRaw);
  if (!vEntrada.ok) return { ok: false, error: vEntrada.error, sugerencias: [] };
  const input = vEntrada.input;
  const numNoches = input.noches;

  const admin = createAdminClient();
  const carga = await cargarDatosHotelPaquete(admin, input.paqueteId, input.hotelId);
  if (!carga.ok) {
    if (carga.motivo === "paquete_no_encontrado") return { ok: false, error: MENSAJE_HOTEL_SIN_TARIFA, sugerencias: [] };
    if (carga.motivo === "hotel_no_asociado") {
      // Ronda 3: combinación paquete+hotel sin fila `armado_hoteles` — nunca
      // se evalúan tarifas ni se generan sugerencias (no hay `datos` reales
      // que ofrecer), el cliente recibe el mismo mensaje comercial genérico
      // que "sin tarifa" (nunca revela que el par es inválido), y el detalle
      // se registra server-side para poder detectar caché desactualizada o
      // un intento de combinación fabricada.
      console.error(`[cotizarPorFechas] etapa=hotel_no_asociado paqueteId=${input.paqueteId} hotelId=${input.hotelId} detalle=el par no tiene fila armado_hoteles`);
      return { ok: false, error: MENSAJE_HOTEL_SIN_TARIFA, sugerencias: [] };
    }
    console.error(`[cotizarPorFechas] etapa=${carga.etapa} paqueteId=${input.paqueteId} hotelId=${input.hotelId} detalle=${carga.detalleInterno}`);
    return { ok: false, error: MENSAJE_HOTEL_ERROR_TECNICO, sugerencias: [] };
  }
  const { datos } = carga;

  if (datos.paquete.fecha_viaje_inicio && input.fechaIda < datos.paquete.fecha_viaje_inicio)
    return { ok: false, error: `La ida no puede ser antes del ${datos.paquete.fecha_viaje_inicio} (rango del paquete).`, sugerencias: [] };
  if (datos.paquete.fecha_viaje_fin && input.fechaRegreso > datos.paquete.fecha_viaje_fin)
    return { ok: false, error: `El regreso no puede ser después del ${datos.paquete.fecha_viaje_fin} (rango del paquete).`, sugerencias: [] };

  const res = evaluarHotelPorFechas(datos, input.fechaIda, numNoches);
  if (res && numNoches < (res.minNoches ?? 1)) {
    const sugerencias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: input.fechaIda, numNochesSolicitadas: numNoches });
    return { ok: false, error: `Este alojamiento exige un mínimo de ${res.minNoches} noche(s) para esas fechas.`, sugerencias };
  }
  if (!res || !res.combos.length) {
    // Diagnóstico técnico (SOLO para el log — nunca al cliente, ver mensaje
    // fijo más abajo): ¿qué temporada de las noches elegidas no tiene tarifa
    // cargada? Reutiliza los datos YA CONSULTADOS por `cargarDatosHotelPaquete`
    // — antes de esta ronda esto repetía 2 consultas más a Supabase.
    const temporadas = datos.temporadas.map(toTemporadaRango);
    const conTarifa = new Set(datos.tarifas.map((t) => ((t.temporada as string) ?? "").trim()));
    const base = new Date(`${input.fechaIda}T00:00:00`).getTime();
    const faltan = new Set<string>();
    let hayNocheSinTemp = false;
    for (let n = 0; n < numNoches; n++) {
      const temp = temporadaParaFecha(new Date(base + n * 86_400_000), temporadas);
      if (!temp) hayNocheSinTemp = true;
      else if (!conTarifa.has(temp.trim())) faltan.add(temp);
    }
    let detalle = "sin diagnóstico adicional (0 combos)";
    if (faltan.size) detalle = `falta cargar la tarifa de la temporada: ${[...faltan].join(", ")}`;
    else if (hayNocheSinTemp) detalle = "hay noches que no caen en ninguna temporada del hotel";
    console.error(`[cotizarPorFechas] etapa=sin_tarifa paqueteId=${input.paqueteId} hotelId=${input.hotelId} detalle=${detalle}`);

    const sugerencias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: input.fechaIda, numNochesSolicitadas: numNoches });
    return { ok: false, error: MENSAJE_HOTEL_SIN_TARIFA, sugerencias };
  }
  // Se devuelve al cliente SIN `netos` (el costo interno no sale del servidor).
  const combosPublicos = res.combos.map((c) => ({ categoria: c.categoria, regimen: c.regimen, precios: c.precios }));
  return { ok: true, combos: combosPublicos, noches: numNoches, moneda: res.moneda };
}

// ── Mini-motor de búsqueda (público): liquida TODOS los hoteles de porción para
// las fechas y la composición de habitaciones, y devuelve los que CABEN ya con
// precio (el combo categoría/régimen más barato por hotel). Los menores se
// declaran por EDAD EXACTA (nunca fecha de nacimiento) y se clasifican
// infante/niño PER HOTEL, porque cada hotel puede tener un umbral de edad
// distinto (`edad_infante_max`/`edad_nino_max`, ver
// lib/reservar/edadesMenores.ts). Quién paga Niño 1/Niño 2 se decide
// DESPUÉS, repartiendo por HABITACIÓN (`distribuirPorHabitaciones`, ver
// lib/reservar/distribucionHabitaciones.ts) — NO es un límite de 2 niños en
// toda la búsqueda: un hotel cuyas habitaciones consultadas no alcanzan a
// acomodar la composición (por edad, por capacidad de niño/infante o por la
// cantidad de adultos declarada) simplemente no aparece en el resultado — es
// una búsqueda entre varios hoteles, no un solo cálculo que deba fallar
// entero por uno de ellos. `adultos` es la cantidad REAL declarada por el
// usuario (campo "Adultos" de Vista Booking) — debe coincidir con lo que las
// habitaciones elegidas implican (`pax_tarifa` por habitación), si no la
// búsqueda entera falla con un mensaje claro (no es un rechazo por hotel). ──
export type BusquedaInput = {
  fechaIda: string;
  fechaRegreso: string;
  habitaciones: { acom: AcomRoom }[]; // una entrada por habitación, en orden de captura
  adultos: number; // cantidad real de adultos declarada — debe cuadrar con las habitaciones
  cantidadMenores: number;
  edadesMenores: number[]; // edad exacta de cada menor
  destino?: string; // filtra por destino (vacío = todos)
};
export type BusquedaResultado = {
  hotelId: number; hotelNombre: string | null; destino: string | null;
  paqueteId: number; categoria: string; regimen: string;
  total: number; noches: number; fechaIda: string; fechaRegreso: string;
  habitaciones: Record<string, number>;
  menores: ClasificacionMenores; // totales de la distribución por habitación, para ESTE hotel
  edadesMenores: number[]; // las mismas edades de la búsqueda — para persistir en el carrito
  pax: number;
  // Todos los combos válidos (categoría × régimen) para esta composición, con su
  // precio. El top-level categoria/regimen/total es el más barato (predeterminado).
  combos: { categoria: string; regimen: string; total: number; pax: number; menores: ClasificacionMenores }[];
};

// Máximo de hoteles/paquetes cuyo `DatosHotelPaquete` (ya cargado durante la
// búsqueda principal, sin I/O adicional) se usa para intentar sugerencias de
// fecha — acota el trabajo extra (fetch de acomodaciones/edades por hotel,
// necesario SOLO para validar composición) cuando el destino consultado
// tiene muchos hoteles.
const MAX_HOTELES_SUGERENCIA_FECHA = 6;

// Recorre un subconjunto ACOTADO de los pares hotel/paquete cuya carga fue
// exitosa (cacheada durante el bucle principal de `buscarHoteles`, cero
// consultas nuevas para eso) y les pide sugerencias de fecha reales.
//
// Ronda 2, defecto real corregido (N+1): antes se consultaba
// `hotel_acomodaciones`/`hoteles` UNA VEZ POR HOTEL dentro del bucle
// (hasta `MAX_HOTELES_SUGERENCIA_FECHA` × 2 consultas). Ahora se toman
// primero los `hotelId` candidatos y se hacen exactamente DOS consultas
// totales con `.in(...)` — nunca dos por hotel — armando mapas en memoria.
// Cada consulta revisa su propio error POR SEPARADO: si cualquiera falla, no
// se muestran sugerencias engañosas (fail-closed) para NINGÚN hotel de este
// lote — el detalle técnico se registra solo server-side.
//
// Ronda 4, defecto real corregido (elección global, no por el primer hotel):
// el bucle antes cortaba con `if (sugerencias.length >= 4) break` apenas el
// PRIMER hotel del lote aportaba 4 sugerencias, y el resultado final se
// reordenaba con `localeCompare` (cronológico simple) en vez del criterio de
// cercanía compartido — un hotel evaluado DESPUÉS con una fecha mucho más
// cercana a `input.fechaIda` nunca llegaba a evaluarse. Ahora se evalúan
// TODOS los candidatos del lote (cada uno sigue acotado internamente a
// `MAX_SUGERENCIAS_FECHAS` por `generarSugerenciasFechas`, sin cambios ahí —
// hasta `MAX_HOTELES_SUGERENCIA_FECHA` × `MAX_SUGERENCIAS_FECHAS` = 24
// candidatas en memoria, ninguna consulta nueva) y la selección final es una
// decisión GLOBAL de `consolidarSugerenciasGlobales`
// (lib/reservar/liquidacionHotel.ts, pura y testeable), que dedupe y ordena
// con el MISMO `compararPorCercania` que ya usa `generarSugerenciasFechas`.
async function sugerenciasBusquedaGeneral(
  admin: ReturnType<typeof createAdminClient>,
  datosPorPar: { paquete: number; hotel: number; datos: DatosHotelPaquete }[],
  input: BusquedaInput,
  numNoches: number
): Promise<SugerenciaFecha[]> {
  const candidatos = datosPorPar.slice(0, MAX_HOTELES_SUGERENCIA_FECHA);
  let acomCfgPorHotel: Map<number, AcomConfig[]> | null = null;
  let hotelRowPorId: Map<number, { edad_infante_max: number | null; edad_nino_max: number | null; adults_only: boolean | null }> | null = null;

  if (input.habitaciones.length && candidatos.length) {
    const hotelIds = [...new Set(candidatos.map((c) => c.hotel))];
    const [{ data: acomCfg, error: acomCfgErr }, { data: hotelRows, error: hotelRowsErr }] = await Promise.all([
      admin.from("hotel_acomodaciones").select("hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max").in("hotel_id", hotelIds),
      admin.from("hoteles").select("id, edad_infante_max, edad_nino_max, adults_only").in("id", hotelIds),
    ]);
    if (acomCfgErr || hotelRowsErr) {
      console.error(`[buscarHoteles.sugerenciasBusquedaGeneral] etapa=hotel_acomodaciones_o_hoteles detalle=${acomCfgErr?.message ?? hotelRowsErr?.message}`);
      return []; // fail-closed: sin datos de composición confiables, no se sugiere nada engañoso
    }
    acomCfgPorHotel = new Map();
    for (const r of (acomCfg ?? []) as (AcomConfig & { hotel_id: number })[]) {
      const arr = acomCfgPorHotel.get(r.hotel_id) ?? [];
      arr.push(r);
      acomCfgPorHotel.set(r.hotel_id, arr);
    }
    hotelRowPorId = new Map();
    for (const h of hotelRows ?? []) hotelRowPorId.set(h.id, h);
  }

  const porHotel: SugerenciaFecha[][] = [];
  for (const { hotel, datos } of candidatos) {
    let composicion: ComposicionSugerencia | null = null;
    if (input.habitaciones.length) {
      // Ronda 3, defecto real corregido: si la consulta a `hoteles` tuvo
      // éxito pero NO trajo fila para este hotel puntual (fila maestra
      // faltante — inconsistencia real, no un error técnico), el código
      // antes caía a `?? 2`/`?? 10`/`false` — inventando umbrales de
      // edad y "no es Adults Only" sin ninguna base. Eso podría sugerir una
      // fecha realmente incompatible (ej. un hotel Adults Only real
      // apareciendo como si aceptara menores). Fail-closed POR HOTEL: sin la
      // fila maestra, este hotel no participa de las sugerencias — nunca se
      // inventa la restricción, solo se omite (no revienta el resto del
      // lote). La ausencia de `hotel_acomodaciones` (reglas.length === 0) es
      // otro caso, ya cubierto por `defaultAcomConfig` — regla deliberada y
      // documentada del sistema (mismo fallback 1/2/3/4 que usa el resto del
      // motor de reservas cuando un hotel no configuró acomodaciones), no se
      // toca acá.
      const hotelRow = hotelRowPorId?.get(hotel);
      if (!hotelRow) {
        console.error(`[buscarHoteles.sugerenciasBusquedaGeneral] etapa=hotel_sin_fila_maestra hotelId=${hotel} detalle=falta la fila en 'hoteles' para este candidato — se omite del lote de sugerencias`);
        continue;
      }
      const reglas = acomCfgPorHotel?.get(hotel) ?? [];
      const configDe = (a: AcomRoom): AcomConfig => reglas.find((x) => x.acomodacion === a) ?? defaultAcomConfig(a);
      composicion = {
        adultosDeclarados: input.adultos,
        habitacionesConsultadas: input.habitaciones.map((h) => ({ acom: h.acom, config: configDe(h.acom) })),
        edadesMenores: input.edadesMenores,
        edadInfanteMax: hotelRow.edad_infante_max ?? 2,
        edadNinoMax: hotelRow.edad_nino_max ?? 10,
        adultsOnly: !!hotelRow.adults_only,
      };
    }
    const propias = generarSugerenciasFechas({ datos, fechaIdaSolicitada: input.fechaIda, numNochesSolicitadas: numNoches, composicion });
    if (propias.length) porHotel.push(propias);
  }
  return consolidarSugerenciasGlobales(porHotel, input.fechaIda);
}

// `inputRaw` se trata como `unknown` — esta función es alcanzable desde el
// navegador (Server Action) con cualquier body HTTP, sin importar lo que
// declare el tipo `BusquedaInput`. Se valida la FORMA completa (objeto,
// fechas, destino, adultos, habitaciones, cantidad de menores, edades) antes
// de tocar la base de datos o el motor de liquidación.
export async function buscarHoteles(inputRaw: unknown): Promise<
  { ok: true; resultados: BusquedaResultado[]; diagnostico?: string; sugerenciasFecha?: SugerenciaFecha[] } | { ok: false; error: string }
> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[buscarHoteles] etapa=arranque detalle=SUPABASE_SERVICE_ROLE_KEY no configurada");
    return { ok: false, error: MENSAJE_BUSQUEDA_HOTELES_NO_DISPONIBLE };
  }
  if (typeof inputRaw !== "object" || inputRaw === null || Array.isArray(inputRaw)) {
    return { ok: false, error: "La consulta no tiene una forma válida." };
  }
  const o = inputRaw as Record<string, unknown>;
  // Ronda 3, defecto real corregido: antes solo se validaba fecha real +
  // rango (regreso > ida), sin exigir "ida no anterior a hoy" ni acotar el
  // número de noches — un payload manipulado podía pedir un rango de años/
  // décadas, y `evaluarHotelPorFechas` construye `nochesStay` recorriendo
  // `numNoches` uno a uno POR CADA hotel candidato de la búsqueda. Mismo
  // validador compartido que usa `cotizarPorFechas`/`buscarReceptivos` — la
  // regla vive en un solo lugar (`validarRangoFechasConsulta`).
  const vRango = validarRangoFechasConsulta(o.fechaIda, o.fechaRegreso);
  if (!vRango.ok) return { ok: false, error: vRango.error };
  const vDestino = validarDestinoConsulta(o.destino);
  if (!vDestino.ok) return { ok: false, error: vDestino.error };
  const vHabs = validarHabitacionesConsultadas(o.habitaciones);
  if (!vHabs.ok) return { ok: false, error: vHabs.error };
  const vAdultos = validarAdultosDeclarados(o.adultos);
  if (!vAdultos.ok) return { ok: false, error: vAdultos.error };
  const vCant = validarCantidadMenores(o.cantidadMenores);
  if (!vCant.ok) return { ok: false, error: vCant.error };
  const vEdades = validarEdadesMenores(o.edadesMenores, vCant.cantidad);
  if (!vEdades.ok) return { ok: false, error: vEdades.error };

  const input: BusquedaInput = {
    fechaIda: vRango.fechaIda, fechaRegreso: vRango.fechaRegreso, habitaciones: vHabs.habitaciones,
    adultos: vAdultos.adultos, cantidadMenores: vCant.cantidad, edadesMenores: vEdades.edades,
    destino: vDestino.destino || undefined,
  };
  const edades = input.edadesMenores;
  const numNoches = vRango.noches;
  const vPaxTotal = validarPaxTotalConsulta(input.adultos, edades.length);
  if (!vPaxTotal.ok) return { ok: false, error: vPaxTotal.error };

  const admin = createAdminClient();
  // Paginado robusto (ronda posterior — incidente "RECEPTIVOS ADZ"): esta
  // consulta no acota por paquete/hotel puntual, solo por módulo/destino —
  // con el catálogo real (~16.000 filas en tarifario_resultado) puede
  // superar el límite "Max Rows" del proyecto, y un `.select()` sin
  // `.range()` lo trunca EN SILENCIO (sin `error`). Ver
  // lib/tarifario/paginacion.ts (`ejecutarConsultaPaginada`).
  const { data: filas, error: filasErr } = await ejecutarConsultaPaginada<{
    paquete_id: number; hotel_id: number | null; destino_nombre: string | null;
  }>((from, hasta) => {
    let q = admin
      .from("tarifario_resultado")
      .select("paquete_id, hotel_id, destino_nombre")
      .eq("modulo", "porcion_terrestre")
      .eq("paquete_activo", true);
    if (input.destino?.trim()) q = q.eq("destino_nombre", input.destino.trim());
    return q.order("id").range(from, hasta);
  });
  if (filasErr) {
    console.error(`[buscarHoteles] etapa=tarifario_resultado detalle=${filasErr instanceof Error ? filasErr.message : JSON.stringify(filasErr)}`);
    return { ok: false, error: MENSAJE_BUSQUEDA_HOTELES_NO_DISPONIBLE };
  }
  const pares = new Map<string, { paquete: number; hotel: number }>();
  for (const f of filas ?? []) if (f.paquete_id != null && f.hotel_id != null) pares.set(`${f.paquete_id}-${f.hotel_id}`, { paquete: f.paquete_id, hotel: f.hotel_id });

  // Composición agregada por acomodación (nº de habitaciones por tipo, para
  // el precio de cada combo). La LISTA en orden de captura (`input.habitaciones`)
  // se conserva aparte para la distribución por habitación, que sí depende
  // del orden en que se armaron las habitaciones.
  const porAcom = new Map<AcomRoom, number>();
  for (const r of input.habitaciones) porAcom.set(r.acom, (porAcom.get(r.acom) ?? 0) + 1);
  const habitacionesOut: Record<string, number> = {};
  for (const [a, count] of porAcom) habitacionesOut[a] = count;

  const resultados: BusquedaResultado[] = [];
  // Motivo de rechazo por hotel evaluado — nunca se expone cuál hotel dio
  // cuál motivo; solo sirve para armar un diagnóstico agregado si la
  // búsqueda entera queda en 0 resultados por la misma composición.
  const rechazos = new Map<string, number>();
  let evaluados = 0;
  let falloTecnico = false;
  const registrarRechazo = (motivo: string) => rechazos.set(motivo, (rechazos.get(motivo) ?? 0) + 1);
  // Datos crudos de cada hotel/paquete cuya carga tuvo éxito pero NO tenía
  // tarifa para la fecha pedida (o exigía más noches) — se guardan (sin
  // I/O extra, ya están en memoria) para poder intentar sugerencias de
  // fecha DESPUÉS, solo si la búsqueda completa termina en 0 resultados por
  // motivo de fechas (ver el cierre de la función).
  const datosSinTarifaParaFecha: { paquete: number; hotel: number; datos: DatosHotelPaquete }[] = [];

  for (const { paquete, hotel } of pares.values()) {
    const carga = await cargarDatosHotelPaquete(admin, paquete, hotel);
    if (!carga.ok) {
      if (carga.motivo === "error_consulta") {
        console.error(`[buscarHoteles] etapa=${carga.etapa} paqueteId=${paquete} hotelId=${hotel} detalle=${carga.detalleInterno}`);
        falloTecnico = true;
      } else if (carga.motivo === "hotel_no_asociado") {
        // Ronda 3: `pares` sale de `tarifario_resultado`, que es un CACHÉ —
        // puede quedar desactualizado si un hotel se desmarca de un paquete
        // (armado_hoteles) sin regenerar el tarifario, o el par podría ser
        // fabricado. En ningún caso corresponde cotizar mezclando margen/
        // impuesto/servicios del paquete con tarifas de un hotel que HOY no
        // está asociado — se ignora el par (no cuenta como `evaluados` ni
        // entra a `datosSinTarifaParaFecha`, tampoco es un fallo técnico) y
        // se registra para poder detectar caché desactualizada.
        console.error(`[buscarHoteles] etapa=hotel_no_asociado paqueteId=${paquete} hotelId=${hotel} detalle=el par no tiene fila armado_hoteles — posible tarifario_resultado desactualizado`);
      }
      continue; // "paquete_no_encontrado" no debería pasar (viene de tarifario_resultado), pero tampoco revienta la búsqueda de los demás pares
    }
    const { datos } = carga;
    const res = evaluarHotelPorFechas(datos, input.fechaIda, numNoches);
    if (!res || !res.combos.length || numNoches < (res.minNoches ?? 1)) {
      // Sin tarifa para ESTA fecha (o exige más noches) — motivo de fecha,
      // nunca de composición: se guarda para sugerencias, nunca se cuenta
      // en `evaluados` (esa cuenta es exclusiva de los pares que SÍ tenían
      // tarifa y llegaron a la etapa de composición).
      datosSinTarifaParaFecha.push({ paquete, hotel, datos });
      continue;
    }

    const [{ data: acomCfg, error: acomCfgErr }, { data: hotelRow, error: hotelRowErr }] = await Promise.all([
      admin.from("hotel_acomodaciones").select("acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max").eq("hotel_id", hotel),
      admin.from("hoteles").select("edad_infante_max, edad_nino_max, adults_only").eq("id", hotel).maybeSingle(),
    ]);
    if (acomCfgErr || hotelRowErr) {
      console.error(`[buscarHoteles] etapa=hotel_acomodaciones_o_hoteles paqueteId=${paquete} hotelId=${hotel} detalle=${acomCfgErr?.message ?? hotelRowErr?.message}`);
      falloTecnico = true;
      continue;
    }
    evaluados++;
    if (edades.length > 0 && hotelRow?.adults_only) { registrarRechazo("Este hotel es Adults Only y no acepta menores."); continue; }

    const reglas = (acomCfg ?? []) as AcomConfig[];
    const configDe = (a: AcomRoom): AcomConfig => reglas.find((x) => x.acomodacion === a) ?? defaultAcomConfig(a);

    // Clasificación REAL por edad, contra el umbral de ESTE hotel — nunca una
    // edad de referencia genérica. Alguien mayor al umbral de niño no tiene
    // cabida en este campo (falla cerrado, nunca se cuenta como adulto solo).
    let ninosClasif = 0, infantesClasif = 0;
    if (edades.length > 0) {
      const rClasif = clasificarMenoresPorEdad(edades, hotelRow?.edad_infante_max ?? 2, hotelRow?.edad_nino_max ?? 10);
      if (!rClasif.ok) { registrarRechazo(rClasif.error); continue; }
      ninosClasif = rClasif.c.ninos;
      infantesClasif = rClasif.c.infantes;
    }

    // Distribución REAL por habitación: primer niño de cada habitación →
    // Niño 1, segundo → Niño 2 (nunca un límite global de 2 en toda la
    // búsqueda), respetando la capacidad real de cada habitación consultada
    // y la cantidad de adultos declarada.
    const habitacionesConsultadas: HabitacionConsultada[] = input.habitaciones.map((h) => ({ acom: h.acom, config: configDe(h.acom) }));
    const rDist = distribuirPorHabitaciones({
      adultosDeclarados: input.adultos,
      ninos: ninosClasif,
      infantes: infantesClasif,
      habitaciones: habitacionesConsultadas,
    });
    if (!rDist.ok) { registrarRechazo(rDist.error); continue; }
    const menores: ClasificacionMenores = { infantes: rDist.totales.infantes, nino: rDist.totales.nino, nino2: rDist.totales.nino2 };

    const combosValidos: { total: number; categoria: string; regimen: string; pax: number; menores: ClasificacionMenores }[] = [];
    for (const combo of res.combos) {
      const errTarifa = verificarTarifasMenoresDisponibles(menores, { nino: combo.precios["nino"] != null, nino2: combo.precios["nino2"] != null });
      if (errTarifa) continue; // este combo (categoría/régimen) no tiene la tarifa de niño que hace falta

      let total = 0; let pax = 0; let ok = true;
      for (const [acom, count] of porAcom) {
        const pvp = combo.precios[acom];
        if (pvp == null) { ok = false; break; }
        const adultos = count * configDe(acom).pax_tarifa;
        total += adultos * pvp; pax += adultos;
      }
      if (!ok) continue;
      if (menores.nino > 0) { total += menores.nino * combo.precios["nino"]!; pax += menores.nino; }
      if (menores.nino2 > 0) { total += menores.nino2 * combo.precios["nino2"]!; pax += menores.nino2; }
      // Infante: si el hotel no configuró tarifa para este combo, es gratis
      // (misma asimetría documentada del resto del motor de reservas).
      if (menores.infantes > 0 && combo.precios["infante"] != null) total += menores.infantes * combo.precios["infante"];
      combosValidos.push({ total, categoria: combo.categoria, regimen: combo.regimen, pax, menores });
    }
    if (combosValidos.length) {
      combosValidos.sort((a, b) => a.total - b.total); // más barato primero (predeterminado)
      const mejor = combosValidos[0];
      resultados.push({
        hotelId: hotel, hotelNombre: res.hotelNombre, destino: res.destinoNombre,
        paqueteId: paquete, categoria: mejor.categoria, regimen: mejor.regimen,
        total: mejor.total, noches: numNoches, fechaIda: input.fechaIda, fechaRegreso: input.fechaRegreso,
        habitaciones: habitacionesOut, menores: mejor.menores, edadesMenores: edades, pax: mejor.pax,
        combos: combosValidos,
      });
    } else {
      registrarRechazo("Ninguna categoría/régimen de este hotel tiene tarifa configurada para esa composición.");
    }
  }
  resultados.sort((a, b) => a.total - b.total);

  // Un fallo técnico real en TODOS los pares evaluados nunca debe verse como
  // "sin resultados" a secas — aborta con el mensaje genérico saneado. Si
  // solo ALGUNOS pares fallaron técnicamente pero otros sí se evaluaron con
  // éxito (con o sin resultado), la búsqueda sigue: esos pares puntuales
  // simplemente no aparecen, igual que "sin tarifa" — mismo criterio que
  // `buscarReceptivos` (ronda 7) adaptado a que acá son MUCHOS pares
  // independientes por búsqueda, no una sola liquidación puntual.
  if (!resultados.length && falloTecnico && evaluados === 0 && !datosSinTarifaParaFecha.length) {
    return { ok: false, error: MENSAJE_BUSQUEDA_HOTELES_NO_DISPONIBLE };
  }

  // Nunca "sin resultados" a secas si sí había hoteles candidatos y todos
  // quedaron descartados por la misma composición: se entrega el motivo más
  // frecuente entre los evaluados, sin exponer cuál hotel lo dio.
  let diagnostico: string | undefined;
  let sugerenciasFecha: SugerenciaFecha[] | undefined;
  if (!resultados.length && evaluados > 0 && rechazos.size) {
    diagnostico = [...rechazos.entries()].sort((a, b) => b[1] - a[1])[0][0];
  } else if (!resultados.length && evaluados === 0 && datosSinTarifaParaFecha.length > 0) {
    // NINGÚN par llegó siquiera a la etapa de composición (edad/capacidad/
    // Adults Only) — el motivo de los 0 resultados es 100% de fechas, nunca
    // de composición, así que sí vale la pena sugerir fechas cercanas con
    // tarifa real para esta MISMA composición (nunca al revés: si algún par
    // sí llegó a composición y fue rechazado ahí, `evaluados > 0` gana
    // arriba y no se sugieren fechas — cambiar de fecha no arreglaría un
    // problema de capacidad/edad/Adults Only).
    sugerenciasFecha = await sugerenciasBusquedaGeneral(admin, datosSinTarifaParaFecha, input, numNoches);
  }
  return { ok: true, resultados, diagnostico, sugerenciasFecha };
}

// ── Mini-motor de búsqueda de RECEPTIVOS (servicios): liquida EN VIVO cada
// tour/servicio publicado para el destino, fechas y pax elegidos — misma idea
// que buscarHoteles, pero resolviendo temporada (si el servicio tiene tarifa
// por fecha) y el rango de grupo/persona según el pax buscado. ──────────────
export type BusquedaServiciosInput = {
  fechaIda: string;
  fechaRegreso: string;
  pax: number;
  destino?: string; // vacío = todos
};
export type { ResultadoServicio, RespuestaPublicaServicioPuntual };

// Mensaje público ÚNICO para cualquier fallo técnico de esta búsqueda
// (ronda 7) — nunca revela configuración interna (antes: "falta
// service-role", que expone que el servidor depende de una service-role key)
// ni texto de Supabase (nombres de tabla/columna/policy). El detalle técnico
// real se registra con `console.error` en cada punto de falla, server-side.
const MENSAJE_BUSQUEDA_RECEPTIVOS_NO_DISPONIBLE = "Búsqueda no disponible en este momento. Intenta nuevamente.";

// `inputRaw` se trata como `unknown` — igual que `buscarHoteles` — esta
// función es alcanzable desde el navegador (Server Action, ver
// app/(dashboard)/dashboard/reservar/actions.ts) con cualquier body HTTP.
// Se valida la FORMA completa (objeto, fechas reales de calendario + rango,
// pax entero acotado, destino con longitud máxima) ANTES de tocar la base de
// datos con service-role — ningún payload manipulado (null, arreglos,
// fechas imposibles, pax decimal/NaN/Infinity/negativo/gigante, destino
// gigante) debe poder lanzar un TypeError ni llegar a consultar Supabase.
//
// FALLA CERRADA en cada consulta (ronda 7): defecto real corregido — la
// consulta inicial a `tarifario_resultado` y las 5 consultas paralelas
// posteriores (paquetes/armado/servicios/grupos/temporadas) descartaban su
// `error` y seguían con `?? []`, así que un fallo técnico real de Supabase
// (RLS, tabla renombrada, columna eliminada) se veía IDÉNTICO a "no hay
// servicios" o a "faltan datos de configuración para ese par" — resultado
// funcional y financieramente incorrecto (omitir servicios en silencio).
// Ahora CADA consulta conserva y revisa su `error`; cualquier fallo aborta
// la búsqueda COMPLETA con el mensaje genérico de arriba — "sin resultados"
// solo se devuelve cuando las consultas fueron exitosas y de verdad no hay
// servicios para esos filtros.
export async function buscarReceptivos(inputRaw: unknown): Promise<{ ok: true; resultados: ResultadoServicio[] } | { ok: false; error: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[buscarReceptivos] etapa=arranque detalle=SUPABASE_SERVICE_ROLE_KEY no configurada");
    return { ok: false, error: MENSAJE_BUSQUEDA_RECEPTIVOS_NO_DISPONIBLE };
  }
  if (typeof inputRaw !== "object" || inputRaw === null || Array.isArray(inputRaw)) {
    return { ok: false, error: "La consulta no tiene una forma válida." };
  }
  const o = inputRaw as Record<string, unknown>;
  // Ronda 3, mismo defecto real y misma corrección que `buscarHoteles`: sin
  // "ida no anterior a hoy" ni tope de noches, un rango de años/décadas
  // llegaba a `calcularResultadoServicio` (recorre las noches una a una) por
  // cada servicio/tour candidato. Comparte el validador — la fórmula de
  // liquidación no se toca.
  const vRango = validarRangoFechasConsulta(o.fechaIda, o.fechaRegreso);
  if (!vRango.ok) return { ok: false, error: vRango.error };
  const vDestino = validarDestinoConsulta(o.destino);
  if (!vDestino.ok) return { ok: false, error: vDestino.error };
  const vPax = validarPaxServicioConsulta(o.pax);
  if (!vPax.ok) return { ok: false, error: vPax.error };

  const input: BusquedaServiciosInput = {
    fechaIda: vRango.fechaIda, fechaRegreso: vRango.fechaRegreso, pax: vPax.pax, destino: vDestino.destino || undefined,
  };

  const numNoches = vRango.noches;
  const pax = input.pax;

  const admin = createAdminClient();
  // Paginado robusto (ronda posterior — incidente "RECEPTIVOS ADZ", causa
  // raíz confirmada del segundo síntoma): un servicio recién publicado podía
  // quedar fuera de una respuesta truncada en silencio por el límite "Max
  // Rows" del proyecto. Mismo helper que buscarHoteles (arriba) — ver
  // lib/tarifario/paginacion.ts (`ejecutarConsultaPaginada`).
  const { data: filas, error: filasErr } = await ejecutarConsultaPaginada<{
    paquete_id: number; servicio_id: number; servicio_nombre: string | null; destino_nombre: string | null; descripcion: string | null;
  }>((from, hasta) => {
    let q = admin
      .from("tarifario_resultado")
      .select("paquete_id, servicio_id, servicio_nombre, destino_nombre, descripcion")
      .eq("modulo", "servicios")
      .eq("paquete_activo", true)
      .not("servicio_id", "is", null);
    if (input.destino?.trim()) q = q.eq("destino_nombre", input.destino.trim());
    return q.order("id").range(from, hasta);
  });
  if (filasErr) {
    console.error(`[buscarReceptivos] etapa=tarifario_resultado detalle=${filasErr instanceof Error ? filasErr.message : JSON.stringify(filasErr)}`);
    return { ok: false, error: MENSAJE_BUSQUEDA_RECEPTIVOS_NO_DISPONIBLE };
  }
  const pares = new Map<string, DatosServicioPar>();
  for (const f of filas ?? []) {
    if (f.paquete_id == null || f.servicio_id == null) continue;
    pares.set(`${f.paquete_id}-${f.servicio_id}`, {
      paqueteId: f.paquete_id, servicioId: f.servicio_id,
      nombre: f.servicio_nombre ?? "Servicio", destino: f.destino_nombre, descripcion: f.descripcion,
    });
  }
  // "Sin resultados" solo se devuelve acá porque la consulta de arriba SÍ
  // tuvo éxito (ya se abortó antes si `filasErr` venía presente) — un
  // arreglo vacío en este punto significa de verdad "no hay servicios
  // publicados para ese destino", nunca "la consulta falló".
  if (!pares.size) return { ok: true, resultados: [] };

  const paqueteIds = [...new Set([...pares.values()].map((p) => p.paqueteId))];
  const servicioIds = [...new Set([...pares.values()].map((p) => p.servicioId))];

  const [
    { data: paquetes, error: paquetesErr },
    { data: armado, error: armadoErr },
    { data: servicios, error: serviciosErr },
    { data: grupos, error: gruposErr },
    { data: temporadas, error: temporadasErr },
  ] = await Promise.all([
    admin.from("armado_paquetes").select("id, pct_mk").in("id", paqueteIds),
    admin.from("armado_servicios").select("paquete_id, servicio_id, modo").in("paquete_id", paqueteIds).in("servicio_id", servicioIds),
    admin.from("servicios_adicionales").select("id, precio_persona, recargo_individual, liquidacion, moneda").in("id", servicioIds),
    admin.from("servicio_tarifa_pax").select("servicio_id, pax_desde, pax_hasta, precio, temporada").in("servicio_id", servicioIds),
    admin.from("servicio_temporadas").select("servicio_id, nombre, fecha_inicio, fecha_fin, compra_inicio, compra_fin, prioridad, precio_persona, recargo_individual").in("servicio_id", servicioIds),
  ]);

  // Cualquiera de las 5 consultas paralelas que falle aborta la búsqueda
  // COMPLETA — nunca se sigue con `?? []` sobre una consulta que SÍ falló
  // (eso escondería el fallo como "sin tarifa"/"sin armado" para todos los
  // pares, un resultado funcional y financieramente incorrecto).
  if (paquetesErr || armadoErr || serviciosErr || gruposErr || temporadasErr) {
    const detalle = [
      paquetesErr && `armado_paquetes: ${paquetesErr.message}`,
      armadoErr && `armado_servicios: ${armadoErr.message}`,
      serviciosErr && `servicios_adicionales: ${serviciosErr.message}`,
      gruposErr && `servicio_tarifa_pax: ${gruposErr.message}`,
      temporadasErr && `servicio_temporadas: ${temporadasErr.message}`,
    ].filter(Boolean).join(" | ");
    console.error(`[buscarReceptivos] etapa=consultas_paralelas detalle=${detalle}`);
    return { ok: false, error: MENSAJE_BUSQUEDA_RECEPTIVOS_NO_DISPONIBLE };
  }

  const ctx = construirContextoServicios({
    paquetes: paquetes ?? [], armado: armado ?? [], servicios: servicios ?? [], grupos: grupos ?? [], temporadas: temporadas ?? [],
  });

  const fechaIdaDate = new Date(`${input.fechaIda}T00:00:00`);
  const resultados: ResultadoServicio[] = [];
  for (const par of pares.values()) {
    const r = calcularResultadoServicio(par, ctx, fechaIdaDate, numNoches, pax);
    if (r) resultados.push(r);
  }
  resultados.sort((a, b) => a.total - b.total);
  return { ok: true, resultados };
}

// Re-liquida EN VIVO un único servicio/tour puntual — usado por el checkout
// público para volver a calcular el precio real de un tour del carrito,
// nunca confiando en nombre/precio/moneda/pax que mande el navegador (ver
// FRONTERA en app/tarifario/checkout/actions.ts). Confirma primero que el par
// (paqueteId, servicioId) esté REALMENTE publicado y activo en
// `tarifario_resultado` — el nombre/destino/descripción canónicos salen de
// ahí, nunca del cliente.
//
// FALLA CERRADO (ronda 4): esta función solo consulta — TODA la decisión de
// qué hacer con lo consultado (incl. no usar defaults de modo/markup, exigir
// que el armado pertenezca exactamente al par, y distinguir un error técnico
// de una configuración incompleta de un servicio genuinamente no disponible)
// vive en `resolverLiquidacionServicioPuntual` (lib/reservar/liquidacionServicio.ts,
// módulo puro, testeable con node --test sin tocar Supabase). El llamador
// (`crearCotizacionCarrito` en checkout/actions.ts) debe abortar la
// cotización COMPLETA ante `tipo: "error_consulta"` o `"configuracion_invalida"`
// — solo `"no_disponible"` es un motivo legítimo para excluir el tour del
// carrito y seguir con el resto.
//
// FRONTERA PÚBLICA (ronda 6): esta función devuelve `RespuestaPublicaServicioPuntual`
// (`respuestaPublicaServicioPuntual`, lib/reservar/liquidacionServicio.ts) — NUNCA
// el `ResultadoServicioPuntual` interno con `detalleInterno` (mensajes reales
// de Supabase, nombres de tabla/columna, valores de configuración). El
// detalle técnico se registra ACÁ, server-side, con `console.error` — este
// es el único punto de esta función que de verdad toca Supabase/consola, así
// que es donde debe vivir el logging (el resolutor puro no hace I/O).
export async function liquidarServicioPuntual(input: {
  paqueteId: number; servicioId: number; fechaIda: string; fechaRegreso: string; pax: number;
}): Promise<RespuestaPublicaServicioPuntual> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const r = fallaErrorConsulta("service_role_faltante", "SUPABASE_SERVICE_ROLE_KEY no configurada");
    if (!r.ok) {
      console.error(formatearLogLiquidacionServicioPuntual({
        servicioId: input.servicioId, paqueteId: input.paqueteId, tipo: r.tipo, codigo: r.codigo, detalle: r.detalleInterno,
      }));
    }
    return respuestaPublicaServicioPuntual(r);
  }
  const numNoches = Math.max(1, noches(input.fechaIda, input.fechaRegreso));
  const pax = Math.max(1, Math.trunc(input.pax) || 1);

  const admin = createAdminClient();
  const { data: fila, error: filaErr } = await admin
    .from("tarifario_resultado")
    .select("servicio_nombre, destino_nombre, descripcion")
    .eq("modulo", "servicios")
    .eq("paquete_activo", true)
    .eq("paquete_id", input.paqueteId)
    .eq("servicio_id", input.servicioId)
    .limit(1)
    .maybeSingle();

  const par: DatosServicioPar = {
    servicioId: input.servicioId, paqueteId: input.paqueteId,
    nombre: fila?.servicio_nombre ?? "Servicio", destino: fila?.destino_nombre ?? null, descripcion: fila?.descripcion ?? null,
  };

  // Se consultan las 5 tablas restantes en paralelo sin importar si la fila
  // del tarifario se confirmó — `resolverLiquidacionServicioPuntual` revisa
  // `filaTarifarioError`/`filaTarifarioEncontrada` ANTES que cualquier otro
  // dato, así que un tarifario ausente/erróneo aborta igual sin depender de
  // que estas consultas hayan encontrado algo.
  const [
    { data: paquete, error: paqueteErr },
    { data: armado, error: armadoErr },
    { data: servicio, error: servicioErr },
    { data: grupos, error: gruposErr },
    { data: temporadas, error: temporadasErr },
  ] = await Promise.all([
    admin.from("armado_paquetes").select("id, pct_mk").eq("id", input.paqueteId).maybeSingle(),
    admin.from("armado_servicios").select("paquete_id, servicio_id, modo").eq("paquete_id", input.paqueteId).eq("servicio_id", input.servicioId).maybeSingle(),
    admin.from("servicios_adicionales").select("id, precio_persona, recargo_individual, liquidacion, moneda").eq("id", input.servicioId).maybeSingle(),
    admin.from("servicio_tarifa_pax").select("servicio_id, pax_desde, pax_hasta, precio, temporada").eq("servicio_id", input.servicioId),
    admin.from("servicio_temporadas").select("servicio_id, nombre, fecha_inicio, fecha_fin, compra_inicio, compra_fin, prioridad, precio_persona, recargo_individual").eq("servicio_id", input.servicioId),
  ]);

  const fechaIdaDate = new Date(`${input.fechaIda}T00:00:00`);
  const resultado = resolverLiquidacionServicioPuntual({
    par, fechaIdaDate, numNoches, pax,
    filaTarifarioEncontrada: !!fila,
    filaTarifarioError: filaErr?.message ?? null,
    paquete: paquete ?? null, paqueteError: paqueteErr?.message ?? null,
    armado: armado ?? null, armadoError: armadoErr?.message ?? null,
    servicio: servicio ?? null, servicioError: servicioErr?.message ?? null,
    grupos: grupos ?? [], gruposError: gruposErr?.message ?? null,
    temporadas: temporadas ?? [], temporadasError: temporadasErr?.message ?? null,
  });
  // El detalle técnico real (mensaje de Supabase, tabla/columna/valor de
  // configuración involucrado) se registra SOLO acá, server-side — nunca
  // sale de esta función (ver `respuestaPublicaServicioPuntual` abajo).
  if (!resultado.ok) {
    console.error(formatearLogLiquidacionServicioPuntual({
      servicioId: input.servicioId, paqueteId: input.paqueteId,
      tipo: resultado.tipo, codigo: resultado.codigo, detalle: resultado.detalleInterno,
    }));
  }
  return respuestaPublicaServicioPuntual(resultado);
}
