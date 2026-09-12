// ─────────────────────────────────────────────────────────────────────────
// Fase 3F-3 Bernalo — servicio INTERNO autoritativo de cálculo de una
// reserva Bernalo (`hoteles.modelo_tarifario = "unidad"`).
//
// Extraído tal cual de la Server Action pública de Fase 3E
// (`app/tarifario/cotizacionBernaloActions.ts`, `cotizarAlojamientoBernaloPublico`)
// — MISMA autorización, MISMAS consultas, MISMOS filtros de vigencia/moneda/
// pertenencia/clasificación (regla 1/4 del encargo: "no mantengas dos
// implementaciones monetarias", "todas las consultas y filtros... permanecen
// iguales"). La única diferencia es que este archivo devuelve el cálculo
// INTERNO COMPLETO (`ComputoReservaBernalo`) en vez de recortarlo a las 4
// claves públicas — esa sanitización ahora vive en la Server Action, que
// llama a este servicio y transforma su resultado.
//
// Entrada: SOLO decisiones ya validadas en FORMA (no en pertenencia — eso lo
// resuelve este archivo contra la base). `habitaciones` llega como
// `HabitacionOcupacionValidada[]` (la salida de `validarHabitacionesOcupacion`,
// Fase 3D) y `salida` como `SalidaSeleccionadaBernaloEntrada` (la salida de
// `validarSalidaSeleccionadaBernalo`, Fase 3F-1) — exactamente la forma de
// `DecisionesOcupacionBernalo` (mismo módulo neutral de 3F-1, reusado tal
// cual, nunca copiado) — así que un `SolicitudItemBernaloValidado` completo
// (Fase 3F-1) ya trae todo lo que esta función necesita, sin transformación.
// Quien llama a este servicio (la Server Action pública, y más adelante
// 3F-4) es responsable de haber tratado el body de red como `unknown` antes
// de llegar aquí — esta función YA NO revalida forma de habitaciones/salida,
// confía en el tipo (regla del encargo: "Solo decisiones validadas").
//
// Qué SIGUE sin hacer esta fase (regla 9/10/11 del encargo):
//   · No inserta contrato_items, snapshots (`contrato_alojamiento_bernalo`,
//     migración 176) ni cuentas por pagar — solo calcula y devuelve.
//   · No arma un `ReservaInput` de la forma persona (`habitaciones: {}` o
//     similar) — `ComputoReservaBernalo` es su propio tipo, nunca se disfraza
//     de `ComputoReserva`.
//   · No toca `lib/reservar/computo.ts` — su guardia
//     (`modelo_tarifario === 'unidad'` bloquea) sigue exactamente igual; el
//     dispatch hacia este servicio es trabajo de 3F-4.
// ─────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { noches as calcularNoches, hoyISO } from "@/lib/calc/paquetes";
import {
  orquestarCotizacionAlojamientoBernalo,
  type DatosOrquestacionBernalo,
} from "@/lib/calc/orquestarCotizacionAlojamientoBernalo";
import {
  calcularPvpAlojamientoBernalo,
  resolverMonedaComponentesBernalo,
  type EntradaPvpAlojamientoBernalo,
  type ServicioIncluidoPersonaBernalo,
  type ServicioIncluidoResueltoBernalo,
  type VueloBernalo,
} from "@/lib/calc/pvpAlojamientoBernalo";
import type { ResultadoValido, SnapshotAlojamiento } from "@/lib/calc/unidadAlojamiento";
import { type HabitacionOcupacionValidada } from "@/lib/reservar/ocupacionPorHabitacion";
import { normalizarCategoriaServicio, type ServicioGrupoIncluido } from "@/lib/reservar/serviciosPaquete";
import { empaquetadoVigente, hoyBogota } from "@/lib/reservar/origen";
import type { DecisionesOcupacionBernalo, SalidaSeleccionadaBernaloEntrada } from "@/lib/reservar/solicitudAlojamientoBernalo";

// ── Entrada: reusa TAL CUAL el tipo de decisiones de Fase 3F-1 ─────────────
// (paqueteId, hotelId, categoria, alimentacion, salida, habitaciones YA
// validadas) — nunca se copia esta forma, es un alias directo.
export type EntradaComputoReservaBernalo = DecisionesOcupacionBernalo;

export type CodigoComputoReservaBernalo =
  | "ocupacion_invalida"
  | "paquete_no_disponible"
  | "hotel_no_vinculado"
  | "clasificacion_no_vinculada"
  | "configuracion_incompleta"
  | "salida_no_vinculada"
  | "salidas_no_disponibles"
  | "fechas_fuera_de_ventana"
  | "moneda_no_determinable"
  | "no_cotizable"
  | "error_interno";

export type ComputoReservaBernaloBloqueado = {
  ok: false;
  codigo: CodigoComputoReservaBernalo;
  /** Mensaje INTERNO (puede nombrar tarifas/servicios) — nunca se reenvía tal cual a un cliente público; la Server Action lo traduce vía MENSAJES_PUBLICOS. */
  mensaje: string;
};

/** Salida aérea YA resuelta contra el paquete real — nunca las fechas que mandó el navegador para bloqueo/empaquetado. */
export type SalidaResueltaBernalo =
  | { tipo: "bloqueo"; id: number; fechaIda: string; fechaRegreso: string }
  | { tipo: "empaquetado"; id: number; fechaIda: string; fechaRegreso: string }
  | { tipo: "sin_vuelo"; fechaIda: string; fechaRegreso: string };

export type ProveedorHotelBernalo = { nombre: string | null; aplicaRetencion: boolean; pctRetencion: number } | null;

/** Una habitación física con su ocupación de entrada, el resultado del motor y el snapshot completo (Fase 3A) — nunca aplanada ni resumida. */
export type HabitacionComputoBernalo = {
  habitacionId: string;
  ocupacion: HabitacionOcupacionValidada;
  resultado: ResultadoValido;
  snapshot: SnapshotAlojamiento;
};

/** Servicio incluido YA resuelto, con la moneda ÚNICA ya validada del contrato — listo para que 3F-4 genere su CxP sin volver a tocar el catálogo. */
export type ServicioIncluidoComputoBernalo = ServicioIncluidoResueltoBernalo & { moneda: string };

export type ComputoReservaBernaloOk = {
  ok: true;
  modeloTarifario: "unidad";
  precioVenta: number;
  moneda: string;
  paxTotal: number;
  /** Adultos + menores CON silla (excluye infantes) — el vuelo se costea/aporta SOLO sobre este número (regla 7). */
  paxConSilla: number;
  /** Σ literal de `resultado.totalNeto` por habitación (regla 5) — nunca marcado, es el costo real a pagar al hotel. */
  costoHotelTotal: number;
  /** costoTiqueteSilla × paxConSilla (regla 7) — `0` si el paquete no lleva vuelo. Nunca incluye TA ni markup: eso es `aportePvpVuelo`. */
  costoVueloTotal: number;
  /** Costo NETO agregado de todos los servicios incluidos (persona + grupo) — regla 6, identidad separada del costo de hotel. */
  costoServiciosTotal: number;
  aportePvpHotel: number;
  aportePvpServicios: number;
  aportePvpVuelo: number;
  hotelId: number;
  hotelNombre: string;
  /** Destino AUTORITATIVO del paquete (`armado_paquetes.destino_id -> destinos.nombre`) — `null` solo si el paquete no tiene destino configurado. Nunca el texto que haya podido mandar el navegador. */
  hotelDestino: string | null;
  proveedorHotel: ProveedorHotelBernalo;
  salida: SalidaResueltaBernalo;
  /** Una entrada POR HABITACIÓN FÍSICA — nunca agrupada ni resumida (regla explícita del encargo). */
  habitaciones: HabitacionComputoBernalo[];
  /** Servicios incluidos (persona + grupo) YA resueltos con identidad, proveedor y costo neto reales. */
  serviciosIncluidos: ServicioIncluidoComputoBernalo[];
};

export type ResultadoComputoReservaBernalo = ComputoReservaBernaloOk | ComputoReservaBernaloBloqueado;

type SalidaValidaBernalo = {
  tipo: "bloqueo" | "empaquetado";
  id: number;
  fechaIda: string;
  fechaRegreso: string;
  costoTiqueteSilla: number;
  aplicaMk: boolean;
  ta: number;
};

/**
 * Calcula una reserva Bernalo COMPLETA: valida pertenencia al paquete +
 * salida aérea + moneda + ventana de fechas ANTES de tocar
 * `hotel_tarifas_unidad` (service role, único cliente que puede leerla — su
 * RLS sigue cerrada, migración 173/sin cambios), delega temporada+tarifa+
 * cotización al orquestador puro de Fase 3C, compone costos/aportes con la
 * fórmula de Fase 3E/3F-3, y devuelve el cálculo INTERNO completo. NUNCA
 * escribe nada — ni contrato_items, ni `contrato_alojamiento_bernalo`
 * (migración 176), ni CxP, ni `ventas` (regla 9 del encargo).
 */
export async function computarReservaBernalo(
  input: EntradaComputoReservaBernalo
): Promise<ResultadoComputoReservaBernalo> {
  const admin = createAdminClient();

  // 1) Paquete visible/publicable — MISMO criterio que ya usa la lectura del
  // tarifario público (`tarifario_resultado.paquete_activo = true`).
  const { data: pq, error: ePq } = await admin
    .from("armado_paquetes")
    .select("id, activo, pct_mk, moneda, fecha_viaje_inicio, fecha_viaje_fin, destinos(nombre)")
    .eq("id", input.paqueteId)
    .maybeSingle();
  if (ePq) return { ok: false, codigo: "error_interno", mensaje: "No se pudo validar el paquete." };
  if (!pq || !pq.activo) {
    return { ok: false, codigo: "paquete_no_disponible", mensaje: "Este paquete ya no está disponible." };
  }
  // Destino AUTORITATIVO del paquete (mismo criterio que `meta.destino_nombre`
  // en el flujo persona, computo.ts, y que `destinoPorPaquete` en
  // `lib/tarifario/datosBernalo.ts`) — nunca el texto que haya podido mandar
  // el navegador (Fase 3F-4A, cierre #2).
  const destinoNombre = (pq.destinos as unknown as { nombre: string } | null)?.nombre ?? null;

  // 2) Hotel realmente vinculado al paquete, modelo tarifario Bernalo, y
  // proveedor real (para la futura CxP, 3F-4) — nunca se asume por el
  // `hotelId` recibido.
  const { data: ah, error: eAh } = await admin
    .from("armado_hoteles")
    .select("hotel_id, categorias, regimenes, hoteles(moneda, modelo_tarifario, nombre, proveedores(nombre, aplica_retencion, pct_retencion))")
    .eq("paquete_id", input.paqueteId)
    .eq("hotel_id", input.hotelId)
    .maybeSingle();
  if (eAh) return { ok: false, codigo: "error_interno", mensaje: "No se pudo validar el hotel del paquete." };
  if (!ah) {
    return { ok: false, codigo: "hotel_no_vinculado", mensaje: "Este hotel no pertenece al paquete indicado." };
  }
  const hotelMeta = ah.hoteles as unknown as {
    moneda?: string | null; modelo_tarifario?: string | null; nombre?: string | null;
    proveedores?: { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null;
  } | null;
  const modeloTarifario = hotelMeta?.modelo_tarifario ?? null;
  if (modeloTarifario !== "unidad") {
    return { ok: false, codigo: "hotel_no_vinculado", mensaje: "Este hotel no está disponible para cotización en este momento." };
  }
  const hotelNombre = hotelMeta?.nombre ?? "";
  const proveedorHotel: ProveedorHotelBernalo = hotelMeta?.proveedores
    ? {
        nombre: hotelMeta.proveedores.nombre,
        aplicaRetencion: !!hotelMeta.proveedores.aplica_retencion,
        pctRetencion: Number(hotelMeta.proveedores.pct_retencion) || 0,
      }
    : null;

  // 3) Categoría y alimentación: B1 — SOLO un valor realmente presente en
  // `armado_hoteles.categorias`/`regimenes`. Un arreglo VACÍO significa
  // "este hotel no tiene configuración completa para cotizar" — nunca
  // "cualquier valor sirve".
  const categorias = (ah.categorias as string[] | null) ?? [];
  const regimenes = (ah.regimenes as string[] | null) ?? [];
  if (!categorias.length || !regimenes.length) {
    return {
      ok: false,
      codigo: "configuracion_incompleta",
      mensaje: "Este hotel todavía no tiene categorías/alimentación configuradas para cotizar en línea.",
    };
  }
  if (!categorias.includes(input.categoria)) {
    return { ok: false, codigo: "clasificacion_no_vinculada", mensaje: "La categoría seleccionada no está disponible para este hotel." };
  }
  if (!regimenes.includes(input.alimentacion)) {
    return { ok: false, codigo: "clasificacion_no_vinculada", mensaje: "La alimentación seleccionada no está disponible para este hotel." };
  }

  // 4) Salida aérea + servicios incluidos — en paralelo.
  const [
    { data: serviciosSel, error: eServ },
    { data: vuelosSel, error: eVuelo },
    { data: empaquetadosSel, error: eEmp },
  ] = await Promise.all([
    admin
      .from("armado_servicios")
      .select("servicio_id, modo, incluido, servicios_adicionales(nombre, categoria, precio_persona, liquidacion, moneda, proveedor_id, proveedores(nombre, aplica_retencion, pct_retencion))")
      .eq("paquete_id", input.paqueteId),
    admin
      .from("armado_vuelos")
      .select("bloqueo_id, aplica_mk, ta, bloqueos_vuelo(id, fecha_ida, fecha_regreso, tarifa_para_empaquetar)")
      .eq("paquete_id", input.paqueteId),
    admin
      .from("armado_empaquetados")
      .select("empaquetado_id, aplica_mk, ta, empaquetados(id, fecha_ida, fecha_regreso, tarifa_para_empaquetar, activo, compra_inicio, compra_fin)")
      .eq("paquete_id", input.paqueteId),
  ]);
  if (eServ || eVuelo || eEmp) {
    return { ok: false, codigo: "error_interno", mensaje: "No se pudo consultar la información del paquete." };
  }

  // Mismos filtros EXACTOS que `generarTarifario` (regla 4 del encargo).
  const hoy = hoyBogota(new Date());
  const salidasValidas: SalidaValidaBernalo[] = [];
  for (const v of vuelosSel ?? []) {
    const b = v.bloqueos_vuelo as unknown as { id: number; fecha_ida: string | null; fecha_regreso: string | null; tarifa_para_empaquetar: number } | null;
    if (!b || !b.fecha_ida || !b.fecha_regreso) continue;
    salidasValidas.push({
      tipo: "bloqueo", id: b.id, fechaIda: b.fecha_ida, fechaRegreso: b.fecha_regreso,
      costoTiqueteSilla: Number(b.tarifa_para_empaquetar) || 0, aplicaMk: !!v.aplica_mk, ta: Number(v.ta) || 0,
    });
  }
  for (const v of empaquetadosSel ?? []) {
    const e = v.empaquetados as unknown as {
      id: number; fecha_ida: string | null; fecha_regreso: string | null; tarifa_para_empaquetar: number;
      activo: boolean; compra_inicio: string | null; compra_fin: string | null;
    } | null;
    if (!e || !e.activo || !e.fecha_ida || !e.fecha_regreso) continue;
    if (!empaquetadoVigente(e.compra_inicio, e.compra_fin, hoy)) continue;
    salidasValidas.push({
      tipo: "empaquetado", id: e.id, fechaIda: e.fecha_ida, fechaRegreso: e.fecha_regreso,
      costoTiqueteSilla: Number(e.tarifa_para_empaquetar) || 0, aplicaMk: !!v.aplica_mk, ta: Number(v.ta) || 0,
    });
  }
  const totalConfiguradas = (vuelosSel?.length ?? 0) + (empaquetadosSel?.length ?? 0);

  // Había vuelos configurados para este paquete, pero NINGUNO pasa el filtro
  // (todos vencidos/inactivos/incompletos) → bloquea, nunca cotiza como si
  // fuera porción terrestre.
  if (totalConfiguradas > 0 && salidasValidas.length === 0) {
    return { ok: false, codigo: "salidas_no_disponibles", mensaje: "No hay salidas disponibles para este paquete en este momento." };
  }

  let vuelo: VueloBernalo | null = null;
  let salidaResuelta: SalidaResueltaBernalo;
  let fechaIda: string;
  let fechaRegreso: string;

  if (input.salida.tipo === "sin_vuelo") {
    // "sin vuelo" NUNCA es válido si el paquete sí tiene salidas reales.
    if (salidasValidas.length > 0) {
      return { ok: false, codigo: "salida_no_vinculada", mensaje: "Este paquete tiene vuelo — selecciona una salida antes de cotizar." };
    }
    fechaIda = input.salida.fechaIda;
    fechaRegreso = input.salida.fechaRegreso;
    salidaResuelta = { tipo: "sin_vuelo", fechaIda, fechaRegreso };
  } else {
    // La salida elegida debe existir REALMENTE entre las válidas de ESTE
    // paquete — nunca se asume, nunca se toma "la primera" (`[0]`).
    const salida = salidasValidas.find((s) => s.tipo === input.salida.tipo && s.id === input.salida.id);
    if (!salida) {
      return { ok: false, codigo: "salida_no_vinculada", mensaje: "La salida seleccionada no pertenece a este paquete o ya no está disponible." };
    }
    // Fechas AUTORITATIVAS de la salida validada — nunca las que el
    // navegador hubiera podido enviar para este caso.
    fechaIda = salida.fechaIda;
    fechaRegreso = salida.fechaRegreso;
    vuelo = { costoTiqueteSilla: salida.costoTiqueteSilla, aplicaMk: salida.aplicaMk, ta: salida.ta };
    salidaResuelta = { tipo: salida.tipo, id: salida.id, fechaIda, fechaRegreso };
  }

  // 5) Fechas dentro de la ventana de viaje del paquete — nunca se confía en
  // que el llamador ya las validó contra esa ventana.
  if (pq.fecha_viaje_inicio && fechaIda < pq.fecha_viaje_inicio) {
    return { ok: false, codigo: "fechas_fuera_de_ventana", mensaje: "La fecha de entrada está fuera de la ventana de viaje del paquete." };
  }
  if (pq.fecha_viaje_fin && fechaRegreso > pq.fecha_viaje_fin) {
    return { ok: false, codigo: "fechas_fuera_de_ventana", mensaje: "La fecha de salida está fuera de la ventana de viaje del paquete." };
  }

  // ── Servicios incluidos: separa persona/grupo, mismas tablas que usa
  // `generarTarifario` para el flujo legado. Proveedor real resuelto acá
  // (antes quedaba `null` en el flujo público 3E — regla del encargo:
  // "proveedores e ids se resuelven server-side"). ────────────────────────
  type ProvFact = { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null;
  const incluidos = (serviciosSel ?? []).filter((s) => s.incluido);
  const serviciosPersona: ServicioIncluidoPersonaBernalo[] = incluidos
    .filter((s) => s.modo === "persona")
    .map((s) => {
      const sa = s.servicios_adicionales as unknown as {
        nombre: string; categoria: string; precio_persona: number | null; liquidacion: string | null;
        moneda?: string | null; proveedor_id: number | null; proveedores: ProvFact;
      } | null;
      return {
        servicioId: s.servicio_id,
        nombre: sa?.nombre ?? `Servicio #${s.servicio_id}`,
        categoria: normalizarCategoriaServicio(sa?.categoria),
        precioPersonaNeto: sa?.precio_persona ?? null,
        liquidacion: sa?.liquidacion ?? null,
        proveedorId: sa?.proveedor_id ?? null,
      };
    });

  const idsGrupo = incluidos.filter((s) => s.modo === "grupo").map((s) => s.servicio_id);
  const rangosGrupoPorServicio = new Map<number, { pax_desde: number; pax_hasta: number; precio: number }[]>();
  if (idsGrupo.length) {
    const { data: gr, error: eGr } = await admin
      .from("servicio_tarifa_pax")
      .select("servicio_id, pax_desde, pax_hasta, precio")
      .eq("temporada", "GENERAL")
      .in("servicio_id", idsGrupo);
    if (eGr) return { ok: false, codigo: "error_interno", mensaje: "No se pudo consultar la tarifa de un servicio incluido." };
    for (const g of gr ?? []) {
      const arr = rangosGrupoPorServicio.get(g.servicio_id) ?? [];
      arr.push({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: g.precio });
      rangosGrupoPorServicio.set(g.servicio_id, arr);
    }
  }
  const serviciosGrupo: ServicioGrupoIncluido[] = incluidos
    .filter((s) => s.modo === "grupo")
    .map((s) => {
      const sa = s.servicios_adicionales as unknown as {
        nombre: string; categoria: string; liquidacion: string | null; proveedor_id: number | null;
      } | null;
      return {
        servicioId: s.servicio_id,
        nombre: sa?.nombre ?? `Servicio #${s.servicio_id}`,
        categoria: normalizarCategoriaServicio(sa?.categoria),
        liquidacion: sa?.liquidacion ?? null,
        proveedorId: sa?.proveedor_id ?? null,
        rangos: rangosGrupoPorServicio.get(s.servicio_id) ?? [],
      };
    });

  // 6) Moneda: resuelta desde el hotel + servicios incluidos — NUNCA
  // `pq.moneda ?? "COP"`. Si `armado_paquetes.moneda` contradice, bloquea.
  const monedasServicios = incluidos.map((s) => (s.servicios_adicionales as unknown as { moneda?: string | null } | null)?.moneda ?? null);
  const resolucionMoneda = resolverMonedaComponentesBernalo(hotelMeta?.moneda ?? null, monedasServicios, pq.moneda ?? null);
  if (!resolucionMoneda.ok) {
    return { ok: false, codigo: "moneda_no_determinable", mensaje: resolucionMoneda.mensaje };
  }
  const moneda = resolucionMoneda.moneda;

  // 7) Calendario + tarifas Bernalo — TODO con service role.
  const [{ data: temporadasRaw, error: eTemp }, { data: tarifasRaw, error: eTar }] = await Promise.all([
    admin
      .from("hotel_temporadas")
      .select("nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts, min_noches, regimen_restringido")
      .eq("hotel_id", input.hotelId),
    admin
      .from("hotel_tarifas_unidad")
      .select("id, hotel_id, tarifa_id, version_tarifario, temporada, categoria, alimentacion, estado, fuente_documento, fuente_pagina, comision_pct, payload")
      .eq("hotel_id", input.hotelId)
      .eq("estado", "publicada"),
  ]);
  if (eTemp || eTar) {
    return { ok: false, codigo: "error_interno", mensaje: "No se pudo consultar el calendario/tarifas del hotel." };
  }

  // Noches: derivadas de las fechas AUTORITATIVAS — nunca de un valor
  // enviado por el llamador ni del `armado_paquetes.noches` legado.
  const numNoches = calcularNoches(fechaIda, fechaRegreso);

  const datosOrquestacion: DatosOrquestacionBernalo = {
    hotelId: input.hotelId,
    modeloTarifario,
    temporadasRaw: temporadasRaw ?? [],
    filasTarifas: tarifasRaw ?? [],
    fechaIda,
    fechaRegreso,
    hoy: hoyISO(),
    habitaciones: input.habitaciones.map((h) => ({
      id: h.id,
      adultos: h.adultos,
      menores: h.edadesMenores.map((edadAnios) => ({ edadAnios })),
      categoria: input.categoria,
      alimentacion: input.alimentacion,
      noches: numNoches,
    })),
  };

  const resultadoOrquestacion = orquestarCotizacionAlojamientoBernalo(datosOrquestacion);
  if (!resultadoOrquestacion.ok) {
    return { ok: false, codigo: "no_cotizable", mensaje: resultadoOrquestacion.mensaje };
  }

  const entradaPvp: EntradaPvpAlojamientoBernalo = {
    resultadoHabitaciones: resultadoOrquestacion,
    pctMk: Number(pq.pct_mk) || 0,
    moneda,
    numNoches,
    serviciosPersona,
    serviciosGrupo,
    vuelo,
  };

  const resultadoComposicion = calcularPvpAlojamientoBernalo(entradaPvp);
  if (!resultadoComposicion.ok) {
    return { ok: false, codigo: "no_cotizable", mensaje: resultadoComposicion.mensaje };
  }

  // Ocupación de entrada, por habitacionId — para adjuntarla tal cual junto
  // al resultado/snapshot de cada habitación (nunca se aplana ni se pierde
  // la asociación habitación↔ocupación, Fase 3D).
  const ocupacionPorId = new Map(input.habitaciones.map((h) => [h.id, h]));
  const habitaciones: HabitacionComputoBernalo[] = resultadoOrquestacion.porHabitacion.map((ph) => ({
    habitacionId: ph.habitacionId,
    ocupacion: ocupacionPorId.get(ph.habitacionId)!,
    resultado: ph.resultado,
    snapshot: ph.snapshot,
  }));

  const serviciosIncluidos: ServicioIncluidoComputoBernalo[] = resultadoComposicion.serviciosIncluidosResueltos.map((s) => ({
    ...s,
    moneda,
  }));

  return {
    ok: true,
    modeloTarifario: "unidad",
    precioVenta: resultadoComposicion.pvp,
    moneda: resultadoComposicion.moneda,
    paxTotal: resultadoComposicion.paxTotal,
    paxConSilla: resultadoComposicion.paxConSilla,
    costoHotelTotal: resultadoComposicion.costoHotelTotal,
    costoVueloTotal: resultadoComposicion.costoVueloTotal,
    costoServiciosTotal: resultadoComposicion.costoServiciosTotal,
    aportePvpHotel: resultadoComposicion.aporteHotelTotal,
    aportePvpServicios: resultadoComposicion.aporteServiciosTotal,
    aportePvpVuelo: resultadoComposicion.aporteVueloTotal,
    hotelId: input.hotelId,
    hotelNombre,
    hotelDestino: destinoNombre,
    proveedorHotel,
    salida: salidaResuelta,
    habitaciones,
    serviciosIncluidos,
  };
}

// Re-exportado para que `cotizacionBernaloActions.ts` (y 3F-4 más adelante)
// puedan tipar `salida` sin definir su propia copia — mismo criterio de
// reexportación que ya usa ese archivo con `SalidaSeleccionadaBernaloEntrada`.
export type { SalidaSeleccionadaBernaloEntrada };
