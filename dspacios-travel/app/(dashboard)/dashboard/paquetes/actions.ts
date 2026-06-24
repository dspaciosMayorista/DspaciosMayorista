"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";
import {
  noches as calcNoches,
  liquidarHotelNoches,
  liquidarHotelMasBarato,
  marcar,
  aporteVuelo,
  componerTarifa,
  redondearMilArriba,
  factorLiquidacion,
  toTemporadaRango,
  type TemporadaRango,
} from "@/lib/calc/paquetes";

type Result = { ok: true; id?: number } | { ok: false; error: string };
const oNull = (s: string | null | undefined) => (s && s.trim() !== "" ? s.trim() : null);
const dNull = (s: string | null | undefined) => (s && s.trim() !== "" ? s : null);

type ImpuestoTipo = Database["public"]["Enums"]["impuesto_tipo"];
type Acomodacion = Database["public"]["Enums"]["acomodacion_tipo"];

const ACOMODACIONES: Acomodacion[] = ["sencilla", "doble", "triple", "multiple", "nino", "nino2"];
const COL_NETO: Record<Acomodacion, string> = {
  sencilla: "neto_sencilla",
  doble: "neto_doble",
  triple: "neto_triple",
  multiple: "neto_multiple",
  nino: "neto_nino",     // Niño 1 (Chd1)
  nino2: "neto_nino2",   // Niño 2 (Chd2)
};

export interface PaqueteConfig {
  nombre: string;
  tipo: "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";
  noches: number;
  destinoId: number | null;
  fechaCompraInicio: string;
  fechaCompraFin: string;
  fechaViajeInicio: string;
  fechaViajeFin: string;
  pctMk: number;          // porcentaje (20 = 20 %); se guarda como fracción
  impuestoTipo: ImpuestoTipo;
  impuestoFijo: number;
  activo: boolean;
  notas: string;
}

function configToRow(c: PaqueteConfig) {
  return {
    nombre: c.nombre.trim(),
    tipo: c.tipo,
    noches: Number(c.noches) || 3,
    destino_id: c.destinoId,
    fecha_compra_inicio: dNull(c.fechaCompraInicio),
    fecha_compra_fin: dNull(c.fechaCompraFin),
    fecha_viaje_inicio: dNull(c.fechaViajeInicio),
    fecha_viaje_fin: dNull(c.fechaViajeFin),
    pct_mk: (Number(c.pctMk) || 0) / 100,
    impuesto_tipo: c.impuestoTipo,
    impuesto_fijo: Number(c.impuestoFijo) || 0,
    activo: c.activo,
    notas: oNull(c.notas),
  };
}

export async function crearPaquete(c: PaqueteConfig): Promise<Result> {
  if (!c.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const sb = await createClient();
  const { data, error } = await sb
    .from("armado_paquetes")
    .insert(configToRow(c))
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/paquetes");
  return { ok: true, id: data.id };
}

export async function actualizarPaquete(id: number, c: PaqueteConfig): Promise<Result> {
  if (!c.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const sb = await createClient();
  const { error } = await sb
    .from("armado_paquetes")
    .update({ ...configToRow(c), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/paquetes/${id}`);
  return { ok: true, id };
}

export async function eliminarPaquete(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("armado_paquetes").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/paquetes");
  return { ok: true };
}

// ── Adición de vuelo: alta/baja + decisión de margen (mk o TA) ─────────────
// Solo el vuelo decide margen. TA = Tarifa Administrativa (valor fijo).
export async function setVuelo(
  paqueteId: number,
  bloqueoId: number,
  checked: boolean,
  aplicaMk: boolean,
  ta: number
): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    await sb.from("armado_vuelos").delete().eq("paquete_id", paqueteId).eq("bloqueo_id", bloqueoId);
  } else {
    const { error } = await sb
      .from("armado_vuelos")
      .upsert(
        { paquete_id: paqueteId, bloqueo_id: bloqueoId, aplica_mk: aplicaMk, ta: Number(ta) || 0 },
        { onConflict: "paquete_id,bloqueo_id" }
      );
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true };
}

// ── Seleccionar / quitar TODOS los vuelos disponibles ─────────────────────
export async function setTodosVuelos(
  paqueteId: number,
  bloqueoIds: number[],
  checked: boolean
): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    await sb.from("armado_vuelos").delete().eq("paquete_id", paqueteId);
  } else if (bloqueoIds.length) {
    const { error } = await sb
      .from("armado_vuelos")
      .upsert(
        bloqueoIds.map((b) => ({ paquete_id: paqueteId, bloqueo_id: b, aplica_mk: true, ta: 0 })),
        { onConflict: "paquete_id,bloqueo_id", ignoreDuplicates: true }
      );
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true };
}

// ── Adición de hotel (con check). El hotel siempre va con el mk del paquete ─
export async function setHotel(paqueteId: number, hotelId: number, checked: boolean): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    await sb.from("armado_hoteles").delete().eq("paquete_id", paqueteId).eq("hotel_id", hotelId);
  } else {
    const { error } = await sb
      .from("armado_hoteles")
      .upsert({ paquete_id: paqueteId, hotel_id: hotelId }, { onConflict: "paquete_id,hotel_id" });
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true };
}

// Seleccionar/quitar TODOS los hoteles disponibles (con todas las categorías y
// regímenes por defecto; luego se afina cada uno desde su ventana).
export async function setTodosHoteles(paqueteId: number, hotelIds: number[], checked: boolean): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    await sb.from("armado_hoteles").delete().eq("paquete_id", paqueteId);
  } else if (hotelIds.length) {
    const { error } = await sb
      .from("armado_hoteles")
      .upsert(
        hotelIds.map((h) => ({ paquete_id: paqueteId, hotel_id: h })),
        { onConflict: "paquete_id,hotel_id", ignoreDuplicates: true }
      );
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true };
}

// ── Tarifas de un hotel (para la ventana de selección) ─────────────────────
export type TarifaHotelPreview = {
  categoria: string;
  regimen: string;
  temporada: string;
  neto_sencilla: number | null;
  neto_doble: number | null;
  neto_triple: number | null;
  neto_multiple: number | null;
  neto_nino: number | null;
};
export async function getTarifasHotel(hotelId: number): Promise<{
  categorias: string[];
  regimenes: string[];
  tarifas: TarifaHotelPreview[];
}> {
  const sb = await createClient();
  const { data } = await sb
    .from("tarifa_hotel")
    .select("tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino")
    .eq("hotel_id", hotelId);
  const tarifas: TarifaHotelPreview[] = (data ?? []).map((r) => ({
    categoria: r.tipo_habitacion ?? "",
    regimen: r.alimentacion ?? "",
    temporada: r.temporada ?? "",
    neto_sencilla: r.neto_sencilla,
    neto_doble: r.neto_doble,
    neto_triple: r.neto_triple,
    neto_multiple: r.neto_multiple,
    neto_nino: r.neto_nino,
  }));
  const categorias = [...new Set(tarifas.map((t) => t.categoria).filter(Boolean))].sort();
  const regimenes = [...new Set(tarifas.map((t) => t.regimen).filter(Boolean))].sort();
  return { categorias, regimenes, tarifas };
}

// Guarda el hotel + su filtro de categorías/regímenes (null/vacío = todas).
export async function setHotelFiltros(
  paqueteId: number,
  hotelId: number,
  categorias: string[],
  regimenes: string[]
): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("armado_hoteles").upsert(
    {
      paquete_id: paqueteId,
      hotel_id: hotelId,
      categorias: categorias.length ? categorias : null,
      regimenes: regimenes.length ? regimenes : null,
    },
    { onConflict: "paquete_id,hotel_id" }
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true };
}

// ── Adición de servicio (con check) + modo de cobro (persona/grupo) ────────
export async function setServicio(
  paqueteId: number,
  servicioId: number,
  checked: boolean,
  modo: "persona" | "grupo" = "persona",
  incluido = false
): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    await sb.from("armado_servicios").delete().eq("paquete_id", paqueteId).eq("servicio_id", servicioId);
  } else {
    const { error } = await sb
      .from("armado_servicios")
      .upsert({ paquete_id: paqueteId, servicio_id: servicioId, modo, incluido }, { onConflict: "paquete_id,servicio_id" });
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true };
}

// ── GENERAR TARIFARIO: liquida el paquete y reescribe tarifario_resultado ───
export async function generarTarifario(paqueteId: number): Promise<Result> {
  const sb = await createClient();

  const { data: pq, error: ePq } = await sb
    .from("armado_paquetes")
    .select("*, destinos(nombre)")
    .eq("id", paqueteId)
    .single();
  if (ePq || !pq) return { ok: false, error: ePq?.message ?? "Paquete no encontrado." };

  const pctMk = Number(pq.pct_mk) || 0;
  const paqueteNombre = pq.nombre;
  const paqueteActivo = pq.activo;
  const paqueteDestinoId = pq.destino_id;
  const destinoNombre = (pq.destinos as unknown as { nombre: string } | null)?.nombre ?? null;

  const [{ data: vuelosSel }, { data: hotelesSel }, { data: serviciosSel }] = await Promise.all([
    sb
      .from("armado_vuelos")
      .select("bloqueo_id, aplica_mk, ta, bloqueos_vuelo(id, record, ruta, fecha_ida, fecha_regreso, tarifa_para_empaquetar)")
      .eq("paquete_id", paqueteId),
    sb
      .from("armado_hoteles")
      .select("hotel_id, categorias, regimenes, hoteles(nombre, moneda)")
      .eq("paquete_id", paqueteId),
    sb
      .from("armado_servicios")
      .select("servicio_id, modo, incluido, servicios_adicionales(nombre, precio_persona, liquidacion, descripcion, recargo_individual)")
      .eq("paquete_id", paqueteId),
  ]);

  // Rangos de grupo de los servicios seleccionados
  const servicioIds = (serviciosSel ?? []).map((s) => s.servicio_id);
  const gruposPorServicio = new Map<number, { pax_desde: number; pax_hasta: number; precio: number }[]>();
  if (servicioIds.length) {
    // El snapshot del tarifario usa la tarifa BASE (GENERAL); las temporadas se
    // aplican al reservar (re-escala por fecha del viaje).
    const { data: gr } = await sb
      .from("servicio_tarifa_pax")
      .select("servicio_id, pax_desde, pax_hasta, precio")
      .eq("temporada", "GENERAL")
      .in("servicio_id", servicioIds);
    for (const g of gr ?? []) {
      const arr = gruposPorServicio.get(g.servicio_id) ?? [];
      arr.push({ pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, precio: g.precio });
      gruposPorServicio.set(g.servicio_id, arr);
    }
  }

  const hoteles = hotelesSel ?? [];
  const servicios = serviciosSel ?? [];

  // Temporadas y tarifas netas de cada hotel involucrado
  const hotelIds = hoteles.map((h) => h.hotel_id);
  const temporadasPorHotel = new Map<number, TemporadaRango[]>();
  type TarifaRow = Record<string, unknown>;
  const tarifasPorHotel = new Map<number, TarifaRow[]>();
  if (hotelIds.length) {
    const [{ data: temps }, { data: tarifas }] = await Promise.all([
      sb.from("hotel_temporadas").select("hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, compra_inicio, compra_fin, tipo, descuento_valor, rangos, blackouts").in("hotel_id", hotelIds),
      sb.from("tarifa_hotel").select("*").in("hotel_id", hotelIds),
    ]);
    for (const t of temps ?? []) {
      const arr = temporadasPorHotel.get(t.hotel_id) ?? [];
      arr.push(toTemporadaRango(t));
      temporadasPorHotel.set(t.hotel_id, arr);
    }
    for (const r of (tarifas ?? []) as TarifaRow[]) {
      const hid = r.hotel_id as number;
      const arr = tarifasPorHotel.get(hid) ?? [];
      arr.push(r);
      tarifasPorHotel.set(hid, arr);
    }
  }

  type ResultadoInsert = Database["public"]["Tables"]["tarifario_resultado"]["Insert"];
  const filas: ResultadoInsert[] = [];

  // Servicios INCLUIDOS se hornean por persona en la tarifa del hotel.
  // (Los OPCIONALES no se hornean: se agregan como add-on en la reserva.)
  function aporteServiciosIncluidos(numNoches: number): number {
    let total = 0;
    for (const s of servicios) {
      if (!(s.incluido as boolean)) continue;
      const srv = s.servicios_adicionales as unknown as { precio_persona: number | null; liquidacion: string | null } | null;
      if (srv?.precio_persona == null) continue;
      // Cobro amarrado a la duración: por noche × noches, por día × (noches+1).
      total += marcar(Number(srv.precio_persona) || 0, pctMk) * factorLiquidacion(srv.liquidacion, numNoches);
    }
    return total;
  }

  // Genera las filas de hotel para una estadía (fechaIda + numNoches).
  // `aporteVueloVal` es el aporte del vuelo al PVP (0 en porción terrestre);
  // `impuesto` es la BNC que se resta del PVP.
  function filasHoteles(
    fechaIda: string,
    numNoches: number,
    aporteVueloVal: number,
    impuesto: number,
    modulo: Database["public"]["Enums"]["tarifario_modulo"],
    bloqueoId: number | null,
    bloqueoLabel: string | null,
    fechaRegreso: string | null,
    // Tarifario "desde": toma la tarifa más barata de la ventana de viaje
    // [fechaIda, fechaRegreso] en vez de liquidar una fecha fija. Para porción,
    // donde el asesor elige fecha al reservar (re-liquida). Bloqueo = fecha fija.
    masBarato = false,
    salidaId: number | null = null,
  ) {
    if (numNoches <= 0) return;
    const aporteServ = aporteServiciosIncluidos(numNoches); // solo servicios incluidos
    for (const h of hoteles) {
      const hotelMeta = h.hoteles as unknown as { nombre: string; moneda?: string | null } | null;
      const hotelNombre = hotelMeta?.nombre ?? null;
      const monedaHotel = (hotelMeta?.moneda ?? "COP") === "USD" ? "USD" : "COP";
      const filtroCat = (h.categorias as string[] | null) ?? null;
      const filtroReg = (h.regimenes as string[] | null) ?? null;
      const temporadas = temporadasPorHotel.get(h.hotel_id) ?? [];
      const tarifas = tarifasPorHotel.get(h.hotel_id) ?? [];
      // Agrupa por (categoría, régimen) -> (temporada -> fila de tarifa)
      const combos = new Map<string, Map<string, TarifaRow>>();
      for (const r of tarifas) {
        const cat = (r.tipo_habitacion as string) ?? "";
        const reg = (r.alimentacion as string) ?? "";
        const key = `${cat}|||${reg}`;
        if (!combos.has(key)) combos.set(key, new Map());
        combos.get(key)!.set((r.temporada as string) ?? "", r);
      }
      for (const [key, tempMap] of combos) {
        const [categoria, regimen] = key.split("|||");
        // Filtro de la ventana del hotel (null/vacío = todas)
        if (filtroCat && filtroCat.length && !filtroCat.includes(categoria)) continue;
        if (filtroReg && filtroReg.length && !filtroReg.includes(regimen)) continue;
        for (const acom of ACOMODACIONES) {
          const col = COL_NETO[acom];
          const netoPorTemporada: Record<string, number | null> = {};
          for (const [temp, row] of tempMap) {
            const v = row[col];
            netoPorTemporada[temp] = v == null ? null : Number(v);
          }
          const costoHotel = masBarato
            ? liquidarHotelMasBarato({ desde: fechaIda, hasta: fechaRegreso ?? fechaIda, numNoches, temporadas, netoPorTemporada })
            : liquidarHotelNoches({ fechaIda, numNoches, temporadas, netoPorTemporada });
          // null = no aplica (no se publica). En HABITACIONES, 0 también es "no
          // aplica" (no es gratis); solo en niños el 0 es válido (niño gratis).
          const esRoom = acom !== "nino" && acom !== "nino2";
          if (costoHotel == null) continue;
          if (esRoom && costoHotel <= 0) continue;
          const aporteHotel = marcar(costoHotel, pctMk); // hotel siempre con mk
          const t = componerTarifa({
            aporteHotel,
            aporteServicios: aporteServ,
            aporteVuelo: aporteVueloVal,
            impuesto,
            moneda: monedaHotel,
          });
          filas.push({
            paquete_id: paqueteId,
            paquete_nombre: paqueteNombre,
            paquete_activo: paqueteActivo,
            modulo,
            bloqueo_id: bloqueoId,
            bloqueo_label: bloqueoLabel,
            hotel_id: h.hotel_id,
            hotel_nombre: hotelNombre,
            destino_id: paqueteDestinoId,
            destino_nombre: destinoNombre,
            categoria: categoria || null,
            regimen: regimen || null,
            acomodacion: acom,
            noches: numNoches,
            fecha_ida: fechaIda,
            fecha_regreso: fechaRegreso,
            base_comisionable: t.baseComisionable,
            impuesto: t.impuesto,
            precio_pvp: t.pvp,
            moneda: monedaHotel,
            salida_id: salidaId,
          });
        }
      }
    }
  }

  const vuelos = (vuelosSel ?? [])
    .map((v) => ({
      aplica_mk: v.aplica_mk as boolean,
      ta: Number(v.ta) || 0,
      b: v.bloqueos_vuelo as unknown as {
        id: number;
        record: string | null;
        ruta: string | null;
        fecha_ida: string | null;
        fecha_regreso: string | null;
        tarifa_para_empaquetar: number;
      } | null,
    }))
    .filter((v): v is typeof v & { b: NonNullable<typeof v.b> } => !!v.b && !!v.b.fecha_ida && !!v.b.fecha_regreso);

  const tipo = (pq.tipo ?? "bloqueo") as "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";

  // Salidas dinámicas (vuelo por sistema): solo para el tipo 'dinamico'.
  const { data: salidasRaw } = tipo === "dinamico"
    ? await sb.from("salidas_dinamicas").select("*").eq("paquete_id", paqueteId).eq("activo", true).order("fecha_ida")
    : { data: null };
  const salidas = salidasRaw ?? [];

  // Validaciones según el tipo (mensajes claros en vez de 0 silencioso)
  if (tipo === "bloqueo" && !vuelos.length)
    return { ok: false, error: "Bloqueo: selecciona al menos un vuelo." };
  if (tipo === "porcion_terrestre" && (!pq.fecha_viaje_inicio || !pq.fecha_viaje_fin))
    return { ok: false, error: "Porción terrestre: define el rango de viaje (fechas) en la Configuración inicial." };
  if (tipo === "dinamico" && !salidas.length)
    return { ok: false, error: "Dinámico: agrega al menos una salida (vuelo por sistema)." };
  if ((tipo === "bloqueo" || tipo === "porcion_terrestre" || tipo === "dinamico") && !hoteles.length)
    return { ok: false, error: "Agrega al menos un hotel." };
  if (tipo === "servicios" && !servicios.length)
    return { ok: false, error: "Agrega al menos un servicio." };

  if (tipo === "bloqueo") {
    // MÓDULO BLOQUEOS: una liquidación por ciclo aéreo
    for (const { aplica_mk, ta, b } of vuelos) {
      const numNoches = calcNoches(b.fecha_ida!, b.fecha_regreso!);
      const costoTiquete = Number(b.tarifa_para_empaquetar) || 0;
      const aporteVueloVal = aporteVuelo(costoTiquete, aplica_mk, pctMk, ta);
      const impuesto = pq.impuesto_tipo === "tiquete" ? costoTiquete : Number(pq.impuesto_fijo) || 0;
      // Etiqueta pública del vuelo: solo la ruta (el record/PNR es interno y
      // NO debe aparecer en el tarifario que ven clientes B2C/B2B).
      const label = b.ruta || "";
      filasHoteles(b.fecha_ida!, numNoches, aporteVueloVal, impuesto, "bloqueo", b.id, label, b.fecha_regreso);
    }
  } else if (tipo === "porcion_terrestre" && pq.fecha_viaje_inicio) {
    // MÓDULO PORCIÓN TERRESTRE: sin vuelo; noches del paquete desde la fecha inicio
    const numNoches = Number(pq.noches) || 3;
    filasHoteles(pq.fecha_viaje_inicio, numNoches, 0, Number(pq.impuesto_fijo) || 0, "porcion_terrestre", null, null, pq.fecha_viaje_fin, true);
  } else if (tipo === "dinamico") {
    // MÓDULO DINÁMICO: una liquidación por SALIDA (vuelo por sistema, sin record).
    // El hotel se liquida por las noches de la salida; el vuelo es valor_tiquete
    // (adulto 2+) con mk o TA. fecha fija → no "más barato".
    for (const sal of salidas) {
      const fIda = sal.fecha_ida as string;
      const fReg = (sal.fecha_regreso as string | null) ?? null;
      if (!fIda || !fReg) continue;
      const numNoches = calcNoches(fIda, fReg);
      if (numNoches <= 0) continue;
      const costoTiquete = Number(sal.valor_tiquete) || 0;
      const aporteVueloVal = aporteVuelo(costoTiquete, sal.aplica_mk as boolean, pctMk, Number(sal.ta) || 0);
      const impuesto = pq.impuesto_tipo === "tiquete" ? costoTiquete : Number(pq.impuesto_fijo) || 0;
      // Etiqueta pública de la salida: ruta + fecha (NO hay record/PNR).
      const label = `${sal.ruta || ""}${sal.ruta && fIda ? " · " : ""}${fIda ? fIda.split("-").reverse().join("/") : ""}`.trim();
      filasHoteles(fIda, numNoches, aporteVueloVal, impuesto, "dinamico", null, label || (sal.ruta ?? "Salida"), fReg, false, sal.id as number);
    }
  }

  // Noches del paquete para amarrar el cobro de los servicios por día/noche.
  let nochesPaq = Number(pq.noches) || 1;
  if (tipo === "bloqueo" && vuelos.length) {
    nochesPaq = calcNoches(vuelos[0].b.fecha_ida!, vuelos[0].b.fecha_regreso!) || nochesPaq;
  }

  // SERVICIOS: se publican siempre (módulo Servicios y/o add-ons en la reserva),
  // sin importar el tipo. Persona = una fila; grupo = una fila por rango de pax.
  for (const s of servicios) {
    if (s.incluido as boolean) continue; // los incluidos se hornean, no se publican
    const srv = s.servicios_adicionales as unknown as { nombre: string; precio_persona: number | null; liquidacion: string | null; descripcion: string | null; recargo_individual: number | null } | null;
    if (!srv) continue;
    const fLiq = factorLiquidacion(srv.liquidacion, nochesPaq);
    const modo = (s.modo as string) === "grupo" ? "grupo" : "persona";
    const comun = {
      paquete_id: paqueteId,
      paquete_nombre: paqueteNombre,
      paquete_activo: paqueteActivo,
      modulo: "servicios" as const,
      servicio_id: s.servicio_id,
      servicio_nombre: srv.nombre,
      destino_id: paqueteDestinoId,
      destino_nombre: destinoNombre,
      tipo_tarifa: modo,
      impuesto: 0,
      descripcion: srv.descripcion ?? null,
    };
    if (modo === "grupo") {
      for (const g of gruposPorServicio.get(s.servicio_id) ?? []) {
        const pvp = redondearMilArriba(marcar(Number(g.precio) || 0, pctMk) * fLiq);
        filas.push({ ...comun, pax_desde: g.pax_desde, pax_hasta: g.pax_hasta, base_comisionable: pvp, precio_pvp: pvp });
      }
    } else if (srv.precio_persona != null) {
      const pvp = redondearMilArriba(marcar(Number(srv.precio_persona) || 0, pctMk) * fLiq);
      // Recargo individual: suplemento del proveedor cuando va 1 pax (cobro por
      // persona). Es un COSTO, así que el lado de venta sube con su markup; el
      // costo neto lo toma Reservar del catálogo para la CxP del proveedor.
      const recargoNeto = Math.max(Number(srv.recargo_individual) || 0, 0);
      const recargoPvp = recargoNeto > 0 ? redondearMilArriba(marcar(recargoNeto, pctMk)) : 0;
      filas.push({ ...comun, base_comisionable: pvp, precio_pvp: pvp, recargo_individual: recargoPvp });
    }
  }

  // Reescribe el resultado del paquete
  const del = await sb.from("tarifario_resultado").delete().eq("paquete_id", paqueteId);
  if (del.error) return { ok: false, error: del.error.message };
  if (filas.length) {
    const ins = await sb.from("tarifario_resultado").insert(filas);
    if (ins.error) return { ok: false, error: ins.error.message };
  } else if (tipo === "bloqueo" || tipo === "porcion_terrestre") {
    return {
      ok: false,
      error:
        "No se generaron tarifas. Revisa que el hotel tenga temporadas y tarifas netas que cubran el rango de fechas del viaje.",
    };
  }

  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  revalidatePath("/tarifario");
  return { ok: true, id: filas.length };
}

// ── AUTO-RECÁLCULO ─────────────────────────────────────────────────────────
// Regenera el tarifario de TODOS los paquetes activos que usan un hotel. Se
// llama tras editar tarifas/vigencias del hotel para que el tarifario (y el PVP
// que lee Reservar) se actualice solo, sin volver a "Generar" a mano. No lanza:
// un fallo de un paquete no debe tumbar el guardado de la tarifa.
export async function regenerarTarifariosDeHotel(hotelId: number): Promise<void> {
  if (!hotelId) return;
  try {
    const sb = await createClient();
    const { data: pkgs } = await sb
      .from("armado_hoteles")
      .select("paquete_id, armado_paquetes!inner(activo)")
      .eq("hotel_id", hotelId);
    const ids = [...new Set((pkgs ?? [])
      .filter((p) => (p.armado_paquetes as unknown as { activo: boolean } | null)?.activo)
      .map((p) => p.paquete_id))];
    for (const id of ids) {
      try { await generarTarifario(id); } catch { /* un paquete malo no frena el resto */ }
    }
  } catch {
    /* el auto-recálculo es best-effort; nunca bloquea la edición */
  }
}

// Regenera el tarifario de los paquetes activos que usan un BLOQUEO aéreo. Se
// llama tras editar/eliminar el bloqueo (tarifa de empaquetar, fechas, ruta).
export async function regenerarTarifariosDeBloqueo(bloqueoId: number): Promise<void> {
  if (!bloqueoId) return;
  try {
    const sb = await createClient();
    const { data: pkgs } = await sb
      .from("armado_vuelos")
      .select("paquete_id, armado_paquetes!inner(activo)")
      .eq("bloqueo_id", bloqueoId);
    const ids = [...new Set((pkgs ?? [])
      .filter((p) => (p.armado_paquetes as unknown as { activo: boolean } | null)?.activo)
      .map((p) => p.paquete_id))];
    for (const id of ids) { try { await generarTarifario(id); } catch { /* sigue */ } }
  } catch { /* best-effort */ }
}

// Regenera el tarifario de los paquetes activos que usan un SERVICIO. Se llama
// tras editar/eliminar el servicio (precio por persona o tarifas por grupo).
export async function regenerarTarifariosDeServicio(servicioId: number): Promise<void> {
  if (!servicioId) return;
  try {
    const sb = await createClient();
    const { data: pkgs } = await sb
      .from("armado_servicios")
      .select("paquete_id, armado_paquetes!inner(activo)")
      .eq("servicio_id", servicioId);
    const ids = [...new Set((pkgs ?? [])
      .filter((p) => (p.armado_paquetes as unknown as { activo: boolean } | null)?.activo)
      .map((p) => p.paquete_id))];
    for (const id of ids) { try { await generarTarifario(id); } catch { /* sigue */ } }
  } catch { /* best-effort */ }
}

// ── SALIDAS DINÁMICAS (vuelo por sistema, sin record) ───────────────────────
export type SalidaDinamicaInput = {
  aerolinea: string;
  ruta: string;
  origen: string;
  fechaIda: string;
  fechaRegreso: string;
  horaSalidaIda: string;
  horaLlegadaIda: string;
  horaSalidaReg: string;
  horaLlegadaReg: string;
  valorTiquete: number;       // NETO adulto (2+) por pax, en la moneda del paquete
  aplicaMk: boolean;          // true: valor/(1-mk) · false: valor + ta
  ta: number;
  feeInfante: number;         // 0–1.99 años
  compraInicio: string;
  compraFin: string;
  notas: string;
};

function salidaRow(paqueteId: number, input: SalidaDinamicaInput) {
  return {
    paquete_id: paqueteId,
    aerolinea: oNull(input.aerolinea),
    ruta: oNull(input.ruta),
    origen: oNull(input.origen)?.toUpperCase() ?? null,
    fecha_ida: input.fechaIda,
    fecha_regreso: dNull(input.fechaRegreso),
    hora_salida_ida: oNull(input.horaSalidaIda),
    hora_llegada_ida: oNull(input.horaLlegadaIda),
    hora_salida_reg: oNull(input.horaSalidaReg),
    hora_llegada_reg: oNull(input.horaLlegadaReg),
    valor_tiquete: Math.max(Number(input.valorTiquete) || 0, 0),
    aplica_mk: !!input.aplicaMk,
    ta: Math.max(Number(input.ta) || 0, 0),
    fee_infante: Math.max(Number(input.feeInfante) || 0, 0),
    compra_inicio: dNull(input.compraInicio),
    compra_fin: dNull(input.compraFin),
    notas: oNull(input.notas),
  };
}

export async function crearSalidaDinamica(paqueteId: number, input: SalidaDinamicaInput): Promise<Result> {
  const sb = await createClient();
  if (!input.fechaIda) return { ok: false, error: "La fecha de ida es obligatoria." };
  const { error } = await sb.from("salidas_dinamicas").insert(salidaRow(paqueteId, input));
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  try { await generarTarifario(paqueteId); } catch { /* sigue */ }
  return { ok: true };
}

export async function actualizarSalidaDinamica(id: number, input: SalidaDinamicaInput): Promise<Result> {
  const sb = await createClient();
  if (!input.fechaIda) return { ok: false, error: "La fecha de ida es obligatoria." };
  const { data: prev } = await sb.from("salidas_dinamicas").select("paquete_id").eq("id", id).maybeSingle();
  const { paquete_id: _omit, ...row } = salidaRow(prev?.paquete_id ?? 0, input);
  void _omit;
  const { error } = await sb.from("salidas_dinamicas").update(row).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (prev?.paquete_id) {
    revalidatePath(`/dashboard/paquetes/${prev.paquete_id}`);
    try { await generarTarifario(prev.paquete_id); } catch { /* sigue */ }
  }
  return { ok: true };
}

export async function eliminarSalidaDinamica(id: number): Promise<Result> {
  const sb = await createClient();
  const { data: prev } = await sb.from("salidas_dinamicas").select("paquete_id").eq("id", id).maybeSingle();
  const { error } = await sb.from("salidas_dinamicas").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (prev?.paquete_id) {
    revalidatePath(`/dashboard/paquetes/${prev.paquete_id}`);
    try { await generarTarifario(prev.paquete_id); } catch { /* sigue */ }
  }
  return { ok: true };
}
