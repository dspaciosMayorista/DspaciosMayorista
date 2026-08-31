import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { FilaTarifario } from "@/app/tarifario/TarifarioPublic";
import type { AcomConfig } from "@/lib/acomodaciones";
import { createAdminClient } from "../supabase/admin.ts";
import { aplicarFiltrosPostCarga } from "./filtrosPostCarga.ts";
import { registrarEtapa, registrarDatoPagina, registrarErrorTecnico } from "../observabilidad/medicion.ts";
import type { InfoHotelDato, CapHotelDato } from "./datos.ts";

// ── Resumen del tarifario: carga inicial LIVIANA (dos niveles) ─────────────
//
// Rondas anteriores (compresión de payload, luego paginación con rediseño
// visual) fueron rechazadas por el dueño — ninguna atacaba la causa real:
// `cargarDatosTarifario()` (lib/tarifario/datos.ts) trae SIEMPRE la matriz
// completa hotel × categoría × régimen × acomodación (~17.197 filas, ~15.876
// vigentes) para pintar ~58 tarjetas de hotel que solo necesitan un precio
// "desde". Este módulo carga en su lugar `tarifario_resumen` (migración 161,
// vista agregada — colapsa ÚNICAMENTE la dimensión acomodación, ver el
// comentario largo en esa migración sobre por qué no colapsa también
// categoría/régimen: la vigencia de compra se verifica por hotel+categoría+
// régimen y esa lógica vive en TypeScript, no en SQL).
//
// La matriz COMPLETA (con niño/niño2/infante, descripción, recargo, escalas)
// solo se consulta bajo demanda — ver app/tarifario/detalle-actions.ts,
// llamado al abrir un hotel (VistaBooking "Ver opciones"), al elegir una
// salida en Vista tabla, o al entrar a la pestaña Servicios.
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
  "modulo, paquete_id, paquete_nombre, bloqueo_id, bloqueo_label, empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre, destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda, precio_sencilla, precio_doble, precio_triple, precio_multiple, desde_adulto, desde_general, descripcion, recargo_individual, tipo_tarifa";

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
  desde_adulto: number | null;
  desde_general: number | null;
  descripcion: string | null;
  recargo_individual: number | null;
  tipo_tarifa: string | null;
};

const PAGE = 1000;

export type ResultadoResumenPaginado =
  | { ok: true; filas: FilaResumen[]; paginasConsultadas: number }
  | { ok: false; paginasConsultadas: number; error: unknown };

/**
 * Carga TODAS las filas de `tarifario_resumen`, paginando de a 1000 (mismo
 * límite/patrón que `cargarFilasTarifarioPaginado`). En la práctica esto casi
 * siempre entra en UNA sola página — el resumen ya no tiene la cardinalidad
 * de acomodación — pero se pagina igual por robustez ante catálogos grandes.
 */
export async function cargarFilasResumenPaginado(
  sb: SupabaseClient<Database>
): Promise<ResultadoResumenPaginado> {
  const filas: FilaResumen[] = [];
  let paginasConsultadas = 0;
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await sb
      .from("tarifario_resumen")
      .select(COLUMNAS_RESUMEN)
      .order("destino_nombre")
      .order("bloqueo_label")
      .order("hotel_nombre")
      .order("categoria")
      .order("regimen")
      .range(from, from + PAGE - 1);
    paginasConsultadas++;
    if (error) return { ok: false, paginasConsultadas, error };
    if (!page || page.length === 0) break;
    filas.push(...(page as unknown as FilaResumen[]));
    if (page.length < PAGE) break;
  }
  return { ok: true, filas, paginasConsultadas };
}

// Acomodaciones de adulto (mismo orden que ACOM_ROOMS en lib/acomodaciones.ts).
const PRECIO_ACOM: [string, keyof FilaResumen][] = [
  ["sencilla", "precio_sencilla"],
  ["doble", "precio_doble"],
  ["triple", "precio_triple"],
  ["multiple", "precio_multiple"],
];

/**
 * Expande el resumen a filas `FilaTarifario` SINTÉTICAS — para que
 * `VistaBooking.tsx`/`TarifarioPublic.tsx` (sin ningún cambio en su lógica
 * interna) sigan operando sobre el mismo tipo `FilaTarifario[]` de siempre.
 * Función PURA, sin I/O — testeable con fixtures.
 *
 * Por cada fila de resumen (una combinación módulo/paquete/bloqueo/hotel/
 * servicio/categoría/régimen), emite:
 *   - Módulos con hotel: una fila por acomodación de adulto que SÍ tenga
 *     precio (hasta 4) — nunca niño/niño2/infante (esos solo viven en el
 *     detalle bajo demanda, igual que hoy los ignora `minRoomPvp()`). Si
 *     NINGUNA acomodación de adulto tiene precio, emite 1 fila con
 *     `acomodacion: null, precio_pvp: 0` para que el hotel SIGA generando su
 *     tarjeta (mismo caso de hoy: sin precio de adulto, la tarjeta muestra
 *     "Consultar" en vez de desaparecer).
 *   - `servicios`: una sola fila con `precio_pvp: desde_general` (ya es el
 *     mínimo entre todas las escalas/acomodaciones de ese servicio — un
 *     `min()` de mínimos es matemáticamente el mismo mínimo que agrupar de
 *     una).
 */
export function expandirResumenAFilas(resumen: FilaResumen[]): FilaTarifario[] {
  const out: FilaTarifario[] = [];
  for (const r of resumen) {
    const base = {
      modulo: r.modulo,
      bloqueo_label: r.bloqueo_label,
      bloqueo_id: r.bloqueo_id,
      empaquetado_id: r.empaquetado_id,
      salida_id: r.salida_id,
      paquete_id: r.paquete_id,
      hotel_id: r.hotel_id,
      fecha_ida: r.fecha_ida,
      fecha_regreso: r.fecha_regreso,
      noches: r.noches,
      destino_nombre: r.destino_nombre,
      paquete_nombre: r.paquete_nombre,
      hotel_nombre: r.hotel_nombre,
      moneda: r.moneda,
    };
    if (r.modulo === "servicios") {
      out.push({
        ...base,
        servicio_id: r.servicio_id,
        servicio_nombre: r.servicio_nombre,
        tipo_tarifa: r.tipo_tarifa,
        pax_desde: null,
        pax_hasta: null,
        categoria: null,
        regimen: null,
        acomodacion: null,
        precio_pvp: Number(r.desde_general) || 0,
        descripcion: r.descripcion,
        recargo_individual: r.recargo_individual,
      });
      continue;
    }
    let emitida = false;
    for (const [acom, campo] of PRECIO_ACOM) {
      const v = r[campo];
      if (v == null || Number(v) <= 0) continue;
      out.push({
        ...base,
        servicio_id: null,
        servicio_nombre: null,
        tipo_tarifa: null,
        pax_desde: null,
        pax_hasta: null,
        categoria: r.categoria,
        regimen: r.regimen,
        acomodacion: acom,
        precio_pvp: Number(v),
        descripcion: null,
        recargo_individual: null,
      });
      emitida = true;
    }
    if (!emitida) {
      out.push({
        ...base,
        servicio_id: null,
        servicio_nombre: null,
        tipo_tarifa: null,
        pax_desde: null,
        pax_hasta: null,
        categoria: r.categoria,
        regimen: r.regimen,
        acomodacion: null,
        precio_pvp: 0,
        descripcion: null,
        recargo_individual: null,
      });
    }
  }
  return out;
}

export type DatosResumenTarifario = {
  filasVisibles: FilaTarifario[];
  filasAddon: FilaTarifario[];
  cuposPorBloqueo: Record<number, number>;
  origenPorBloqueo: Record<number, string>;
  fotosPorHotel: Record<number, string>;
  fotosPorServicio: Record<number, string>;
  infoPorHotel: Record<number, InfoHotelDato>;
  capPorHotel: Record<number, CapHotelDato>;
  planesInfo: Record<string, { nombre: string | null; descripcion: string | null; nota_especial: string | null }>;
  ventanaPorPaquete: Record<number, { min: string | null; max: string | null }>;
  incluidosPorPaquete: Record<number, string[]>;
  /** Cuántas filas trajo el resumen (magnitud "hoteles/salidas", NO "tarifas") — instrumentación. */
  filasResumen: number;
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
 * al cliente en la carga inicial. Devuelve `FilaTarifario[]` (vía
 * `expandirResumenAFilas`) para que las páginas y componentes existentes NO
 * necesiten cambiar de forma.
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
  registrarEtapa(flujo, flujoId, "resumen_inicial", Math.round(performance.now() - _tResumen0), "ok");
  registrarDatoPagina(flujo, flujoId, "resumen_inicial", `filas_resumen=${filas.length} paginas=${pag.paginasConsultadas} consultas_iniciales=${pag.paginasConsultadas}`);
  const filasResumen = filas.length;

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
  if (resFiltros.errorVigencia) {
    registrarErrorTecnico(flujo, flujoId, "filtro_vigencia", "error_hotel_temporadas_o_tarifa_hotel", resFiltros.errorVigencia);
  }
  if (resFiltros.errorEmpaquetado) {
    _huboErrorAux = true;
    registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_consulta_empaquetados_vigencia", resFiltros.errorEmpaquetado);
  }
  registrarEtapa(flujo, flujoId, "filtro_vigencia", Math.round(performance.now() - _tAux0), resFiltros.errorVigencia ? "error" : "ok");
  registrarDatoPagina(flujo, flujoId, "filtro_vigencia", `filas=${filas.length} consultas=${huboVigencia ? 2 : 0}`);

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
    resFotosHotel, resHoteles, resAcomInfante, resFotosServicio, resPlanes, resVentana, resIncluidos,
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

  const filasVisiblesExpandidas = expandirResumenAFilas(filasVisibles);
  const filasAddonExpandidas = expandirResumenAFilas(filasAddon);

  return {
    ok: true,
    datos: {
      filasVisibles: filasVisiblesExpandidas, filasAddon: filasAddonExpandidas,
      cuposPorBloqueo, origenPorBloqueo, fotosPorHotel, fotosPorServicio,
      infoPorHotel, capPorHotel, planesInfo, ventanaPorPaquete, incluidosPorPaquete,
      filasResumen,
    },
  };
}
