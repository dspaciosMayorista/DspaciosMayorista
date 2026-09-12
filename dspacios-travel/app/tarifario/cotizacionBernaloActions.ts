"use server";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3E Bernalo — frontera PÚBLICA de cotización dinámica por habitación.
//
// Esta es la ÚNICA puerta por la que un visitante público (anónimo o con
// sesión externa: agencia/freelance) puede llegar a un precio Bernalo.
//
// Fase 3F-3: TODA la autorización/resolución/cálculo (validar pertenencia al
// paquete, salida aérea, moneda, ventana de fechas, orquestar temporada+
// tarifa+cotización, componer costos/PVP) se EXTRAJO al servicio interno
// `lib/reservar/computoReservaBernalo.ts` (`computarReservaBernalo`) — este
// archivo ya NO calcula nada por sí mismo. Su único trabajo ahora es:
//   1. Tratar el body de red como `unknown` y validarlo en FORMA
//      (`validarHabitacionesOcupacion` Fase 3D, `validarSalidaSeleccionadaBernalo`
//      Fase 3F-1) antes de construir la entrada del servicio interno — nunca
//      confiar en el tipo declarado de `EntradaCotizarAlojamientoBernaloPublico`
//      en tiempo de ejecución (una Server Action pública es alcanzable con
//      cualquier body HTTP).
//   2. Llamar `computarReservaBernalo` UNA vez — la única fuente de verdad
//      del cálculo (regla 1: "no mantengas dos implementaciones monetarias").
//   3. SANITIZAR su resultado a las 5 claves públicas de siempre
//      (`ok`/`pvp`/`moneda`/`paxTotal`/`promedioPorViajero`) o a un rechazo
//      con código + mensaje FIJO — nunca reenviar el objeto interno
//      completo (que trae netos, aportes, snapshots, proveedor, habitación
//      por habitación) ni su `.mensaje` crudo (que sí puede nombrar
//      tarifas/servicios internos).
//
// Reglas de seguridad que se conservan intactas (ver el servicio interno
// para el detalle de cada una — ninguna cambió de comportamiento):
//   1. RLS de `hotel_tarifas_unidad` sigue cerrada — el visitante NUNCA la
//      lee directo.
//   2. `createAdminClient()` (service role) SOLO para lectura, y SOLO
//      DESPUÉS de validar pertenencia/vigencia/clasificación.
//   3. Nada de lo que mande el navegador se usa como autoridad de precio.
//   4-5. La respuesta pública es siempre un tipo CERRADO.
//
// Corrección (auditoría DeepSeek — hallazgos A1/A2/A3/B1/C1, Fase 3E):
//   A1. Salida aérea = identidad discriminada `{tipo,id}` (o "sin_vuelo"),
//       nunca `[0]`. A2. Mismos filtros que `generarTarifario`. A3. Moneda
//       resuelta desde componentes reales. B1. Categoría/alimentación solo
//       de `armado_hoteles.categorias/regimenes`. C1. Mensajes públicos
//       fijos, nunca el nombre interno de un servicio/tarifa.
//
// Fuera de alcance de este archivo (ver el informe de la tarea):
//   - Carrito/checkout/contrato/CxP — esta acción NUNCA llama `add()` del
//     carrito ni ninguna función de `app/tarifario/checkout/actions.ts`.
//   - contrato_items/snapshots (`contrato_alojamiento_bernalo`, migración
//     176)/ventas/CxP — eso es 3F-4, que usará `computarReservaBernalo`
//     para persistir. La guardia de `lib/reservar/computo.ts` sigue
//     bloqueando Bernalo, sin cambios.
// ─────────────────────────────────────────────────────────────────────────

import {
  computarReservaBernalo,
  type CodigoComputoReservaBernalo,
} from "@/lib/reservar/computoReservaBernalo";
import {
  validarSalidaSeleccionadaBernalo,
} from "@/lib/reservar/solicitudAlojamientoBernalo";
import {
  validarHabitacionesOcupacion,
  type HabitacionOcupacionEntrada,
} from "@/lib/reservar/ocupacionPorHabitacion";
// Fase 3F-1: `SalidaSeleccionadaBernaloEntrada` vive en un módulo NEUTRAL
// (sin "use server"/"use client"), fuente única compartida con el carrito
// (`lib/cart/CartContext.tsx`) y el checkout público
// (`app/tarifario/checkout/actions.ts`) — ninguno de los dos tiene que
// importar este archivo "use server" para conocer la forma de la salida
// elegida. Reexportada acá para no romper a nadie que ya la importaba desde
// esta ruta (ej. `app/tarifario/VistaBooking.tsx`).
export type { SalidaSeleccionadaBernaloEntrada } from "@/lib/reservar/solicitudAlojamientoBernalo";
import type { SalidaSeleccionadaBernaloEntrada } from "@/lib/reservar/solicitudAlojamientoBernalo";

// Mismo conjunto de códigos que produce el servicio interno — la frontera
// pública nunca inventa un código propio ni le agrega ninguno.
export type CodigoRechazoCotizacionBernaloPublico = CodigoComputoReservaBernalo;

export type RechazoCotizacionBernaloPublico = {
  ok: false;
  codigo: CodigoRechazoCotizacionBernaloPublico;
  mensaje: string;
};

// Tipo CERRADO — únicamente estas 5 claves (o el rechazo de arriba) pueden
// viajar hacia el navegador. Nunca un passthrough/`Omit<>` del resultado
// interno: si el servicio interno gana un campo nuevo mañana, este tipo NO
// lo hereda solo, hay que decidirlo a propósito.
export type ResultadoCotizarAlojamientoBernaloPublicoOk = {
  ok: true;
  pvp: number;
  moneda: string;
  paxTotal: number;
  promedioPorViajero: number;
};

export type ResultadoCotizarAlojamientoBernaloPublico = ResultadoCotizarAlojamientoBernaloPublicoOk | RechazoCotizacionBernaloPublico;

export type EntradaCotizarAlojamientoBernaloPublico = {
  paqueteId: number;
  hotelId: number;
  categoria: string;
  alimentacion: string;
  salida: SalidaSeleccionadaBernaloEntrada;
  habitaciones: HabitacionOcupacionEntrada[];
};

// Mensajes públicos FIJOS por código interno — nunca se reenvía el `.mensaje`
// que arma el servicio interno (que puede describir identidades de tarifa/
// nombres de servicio pensados para diagnóstico interno, no para un
// visitante público, regla C1.21/22).
const MENSAJES_PUBLICOS: Record<string, string> = {
  error_interno: "No fue posible cotizar con los datos ingresados.",
  ocupacion_invalida: "La ocupación indicada no es válida.",
  paquete_no_disponible: "Este paquete ya no está disponible.",
  hotel_no_vinculado: "Este hotel no está disponible para cotización en este momento.",
  clasificacion_no_vinculada: "La categoría o alimentación seleccionada no está disponible para este hotel.",
  configuracion_incompleta: "Este hotel todavía no tiene su configuración completa para cotizar en línea.",
  salida_no_vinculada: "La salida seleccionada no es válida para este paquete.",
  salidas_no_disponibles: "No hay salidas disponibles para este paquete en este momento.",
  fechas_fuera_de_ventana: "Las fechas seleccionadas están fuera del rango de viaje del paquete.",
  moneda_no_determinable: "No se pudo determinar la moneda de esta cotización — contacta a un asesor.",
  no_cotizable: "No fue posible cotizar con los datos ingresados.",
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
  servicio_sin_tarifa: "Uno de los servicios incluidos no tiene una tarifa configurada — contacta a un asesor.",
  servicio_sin_rango_grupal: "Uno de los servicios incluidos no tiene una tarifa configurada para esta cantidad de viajeros — contacta a un asesor.",
  moneda_indeterminada: "No se pudo determinar la moneda de este hotel — contacta a un asesor.",
  moneda_mixta: "El hotel y sus servicios incluidos están en monedas distintas — contacta a un asesor.",
  moneda_contradice_paquete: "Hay una inconsistencia de moneda en la configuración de este paquete — contacta a un asesor.",
};

function mensajePublico(codigo: string): string {
  return MENSAJES_PUBLICOS[codigo] ?? "No fue posible cotizar con los datos ingresados.";
}

/**
 * Cotiza un hotel Bernalo para un visitante PÚBLICO. Valida forma, llama al
 * servicio interno autoritativo (`computarReservaBernalo`) y sanitiza su
 * resultado a las 5 claves públicas de siempre — nunca reenvía el cálculo
 * interno completo (netos, aportes, snapshots, proveedor, habitación por
 * habitación) ni un `.mensaje` que pueda nombrar algo interno.
 */
export async function cotizarAlojamientoBernaloPublico(
  input: EntradaCotizarAlojamientoBernaloPublico
): Promise<ResultadoCotizarAlojamientoBernaloPublico> {
  // 1) Forma — nunca se confía en lo que mandó el navegador, aunque ya haya
  // sido "validado" en el cliente.
  const validacionOcupacion = validarHabitacionesOcupacion(input.habitaciones);
  if (!validacionOcupacion.ok) {
    return {
      ok: false,
      codigo: "ocupacion_invalida",
      mensaje: validacionOcupacion.errores.map((e) => e.mensaje).join(" "),
    };
  }
  if (typeof input.paqueteId !== "number" || typeof input.hotelId !== "number") {
    return { ok: false, codigo: "error_interno", mensaje: mensajePublico("error_interno") };
  }
  if (typeof input.categoria !== "string" || typeof input.alimentacion !== "string") {
    return { ok: false, codigo: "error_interno", mensaje: mensajePublico("error_interno") };
  }
  const vSalida = validarSalidaSeleccionadaBernalo(input.salida);
  if (!vSalida.ok) {
    return { ok: false, codigo: "error_interno", mensaje: mensajePublico("error_interno") };
  }

  // 2) Servicio interno autoritativo — ÚNICA fuente del cálculo.
  const resultado = await computarReservaBernalo({
    paqueteId: input.paqueteId,
    hotelId: input.hotelId,
    categoria: input.categoria,
    alimentacion: input.alimentacion,
    salida: vSalida.salida,
    habitaciones: validacionOcupacion.habitaciones,
  });

  if (!resultado.ok) {
    // C1: mensaje público FIJO — nunca `resultado.mensaje` (que sí puede
    // nombrar una tarifa/servicio interno).
    return { ok: false, codigo: resultado.codigo, mensaje: mensajePublico(resultado.codigo) };
  }

  // 3) Sanitización final — SOLO estas 5 claves, nunca el objeto interno
  // completo (regla 2/3 del encargo).
  return {
    ok: true,
    pvp: resultado.precioVenta,
    moneda: resultado.moneda,
    paxTotal: resultado.paxTotal,
    promedioPorViajero: resultado.paxTotal > 0 ? Math.round(resultado.precioVenta / resultado.paxTotal) : resultado.precioVenta,
  };
}
