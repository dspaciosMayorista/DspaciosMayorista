"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aplicarFiltrosPostCarga } from "@/lib/tarifario/filtrosPostCarga";
import { esFilaHotelVerificable } from "@/lib/tarifario/vigencia";
import { validarEntradaDetalleHotel, validarEntradaDetalleSalida, validarEntradaDetallePaquete } from "@/lib/tarifario/detalleValidacion";
import { filtrarPorCombos, type ComboIdentidad } from "@/lib/tarifario/comboKey";
import { ejecutarConsultaPaginada } from "@/lib/tarifario/paginacion";
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
//   · ⚠️ Ronda 6, ítem 2 — las 3 acciones que acotan por un id estructural
//     (`obtenerDetalleHotel`/`obtenerDetalleSalida`/`obtenerDetallePaquete`)
//     EXIGEN además `combos: ComboIdentidad[]` — el alcance de COMBOS
//     (módulo/paquete/bloqueo/salida/hotel/categoría/régimen/fechas/moneda,
//     ver lib/tarifario/comboKey.ts) actualmente visible bajo CUALQUIER
//     filtro activo del cliente (búsqueda de texto, categoría, régimen,
//     origen/destino/una salida puntual). La ronda anterior solo exigía
//     `bloqueoIds` (ids estructurales) para `obtenerDetalleHotel({modulo:
//     "bloqueo"})` — cubría origen/destino/salida, pero NO categoría/
//     régimen/búsqueda, ni el módulo `porcion_terrestre`, ni Vista tabla
//     (Salidas/Paquetes). Ahora las 3 acciones post-filtran las filas que
//     trajeron de `tarifario_resultado` contra ese alcance ANTES de
//     devolverlas (`filtrarPorCombos`, abajo) — el alcance declarado por el
//     cliente es la fuente AUTORITATIVA de qué combos son válidos, no solo
//     un hint de optimización del `.in(...)` de la consulta. `combos` puede
//     ser un array vacío (alcance vacío: "sin opciones", nunca "todo el
//     hotel/salida/paquete" como fallback). Ver
//     lib/tarifario/detalleValidacion.ts.
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
 * "Sin opciones bajo el alcance actual" — respuesta compartida por las 3
 * acciones acotadas por combos cuando el cliente declara `combos: []` (el
 * filtro activo no deja ningún combo visible). Nunca cae a "todo el
 * hotel/salida/paquete" como fallback — ver la nota larga de arriba.
 */
function alcanceVacio(etapa: string): ResultadoDetalle {
  const flujoId = generarFlujoId();
  registrarEtapa(FLUJO, flujoId, "detalle_tarifas", 0, "ok");
  registrarDatoPagina(FLUJO, flujoId, "detalle_tarifas", `alcance=${etapa} filas_detalle=0 motivo=alcance_vacio`);
  return { ok: true, filas: [] };
}

/**
 * Ejecuta la consulta acotada dada, aplica los mismos filtros de vigencia/
 * empaquetados que ya aplicó el resumen (Tier 1), post-filtra por el alcance
 * de `combos` (cuando se pasa — ronda 6, ítem 2: el allow-list del cliente
 * es la fuente AUTORITATIVA, no solo un hint de la consulta SQL) y devuelve
 * el resultado saneado. Punto único para las 4 acciones de abajo — evita
 * repetir el manejo de error/instrumentación 4 veces.
 */
async function cargarDetalleAcotado(
  etapa: string,
  // `PromiseLike`, no `Promise`: los query builders de Supabase
  // (`sb.from(...).select(...).eq(...)`) son "thenables" pero no Promise
  // reales (no implementan `catch`/`finally`) — mismo motivo documentado en
  // `Medidor` (lib/observabilidad/medicion.ts).
  ejecutar: (sb: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ data: unknown; error: unknown }>,
  combos?: ComboIdentidad[]
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
  const filasFinal = combos ? filtrarPorCombos(res.filas, combos) : res.filas;
  registrarEtapa(FLUJO, flujoId, "detalle_tarifas", Math.round(performance.now() - t0), "ok");
  registrarDatoPagina(
    FLUJO, flujoId, "detalle_tarifas",
    `alcance=${etapa} filas_detalle=${filasFinal.length}${combos ? ` filas_antes_de_combos=${res.filas.length} combos_permitidos=${combos.length}` : ""}`
  );
  return { ok: true, filas: filasFinal };
}

/**
 * "Ver opciones" de un hotel en Vista Booking — acotado por (módulo, hotel) y
 * por el ALCANCE de `combos` actualmente visible bajo CUALQUIER filtro activo
 * (búsqueda, categoría, régimen, y para `modulo:"bloqueo"` también origen/
 * destino/salida — obligatorio para AMBOS módulos, ver
 * `validarEntradaDetalleHotel`). `bloqueoIds`/`paqueteIds` se derivan de
 * `combos` SOLO como hint de la consulta SQL (reduce cuánto trae Supabase);
 * la corrección real la da `filtrarPorCombos` dentro de
 * `cargarDetalleAcotado`, que post-filtra contra el alcance declarado.
 */
export async function obtenerDetalleHotel(inputRaw: unknown): Promise<ResultadoDetalle> {
  const v = validarEntradaDetalleHotel(inputRaw);
  if (!v) return { ok: false, error: MSG_ERROR_DETALLE };

  // Alcance vacío: el filtro activo no deja ningún combo visible para este
  // hotel — el resultado correcto es "sin opciones", nunca "todo el hotel"
  // como fallback (eso rompería el alcance que el usuario ve).
  if (v.combos.length === 0) return alcanceVacio("hotel");

  if (v.modulo === "bloqueo") {
    const bloqueoIds = [...new Set(v.combos.map((c) => c.bloqueo_id).filter((x): x is number => x != null))];
    return cargarDetalleAcotado(
      "hotel",
      (sb) => {
        let q = sb.from("tarifario_resultado").select(COLUMNAS_DETALLE)
          .eq("paquete_activo", true).eq("modulo", "bloqueo").eq("hotel_id", v.hotelId);
        if (bloqueoIds.length) q = q.in("bloqueo_id", bloqueoIds);
        return q;
      },
      v.combos
    );
  }
  const paqueteIds = [...new Set(v.combos.map((c) => c.paquete_id).filter((x): x is number => x != null))];
  return cargarDetalleAcotado(
    "hotel",
    (sb) => {
      let q = sb.from("tarifario_resultado").select(COLUMNAS_DETALLE)
        .eq("paquete_activo", true).eq("modulo", "porcion_terrestre").eq("hotel_id", v.hotelId);
      if (paqueteIds.length) q = q.in("paquete_id", paqueteIds);
      return q;
    },
    v.combos
  );
}

/**
 * Vista tabla → pestaña Paquetes/Salidas dinámicas: al elegir UNA salida
 * concreta (record de bloqueo o salida dinámica), trae su matriz completa —
 * pero acotada por `combos` (obligatorio): el id estructural identifica QUÉ
 * salida abrir, `combos` acota además a qué hoteles/categorías/regímenes
 * dentro de esa salida el filtro activo (búsqueda/categoría/régimen) deja
 * visibles.
 */
export async function obtenerDetalleSalida(inputRaw: unknown): Promise<ResultadoDetalle> {
  const v = validarEntradaDetalleSalida(inputRaw);
  if (!v) return { ok: false, error: MSG_ERROR_DETALLE };
  if (v.combos.length === 0) return alcanceVacio("salida");

  if (v.modulo === "bloqueo") {
    return cargarDetalleAcotado(
      "salida_bloqueo",
      (sb) => sb.from("tarifario_resultado").select(COLUMNAS_DETALLE)
        .eq("paquete_activo", true).eq("modulo", "bloqueo").eq("bloqueo_id", v.bloqueoId),
      v.combos
    );
  }
  return cargarDetalleAcotado(
    "salida_dinamica",
    (sb) => sb.from("tarifario_resultado").select(COLUMNAS_DETALLE)
      .eq("paquete_activo", true).eq("modulo", "dinamico").eq("salida_id", v.salidaId),
    v.combos
  );
}

/**
 * Vista tabla → pestaña Porción terrestre: al elegir UN paquete concreto,
 * acotado además por `combos` (obligatorio) — mismo criterio que
 * `obtenerDetalleSalida`.
 */
export async function obtenerDetallePaquete(inputRaw: unknown): Promise<ResultadoDetalle> {
  const v = validarEntradaDetallePaquete(inputRaw);
  if (!v) return { ok: false, error: MSG_ERROR_DETALLE };
  if (v.combos.length === 0) return alcanceVacio("paquete");

  return cargarDetalleAcotado(
    "paquete_porcion",
    (sb) => sb.from("tarifario_resultado").select(COLUMNAS_DETALLE)
      .eq("paquete_activo", true).eq("modulo", "porcion_terrestre").eq("paquete_id", v.paqueteId),
    v.combos
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
  // Paginado robusto (ronda posterior — incidente "RECEPTIVOS ADZ", causa
  // raíz confirmada del segundo síntoma): a diferencia de las otras 3
  // acciones de este archivo, esta NO acota por hotel/bloqueo/salida/paquete
  // puntual — trae el catálogo COMPLETO de `modulo='servicios'`, así que con
  // el catálogo real (~16.000 filas en tarifario_resultado) puede superar el
  // límite "Max Rows" del proyecto. Un `.select()` sin `.range()` lo trunca
  // EN SILENCIO (sin `error`) — un servicio recién publicado podía quedar
  // fuera de la pestaña "Servicios" del tarifario público sin ningún aviso.
  // Ver lib/tarifario/paginacion.ts (`ejecutarConsultaPaginada`).
  const { data, error } = await ejecutarConsultaPaginada<FilaTarifario>((from, hasta) =>
    sb.from("tarifario_resultado").select(COLUMNAS_DETALLE)
      .eq("paquete_activo", true).eq("modulo", "servicios")
      .order("id").range(from, hasta)
  );
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
