import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AcomConfig } from "@/lib/acomodaciones";
import { createAdminClient } from "../supabase/admin.ts";
import { aplicarFiltrosPostCarga } from "./filtrosPostCarga.ts";
import { esFilaHotelVerificable } from "./vigencia.ts";
import { registrarEtapa, registrarDatoPagina, registrarErrorTecnico, medirPayloadSiHabilitado, textoEstimacionPayload } from "../observabilidad/medicion.ts";
import type { InfoHotelDato, CapHotelDato } from "./datos.ts";
import { condicionHotelFechas, type FilaTemporadaHotelRaw } from "../reservar/liquidacionHotel.ts";
import { esNeutra } from "../cotizacion/condicionPago.ts";

// ── Resumen del tarifario: carga inicial LIVIANA (dos niveles) ─────────────
//
// Rondas anteriores (compresión de payload, luego paginación con rediseño
// visual, luego esta MISMA vista pero re-expandida a filas sintéticas antes
// de transportarla) fueron rechazadas por el dueño — ninguna atacaba la
// causa real: `cargarDatosTarifario()` (lib/tarifario/datos.ts) trae SIEMPRE
// la matriz completa hotel × categoría × régimen × acomodación (~17.197
// filas, ~15.876 vigentes) para pintar ~58 tarjetas de hotel que solo
// necesitan un precio "desde".
//
// ⚠️ Corrección de esta ronda: la versión anterior de este archivo llamaba
// `expandirResumenAFilas()` ANTES de devolver `filasVisibles`/`filasAddon` —
// es decir, volvía a MULTIPLICAR cada fila de resumen en hasta 4 filas
// sintéticas (una por acomodación de adulto con precio) antes de que el
// Server Component las pasara como prop al cliente. Eso deshacía el
// beneficio real de la vista: el payload transportado seguía creciendo con
// la cardinalidad de acomodación, no con la de hoteles/salidas. AHORA este
// módulo transporta el DTO de resumen (`FilaResumen[]`) TAL CUAL — sin
// expandir — y son `TarifarioPublic.tsx`/`VistaBooking.tsx` quienes
// construyen tarjetas/filtros/salidas directamente sobre `FilaResumen`
// (tienen exactamente los campos que necesitan: modulo/categoria/regimen/
// hotel_nombre/paquete_nombre/servicio_nombre para filtros y tabs, y
// precio_sencilla/doble/triple/multiple/nino/nino2/infante/desde_adulto/
// desde_general para las tarjetas — nunca la matriz expandida).
//
// La matriz COMPLETA (con descripción/recargo/escalas, y con cada fila real
// de `tarifario_resultado`, incluidas niño/niño2/infante) solo se consulta
// bajo demanda — ver app/tarifario/detalle-actions.ts, llamado al abrir un
// hotel (VistaBooking "Ver opciones"), al elegir una salida en Vista tabla,
// o al entrar a la pestaña Servicios. Un `FilaTarifario` (el tipo de fila
// completa, definido en TarifarioPublic.tsx) solo puede existir en la app
// como resultado de una de esas 4 Server Actions — nunca sintetizado aquí.
//
// ⚠️ Este archivo REPITE deliberadamente el bloque de enriquecimiento
// (fotos/info/capacidades de hotel, fotos/planes, ventana de viaje,
// "incluye") que ya existe en `cargarDatosTarifario()` — la misma decisión
// que ya toma `lib/tarifario/paginacion.ts` frente a `/dashboard/tarifario`
// ("reusar cargarDatosTarifario() ahí aumentaría sus consultas... sin
// necesidad"): refactorizar esa función (ya cubierta por
// `pruebas/tarifarioDatos.test.ts` y por la revisión de seguridad que
// corrigió sus 2 defectos de "resultados ok falsos") para compartir código
// con esta ronda nueva es más riesgo del que vale la pena — son ~35 líneas,
// estables, sin lógica de negocio propia (son las MISMAS 7 consultas de
// siempre, solo que ahora alimentadas por menos ids). Si cambia el
// enriquecimiento de Vista Booking, hay que actualizar los DOS lugares — el
// próximo que toque esto debería evaluar extraerlo a un helper compartido.

const COLUMNAS_RESUMEN =
  "modulo, paquete_id, paquete_nombre, bloqueo_id, bloqueo_label, empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre, destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda, precio_sencilla, precio_doble, precio_triple, precio_multiple, precio_nino, precio_nino2, precio_infante, desde_adulto, desde_general, descripcion, recargo_individual, tipo_tarifa";

export type FilaResumen = {
  modulo: "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";
  paquete_id: number;
  paquete_nombre: string | null;
  bloqueo_id: number | null;
  bloqueo_label: string | null;
  empaquetado_id: number | null;
  salida_id: number | null;
  hotel_id: number | null;
  hotel_nombre: string | null;
  servicio_id: number | null;
  servicio_nombre: string | null;
  destino_id: number | null;
  destino_nombre: string | null;
  categoria: string | null;
  regimen: string | null;
  fecha_ida: string | null;
  fecha_regreso: string | null;
  noches: number | null;
  moneda: string | null;
  precio_sencilla: number | null;
  precio_doble: number | null;
  precio_triple: number | null;
  precio_multiple: number | null;
  // Chd1/Chd2/infante — nunca entran al "desde" (ver desde_adulto), pero SÍ
  // deben viajar en el resumen: los filtros de acomodación Chd1/Chd2 de
  // VistaBooking/TarifarioPublic dependen de saber, YA en la carga inicial,
  // qué hoteles ofrecen niño/niño2 (sin esto, ese filtro no puede funcionar
  // sin pedir el detalle completo de cada hotel — exactamente lo que la
  // carga en dos niveles busca evitar).
  precio_nino: number | null;
  precio_nino2: number | null;
  precio_infante: number | null;
  desde_adulto: number | null;
  desde_general: number | null;
  descripcion: string | null;
  recargo_individual: number | null;
  tipo_tarifa: string | null;
};

const PAGE = 1000;

// Guardia explícita contra falta de progreso: un límite duro de páginas para
// que un backend que nunca entregue una página vacía (bug de PostgREST, proxy
// mal configurado, o un dataset que de verdad mutara bajo los pies de la
// paginación) no deje el loop corriendo indefinidamente. 500 páginas × 1000
// filas = 500.000 filas — muy por encima de cualquier catálogo real de
// `tarifario_resumen` (magnitud esperada: decenas a pocos miles). Si algún día
// se llega a este límite de verdad, es una señal de que algo está mal, no que
// el catálogo creció — por eso se falla cerrado (ok:false) en vez de devolver
// una página parcial disfrazada de catálogo completo.
const MAX_PAGINAS = 500;

// Orden total y determinista: TODAS las columnas no-constantes del `group by`
// de la vista (migración 162), salvo `paquete_activo` (siempre `true` por el
// `where` de la vista — no discrimina nada, así que no aporta al orden). Con
// esto cada fila tiene una posición única e inequívoca en el orden — condición
// necesaria para paginar con `.range()` sin perder ni duplicar filas por
// empates. Ordenar solo por un subconjunto (como hacía la versión anterior:
// destino/bloqueo/hotel/categoría/régimen) permite empates entre filas — dos
// páginas consecutivas podrían solaparse o saltarse filas empatadas si
// Postgres decide un orden distinto de desempate entre una consulta y la
// siguiente.
const ORDEN_TOTAL_RESUMEN = [
  "modulo", "paquete_id", "paquete_nombre", "bloqueo_id", "bloqueo_label",
  "empaquetado_id", "salida_id", "hotel_id", "hotel_nombre", "servicio_id",
  "servicio_nombre", "destino_id", "destino_nombre", "categoria", "regimen",
  "fecha_ida", "fecha_regreso", "noches", "moneda",
] as const;

export type ResultadoResumenPaginado =
  | { ok: true; filas: FilaResumen[]; paginasConsultadas: number }
  | { ok: false; paginasConsultadas: number; error: unknown };

/**
 * Carga TODAS las filas de `tarifario_resumen`, paginando de a 1000.
 *
 * ⚠️ Revisión posterior — defecto "PAGINACIÓN NO ROBUSTA" confirmado: la
 * versión anterior terminaba con `page.length < PAGE` y avanzaba `from` por
 * el tamaño de página FIJO. Ambas cosas son incorrectas contra PostgREST: el
 * límite "Max Rows" del proyecto puede recortar la respuesta a MENOS filas de
 * las pedidas por `.range()` aunque queden más filas después — ese recorte no
 * es "ya no hay más", es "el servidor decidió no mandar todas las que pedí
 * esta vez". Terminar con `page.length < PAGE` cortaba el catálogo a mitad de
 * camino; avanzar por `PAGE` fijo entonces SALTABA las filas que ese recorte
 * dejó sin traer. Ahora: (1) el orden es TOTAL y determinista (ver
 * `ORDEN_TOTAL_RESUMEN`), (2) `from` avanza por la cantidad REAL de filas
 * recibidas en cada página, nunca por `PAGE`, y (3) la ÚNICA condición de
 * término es una página vacía — un recorte del servidor simplemente resulta
 * en más páginas, nunca en filas perdidas o saltadas. Ver
 * `pruebas/tarifarioResumen.test.ts` (servidor simulado que nunca entrega más
 * de 2 filas por pedido, más de 3 páginas, con claves que empatarían bajo el
 * orden anterior de 5 columnas).
 */
export async function cargarFilasResumenPaginado(
  sb: SupabaseClient<Database>
): Promise<ResultadoResumenPaginado> {
  const filas: FilaResumen[] = [];
  let from = 0;
  let paginasConsultadas = 0;
  for (;;) {
    if (paginasConsultadas >= MAX_PAGINAS) {
      return {
        ok: false,
        paginasConsultadas,
        error: new Error(
          `cargarFilasResumenPaginado: se alcanzó el límite de ${MAX_PAGINAS} páginas sin recibir una página vacía — posible falta de progreso (backend que nunca termina) en vez de un catálogo real de ese tamaño.`
        ),
      };
    }
    let q = sb.from("tarifario_resumen").select(COLUMNAS_RESUMEN);
    for (const col of ORDEN_TOTAL_RESUMEN) q = q.order(col);
    const { data: page, error } = await q.range(from, from + PAGE - 1);
    paginasConsultadas++;
    if (error) return { ok: false, paginasConsultadas, error };
    if (!page || page.length === 0) break;
    filas.push(...(page as unknown as FilaResumen[]));
    // Avanzar por la cantidad REAL recibida — nunca por `PAGE` fijo (ver nota
    // larga arriba). Si el servidor recortó la página, la próxima consulta
    // sigue exactamente donde esta se quedó, sin saltar filas.
    from += page.length;
  }
  return { ok: true, filas, paginasConsultadas };
}

export type DatosResumenTarifario = {
  filasVisibles: FilaResumen[];
  filasAddon: FilaResumen[];
  cuposPorBloqueo: Record<number, number>;
  origenPorBloqueo: Record<number, string>;
  fotosPorHotel: Record<number, string>;
  fotosPorServicio: Record<number, string>;
  infoPorHotel: Record<number, InfoHotelDato>;
  capPorHotel: Record<number, CapHotelDato>;
  planesInfo: Record<string, { nombre: string | null; descripcion: string | null; nota_especial: string | null }>;
  ventanaPorPaquete: Record<number, { min: string | null; max: string | null }>;
  incluidosPorPaquete: Record<number, string[]>;
};

export const MSG_ERROR_CARGAR_TARIFARIO = "No fue posible cargar el tarifario en este momento. Intenta nuevamente en unos segundos.";

export type ResultadoResumenTarifario =
  | { ok: true; datos: DatosResumenTarifario }
  | { ok: false; error: string };

/**
 * Equivalente de `cargarDatosTarifario()` (lib/tarifario/datos.ts) pero
 * partiendo de `tarifario_resumen` en vez de `tarifario_resultado` paginado
 * completo. Misma vigencia, mismos cupos/orígenes, mismo enriquecimiento de
 * Vista Booking — la única diferencia es CUÁNTAS filas viajan del servidor
 * al cliente en la carga inicial. Devuelve `FilaResumen[]` SIN expandir (ver
 * nota larga arriba) — las páginas y componentes existentes leen
 * directamente sobre esas filas de resumen; la matriz completa por
 * acomodación solo llega vía `app/tarifario/detalle-actions.ts`.
 */
export async function cargarResumenTarifario(
  sb: SupabaseClient<Database>, flujo: string, flujoId: string,
  admin: SupabaseClient<Database> | null = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null
): Promise<ResultadoResumenTarifario> {
  const _tResumen0 = performance.now();
  const pag = await cargarFilasResumenPaginado(sb);
  if (!pag.ok) {
    registrarEtapa(flujo, flujoId, "resumen_inicial", Math.round(performance.now() - _tResumen0), "error");
    registrarErrorTecnico(flujo, flujoId, "resumen_inicial", "error_carga_tarifario_resumen", pag.error);
    return { ok: false, error: MSG_ERROR_CARGAR_TARIFARIO };
  }
  let filas = pag.filas;
  // ⚠️ Falla cerrada de verdad (ronda 6, ítem 3): si hay filas de hotel
  // VERIFICABLES (bloqueo/porción con hotel_id + fecha_ida — la misma
  // condición que usa `filtrarTarifarioVencidas`) pero falta el cliente
  // service-role, no hay forma de confirmar su vigencia de compra. La
  // versión anterior dejaba que `aplicarFiltrosPostCarga(null, filas)`
  // simplemente SALTARA la verificación (`if (admin) {...}`) y devolviera
  // `ok:true` con lo que quedara — un catálogo parcial disfrazado de
  // disponibilidad válida. Esto NUNCA debería pasar en producción (Vercel
  // siempre tiene `SUPABASE_SERVICE_ROLE_KEY`), pero si algún día falta, es
  // preferible fallar cerrado a publicar precios sin poder garantizar que
  // siguen vigentes.
  const faltaServiceRoleConHotelVerificable = !admin && filas.some(esFilaHotelVerificable);
  registrarEtapa(
    flujo, flujoId, "resumen_inicial", Math.round(performance.now() - _tResumen0),
    faltaServiceRoleConHotelVerificable ? "error" : "ok"
  );
  // `filas_resumen_db`: lo que la vista devolvió CRUDO (antes de vigencia/
  // hoy-fecha/empaquetados) — la magnitud que debe acercarse a
  // "hoteles/salidas", nunca a las ~17.197 filas de `tarifario_resultado`.
  registrarDatoPagina(flujo, flujoId, "resumen_inicial", `filas_resumen_db=${filas.length} paginas=${pag.paginasConsultadas} consultas_iniciales=${pag.paginasConsultadas}`);
  if (faltaServiceRoleConHotelVerificable) {
    registrarErrorTecnico(
      flujo, flujoId, "resumen_inicial", "error_falta_service_role_con_filas_hotel_verificables",
      new Error("SUPABASE_SERVICE_ROLE_KEY no configurada y el resumen trae filas de hotel verificables — no se puede confirmar su vigencia de compra.")
    );
    return { ok: false, error: MSG_ERROR_CARGAR_TARIFARIO };
  }

  const _tAux0 = performance.now();
  let _huboErrorAux = false;

  const cuposPorBloqueo: Record<number, number> = {};
  const origenPorBloqueo: Record<number, string> = {};
  const bloqueoIds = [...new Set(
    filas.filter((f) => f.modulo === "bloqueo" && f.bloqueo_id != null).map((f) => f.bloqueo_id as number)
  )];

  const huboVigencia = admin != null;
  const [resCupos, resFiltros] = await Promise.all([
    (async () => {
      if (!bloqueoIds.length || !admin) return null;
      const [{ data: cup, error: e1 }, { data: blo, error: e2 }] = await Promise.all([
        admin.from("cupos_por_bloqueo").select("id, cupos_disponibles").in("id", bloqueoIds),
        admin.from("bloqueos_vuelo").select("id, origen, ruta").in("id", bloqueoIds),
      ]);
      return { cup, blo, e1, e2 };
    })(),
    // Vigencia (hotel_temporadas/tarifa_hotel) + salidas ya pasadas +
    // empaquetados desactivados/vencidos — factorizado en
    // lib/tarifario/filtrosPostCarga.ts, compartido con app/tarifario/
    // detalle-actions.ts (Tier 2) para que ninguno de los dos publique una
    // tarifa que el otro ya sabría inválida.
    aplicarFiltrosPostCarga(admin, filas),
  ]);

  if (resCupos) {
    if (resCupos.e1) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_cupos_por_bloqueo", resCupos.e1);
    } else {
      for (const c of resCupos.cup ?? []) cuposPorBloqueo[c.id as number] = Number(c.cupos_disponibles) || 0;
    }
    if (resCupos.e2) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_bloqueos_vuelo_origen", resCupos.e2);
    } else {
      for (const b of resCupos.blo ?? []) {
        const ori = (b.origen ?? "").trim() || (b.ruta ? b.ruta.split("-")[0].trim() : "");
        if (ori) origenPorBloqueo[b.id as number] = ori.toUpperCase();
      }
    }
  }

  filas = resFiltros.filas;
  // ⚠️ Falla cerrada de verdad (ronda 6, ítem 3 — endurece la revisión
  // anterior): un error TÉCNICO al verificar vigencia/empaquetados NUNCA
  // debe quedar registrado como "sin disponibilidad", NI devolverse como
  // `ok:true` con un catálogo parcial. La revisión anterior ya corrigió el
  // LOG (marcaba `resultado=error` en la etapa en vez de "ok"), pero seguía
  // devolviendo `ok:true` a la página con lo que quedara — un catálogo
  // incompleto que el cliente no podía distinguir de "esto es todo lo que
  // hay disponible". Ahora la función entera falla cerrada: nunca entrega
  // catálogo parcial como disponibilidad válida para /tarifario ni
  // /dashboard/reservar.
  const huboErrorFiltros = !!(resFiltros.errorVigencia || resFiltros.errorEmpaquetado);
  if (resFiltros.errorVigencia) {
    registrarErrorTecnico(flujo, flujoId, "filtro_vigencia", "error_hotel_temporadas_o_tarifa_hotel", resFiltros.errorVigencia);
  }
  if (resFiltros.errorEmpaquetado) {
    _huboErrorAux = true;
    registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_consulta_empaquetados_vigencia", resFiltros.errorEmpaquetado);
  }
  registrarEtapa(flujo, flujoId, "filtro_vigencia", Math.round(performance.now() - _tAux0), huboErrorFiltros ? "error" : "ok");
  registrarDatoPagina(flujo, flujoId, "filtro_vigencia", `filas=${filas.length} consultas=${huboVigencia ? 2 : 0}`);
  if (huboErrorFiltros) {
    return { ok: false, error: MSG_ERROR_CARGAR_TARIFARIO };
  }

  let filasVisibles = filas;
  if (admin && filas.some((f) => f.modulo === "servicios")) {
    const { data: pkgs, error: pkgsError } = await admin.from("armado_paquetes").select("id").eq("tipo", "servicios");
    if (pkgsError) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_consulta_armado_paquetes_servicios", pkgsError);
    }
    const idsServicios = new Set((pkgsError ? [] : (pkgs ?? [])).map((p) => p.id));
    filasVisibles = filas.filter((f) => f.modulo !== "servicios" || (f.paquete_id != null && idsServicios.has(f.paquete_id)));
  }

  const filasAddon = filas.filter((f) => f.modulo === "servicios");

  const hotelIds = [...new Set(filasVisibles.filter((f) => f.hotel_id != null).map((f) => f.hotel_id as number))];
  const servicioIds = [...new Set(filasVisibles.filter((f) => f.servicio_id != null).map((f) => f.servicio_id as number))];
  const paqIdsPorcion = [...new Set(
    filasVisibles.filter((f) => f.modulo === "porcion_terrestre" && f.paquete_id != null).map((f) => f.paquete_id as number)
  )];
  const paqIdsConHotel = [...new Set(
    filasVisibles.filter((f) => (f.modulo === "bloqueo" || f.modulo === "porcion_terrestre") && f.paquete_id != null).map((f) => f.paquete_id as number)
  )];

  const fotosPorHotel: Record<number, string> = {};
  const infoPorHotel: Record<number, InfoHotelDato> = {};
  const capPorHotel: Record<number, CapHotelDato> = {};
  const fotosPorServicio: Record<number, string> = {};
  const planesInfo: Record<string, { nombre: string | null; descripcion: string | null; nota_especial: string | null }> = {};
  const ventanaPorPaquete: Record<number, { min: string | null; max: string | null }> = {};
  const incluidosPorPaquete: Record<number, string[]> = {};

  const [
    resFotosHotel, resHoteles, resAcomInfante, resFotosServicio, resPlanes, resVentana, resIncluidos, resCondicionHotel,
  ] = await Promise.all([
    hotelIds.length
      ? sb.from("hotel_fotos").select("hotel_id, url, es_portada, orden").in("hotel_id", hotelIds).order("orden")
      : null,
    hotelIds.length
      ? sb.from("hoteles").select("id, estrellas, clasificacion, descripcion, ubicacion, video_url, pax_min, pax_max, edad_nino_min, edad_nino_max, edad_infante_min, edad_infante_max, nino_nota, adults_only, pet_friendly, pet_costo_neto, pet_costo_desc, pet_nota").in("id", hotelIds)
      : null,
    hotelIds.length && admin
      ? (async () => {
          const [{ data: acs, error: e1 }, { data: tarInfante, error: e2 }] = await Promise.all([
            admin.from("hotel_acomodaciones").select("hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max").in("hotel_id", hotelIds),
            admin.from("tarifa_hotel").select("hotel_id, neto_infante, nota_infante").in("hotel_id", hotelIds),
          ]);
          return { acs, tarInfante, e1, e2 };
        })()
      : null,
    servicioIds.length
      ? sb.from("servicios_adicionales").select("id, foto_url").in("id", servicioIds)
      : null,
    sb.from("planes_alimentacion").select("codigo, nombre, descripcion, nota_especial"),
    paqIdsPorcion.length && admin
      ? admin.from("armado_paquetes").select("id, fecha_viaje_inicio, fecha_viaje_fin").in("id", paqIdsPorcion)
      : null,
    paqIdsConHotel.length && admin
      ? admin.from("armado_servicios").select("paquete_id, incluido, servicios_adicionales(nombre)").eq("incluido", true).in("paquete_id", paqIdsConHotel)
      : null,
    // Badge compacto "Con condiciones" de la tarjeta de exploración (migración
    // 164/165) — hotel_temporadas exige rol interno por RLS (migración 016),
    // de ahí `admin`. Puramente decorativo/informativo: un error acá NUNCA
    // bloquea el tarifario (mismo criterio que fotos/planes/ventana arriba),
    // solo deja el hotel sin el badge.
    hotelIds.length && admin
      ? admin.from("hotel_temporadas").select("hotel_id, id, nombre, fecha_inicio, fecha_fin, condicion_pago_tipo, condicion_pago_pct_inicial, condicion_pago_dias_saldo").in("hotel_id", hotelIds)
      : null,
  ]);

  if (resFotosHotel) {
    if (resFotosHotel.error) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_hotel_fotos", resFotosHotel.error);
    } else {
      for (const f of resFotosHotel.data ?? []) {
        if (fotosPorHotel[f.hotel_id] == null) fotosPorHotel[f.hotel_id] = f.url;
        if (f.es_portada) fotosPorHotel[f.hotel_id] = f.url;
      }
    }
  }

  if (resHoteles) {
    if (resHoteles.error) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_hoteles", resHoteles.error);
    } else {
      for (const h of resHoteles.data ?? []) {
        infoPorHotel[h.id] = { estrellas: h.estrellas, clasificacion: h.clasificacion, descripcion: h.descripcion, ubicacion: h.ubicacion, video_url: h.video_url, ninoMin: h.edad_nino_min, ninoMax: h.edad_nino_max, infMin: h.edad_infante_min, infMax: h.edad_infante_max, infanteCargo: false, infanteNota: null, ninoNota: h.nino_nota, adultsOnly: h.adults_only ?? false, petFriendly: h.pet_friendly ?? false, petCargo: (Number(h.pet_costo_neto) || 0) > 0, petCostoDesc: h.pet_costo_desc, petNota: h.pet_nota };
        capPorHotel[h.id] = { paxMin: h.pax_min, paxMax: h.pax_max, acom: [] };
      }
    }
  }

  if (resAcomInfante) {
    if (resAcomInfante.e1) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_hotel_acomodaciones", resAcomInfante.e1);
    } else {
      for (const a of resAcomInfante.acs ?? []) {
        const slot = (capPorHotel[a.hotel_id] ??= { paxMin: null, paxMax: null, acom: [] });
        slot.acom.push(a as unknown as AcomConfig);
      }
    }
    if (resAcomInfante.e2) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_tarifa_infante", resAcomInfante.e2);
    } else {
      for (const r of resAcomInfante.tarInfante ?? []) {
        const slot = infoPorHotel[r.hotel_id];
        if (!slot) continue;
        if ((Number(r.neto_infante) || 0) > 0) slot.infanteCargo = true;
        if (r.nota_infante && !slot.infanteNota) slot.infanteNota = r.nota_infante;
      }
    }
  }

  // Badge compacto "Con condiciones" de la tarjeta de exploración (VistaBooking,
  // "O explora todos los alojamientos"/"Hoteles disponibles") — reutiliza EL
  // MISMO resolver puro que ya alimenta el badge de resultado/modal/carrito
  // (`condicionHotelFechas`, PR #286), nunca un criterio nuevo. Puramente
  // informativo: un error acá solo deja el hotel sin el badge, nunca bloquea
  // el tarifario (mismo criterio que fotos/planes/ventana).
  //
  // Fechas: por hotel, se prueban TODOS los rangos [fecha_ida, fecha_regreso)
  // que ya traen las `FilaResumen` visibles de ese hotel — para bloqueo son
  // las salidas reales; para porción terrestre es el inicio/fin de la ventana
  // de viaje del paquete (el MISMO dato que esta tarjeta ya usa para calcular
  // el precio "desde") — nunca una fecha inventada. Si CUALQUIERA de esos
  // rangos resuelve a una condición no neutra o restringida, el hotel se
  // marca con el badge (no distingue categoría/régimen — misma limitación ya
  // documentada en `condicionHotelFechas`, lib/reservar/liquidacionHotel.ts).
  if (resCondicionHotel) {
    if (resCondicionHotel.error) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_hotel_temporadas_condicion", resCondicionHotel.error);
    } else {
      const temporadasPorHotel = new Map<number, FilaTemporadaHotelRaw[]>();
      for (const t of resCondicionHotel.data ?? []) {
        const arr = temporadasPorHotel.get(t.hotel_id) ?? [];
        arr.push({
          id: t.id, nombre: t.nombre, fecha_inicio: t.fecha_inicio, fecha_fin: t.fecha_fin,
          condicion_pago_tipo: t.condicion_pago_tipo,
          condicion_pago_pct_inicial: t.condicion_pago_pct_inicial,
          condicion_pago_dias_saldo: t.condicion_pago_dias_saldo,
        });
        temporadasPorHotel.set(t.hotel_id, arr);
      }
      const fechasPorHotel = new Map<number, Set<string>>();
      for (const f of filasVisibles) {
        if (f.hotel_id == null || !f.fecha_ida || !f.fecha_regreso) continue;
        const set = fechasPorHotel.get(f.hotel_id) ?? new Set<string>();
        set.add(`${f.fecha_ida}|${f.fecha_regreso}`);
        fechasPorHotel.set(f.hotel_id, set);
      }
      for (const [hotelId, temporadas] of temporadasPorHotel) {
        const slot = infoPorHotel[hotelId];
        if (!slot) continue;
        const rangos = fechasPorHotel.get(hotelId);
        if (!rangos) continue;
        for (const rango of rangos) {
          const [fechaIda, fechaRegreso] = rango.split("|");
          const cond = condicionHotelFechas(temporadas, { fechaIda, fechaRegreso });
          if (cond && (!esNeutra(cond.condicionPagoTipo) || cond.restringido)) {
            slot.tieneCondicion = true;
            break;
          }
        }
      }
    }
  }

  if (resFotosServicio) {
    if (resFotosServicio.error) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_servicios_adicionales_fotos", resFotosServicio.error);
    } else {
      for (const s of resFotosServicio.data ?? []) if (s.foto_url) fotosPorServicio[s.id] = s.foto_url;
    }
  }

  if (resPlanes.error) {
    _huboErrorAux = true;
    registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_planes_alimentacion", resPlanes.error);
  } else {
    for (const p of resPlanes.data ?? []) planesInfo[(p.codigo ?? "").trim().toUpperCase()] = { nombre: p.nombre, descripcion: p.descripcion, nota_especial: p.nota_especial };
  }

  if (resVentana) {
    if (resVentana.error) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_armado_paquetes_ventana", resVentana.error);
    } else {
      for (const p of resVentana.data ?? []) ventanaPorPaquete[p.id as number] = { min: p.fecha_viaje_inicio as string | null, max: p.fecha_viaje_fin as string | null };
    }
  }

  if (resIncluidos) {
    if (resIncluidos.error) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_armado_servicios_incluidos", resIncluidos.error);
    } else {
      for (const r of resIncluidos.data ?? []) {
        const nombre = (r as unknown as { servicios_adicionales: { nombre: string } | null }).servicios_adicionales?.nombre;
        if (!nombre) continue;
        (incluidosPorPaquete[r.paquete_id as number] ??= []).push(nombre);
      }
    }
  }

  const msAux = performance.now() - _tAux0;
  registrarEtapa(flujo, flujoId, "datos_auxiliares", Math.round(msAux), _huboErrorAux ? "error" : "ok");
  registrarDatoPagina(flujo, flujoId, "datos_auxiliares", `filas_visibles=${filasVisibles.length} filas_addon=${filasAddon.length}`);

  // `filas_entregadas_cliente` + `payload_inicial`: lo que de verdad viaja en
  // las props del Server Component — SIN expansión sintética (ver nota larga
  // arriba). El tamaño en bytes queda detrás de `DIAGNOSTICO_MEDIR_PAYLOAD=1`
  // (mismo criterio que el resto de la instrumentación de payload — nunca
  // paga el costo de serializar en producción por defecto).
  const filasEntregadasCliente = filasVisibles.length + filasAddon.length;
  const estPayload = medirPayloadSiHabilitado({ filasVisibles, filasAddon });
  registrarDatoPagina(flujo, flujoId, "payload_inicial", `filas_entregadas_cliente=${filasEntregadasCliente} ${textoEstimacionPayload(estPayload)}`);

  return {
    ok: true,
    datos: {
      filasVisibles, filasAddon,
      cuposPorBloqueo, origenPorBloqueo, fotosPorHotel, fotosPorServicio,
      infoPorHotel, capPorHotel, planesInfo, ventanaPorPaquete, incluidosPorPaquete,
    },
  };
}
