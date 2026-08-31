"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aplicarFiltrosPostCarga } from "@/lib/tarifario/filtrosPostCarga";
import { esFilaHotelVerificable } from "@/lib/tarifario/vigencia";
import { validarEntradaDetalleHotel, validarEntradaDetalleSalida, validarEntradaDetallePaquete } from "@/lib/tarifario/detalleValidacion";
import type { FilaTarifario } from "./TarifarioPublic";
import { generarFlujoId, registrarEtapa, registrarDatoPagina, registrarErrorTecnico } from "@/lib/observabilidad/medicion";

// ── Detalle del tarifario BAJO DEMANDA (Tier 2 de la carga en dos niveles) ──
//
// La carga inicial (`lib/tarifario/resumen.ts`, Tier 1) trae solo lo
// necesario para las tarjetas: no incluye niño/niño2/infante detallados por
// fila, descripción, recargo individual ni las escalas por rango de pax de
// los servicios. Estas 4 acciones traen la matriz COMPLETA de
// `tarifario_resultado` (las mismas columnas que antes traía
// `cargarDatosTarifario()` de punta a punta), pero SOLO para el
// hotel/bloqueo/paquete/módulo puntual que el usuario está mirando — nunca
// el catálogo completo.
//
// Seguridad (mismo criterio que ya usaba `cargarFilasTarifarioPaginado`):
//   · `tarifario_resultado` se lee con el cliente `sb` (RLS/anon respetada,
//     su policy ya es "for select using (true)" — público) — NUNCA con
//     service-role para servir estos datos públicos.
//   · El service-role (`admin`, opcional según `SUPABASE_SERVICE_ROLE_KEY`,
//     igual patrón que `cargarDatosTarifario`/`cargarResumenTarifario`) solo
//     se usa para las verificaciones INTERNAS que ya usaba el resumen
//     (vigencia de compra, empaquetados vigentes) — nunca para leer o
//     devolver filas de tarifa directamente.
//   · Todo argumento llega como `unknown` (Server Action invocable desde el
//     navegador con cualquier body) y se valida ANTES de tocar Supabase.
//   · Un error técnico nunca llega crudo al navegador — mensaje público fijo,
//     el detalle real queda saneado en el log server-side.
//   · Cada acción hace 1 sola consulta a `tarifario_resultado` (más, cuando
//     aplica, las mismas verificaciones internas ya usadas por el resumen) —
//     nunca N+1 por fila.
//   · `obtenerDetalleHotel({modulo:"bloqueo", ...})` EXIGE `bloqueoIds`: el
//     alcance actualmente visible bajo el filtro de origen/destino/salida de
//     VistaBooking (revisión posterior, defecto "no preserva el alcance
//     activo al abrir un hotel") — nunca vuelve "todo el hotel" como si no
//     hubiera filtro. Ver lib/tarifario/detalleValidacion.ts.
//   · Falla cerrada de VERDAD (revisión posterior, defecto "convierte un
//     error técnico en 'sin disponibilidad'"): si `aplicarFiltrosPostCarga()`
//     devuelve `errorVigencia`/`errorEmpaquetado`, o si hace falta
//     service-role para verificar vigencia y no está configurado, la acción
//     devuelve `ok:false` con el mensaje público fijo — NUNCA `ok:true` con
//     filas vacías/parciales, que el modal interpretaría como "sin
//     disponibilidad publicada" (una afirmación falsa: no se sabe si hay
//     disponibilidad, solo que no se pudo verificar).
const MSG_ERROR_DETALLE = "No fue posible cargar el detalle en este momento. Intenta nuevamente en unos segundos.";
const FLUJO = "tarifario_detalle_bajo_demanda";

const COLUMNAS_DETALLE =
  "modulo, bloqueo_label, bloqueo_id, empaquetado_id, salida_id, paquete_id, hotel_id, servicio_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, fecha_ida, fecha_regreso, noches, destino_nombre, paquete_nombre, hotel_nombre, categoria, regimen, acomodacion, precio_pvp, descripcion, recargo_individual, moneda";

export type ResultadoDetalle = { ok: true; filas: FilaTarifario[] } | { ok: false; error: string };

function admin() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null;
}

/**
 * Ejecuta la consulta acotada dada, aplica los mismos filtros de vigencia/
 * empaquetados que ya aplicó el resumen (Tier 1) y devuelve el resultado
 * saneado. Punto único para las 4 acciones de abajo — evita repetir el
 * manejo de error/instrumentación 4 veces.
 */
async function cargarDetalleAcotado(
  etapa: string,
  // `PromiseLike`, no `Promise`: los query builders de Supabase
  // (`sb.from(...).select(...).eq(...)`) son "thenables" pero no Promise
  // reales (no implementan `catch`/`finally`) — mismo motivo documentado en
  // `Medidor` (lib/observabilidad/medicion.ts).
  ejecutar: (sb: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<ResultadoDetalle> {
  const flujoId = generarFlujoId();
  const t0 = performance.now();
  const sb = await createClient();
  const { data, error } = await ejecutar(sb);
  if (error) {
    registrarEtapa(FLUJO, flujoId, "detalle_tarifas", Math.round(performance.now() - t0), "error");
    registrarErrorTecnico(FLUJO, flujoId, "detalle_tarifas", `error_consulta_${etapa}`, error);
    return { ok: false, error: MSG_ERROR_DETALLE };
  }
  const crudas = (data ?? []) as unknown as FilaTarifario[];
  const ad = admin();

  // Vigencia es INDISPENSABLE para cualquier fila de hotel (bloqueo/porción
  // con fecha) — sin service-role no hay forma de re-liquidar y verificarla.
  // Saltarse la validación en silencio publicaría una tarifa que pudo vencer;
  // en vez de eso, esto es un error de CONFIGURACIÓN del entorno (falta la
  // env var), nunca "sin disponibilidad".
  if (ad == null && crudas.some(esFilaHotelVerificable)) {
    registrarEtapa(FLUJO, flujoId, "detalle_tarifas", Math.round(performance.now() - t0), "error");
    registrarErrorTecnico(FLUJO, flujoId, "detalle_tarifas", `error_config_service_role_faltante_${etapa}`, null);
    return { ok: false, error: MSG_ERROR_DETALLE };
  }

  const res = await aplicarFiltrosPostCarga(ad, crudas);
  if (res.errorVigencia || res.errorEmpaquetado) {
    if (res.errorVigencia) registrarErrorTecnico(FLUJO, flujoId, "detalle_tarifas", `error_vigencia_${etapa}`, res.errorVigencia);
    if (res.errorEmpaquetado) registrarErrorTecnico(FLUJO, flujoId, "detalle_tarifas", `error_empaquetados_${etapa}`, res.errorEmpaquetado);
    // Un error TÉCNICO al verificar vigencia/empaquetados nunca se disfraza
    // de "sin disponibilidad" — la Server Action falla cerrada, con
    // `resultado=error` en la instrumentación (nunca "ok").
    registrarEtapa(FLUJO, flujoId, "detalle_tarifas", Math.round(performance.now() - t0), "error");
    return { ok: false, error: MSG_ERROR_DETALLE };
  }
  registrarEtapa(FLUJO, flujoId, "detalle_tarifas", Math.round(performance.now() - t0), "ok");
  registrarDatoPagina(FLUJO, flujoId, "detalle_tarifas", `alcance=${etapa} filas_detalle=${res.filas.length}`);
  return { ok: true, filas: res.filas };
}

/**
 * "Ver opciones" de un hotel en Vista Booking — acotado por (módulo, hotel)
 * y, para `modulo:"bloqueo"`, por el ALCANCE de bloqueos actualmente visible
 * bajo el filtro de origen/destino/salida (`bloqueoIds`, obligatorio — ver
 * `validarEntradaDetalleHotel`). Un hotel puede tener varias salidas dentro
 * de ese alcance; el modal las elige TODAS de una sola vez (así evita
 * re-consultar al cambiar de salida dentro del mismo modal ya abierto).
 */
export async function obtenerDetalleHotel(inputRaw: unknown): Promise<ResultadoDetalle> {
  const v = validarEntradaDetalleHotel(inputRaw);
  if (!v) return { ok: false, error: MSG_ERROR_DETALLE };

  if (v.modulo === "bloqueo") {
    if (v.bloqueoIds.length === 0) {
      // Alcance vacío: el filtro activo no deja ninguna salida visible para
      // este hotel — el resultado correcto es "sin opciones", nunca "todo el
      // hotel" como fallback (eso rompería el alcance que el usuario ve).
      // Se instrumenta igual que un resultado ok normal (0 filas, sin error).
      const flujoId = generarFlujoId();
      registrarEtapa(FLUJO, flujoId, "detalle_tarifas", 0, "ok");
      registrarDatoPagina(FLUJO, flujoId, "detalle_tarifas", "alcance=hotel filas_detalle=0 motivo=alcance_vacio");
      return { ok: true, filas: [] };
    }
    return cargarDetalleAcotado("hotel", (sb) =>
      sb.from("tarifario_resultado").select(COLUMNAS_DETALLE)
        .eq("paquete_activo", true).eq("modulo", "bloqueo").eq("hotel_id", v.hotelId).in("bloqueo_id", v.bloqueoIds)
    );
  }
  return cargarDetalleAcotado("hotel", (sb) =>
    sb.from("tarifario_resultado").select(COLUMNAS_DETALLE)
      .eq("paquete_activo", true).eq("modulo", "porcion_terrestre").eq("hotel_id", v.hotelId)
  );
}

/**
 * Vista tabla → pestaña Paquetes/Salidas dinámicas: al elegir UNA salida
 * concreta (record de bloqueo o salida dinámica), trae su matriz completa
 * (todos los hoteles de esa salida). Ya viene acotada a un único id exacto —
 * es, por definición, el alcance completo visible (el usuario eligió esa
 * salida puntual entre las pastillas).
 */
export async function obtenerDetalleSalida(inputRaw: unknown): Promise<ResultadoDetalle> {
  const v = validarEntradaDetalleSalida(inputRaw);
  if (!v) return { ok: false, error: MSG_ERROR_DETALLE };

  if (v.modulo === "bloqueo") {
    return cargarDetalleAcotado("salida_bloqueo", (sb) =>
      sb.from("tarifario_resultado").select(COLUMNAS_DETALLE)
        .eq("paquete_activo", true).eq("modulo", "bloqueo").eq("bloqueo_id", v.bloqueoId)
    );
  }
  return cargarDetalleAcotado("salida_dinamica", (sb) =>
    sb.from("tarifario_resultado").select(COLUMNAS_DETALLE)
      .eq("paquete_activo", true).eq("modulo", "dinamico").eq("salida_id", v.salidaId)
  );
}

/** Vista tabla → pestaña Porción terrestre: al elegir UN paquete concreto. */
export async function obtenerDetallePaquete(inputRaw: unknown): Promise<ResultadoDetalle> {
  const v = validarEntradaDetallePaquete(inputRaw);
  if (!v) return { ok: false, error: MSG_ERROR_DETALLE };

  return cargarDetalleAcotado("paquete_porcion", (sb) =>
    sb.from("tarifario_resultado").select(COLUMNAS_DETALLE)
      .eq("paquete_activo", true).eq("modulo", "porcion_terrestre").eq("paquete_id", v.paqueteId)
  );
}

/**
 * Vista tabla → pestaña Servicios: el catálogo completo de servicios
 * (escalas por rango de pax, descripción, recargo individual) — acotado por
 * módulo, NUNCA junto a la matriz de hoteles. Mismo recorte que ya aplicaba
 * `cargarDatosTarifario()`: solo paquetes de tipo 'servicios' (los servicios
 * "add-on" de un paquete de hotel no se publican como producto suelto).
 */
export async function obtenerDetalleServicios(): Promise<ResultadoDetalle> {
  const flujoId = generarFlujoId();
  const t0 = performance.now();
  const ad = admin();
  const sb = await createClient();
  const { data, error } = await sb.from("tarifario_resultado").select(COLUMNAS_DETALLE)
    .eq("paquete_activo", true).eq("modulo", "servicios");
  if (error) {
    registrarEtapa(FLUJO, flujoId, "detalle_tarifas", Math.round(performance.now() - t0), "error");
    registrarErrorTecnico(FLUJO, flujoId, "detalle_tarifas", "error_consulta_servicios", error);
    return { ok: false, error: MSG_ERROR_DETALLE };
  }
  const filas = (data ?? []) as unknown as FilaTarifario[];
  if (ad == null) {
    // El recorte "solo paquetes tipo servicios" necesita service-role
    // (`armado_paquetes`) — sin ella no se puede verificar qué paquetes son
    // realmente 'servicios' vs. add-ons de otro tipo de paquete. Error de
    // configuración, nunca "no hay servicios publicados".
    registrarEtapa(FLUJO, flujoId, "detalle_tarifas", Math.round(performance.now() - t0), "error");
    registrarErrorTecnico(FLUJO, flujoId, "detalle_tarifas", "error_config_service_role_faltante_servicios", null);
    return { ok: false, error: MSG_ERROR_DETALLE };
  }
  let filasFiltradas = filas;
  if (filas.length) {
    const { data: pkgs, error: pkgsError } = await ad.from("armado_paquetes").select("id").eq("tipo", "servicios");
    if (pkgsError) {
      registrarEtapa(FLUJO, flujoId, "detalle_tarifas", Math.round(performance.now() - t0), "error");
      registrarErrorTecnico(FLUJO, flujoId, "detalle_tarifas", "error_consulta_armado_paquetes_servicios", pkgsError);
      return { ok: false, error: MSG_ERROR_DETALLE };
    }
    const ids = new Set((pkgs ?? []).map((p) => p.id));
    filasFiltradas = filas.filter((f) => f.paquete_id != null && ids.has(f.paquete_id));
  }
  const res = await aplicarFiltrosPostCarga(ad, filasFiltradas);
  if (res.errorVigencia || res.errorEmpaquetado) {
    if (res.errorVigencia) registrarErrorTecnico(FLUJO, flujoId, "detalle_tarifas", "error_vigencia_servicios", res.errorVigencia);
    if (res.errorEmpaquetado) registrarErrorTecnico(FLUJO, flujoId, "detalle_tarifas", "error_empaquetados_servicios", res.errorEmpaquetado);
    registrarEtapa(FLUJO, flujoId, "detalle_tarifas", Math.round(performance.now() - t0), "error");
    return { ok: false, error: MSG_ERROR_DETALLE };
  }
  registrarEtapa(FLUJO, flujoId, "detalle_tarifas", Math.round(performance.now() - t0), "ok");
  registrarDatoPagina(FLUJO, flujoId, "detalle_tarifas", `alcance=servicios filas_detalle=${res.filas.length}`);
  return { ok: true, filas: res.filas };
}
