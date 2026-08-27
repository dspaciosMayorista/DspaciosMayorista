import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FilaTarifario } from "@/app/tarifario/TarifarioPublic";
import type { AcomConfig } from "@/lib/acomodaciones";
import { filtrarTarifarioVencidas } from "@/lib/tarifario/vigencia";
import { cargarFilasTarifarioPaginado } from "@/lib/tarifario/paginacion";
import { hoyISO } from "@/lib/calc/paquetes";
import { empaquetadoVigente, hoyBogota } from "@/lib/reservar/origen";
import { registrarEtapa, registrarDatoPagina } from "@/lib/observabilidad/medicion";

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
 */
export async function cargarDatosTarifario(sb: SupabaseClient<Database>, flujo: string, flujoId: string): Promise<DatosTarifario> {
  const _tPaginacion0 = performance.now();
  const { filas: filasPaginadas, paginasConsultadas } = await cargarFilasTarifarioPaginado<FilaTarifario>(sb, COLUMNAS_COMPLETAS);
  let filas = filasPaginadas;
  registrarEtapa(flujo, flujoId, "carga_paginada", Math.round(performance.now() - _tPaginacion0), "ok");
  registrarDatoPagina(flujo, flujoId, "carga_paginada", `filas=${filas.length} paginas=${paginasConsultadas} consultas=${paginasConsultadas}`);

  const _tAux0 = performance.now();
  let _consultasAux = 0;

  // Cupos disponibles por bloqueo (para mostrar y ocultar salidas sin cupos).
  const cuposPorBloqueo: Record<number, number> = {};
  const origenPorBloqueo: Record<number, string> = {};
  const bloqueoIds = [...new Set(
    filas.filter((f) => f.modulo === "bloqueo" && f.bloqueo_id != null).map((f) => f.bloqueo_id as number)
  )];
  if (bloqueoIds.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const [{ data: cup }, { data: blo }] = await Promise.all([
      admin.from("cupos_por_bloqueo").select("id, cupos_disponibles").in("id", bloqueoIds),
      admin.from("bloqueos_vuelo").select("id, origen, ruta").in("id", bloqueoIds),
    ]);
    for (const c of cup ?? []) cuposPorBloqueo[c.id as number] = Number(c.cupos_disponibles) || 0;
    for (const b of blo ?? []) {
      const ori = (b.origen ?? "").trim() || (b.ruta ? b.ruta.split("-")[0].trim() : "");
      if (ori) origenPorBloqueo[b.id as number] = ori.toUpperCase();
    }
    _consultasAux += 2;
  }
  let _msAux = performance.now() - _tAux0;

  // Oculta tarifas de hotel cuya vigencia de COMPRA ya venció (se re-liquida HOY).
  // Etapa propia ("filtro_vigencia"): es una de las 4 mediciones pedidas en
  // el diagnóstico, separada del resto de "datos_auxiliares".
  const _tVigencia0 = performance.now();
  let _huboVigencia = false;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    filas = await filtrarTarifarioVencidas(createAdminClient(), filas);
    _huboVigencia = true;
  }
  registrarEtapa(flujo, flujoId, "filtro_vigencia", Math.round(performance.now() - _tVigencia0), "ok");
  registrarDatoPagina(flujo, flujoId, "filtro_vigencia", `filas=${filas.length} consultas=${_huboVigencia ? 2 : 0}`);

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
  // nunca se publican tarifas cuya vigencia no se pudo verificar. Antes esto
  // ya pasaba por accidente (`emps ?? []` daba un set vacío → todo se
  // filtraba), ahora es explícito e independiente de si la causa fue "cero
  // empaquetados activos" o "la consulta reventó".
  const empaquetadoIds = [...new Set(
    filas.filter((f) => f.empaquetado_id != null).map((f) => f.empaquetado_id as number)
  )];
  if (empaquetadoIds.length) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      filas = filas.filter((f) => f.empaquetado_id == null);
    } else {
      const admin = createAdminClient();
      const { data: emps, error: empsError } = await admin
        .from("empaquetados")
        .select("id, activo, compra_inicio, compra_fin")
        .in("id", empaquetadoIds);
      const hoyEmp = hoyBogota(new Date());
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
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && filas.some((f) => f.modulo === "servicios")) {
    const admin = createAdminClient();
    const { data: pkgs } = await admin.from("armado_paquetes").select("id").eq("tipo", "servicios");
    const idsServicios = new Set((pkgs ?? []).map((p) => p.id));
    filasVisibles = filas.filter((f) => f.modulo !== "servicios" || (f.paquete_id != null && idsServicios.has(f.paquete_id)));
    _consultasAux += 1;
  }

  // Add-ons de CADA paquete de hotel (bloqueo/porción), SIN el recorte de
  // arriba — Vista Booking los ofrece scoped al hotel/paquete que se está viendo.
  const filasAddon = filas.filter((f) => f.modulo === "servicios");

  // Foto de portada por hotel.
  const fotosPorHotel: Record<number, string> = {};
  const hotelIds = [...new Set(filasVisibles.filter((f) => f.hotel_id != null).map((f) => f.hotel_id as number))];
  if (hotelIds.length) {
    const { data: fotos } = await sb
      .from("hotel_fotos")
      .select("hotel_id, url, es_portada, orden")
      .in("hotel_id", hotelIds)
      .order("orden");
    for (const f of fotos ?? []) {
      if (fotosPorHotel[f.hotel_id] == null) fotosPorHotel[f.hotel_id] = f.url;
      if (f.es_portada) fotosPorHotel[f.hotel_id] = f.url;
    }
    _consultasAux += 1;
  }

  // Estrellas/clasificación/descripción + capacidades por hotel.
  const infoPorHotel: Record<number, InfoHotelDato> = {};
  const capPorHotel: Record<number, CapHotelDato> = {};
  if (hotelIds.length) {
    const { data: hs } = await sb.from("hoteles").select("id, estrellas, clasificacion, descripcion, ubicacion, video_url, pax_min, pax_max, edad_nino_min, edad_nino_max, edad_infante_min, edad_infante_max, nino_nota, adults_only, pet_friendly, pet_costo_neto, pet_costo_desc, pet_nota").in("id", hotelIds);
    for (const h of hs ?? []) {
      infoPorHotel[h.id] = { estrellas: h.estrellas, clasificacion: h.clasificacion, descripcion: h.descripcion, ubicacion: h.ubicacion, video_url: h.video_url, ninoMin: h.edad_nino_min, ninoMax: h.edad_nino_max, infMin: h.edad_infante_min, infMax: h.edad_infante_max, infanteCargo: false, infanteNota: null, ninoNota: h.nino_nota, adultsOnly: h.adults_only ?? false, petFriendly: h.pet_friendly ?? false, petCargo: (Number(h.pet_costo_neto) || 0) > 0, petCostoDesc: h.pet_costo_desc, petNota: h.pet_nota };
      capPorHotel[h.id] = { paxMin: h.pax_min, paxMax: h.pax_max, acom: [] };
    }
    _consultasAux += 1;
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const admin = createAdminClient();
      const [{ data: acs }, { data: tarInfante }] = await Promise.all([
        admin
          .from("hotel_acomodaciones")
          .select("hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max")
          .in("hotel_id", hotelIds),
        admin.from("tarifa_hotel").select("hotel_id, neto_infante, nota_infante").in("hotel_id", hotelIds),
      ]);
      for (const a of acs ?? []) {
        const slot = (capPorHotel[a.hotel_id] ??= { paxMin: null, paxMax: null, acom: [] });
        slot.acom.push(a as unknown as AcomConfig);
      }
      for (const r of tarInfante ?? []) {
        const slot = infoPorHotel[r.hotel_id];
        if (!slot) continue;
        if ((Number(r.neto_infante) || 0) > 0) slot.infanteCargo = true;
        if (r.nota_infante && !slot.infanteNota) slot.infanteNota = r.nota_infante;
      }
      _consultasAux += 2;
    }
  }

  // Foto de portada por servicio adicional (tour/receptivo).
  const fotosPorServicio: Record<number, string> = {};
  const servicioIds = [...new Set(filasVisibles.filter((f) => f.servicio_id != null).map((f) => f.servicio_id as number))];
  if (servicioIds.length) {
    const { data: svcs } = await sb.from("servicios_adicionales").select("id, foto_url").in("id", servicioIds);
    for (const s of svcs ?? []) if (s.foto_url) fotosPorServicio[s.id] = s.foto_url;
    _consultasAux += 1;
  }

  // Régimen de alimentación: qué incluye cada plan.
  const planesInfo: Record<string, { nombre: string | null; descripcion: string | null; nota_especial: string | null }> = {};
  {
    const { data: planes } = await sb.from("planes_alimentacion").select("codigo, nombre, descripcion, nota_especial");
    for (const p of planes ?? []) planesInfo[(p.codigo ?? "").trim().toUpperCase()] = { nombre: p.nombre, descripcion: p.descripcion, nota_especial: p.nota_especial };
    _consultasAux += 1;
  }

  // Ventana de viaje por paquete (porción/dinámico) para el motor por fechas.
  const ventanaPorPaquete: Record<number, { min: string | null; max: string | null }> = {};
  const paqIdsPorcion = [...new Set(
    filasVisibles.filter((f) => f.modulo === "porcion_terrestre" && f.paquete_id != null).map((f) => f.paquete_id as number)
  )];
  if (paqIdsPorcion.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const { data: pqs } = await admin.from("armado_paquetes").select("id, fecha_viaje_inicio, fecha_viaje_fin").in("id", paqIdsPorcion);
    for (const p of pqs ?? []) ventanaPorPaquete[p.id as number] = { min: p.fecha_viaje_inicio as string | null, max: p.fecha_viaje_fin as string | null };
    _consultasAux += 1;
  }

  // Servicios marcados "incluido" al armar cada paquete (para "Incluye").
  const incluidosPorPaquete: Record<number, string[]> = {};
  const paqIdsConHotel = [...new Set(
    filasVisibles.filter((f) => (f.modulo === "bloqueo" || f.modulo === "porcion_terrestre") && f.paquete_id != null).map((f) => f.paquete_id as number)
  )];
  if (paqIdsConHotel.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const { data: incs } = await admin
      .from("armado_servicios")
      .select("paquete_id, incluido, servicios_adicionales(nombre)")
      .eq("incluido", true)
      .in("paquete_id", paqIdsConHotel);
    for (const r of incs ?? []) {
      const nombre = (r as unknown as { servicios_adicionales: { nombre: string } | null }).servicios_adicionales?.nombre;
      if (!nombre) continue;
      (incluidosPorPaquete[r.paquete_id as number] ??= []).push(nombre);
    }
    _consultasAux += 1;
  }

  _msAux += performance.now() - _tAux1;
  registrarEtapa(flujo, flujoId, "datos_auxiliares", Math.round(_msAux), "ok");
  registrarDatoPagina(flujo, flujoId, "datos_auxiliares", `filas_visibles=${filasVisibles.length} filas_addon=${filasAddon.length} consultas=${_consultasAux}`);

  return {
    filasVisibles, filasAddon, cuposPorBloqueo, origenPorBloqueo, fotosPorHotel, fotosPorServicio,
    infoPorHotel, capPorHotel, planesInfo, ventanaPorPaquete, incluidosPorPaquete,
  };
}
