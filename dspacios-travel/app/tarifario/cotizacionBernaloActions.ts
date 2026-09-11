"use server";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3E Bernalo — frontera PÚBLICA de cotización dinámica por habitación.
//
// Esta es la ÚNICA puerta por la que un visitante público (anónimo o con
// sesión externa: agencia/freelance) puede llegar a un precio Bernalo. Reglas
// de seguridad de la tarea, todas aplicadas aquí:
//   1. RLS de `hotel_tarifas_unidad` sigue cerrada (sin cambios, sin
//      migración) — el visitante NUNCA la lee directo.
//   2. Se usa `createAdminClient()` (service role) SOLO para las consultas de
//      solo-lectura de calendario/tarifa, y SOLO DESPUÉS de validar: paquete
//      visible (`activo=true`, mismo criterio que `tarifario_resultado`),
//      hotel realmente vinculado al paquete (`armado_hoteles`), categoría y
//      alimentación realmente vinculadas a ese hotel/paquete, salida aérea
//      realmente vinculada al paquete (o ausencia real de vuelo), y fechas
//      dentro de `fecha_viaje_inicio/fecha_viaje_fin` del paquete.
//   3. Nada de lo que mande el navegador (precio, markup, clasificación,
//      fechas de una salida con vuelo, nombres) se usa directo:
//      `paqueteId`/`hotelId` se re-verifican contra `armado_hoteles`/
//      `armado_paquetes`; `pctMk` sale de `armado_paquetes`; la MONEDA se
//      resuelve y valida desde los componentes reales (nunca del cliente
//      ni de `pq.moneda ?? "COP"`); las edades/ocupación se re-validan con
//      `validarHabitacionesOcupacion` (Fase 3D).
//   4-5. La respuesta pública es siempre un tipo CERRADO — solo `pvp`/
//      `moneda`/`paxTotal`/`promedioPorViajero`, o un rechazo con un código
//      público y un mensaje FIJO. Los bloqueos internos (Fase 3B/3C, que sí
//      pueden traer identidades de tarifa/nombres de servicio en su
//      `contexto`/`mensaje`) se traducen SIEMPRE mediante `MENSAJES_PUBLICOS`
//      — nunca se reenvía `.mensaje`/`.contexto` interno tal cual.
//
// Corrección (auditoría DeepSeek — hallazgos A1/A2/A3/B1/C1, ver el encargo
// de esta ronda):
//   A1. La salida aérea (bloqueo/empaquetado) es una identidad discriminada
//       `{tipo,id}` que el CLIENTE elige explícitamente (o "sin_vuelo" si el
//       paquete no tiene ninguna) — el servidor la revalida contra
//       `armado_vuelos`/`armado_empaquetados` del paquete. Ya NO se "toma la
//       primera" (`[0]`) en ningún punto de este archivo.
//   A2. Mismos filtros EXACTOS que `generarTarifario` para decidir qué
//       salidas son válidas. Cero salidas válidas cuando el paquete SÍ tenía
//       vuelos configurados bloquea; varias sin selección explícita bloquea.
//   A3. La moneda se resuelve con `resolverMonedaComponentesBernalo`
//       (`lib/calc/pvpAlojamientoBernalo.ts`) desde el hotel + servicios
//       incluidos — nunca `pq.moneda ?? "COP"`. Si `armado_paquetes.moneda`
//       está configurada y contradice, bloquea (sin escribir nada a la BD).
//   B1. Categoría/alimentación SOLO pueden ser un valor presente en
//       `armado_hoteles.categorias`/`regimenes` — arreglo vacío bloquea con
//       un código de configuración incompleta (nunca texto libre).
//   C1. `servicio_sin_tarifa`/`servicio_sin_rango_grupal` son códigos
//       públicos con mensaje FIJO (nunca el nombre del servicio, que
//       `calcularPvpAlojamientoBernalo` sí incluye en su mensaje INTERNO).
//
// Fuera de alcance de este archivo (ver el informe de la tarea):
//   - Carrito/checkout/contrato/CxP — esta acción NUNCA llama `add()` del
//     carrito ni ninguna función de `app/tarifario/checkout/actions.ts`.
//   - Impuesto/base comisionable contable — Fase 3F.
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
  type ResultadoPvpAlojamientoBernalo,
  type ServicioIncluidoPersonaBernalo,
  type VueloBernalo,
} from "@/lib/calc/pvpAlojamientoBernalo";
import {
  validarHabitacionesOcupacion,
  type HabitacionOcupacionEntrada,
} from "@/lib/reservar/ocupacionPorHabitacion";
import { normalizarCategoriaServicio, type ServicioGrupoIncluido } from "@/lib/reservar/serviciosPaquete";
import { empaquetadoVigente, hoyBogota } from "@/lib/reservar/origen";
// Fase 3F-1: `SalidaSeleccionadaBernaloEntrada` pasó a vivir en un módulo
// NEUTRAL (sin "use server"/"use client"), fuente única compartida con el
// carrito (`lib/cart/CartContext.tsx`) y el checkout público
// (`app/tarifario/checkout/actions.ts`) — ninguno de los dos tiene que
// importar este archivo "use server" para conocer la forma de la salida
// elegida. Reexportada acá para no romper a nadie que ya la importaba desde
// esta ruta (ej. `app/tarifario/VistaBooking.tsx`).
export type { SalidaSeleccionadaBernaloEntrada } from "@/lib/reservar/solicitudAlojamientoBernalo";
import type { SalidaSeleccionadaBernaloEntrada } from "@/lib/reservar/solicitudAlojamientoBernalo";

export type CodigoRechazoCotizacionBernaloPublico =
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

export type RechazoCotizacionBernaloPublico = {
  ok: false;
  codigo: CodigoRechazoCotizacionBernaloPublico;
  mensaje: string;
};

export type ResultadoCotizarAlojamientoBernaloPublico = ResultadoPvpAlojamientoBernalo | RechazoCotizacionBernaloPublico;

export type EntradaCotizarAlojamientoBernaloPublico = {
  paqueteId: number;
  hotelId: number;
  categoria: string;
  alimentacion: string;
  salida: SalidaSeleccionadaBernaloEntrada;
  habitaciones: HabitacionOcupacionEntrada[];
};

// Mensajes públicos FIJOS por código interno — nunca se reenvía el `.mensaje`
// compuesto por los resolvers internos (Fase 3B/3C/3E), que puede describir
// identidades de tarifa/nombres de servicio pensados para diagnóstico
// interno, no para un visitante público (regla C1.21/22).
const MENSAJES_PUBLICOS: Record<string, string> = {
  modelo_no_bernalo: "Este hotel no está disponible para cotización en este momento.",
  fechas_invalidas: "Las fechas seleccionadas no son válidas.",
  blackout: "No hay disponibilidad para las fechas seleccionadas.",
  temporada_no_resuelta: "No hay tarifa vigente para las fechas seleccionadas.",
  estadia_multitemporada_no_soportada: "Esa estadía cruza dos temporadas y no se puede cotizar en una sola tarifa — prueba con fechas dentro de un mismo rango.",
  habitacion_noches_inconsistente: "Ocurrió un problema al calcular las noches de la estadía.",
  sin_habitaciones: "Indica al menos una habitación.",
  tarifa_no_encontrada: "No hay tarifa disponible para la categoría/alimentación seleccionada.",
  tarifa_ambigua: "No fue posible determinar una tarifa única — contacta a un asesor.",
  tarifa_invalida: "No fue posible cotizar esta habitación — contacta a un asesor.",
  ocupacion_no_permitida: "La ocupación declarada no cabe en la habitación seleccionada.",
  edad_fuera_de_regla: "Una de las edades declaradas no tiene una tarifa aplicable.",
  combinacion_ambigua: "Una de las edades declaradas es ambigua para la tarifa configurada.",
  configuracion_invalida: "No fue posible cotizar con los datos ingresados.",
  requiere_cotizacion_manual: "Esta reserva requiere cotización manual — contacta a un asesor.",
  producto_no_soportado: "Este producto no está disponible para cotización en línea.",
  // C1: códigos del compositor de PVP (Fase 3E) — mensaje FIJO, nunca el
  // nombre del servicio que trae el `.mensaje` interno.
  servicio_sin_tarifa: "Uno de los servicios incluidos no tiene una tarifa configurada — contacta a un asesor.",
  servicio_sin_rango_grupal: "Uno de los servicios incluidos no tiene una tarifa configurada para esta cantidad de viajeros — contacta a un asesor.",
  // A3: moneda.
  moneda_indeterminada: "No se pudo determinar la moneda de este hotel — contacta a un asesor.",
  moneda_mixta: "El hotel y sus servicios incluidos están en monedas distintas — contacta a un asesor.",
  moneda_contradice_paquete: "Hay una inconsistencia de moneda en la configuración de este paquete — contacta a un asesor.",
};

function mensajePublico(codigo: string): string {
  return MENSAJES_PUBLICOS[codigo] ?? "No fue posible cotizar con los datos ingresados.";
}

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
 * Cotiza un hotel Bernalo para un visitante PÚBLICO. Valida pertenencia al
 * paquete + salida aérea + moneda + ventana de fechas ANTES de tocar
 * `hotel_tarifas_unidad` (con service role, único cliente que puede leerla —
 * la RLS pública sigue cerrada), delega temporada+tarifa+cotización al
 * orquestador puro de Fase 3C, compone el PVP con la fórmula de Fase 3E, y
 * devuelve SOLO el payload comercial público. Nunca toca carrito/checkout/
 * contrato.
 */
export async function cotizarAlojamientoBernaloPublico(
  input: EntradaCotizarAlojamientoBernaloPublico
): Promise<ResultadoCotizarAlojamientoBernaloPublico> {
  // 1) Ocupación: forma + coherencia (Fase 3D) — nunca se confía en lo que
  // mandó el navegador, aunque ya haya sido "validado" en el cliente.
  const validacionOcupacion = validarHabitacionesOcupacion(input.habitaciones);
  if (!validacionOcupacion.ok) {
    return {
      ok: false,
      codigo: "ocupacion_invalida",
      mensaje: validacionOcupacion.errores.map((e) => e.mensaje).join(" "),
    };
  }

  if (typeof input.paqueteId !== "number" || typeof input.hotelId !== "number") {
    return { ok: false, codigo: "error_interno", mensaje: "Solicitud inválida." };
  }
  const salidaEntrada = input.salida;
  if (
    !salidaEntrada ||
    typeof salidaEntrada !== "object" ||
    (salidaEntrada.tipo !== "bloqueo" && salidaEntrada.tipo !== "empaquetado" && salidaEntrada.tipo !== "sin_vuelo")
  ) {
    return { ok: false, codigo: "error_interno", mensaje: "Solicitud inválida." };
  }

  const admin = createAdminClient();

  // 2) Paquete visible/publicable — MISMO criterio que ya usa la lectura del
  // tarifario público (`tarifario_resultado.paquete_activo = true`).
  const { data: pq, error: ePq } = await admin
    .from("armado_paquetes")
    .select("id, activo, pct_mk, moneda, fecha_viaje_inicio, fecha_viaje_fin")
    .eq("id", input.paqueteId)
    .maybeSingle();
  if (ePq) return { ok: false, codigo: "error_interno", mensaje: "No se pudo validar el paquete." };
  if (!pq || !pq.activo) {
    return { ok: false, codigo: "paquete_no_disponible", mensaje: "Este paquete ya no está disponible." };
  }

  // 3) Hotel realmente vinculado al paquete, y modelo tarifario Bernalo —
  // nunca se asume por el `hotelId` que mandó el navegador.
  const { data: ah, error: eAh } = await admin
    .from("armado_hoteles")
    .select("hotel_id, categorias, regimenes, hoteles(moneda, modelo_tarifario)")
    .eq("paquete_id", input.paqueteId)
    .eq("hotel_id", input.hotelId)
    .maybeSingle();
  if (eAh) return { ok: false, codigo: "error_interno", mensaje: "No se pudo validar el hotel del paquete." };
  if (!ah) {
    return { ok: false, codigo: "hotel_no_vinculado", mensaje: "Este hotel no pertenece al paquete indicado." };
  }
  const hotelMeta = ah.hoteles as unknown as { moneda?: string | null; modelo_tarifario?: string | null } | null;
  const modeloTarifario = hotelMeta?.modelo_tarifario ?? null;
  if (modeloTarifario !== "unidad") {
    return { ok: false, codigo: "hotel_no_vinculado", mensaje: "Este hotel no está disponible para cotización en este momento." };
  }

  // 4) Categoría y alimentación: B1 — SOLO un valor realmente presente en
  // `armado_hoteles.categorias`/`regimenes`. Un arreglo VACÍO significa
  // "este hotel no tiene configuración completa para cotizar" — nunca
  // "cualquier valor sirve" (a diferencia del filtro del tarifario legado,
  // que sí trata el arreglo vacío como "sin restricción": ahí siempre hay
  // una tarifa por-columna de respaldo; acá no hay ningún valor de
  // respaldo posible, así que la ausencia debe bloquear, no abrirse).
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

  // 5) Salida aérea (A1/A2) + servicios incluidos — en paralelo.
  const [
    { data: serviciosSel, error: eServ },
    { data: vuelosSel, error: eVuelo },
    { data: empaquetadosSel, error: eEmp },
  ] = await Promise.all([
    admin
      .from("armado_servicios")
      .select("servicio_id, modo, incluido, servicios_adicionales(nombre, categoria, precio_persona, liquidacion, moneda)")
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

  // A2.8 — MISMOS filtros exactos que `generarTarifario`.
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

  // A2.9: había vuelos configurados para este paquete, pero NINGUNO pasa el
  // filtro (todos vencidos/inactivos/incompletos) → bloquea, nunca cotiza
  // como si fuera porción terrestre.
  if (totalConfiguradas > 0 && salidasValidas.length === 0) {
    return {
      ok: false,
      codigo: "salidas_no_disponibles",
      mensaje: "No hay salidas disponibles para este paquete en este momento.",
    };
  }

  let vuelo: VueloBernalo | null = null;
  let fechaIda: string;
  let fechaRegreso: string;

  if (salidaEntrada.tipo === "sin_vuelo") {
    // A2.10 / A1.4: "sin vuelo" NUNCA es válido si el paquete sí tiene
    // salidas reales — eso sería cotizar sin el componente aéreo por un
    // descuido del cliente, nunca una elección legítima.
    if (salidasValidas.length > 0) {
      return {
        ok: false,
        codigo: "salida_no_vinculada",
        mensaje: "Este paquete tiene vuelo — selecciona una salida antes de cotizar.",
      };
    }
    // A1.6: porción terrestre real — las fechas SÍ vienen del cliente, pero
    // se validan contra la ventana del paquete (regla 5 más abajo).
    fechaIda = salidaEntrada.fechaIda;
    fechaRegreso = salidaEntrada.fechaRegreso;
  } else {
    // A1.4: la salida elegida debe existir REALMENTE entre las válidas de
    // ESTE paquete — nunca se asume, nunca se toma "la primera" (`[0]`).
    const salida = salidasValidas.find((s) => s.tipo === salidaEntrada.tipo && s.id === salidaEntrada.id);
    if (!salida) {
      return {
        ok: false,
        codigo: "salida_no_vinculada",
        mensaje: "La salida seleccionada no pertenece a este paquete o ya no está disponible.",
      };
    }
    // A1.5: fechas AUTORITATIVAS de la salida validada — cualquier fecha
    // que el navegador hubiera podido enviar para este caso ni siquiera
    // existe en el tipo de entrada (`SalidaSeleccionadaBernaloEntrada` para
    // "bloqueo"/"empaquetado" no lleva fechaIda/fechaRegreso).
    fechaIda = salida.fechaIda;
    fechaRegreso = salida.fechaRegreso;
    vuelo = { costoTiqueteSilla: salida.costoTiqueteSilla, aplicaMk: salida.aplicaMk, ta: salida.ta };
  }

  // 6) Fechas dentro de la ventana de viaje del paquete — nunca se confía en
  // que el navegador ya las validó contra esa ventana (aplica también a las
  // fechas ya resueltas desde una salida real, por defensa en profundidad).
  if (pq.fecha_viaje_inicio && fechaIda < pq.fecha_viaje_inicio) {
    return { ok: false, codigo: "fechas_fuera_de_ventana", mensaje: "La fecha de entrada está fuera de la ventana de viaje del paquete." };
  }
  if (pq.fecha_viaje_fin && fechaRegreso > pq.fecha_viaje_fin) {
    return { ok: false, codigo: "fechas_fuera_de_ventana", mensaje: "La fecha de salida está fuera de la ventana de viaje del paquete." };
  }

  // ── Servicios incluidos: separa persona/grupo, mismas tablas que usa
  // `generarTarifario` para el flujo legado. ─────────────────────────────
  const incluidos = (serviciosSel ?? []).filter((s) => s.incluido);
  const serviciosPersona: ServicioIncluidoPersonaBernalo[] = incluidos
    .filter((s) => s.modo === "persona")
    .map((s) => {
      const sa = s.servicios_adicionales as unknown as { nombre: string; categoria: string; precio_persona: number | null; liquidacion: string | null; moneda?: string | null } | null;
      return {
        servicioId: s.servicio_id,
        nombre: sa?.nombre ?? `Servicio #${s.servicio_id}`,
        categoria: normalizarCategoriaServicio(sa?.categoria),
        precioPersonaNeto: sa?.precio_persona ?? null,
        liquidacion: sa?.liquidacion ?? null,
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
      const sa = s.servicios_adicionales as unknown as { nombre: string; categoria: string; liquidacion: string | null } | null;
      return {
        servicioId: s.servicio_id,
        nombre: sa?.nombre ?? `Servicio #${s.servicio_id}`,
        categoria: normalizarCategoriaServicio(sa?.categoria),
        liquidacion: sa?.liquidacion ?? null,
        proveedorId: null,
        rangos: rangosGrupoPorServicio.get(s.servicio_id) ?? [],
      };
    });

  // 7) Moneda (A3): resuelta desde el hotel + servicios incluidos —
  // NUNCA `pq.moneda ?? "COP"`. Si `armado_paquetes.moneda` está
  // configurada y contradice, bloquea (sin escribir nada a la base).
  const monedasServicios = incluidos.map((s) => (s.servicios_adicionales as unknown as { moneda?: string | null } | null)?.moneda ?? null);
  const resolucionMoneda = resolverMonedaComponentesBernalo(hotelMeta?.moneda ?? null, monedasServicios, pq.moneda ?? null);
  if (!resolucionMoneda.ok) {
    return { ok: false, codigo: "moneda_no_determinable", mensaje: mensajePublico(resolucionMoneda.codigo) };
  }
  const moneda = resolucionMoneda.moneda;

  // 8) Calendario + tarifas Bernalo — TODO con service role (única forma de
  // leer `hotel_tarifas_unidad` desde un contexto público; la RLS de esa
  // tabla sigue sin abrirse).
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

  // ── Noches: derivadas de las fechas AUTORITATIVAS (de la salida validada,
  // o de las fechas del cliente ya validadas contra la ventana para porción
  // terrestre) — nunca de un valor mandado por el cliente ni del
  // `armado_paquetes.noches` legado. ──────────────────────────────────────
  const numNoches = calcularNoches(fechaIda, fechaRegreso);

  const datosOrquestacion: DatosOrquestacionBernalo = {
    hotelId: input.hotelId,
    modeloTarifario,
    temporadasRaw: temporadasRaw ?? [],
    filasTarifas: tarifasRaw ?? [],
    fechaIda,
    fechaRegreso,
    hoy: hoyISO(),
    habitaciones: validacionOcupacion.habitaciones.map((h) => ({
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
    return { ok: false, codigo: "no_cotizable", mensaje: mensajePublico(resultadoOrquestacion.codigo) };
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

  const resultadoPvp = calcularPvpAlojamientoBernalo(entradaPvp);
  if (!resultadoPvp.ok) {
    // C1: mensaje público FIJO — nunca `resultadoPvp.mensaje` (que sí trae
    // el nombre interno del servicio, ver `pvpAlojamientoBernalo.ts`).
    return { ok: false, codigo: "no_cotizable", mensaje: mensajePublico(resultadoPvp.codigo) };
  }

  // Tipo cerrado: solo pvp/moneda/paxTotal/promedioPorViajero — nada interno.
  return resultadoPvp;
}
