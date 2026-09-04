// ─────────────────────────────────────────────────────────────────────────
// Congelado de condiciones de pago — Rama B (catálogo → contrato, fuera de
// la cotización manual).
//
// La migración 164 dejó el motor puro (`condicionPago.ts`), el snapshot
// (`snapshotCondiciones.ts`) y la tabla PERMANENTE `contrato_condiciones`,
// pero el único camino que la escribía era `convertir_cotizacion_a_contrato`
// (exclusivo de la cotización MANUAL). Los contratos que nacen DIRECTO de
// catálogo/tarifario/reservar/programas (`reservarDesdeTarifarioInterno`,
// `reservarProgramaInterno`, `convertirCotizacionCarrito`) no pasan por
// ninguna cotización con etapa de "primer pago" — crean la `venta`/
// `contrato_hoteles` directo. Este módulo es el puente: arma el
// `ComponenteSnapshot[]` con datos REALES de catálogo (nunca defaults
// inventados) y llama al RPC `congelar_condiciones_contrato` (migración 165).
//
// NINGUNA lógica de precios vive aquí — solo TRADUCE filas de catálogo ya
// persistidas (hotel_temporadas / armado_paquetes / programas) usando los
// módulos puros existentes (`condicionDesdeCatalogo.ts`,
// `snapshotCondiciones.ts`, `condicionPago.ts`, ninguno modificado).
//
// ── Por qué el HOTEL toma TODO el valor del contrato ──
// El motor de precios (`lib/calc/paquetes.ts`) ya funde vuelo negociado +
// hotel negociado + servicios en un solo PVP por acomodación
// (`pvpPorAcom`/`tarifario_resultado`) ANTES de que `reservar` los use — no
// hay forma de recuperar "cuánto del precio es hotel vs. cuánto es vuelo"
// sin tocar ese motor (fuera de alcance por decisión del dueño). Por eso:
//   · si el contrato tiene hotel (`!esServicios`): el componente "hotel"
//     lleva el precio_venta COMPLETO, condicionado por las vigencias REALES
//     del hotel (`hotel_temporadas`) — es donde el dueño configura la
//     condición restrictiva de un bloqueo/porción negociado en la práctica.
//   · si el paquete es tipo "servicios" (nunca hay hotel — `esServicios`):
//     el componente "paquete" lleva el precio_venta completo, condicionado
//     por la condición propia de `armado_paquetes`.
// Los dos casos son mutuamente excluyentes por diseño de `computarReserva`
// (un `esServicios=true` nunca genera `contrato_hoteles`), así que nunca se
// duplica ni se pierde dinero entre ambos componentes. La condición propia
// del paquete (`armado_paquetes.condicion_pago_tipo`) queda SIN EFECTO
// cuando el paquete sí tiene hotel — decisión documentada, pendiente de
// confirmar con el dueño si en el futuro se quiere combinar ambas fuentes
// (ver cabecera del PR).
//
// ── TRM en el momento de reservar ──
// A diferencia de la cotización manual (que congela `trm_autoritativa` con
// el primer pago previo), `reservarDesdeTarifarioInterno`/
// `reservarProgramaInterno` NO capturan una TRM del día al crear el
// contrato (limitación estructural preexistente, no introducida aquí). Para
// una reserva en moneda distinta de COP se usa `trm_referencia`
// (`parametros_tributarios`, ya usada como tasa informativa en
// rentabilidad/estados financieros) como aproximación; si no está
// configurada, cae a 1 (mismo respaldo que `construirSnapshot`). Esto NO
// afecta el monto exigido en la moneda de la reserva (autoritativo); solo
// el equivalente en COP que se guarda junto al snapshot, igual que el resto
// de conversiones USD→COP pendientes de esta app (ver CLAUDE.md).
//
// ── Best-effort, nunca bloquea la reserva ──
// El congelado corre DESPUÉS de que la venta/contrato ya existe. Si falla
// (catálogo inconsistente, RPC rechazado, etc.) se registra en el log del
// servidor pero NO se revierte ni se le informa como error al asesor: el
// contrato ya es válido sin condiciones congeladas (mismo estado que todo
// contrato creado antes de este PR) y se puede reintentar/backfillear
// después. Fallar la reserva completa por un problema en el snapshot sería
// una regresión mucho más grave que no tener condiciones congeladas.
// ─────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
// Imports RELATIVOS a propósito (nunca "@/…"): estos SÍ son runtime (no solo
// tipos), y `pruebas/**/*.test.ts` corre con `node --test
// --experimental-strip-types` — node no resuelve el alias "@/" (solo lo
// resuelve el bundler de Next). Mismo criterio que `lib/tarifario/datos.ts`.
import {
  construirSnapshot,
  condicionHotelEstadia,
  barridoRestriccionEstadia,
  type ComponenteSnapshot,
  type VigenciaHotelCondicion,
} from "../cotizacion/snapshotCondiciones.ts";
import {
  condicionDeVigenciaHotel,
  componenteDeArmadoPaquete,
  componenteDePrograma,
  type HotelTemporadaCatalogo,
  type CondicionProductoCatalogo,
} from "../cotizacion/condicionDesdeCatalogo.ts";

type Admin = SupabaseClient<Database>;

/**
 * Mensajes de error "seguros": nunca fugan detalles internos de PostgreSQL.
 * Solo para el LOG del servidor (esta función nunca se muestra al navegador
 * directamente — ver "best-effort" arriba), pero se sanea igual por si algún
 * llamador decide en el futuro exponerlo.
 */
function mensajeSeguro(msg: string): string {
  const m = String(msg ?? "").trim();
  if (!m) return "No se pudo congelar las condiciones del contrato.";
  if (/(duplicate key|violates (foreign key|not-null|check) constraint|constraint "|relation "|pg_|sqlstate|serialization failure|new row violates)/i.test(m)) {
    return "No se pudo congelar las condiciones del contrato por un conflicto de datos.";
  }
  return m;
}

/**
 * Lee TODAS las vigencias reales de un hotel (con su condición de pago 164).
 *
 * Devuelve `null` — nunca `[]` — cuando la consulta a Supabase FALLÓ (error
 * técnico real: red, RLS, columna inexistente, etc.). Es una distinción
 * deliberada (revisión estricta de PR #282, finding F1): `[]` solo debe
 * significar "el hotel legítimamente no tiene vigencias configuradas" (caso
 * de negocio válido → condición neutra, documentado en `snapshotCondiciones.ts`),
 * nunca "no sabemos qué condición tiene este hotel". Antes de esta
 * corrección, un error de consulta se trataba igual que "sin vigencias" y
 * terminaba congelando una fila PERMANENTE e INMUTABLE con
 * `restriccion_comercial: 'normal'` cuando la condición real podía ser
 * `pago_total`/`no_reembolsable_no_endosable` — un dato incorrecto y para
 * siempre, en vez de simplemente no congelar nada (que es seguro: el
 * contrato queda como cualquier contrato histórico sin snapshot).
 */
export async function vigenciasCondicionDeHotel(
  admin: Admin,
  hotelId: number,
): Promise<VigenciaHotelCondicion[] | null> {
  const { data, error } = await admin
    .from("hotel_temporadas")
    .select("id, nombre, fecha_inicio, fecha_fin, condicion_pago_tipo, condicion_pago_pct_inicial, condicion_pago_dias_saldo")
    .eq("hotel_id", hotelId);
  if (error) return null;
  if (!data) return [];
  // Una vigencia sin rango de fechas no puede cubrir ninguna noche — se
  // descarta antes de traducir (HotelTemporadaCatalogo exige fechas no nulas).
  const conFechas = data.filter(
    (r): r is typeof r & { fecha_inicio: string; fecha_fin: string } =>
      r.fecha_inicio != null && r.fecha_fin != null,
  );
  return conFechas.map((r) => condicionDeVigenciaHotel(r as HotelTemporadaCatalogo));
}

/**
 * Arma el `ComponenteSnapshot` tipo "hotel" de UNA estadía real, resolviendo
 * su condición contra TODAS las vigencias reales del hotel (nunca contra el
 * ganador del motor de precios — ver cabecera del módulo).
 *
 * Devuelve `null` si la consulta de vigencias falló (ver
 * `vigenciasCondicionDeHotel`) — el llamador debe tratarlo igual que
 * `componentePaqueteReal`/`componenteProgramaReal` devolviendo `null`: no
 * agregar el componente al snapshot (mejor no congelar nada que congelar un
 * dato incorrecto y permanente).
 */
export async function componenteHotelReal(
  admin: Admin,
  p: {
    hotelId: number;
    id: string;
    valor: number;
    referencia?: string | null;
    fechaIda: string;
    fechaRegreso: string;
    fechaPago: string;
  },
): Promise<ComponenteSnapshot | null> {
  const vigencias = await vigenciasCondicionDeHotel(admin, p.hotelId);
  if (vigencias === null) return null;
  const estadia = { fechaIda: p.fechaIda, fechaRegreso: p.fechaRegreso };
  const exigencia = condicionHotelEstadia(estadia, vigencias, { fechaPago: p.fechaPago });
  const barrido = barridoRestriccionEstadia(estadia, vigencias);
  return {
    id: p.id,
    tipo: "hotel",
    valor: p.valor,
    condicion: { tipo: exigencia.tipo, pctInicial: exigencia.pctInicial, diasSaldo: exigencia.diasSaldo },
    fechaViaje: p.fechaIda,
    referencia: p.referencia ?? null,
    restriccionComercial: barrido.tocaRestriccion ? "no_reembolsable_no_endosable" : "normal",
  };
}

/** Arma el `ComponenteSnapshot` tipo "paquete" a partir de la fila REAL de `armado_paquetes`. Null si el paquete no existe. */
export async function componentePaqueteReal(
  admin: Admin,
  p: { paqueteId: number; id: string; valor: number; referencia?: string | null; fechaViaje?: string | null },
): Promise<ComponenteSnapshot | null> {
  const { data, error } = await admin
    .from("armado_paquetes")
    .select("condicion_pago_tipo, condicion_pago_pct_inicial, condicion_pago_dias_saldo, restriccion_comercial")
    .eq("id", p.paqueteId)
    .maybeSingle();
  if (error || !data) return null;
  return componenteDeArmadoPaquete(data as CondicionProductoCatalogo, {
    id: p.id,
    valor: p.valor,
    referencia: p.referencia ?? null,
    fechaViaje: p.fechaViaje ?? null,
  });
}

/** Arma el `ComponenteSnapshot` tipo "programa" a partir de la fila REAL de `programas`. Null si el programa no existe. */
export async function componenteProgramaReal(
  admin: Admin,
  p: { programaId: number; id: string; valor: number; referencia?: string | null; fechaViaje?: string | null },
): Promise<ComponenteSnapshot | null> {
  const { data, error } = await admin
    .from("programas")
    .select("condicion_pago_tipo, condicion_pago_pct_inicial, condicion_pago_dias_saldo, restriccion_comercial")
    .eq("id", p.programaId)
    .maybeSingle();
  if (error || !data) return null;
  return componenteDePrograma(data as CondicionProductoCatalogo, {
    id: p.id,
    valor: p.valor,
    referencia: p.referencia ?? null,
    fechaViaje: p.fechaViaje ?? null,
  });
}

/** TRM de referencia informativa (parametros_tributarios) para contratos en moneda distinta de COP sin TRM del día capturada. 1 si no está configurada. */
export async function trmReferenciaAproximada(admin: Admin, moneda: string): Promise<number> {
  if (moneda === "COP") return 1;
  const { data } = await admin
    .from("parametros_tributarios")
    .select("valor")
    .eq("parametro", "trm_referencia")
    .maybeSingle();
  const v = Number(data?.valor);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export interface CongelarCondicionesParams {
  numeroContrato: string;
  componentes: ComponenteSnapshot[];
  moneda: string;
  trm: number;
  /** Precio total del contrato en su moneda — solo para el % informativo. */
  precioTotalMoneda: number;
  /** Fecha de "hoy" a efectos del bump de anticipo_saldo. Default: hoy real. */
  fechaPago?: string;
  usuarioId: string;
}

/**
 * Construye el snapshot (motor puro, sin tocar) y llama al RPC de la 165.
 * No-op silencioso si `componentes` viene vacío (nunca envía un arreglo
 * vacío al RPC, que lo rechazaría) — un contrato sin componentes
 * condicionables reales (ej. hotelId/paqueteId ausentes) simplemente no
 * congela nada, igual que si esta función no se hubiera llamado.
 */
export async function congelarCondicionesContrato(
  admin: Admin,
  params: CongelarCondicionesParams,
): Promise<{ ok: true; noop?: boolean } | { ok: false; error: string }> {
  if (!params.componentes.length) return { ok: true, noop: true };

  const snapshot = construirSnapshot(params.componentes, {
    fechaPago: params.fechaPago,
    precioTotalMoneda: params.precioTotalMoneda,
    trm: params.trm,
  });

  const filas = snapshot.filas.map((f) => ({
    orden: f.orden,
    tipo_componente: f.tipo_componente,
    referencia_externa: f.referencia_externa ?? null,
    valor_componente: f.valor_componente,
    condicion_pago_tipo: f.condicion_pago_tipo,
    condicion_pago_pct_aplicable: f.condicion_pago_pct_aplicable ?? null,
    condicion_pago_dias_saldo: f.condicion_pago_dias_saldo ?? null,
    condicion_pago_fecha_limite: f.condicion_pago_fecha_limite ?? null,
    monto_exigido: f.monto_exigido,
    restriccion_comercial: f.restriccion_comercial,
  }));

  const rpc = await admin.rpc("congelar_condiciones_contrato", {
    p_numero_contrato: params.numeroContrato,
    p_snapshot: filas as unknown as Json,
    p_moneda: params.moneda,
    p_trm: params.trm,
    p_usuario_id: params.usuarioId,
  });
  if (rpc.error) return { ok: false, error: mensajeSeguro(rpc.error.message) };
  return { ok: true };
}

/**
 * Envoltorio best-effort para los 3 puntos de creación de contrato: nunca
 * lanza, nunca bloquea la reserva. Registra en el log del servidor si algo
 * falla (ver cabecera del módulo).
 */
export async function congelarCondicionesContratoBestEffort(
  admin: Admin,
  params: CongelarCondicionesParams,
): Promise<void> {
  try {
    const r = await congelarCondicionesContrato(admin, params);
    if (!r.ok) {
      console.error(`[congelarCondicionesContrato] contrato ${params.numeroContrato}: ${r.error}`);
    }
  } catch (e) {
    console.error(`[congelarCondicionesContrato] contrato ${params.numeroContrato}: excepción inesperada`, e);
  }
}
