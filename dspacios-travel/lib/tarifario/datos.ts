import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { FilaTarifario } from "@/app/tarifario/TarifarioPublic";
import type { AcomConfig } from "@/lib/acomodaciones";
// Imports RELATIVOS con extensión `.ts` (no `@/lib/...`) para los que son de
// VALOR, no solo de tipo — mismo motivo que en lib/tarifario/vigencia.ts:
// `@/` es un alias que solo resuelve Next.js/TypeScript en build; bajo
// `node --test` plano revienta con `ERR_MODULE_NOT_FOUND`. Deja este archivo
// testeable con ejecución real (pruebas/tarifarioDatos.test.ts, defecto
// "EQUIVALENCIA FUNCIONAL" de la revisión posterior).
import { createAdminClient } from "../supabase/admin.ts";
import { filtrarTarifarioVencidas } from "./vigencia.ts";
import { cargarFilasTarifarioPaginado } from "./paginacion.ts";
import { hoyISO } from "../calc/paquetes.ts";
import { empaquetadoVigente, hoyBogota } from "../reservar/origen.ts";
import { registrarEtapa, registrarDatoPagina, registrarErrorTecnico } from "../observabilidad/medicion.ts";

// Columnas completas que necesita Vista Booking (Reservar/tarifario público)
// — más que las que pide /dashboard/tarifario, ver lib/tarifario/paginacion.ts.
const COLUMNAS_COMPLETAS =
  "modulo, bloqueo_label, bloqueo_id, empaquetado_id, salida_id, paquete_id, hotel_id, servicio_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, fecha_ida, fecha_regreso, noches, destino_nombre, paquete_nombre, hotel_nombre, categoria, regimen, acomodacion, precio_pvp, descripcion, recargo_individual, moneda";

export type InfoHotelDato = {
  estrellas: number | null; clasificacion: string | null; descripcion: string | null; ubicacion: string | null;
  video_url: string | null; ninoMin: number | null; ninoMax: number | null; infMin: number | null; infMax: number | null;
  infanteCargo: boolean; infanteNota: string | null; ninoNota: string | null; adultsOnly: boolean;
  petFriendly: boolean; petCargo: boolean; petCostoDesc: string | null; petNota: string | null;
};
export type CapHotelDato = { paxMin: number | null; paxMax: number | null; acom: AcomConfig[] };

export type DatosTarifario = {
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
};

// Mensaje público FIJO (revisión posterior, defecto "PAGINACIÓN IGNORA
// ERRORES"): si la carga PAGINADA de `tarifario_resultado` falla
// técnicamente, la página NUNCA debe mostrar "no hay tarifas" (eso afirma
// algo falso — hay tarifas, solo no se pudieron leer). Este mensaje fijo,
// nunca el error de Supabase/Postgres crudo, es lo único que puede llegar
// al navegador. El detalle técnico real se registra server-side, saneado,
// vía `registrarErrorTecnico()`.
export const MSG_ERROR_CARGAR_TARIFARIO = "No fue posible cargar el tarifario en este momento. Intenta nuevamente en unos segundos.";

export type ResultadoDatosTarifario =
  | { ok: true; datos: DatosTarifario }
  | { ok: false; error: string };

/**
 * Toda la data derivada de `tarifario_resultado` que necesita Vista Booking
 * (hoteles, cupos, fotos, capacidades, "Incluye", add-ons de cada paquete).
 * Compartida entre `/tarifario` (público) y `/dashboard/reservar` (interno,
 * "el motor general") — antes cada página traía su propia copia y una se
 * quedó atrás, por eso "Incluye"/add-ons solo aparecían en una de las dos.
 * Cualquier campo nuevo que necesite Vista Booking se agrega aquí UNA vez.
 *
 * `flujo`/`flujoId` (diagnóstico del incidente de ~13s en las 3 rutas de
 * tarifario): identifican la ejecución en los logs de medición — el caller
 * (cada page.tsx) genera `flujoId` UNA vez por request y lo pasa aquí para
 * que sus etapas queden atadas a las del resto de la página. Mide, por
 * separado: `carga_paginada` (el bucle de `tarifario_resultado`, con
 * filas/páginas recibidas), `filtro_vigencia` (filtrarTarifarioVencidas), y
 * `datos_auxiliares` (todo lo demás: cupos, vigencia de empaquetados, el
 * recorte de "servicios", fotos/hoteles/capacidades, planes, ventana de
 * viaje, "incluye") — mismos buckets que pide el diagnóstico, sin abrir más
 * granularidad de la necesaria.
 *
 * ⚠️ Revisión posterior (dos defectos confirmados sobre esta función):
 *
 * "RESULTADOS OK FALSOS" — CADA consulta de esta función se revisa ahora por
 * `error`, no solo `data`. Un fallo técnico real (RLS inesperada, timeout,
 * service-role caído) ya no puede quedar clasificado como `resultado=ok`
 * simplemente porque `data` vino `null`/vacío. Se distinguen 3 casos en
 * cada bloque: (a) "sin datos legítimo" (el id-set correspondiente está
 * vacío → ni siquiera se consulta, no es error); (b) "fallo cerrado de
 * negocio" (vigencia/empaquetados sin datos verificables → oculta filas,
 * comportamiento de negocio YA existente); (c) "error técnico" (`.error`
 * presente → se loguea con `registrarErrorTecnico()`, saneado, y la etapa
 * correspondiente queda `resultado=error`). Las consultas de
 * ENRIQUECIMIENTO (fotos, info de hotel, capacidades, planes, ventana,
 * "incluye") degradan best-effort ante error técnico — faltará ese dato
 * cosmético, pero la página sigue mostrando precios/cupos correctos, y el
 * error queda VISIBLE en los logs (nunca silenciado como "ok"). La carga
 * PAGINADA en sí (crítica: sin ella no hay tarifario) SÍ aborta — ver
 * `ResultadoDatosTarifario`/`MSG_ERROR_CARGAR_TARIFARIO`.
 *
 * "OPTIMIZACIÓN INTERNA INCOMPLETA" — antes `createAdminClient()` se
 * llamaba hasta 5 veces (una por bloque) y varias consultas independientes
 * corrían secuenciales sin necesidad. Ahora: UN solo admin client por
 * ejecución (reusado en toda la función); `cupos_por_bloqueo`+
 * `bloqueos_vuelo` (dependen de `bloqueoIds`, calculado de las filas CRUDAS,
 * antes del filtro de vigencia) corren CONCURRENTES con `filtrarTarifario
 * Vencidas` (también sobre las filas crudas) — ninguna depende del
 * resultado de la otra, así que paralelizarlas no cambia qué se consulta ni
 * qué bloqueoIds se piden (se calculan ANTES de que la vigencia reasigne
 * `filas`, igual que en el código original). Las consultas que SÍ dependen
 * de un resultado previo (empaquetados necesita las filas post-vigencia;
 * "servicios" necesita las filas post-empaquetados) se mantienen
 * SECUENCIALES en el mismo orden. Una vez resuelto `filasVisibles` (los
 * ids de hotel/servicio/paquete que de ahí se derivan NO cambian entre
 * ellos), las 8 consultas de enriquecimiento (fotos de hotel, info+
 * capacidades de hotel, tarifa de infante, fotos de servicio, planes de
 * alimentación, ventana de viaje, "incluye") son mutuamente independientes
 * — ninguna necesita el resultado de otra — y corren en UN solo
 * `Promise.all`. Ni el número de consultas ni los filtros de vigencia/
 * fallo cerrado cambiaron — solo CUÁNDO arrancan entre sí.
 */
export async function cargarDatosTarifario(
  sb: SupabaseClient<Database>, flujo: string, flujoId: string,
  // Un solo admin client para TODA la ejecución (antes: hasta 5 instancias
  // por request). Parámetro por defecto — NUNCA se pasa desde las 3 páginas
  // reales (mismo comportamiento exacto que antes: deriva de
  // SUPABASE_SERVICE_ROLE_KEY en cada invocación real). Existe para poder
  // inyectar un cliente admin FALSO en pruebas de ejecución real
  // (pruebas/tarifarioDatos.test.ts) sin tocar el entorno — mismo patrón que
  // `filtrarTarifarioVencidas(admin, filas)` en lib/tarifario/vigencia.ts.
  admin: SupabaseClient<Database> | null = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null
): Promise<ResultadoDatosTarifario> {
  const _tPaginacion0 = performance.now();
  const pag = await cargarFilasTarifarioPaginado<FilaTarifario>(sb, COLUMNAS_COMPLETAS);
  if (!pag.ok) {
    registrarEtapa(flujo, flujoId, "carga_paginada", Math.round(performance.now() - _tPaginacion0), "error");
    registrarErrorTecnico(flujo, flujoId, "carga_paginada", "error_paginacion_tarifario_resultado", pag.error);
    return { ok: false, error: MSG_ERROR_CARGAR_TARIFARIO };
  }
  let filas = pag.filas;
  registrarEtapa(flujo, flujoId, "carga_paginada", Math.round(performance.now() - _tPaginacion0), "ok");
  registrarDatoPagina(flujo, flujoId, "carga_paginada", `filas=${filas.length} paginas=${pag.paginasConsultadas} consultas=${pag.paginasConsultadas}`);

  const _tAux0 = performance.now();
  let _consultasAux = 0;
  let _huboErrorAux = false;

  // `bloqueoIds` se calcula de las filas CRUDAS (antes de filtrar vigencia),
  // exactamente como en el código original — cupos/bloqueos y vigencia leen
  // la MISMA base de filas y no dependen una de la otra, así que se piden
  // concurrentes sin cambiar qué se consulta.
  const cuposPorBloqueo: Record<number, number> = {};
  const origenPorBloqueo: Record<number, string> = {};
  const bloqueoIds = [...new Set(
    filas.filter((f) => f.modulo === "bloqueo" && f.bloqueo_id != null).map((f) => f.bloqueo_id as number)
  )];

  const _tVigencia0 = performance.now();
  const huboVigencia = admin != null;

  const [resCupos, resVigencia] = await Promise.all([
    (async () => {
      if (!bloqueoIds.length || !admin) return null;
      const [{ data: cup, error: e1 }, { data: blo, error: e2 }] = await Promise.all([
        admin.from("cupos_por_bloqueo").select("id, cupos_disponibles").in("id", bloqueoIds),
        admin.from("bloqueos_vuelo").select("id, origen, ruta").in("id", bloqueoIds),
      ]);
      // ⚠️ Revisión posterior (defecto confirmado): antes un `error: e1 ??
      // e2 ?? null` combinado descartaba AMBOS resultados si CUALQUIERA de
      // las dos fallaba — un fallo puntual de `bloqueos_vuelo` borraba
      // también los cupos ya obtenidos correctamente. VistaBooking.tsx/
      // TarifarioPublic.tsx tratan `cuposPorBloqueo[id] === undefined` como
      // "disponibilidad desconocida" y pueden mostrar una salida como
      // agotada — así que cada consulta se conserva de forma INDEPENDIENTE:
      // un cupo válido sobrevive aunque el origen falle, y viceversa.
      return { cup, blo, e1, e2 };
    })(),
    admin ? filtrarTarifarioVencidas(admin, filas) : null,
  ]);

  if (resCupos) {
    if (resCupos.e1) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_cupos_por_bloqueo", resCupos.e1);
      // Best-effort: sin error el enriquecimiento de cupos queda vacío
      // (nunca se inventa un número) — no bloquea la página, el dato solo falta.
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
    _consultasAux += 2;
  }
  const _msAux0 = performance.now() - _tAux0;

  // Oculta tarifas de hotel cuya vigencia de COMPRA ya venció (se re-liquida
  // HOY). Etapa propia ("filtro_vigencia"): una de las 4 mediciones pedidas
  // en el diagnóstico, separada del resto de "datos_auxiliares".
  if (resVigencia) {
    filas = resVigencia.filas;
    if (resVigencia.error) {
      registrarErrorTecnico(flujo, flujoId, "filtro_vigencia", "error_hotel_temporadas_o_tarifa_hotel", resVigencia.error);
    }
  }
  registrarEtapa(flujo, flujoId, "filtro_vigencia", Math.round(performance.now() - _tVigencia0), resVigencia?.error ? "error" : "ok");
  registrarDatoPagina(flujo, flujoId, "filtro_vigencia", `filas=${filas.length} consultas=${huboVigencia ? 2 : 0}`);

  const _tAux1 = performance.now();
  // Oculta salidas de BLOQUEO cuya fecha de ida ya pasó.
  const hoyTarifa = hoyISO();
  filas = filas.filter((f) => (f.modulo !== "bloqueo" && f.modulo !== "dinamico") || !f.fecha_ida || f.fecha_ida >= hoyTarifa);

  // Oculta filas de EMPAQUETADO cuyo origen fue desactivado O quedó fuera de
  // vigencia de compra después de generar el tarifario (defecto 3 original +
  // hallazgo 4 de la revisión posterior, "VIGENCIA EN LA VITRINA"):
  // generarTarifario() solo excluye empaquetados inactivos/vencidos al
  // REGENERAR — una fila ya escrita en tarifario_resultado no desaparece
  // sola si el empaquetado se apaga o vence después, así que el filtro
  // también se aplica aquí, en LECTURA, para el caso (más probable) de que
  // nadie vuelva a pulsar "Generar tarifario" justo después.
  //
  // FALLA CERRADA: si la consulta de vigencia FALLA (`error` presente,
  // service-role caído, etc.), las filas de empaquetado se ocultan TODAS —
  // nunca se publican tarifas cuya vigencia no se pudo verificar.
  const empaquetadoIds = [...new Set(
    filas.filter((f) => f.empaquetado_id != null).map((f) => f.empaquetado_id as number)
  )];
  if (empaquetadoIds.length) {
    if (!admin) {
      filas = filas.filter((f) => f.empaquetado_id == null);
    } else {
      const { data: emps, error: empsError } = await admin
        .from("empaquetados")
        .select("id, activo, compra_inicio, compra_fin")
        .in("id", empaquetadoIds);
      const hoyEmp = hoyBogota(new Date());
      if (empsError) {
        _huboErrorAux = true;
        registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_consulta_empaquetados_vigencia", empsError);
      }
      const vigentes = empsError
        ? new Set<number>() // fallo cerrado: la consulta falló, no se publica ninguna
        : new Set(
            (emps ?? [])
              .filter((e) => e.activo && empaquetadoVigente(e.compra_inicio, e.compra_fin, hoyEmp))
              .map((e) => e.id)
          );
      filas = filas.filter((f) => f.empaquetado_id == null || vigentes.has(f.empaquetado_id));
      _consultasAux += 1;
    }
  }

  // En la vitrina "Servicios" solo deben verse los paquetes de tipo 'servicios'.
  // Los servicios de paquetes porción/bloqueo existen como add-on para Reservar,
  // pero NO deben publicarse como productos sueltos.
  let filasVisibles = filas;
  if (admin && filas.some((f) => f.modulo === "servicios")) {
    const { data: pkgs, error: pkgsError } = await admin.from("armado_paquetes").select("id").eq("tipo", "servicios");
    if (pkgsError) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_consulta_armado_paquetes_servicios", pkgsError);
      // Fallo cerrado (ya era el comportamiento accidental, ahora explícito):
      // sin poder verificar qué paquetes son 'servicios', ninguna fila de
      // 'servicios' se publica como producto suelto.
    }
    const idsServicios = new Set((pkgsError ? [] : (pkgs ?? [])).map((p) => p.id));
    filasVisibles = filas.filter((f) => f.modulo !== "servicios" || (f.paquete_id != null && idsServicios.has(f.paquete_id)));
    _consultasAux += 1;
  }

  // Add-ons de CADA paquete de hotel (bloqueo/porción), SIN el recorte de
  // arriba — Vista Booking los ofrece scoped al hotel/paquete que se está viendo.
  const filasAddon = filas.filter((f) => f.modulo === "servicios");

  // A partir de aquí, `filasVisibles` ya no cambia — los 4 id-sets de abajo
  // (hotel/servicio/paquete-porción/paquete-con-hotel) son todos derivados
  // de ella y no dependen entre sí, así que las 8 consultas que enriquecen
  // Vista Booking pueden arrancar TODAS juntas.
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
    // Foto de portada por hotel.
    hotelIds.length
      ? sb.from("hotel_fotos").select("hotel_id, url, es_portada, orden").in("hotel_id", hotelIds).order("orden")
      : null,
    // Estrellas/clasificación/descripción + pax min/max por hotel.
    hotelIds.length
      ? sb.from("hoteles").select("id, estrellas, clasificacion, descripcion, ubicacion, video_url, pax_min, pax_max, edad_nino_min, edad_nino_max, edad_infante_min, edad_infante_max, nino_nota, adults_only, pet_friendly, pet_costo_neto, pet_costo_desc, pet_nota").in("id", hotelIds)
      : null,
    // Capacidades por acomodación + tarifa de infante — solo necesitan
    // hotelIds, NUNCA el resultado de la consulta `hoteles` de arriba, así
    // que no hace falta esperarla (independencia real, no solo apariencia).
    hotelIds.length && admin
      ? (async () => {
          const [{ data: acs, error: e1 }, { data: tarInfante, error: e2 }] = await Promise.all([
            admin.from("hotel_acomodaciones").select("hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max").in("hotel_id", hotelIds),
            admin.from("tarifa_hotel").select("hotel_id, neto_infante, nota_infante").in("hotel_id", hotelIds),
          ]);
          // ⚠️ Revisión posterior (mismo defecto que cupos/origen): las dos
          // consultas se conservan de forma INDEPENDIENTE — una acomodación
          // válida sobrevive aunque falle la tarifa de infante, y una
          // tarifa de infante válida sobrevive aunque falle la
          // acomodación. Antes un `error` combinado descartaba ambos
          // resultados ante cualquier fallo puntual.
          return { acs, tarInfante, e1, e2 };
        })()
      : null,
    // Foto de portada por servicio adicional (tour/receptivo).
    servicioIds.length
      ? sb.from("servicios_adicionales").select("id, foto_url").in("id", servicioIds)
      : null,
    // Régimen de alimentación: qué incluye cada plan (sin dependencia de ningún id-set).
    sb.from("planes_alimentacion").select("codigo, nombre, descripcion, nota_especial"),
    // Ventana de viaje por paquete (porción/dinámico) para el motor por fechas.
    paqIdsPorcion.length && admin
      ? admin.from("armado_paquetes").select("id, fecha_viaje_inicio, fecha_viaje_fin").in("id", paqIdsPorcion)
      : null,
    // Servicios marcados "incluido" al armar cada paquete (para "Incluye").
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
    _consultasAux += 1;
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
    _consultasAux += 1;
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
    _consultasAux += 2;
  }

  if (resFotosServicio) {
    if (resFotosServicio.error) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_servicios_adicionales_fotos", resFotosServicio.error);
    } else {
      for (const s of resFotosServicio.data ?? []) if (s.foto_url) fotosPorServicio[s.id] = s.foto_url;
    }
    _consultasAux += 1;
  }

  if (resPlanes.error) {
    _huboErrorAux = true;
    registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_planes_alimentacion", resPlanes.error);
  } else {
    for (const p of resPlanes.data ?? []) planesInfo[(p.codigo ?? "").trim().toUpperCase()] = { nombre: p.nombre, descripcion: p.descripcion, nota_especial: p.nota_especial };
  }
  _consultasAux += 1;

  if (resVentana) {
    if (resVentana.error) {
      _huboErrorAux = true;
      registrarErrorTecnico(flujo, flujoId, "datos_auxiliares", "error_armado_paquetes_ventana", resVentana.error);
    } else {
      for (const p of resVentana.data ?? []) ventanaPorPaquete[p.id as number] = { min: p.fecha_viaje_inicio as string | null, max: p.fecha_viaje_fin as string | null };
    }
    _consultasAux += 1;
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
    _consultasAux += 1;
  }

  const msAux = _msAux0 + (performance.now() - _tAux1);
  registrarEtapa(flujo, flujoId, "datos_auxiliares", Math.round(msAux), _huboErrorAux ? "error" : "ok");
  registrarDatoPagina(flujo, flujoId, "datos_auxiliares", `filas_visibles=${filasVisibles.length} filas_addon=${filasAddon.length} consultas=${_consultasAux}`);

  return {
    ok: true,
    datos: {
      filasVisibles, filasAddon, cuposPorBloqueo, origenPorBloqueo, fotosPorHotel, fotosPorServicio,
      infoPorHotel, capPorHotel, planesInfo, ventanaPorPaquete, incluidosPorPaquete,
    },
  };
}
