"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";
import {
  noches as calcNoches,
  liquidarHotelNoches,
  marcar,
  aporteVuelo,
  componerTarifa,
  costoServicio,
  type TemporadaRango,
} from "@/lib/calc/paquetes";

type Result = { ok: true; id?: number } | { ok: false; error: string };
const oNull = (s: string | null | undefined) => (s && s.trim() !== "" ? s.trim() : null);
const dNull = (s: string | null | undefined) => (s && s.trim() !== "" ? s : null);

type ImpuestoTipo = Database["public"]["Enums"]["impuesto_tipo"];
type Acomodacion = Database["public"]["Enums"]["acomodacion_tipo"];

const ACOMODACIONES: Acomodacion[] = ["sencilla", "doble", "triple", "multiple", "nino"];
const COL_NETO: Record<Acomodacion, string> = {
  sencilla: "neto_sencilla",
  doble: "neto_doble",
  triple: "neto_triple",
  multiple: "neto_multiple",
  nino: "neto_nino",
};

export interface PaqueteConfig {
  nombre: string;
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

// ── Adición de servicio (con check). Siempre con el mk del paquete ─────────
export async function setServicio(paqueteId: number, servicioId: number, checked: boolean): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    await sb.from("armado_servicios").delete().eq("paquete_id", paqueteId).eq("servicio_id", servicioId);
  } else {
    const { error } = await sb
      .from("armado_servicios")
      .upsert({ paquete_id: paqueteId, servicio_id: servicioId }, { onConflict: "paquete_id,servicio_id" });
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
  const paqueteDestinoId = pq.destino_id;
  const destinoNombre = (pq.destinos as unknown as { nombre: string } | null)?.nombre ?? null;

  const [{ data: vuelosSel }, { data: hotelesSel }, { data: serviciosSel }] = await Promise.all([
    sb
      .from("armado_vuelos")
      .select("bloqueo_id, aplica_mk, ta, bloqueos_vuelo(id, record, ruta, fecha_ida, fecha_regreso, tarifa_para_empaquetar)")
      .eq("paquete_id", paqueteId),
    sb
      .from("armado_hoteles")
      .select("hotel_id, hoteles(nombre)")
      .eq("paquete_id", paqueteId),
    sb
      .from("armado_servicios")
      .select("servicio_id, servicios_adicionales(nombre, tarifa_neta, liquidacion)")
      .eq("paquete_id", paqueteId),
  ]);

  const hoteles = hotelesSel ?? [];
  const servicios = serviciosSel ?? [];

  // Temporadas y tarifas netas de cada hotel involucrado
  const hotelIds = hoteles.map((h) => h.hotel_id);
  const temporadasPorHotel = new Map<number, TemporadaRango[]>();
  type TarifaRow = Record<string, unknown>;
  const tarifasPorHotel = new Map<number, TarifaRow[]>();
  if (hotelIds.length) {
    const [{ data: temps }, { data: tarifas }] = await Promise.all([
      sb.from("hotel_temporadas").select("hotel_id, nombre, fecha_inicio, fecha_fin").in("hotel_id", hotelIds),
      sb.from("tarifa_hotel").select("*").in("hotel_id", hotelIds),
    ]);
    for (const t of temps ?? []) {
      const arr = temporadasPorHotel.get(t.hotel_id) ?? [];
      arr.push({ nombre: t.nombre, fecha_inicio: t.fecha_inicio, fecha_fin: t.fecha_fin });
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

  // Aporte de servicios (por persona, igual para todas las combinaciones).
  // Los servicios SIEMPRE van con el mk del paquete.
  function aporteServicios(numNoches: number): number {
    let total = 0;
    for (const s of servicios) {
      const srv = s.servicios_adicionales as unknown as
        | { tarifa_neta: number; liquidacion: "dia" | "noche" | "paquete" }
        | null;
      if (!srv) continue;
      const costo = costoServicio(Number(srv.tarifa_neta) || 0, srv.liquidacion, numNoches);
      total += marcar(costo, pctMk);
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
    fechaRegreso: string | null
  ) {
    if (numNoches <= 0) return;
    const aporteServ = aporteServicios(numNoches);
    for (const h of hoteles) {
      const hotelNombre = (h.hoteles as unknown as { nombre: string } | null)?.nombre ?? null;
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
        for (const acom of ACOMODACIONES) {
          const col = COL_NETO[acom];
          const netoPorTemporada: Record<string, number | null> = {};
          for (const [temp, row] of tempMap) {
            const v = row[col];
            netoPorTemporada[temp] = v == null ? null : Number(v);
          }
          const costoHotel = liquidarHotelNoches({ fechaIda, numNoches, temporadas, netoPorTemporada });
          if (costoHotel == null || costoHotel <= 0) continue;
          const aporteHotel = marcar(costoHotel, pctMk); // hotel siempre con mk
          const t = componerTarifa({
            aporteHotel,
            aporteServicios: aporteServ,
            aporteVuelo: aporteVueloVal,
            impuesto,
          });
          filas.push({
            paquete_id: paqueteId,
            paquete_nombre: paqueteNombre,
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

  if (vuelos.length) {
    // MÓDULO BLOQUEOS: una liquidación por ciclo aéreo
    for (const { aplica_mk, ta, b } of vuelos) {
      const numNoches = calcNoches(b.fecha_ida!, b.fecha_regreso!);
      const costoTiquete = Number(b.tarifa_para_empaquetar) || 0;
      const aporteVueloVal = aporteVuelo(costoTiquete, aplica_mk, pctMk, ta);
      const impuesto = pq.impuesto_tipo === "tiquete" ? costoTiquete : Number(pq.impuesto_fijo) || 0;
      const label = [b.record, b.ruta].filter(Boolean).join(" · ") || b.record || "";
      filasHoteles(b.fecha_ida!, numNoches, aporteVueloVal, impuesto, "bloqueo", b.id, label, b.fecha_regreso);
    }
  } else if (pq.fecha_viaje_inicio && pq.fecha_viaje_fin) {
    // MÓDULO PORCIÓN TERRESTRE: sin vuelo; noches = rango de viaje, impuesto fijo
    const numNoches = calcNoches(pq.fecha_viaje_inicio, pq.fecha_viaje_fin);
    filasHoteles(
      pq.fecha_viaje_inicio,
      numNoches,
      0,
      Number(pq.impuesto_fijo) || 0,
      "porcion_terrestre",
      null,
      null,
      pq.fecha_viaje_fin
    );
  }

  // Reescribe el resultado del paquete
  const del = await sb.from("tarifario_resultado").delete().eq("paquete_id", paqueteId);
  if (del.error) return { ok: false, error: del.error.message };
  if (filas.length) {
    const ins = await sb.from("tarifario_resultado").insert(filas);
    if (ins.error) return { ok: false, error: ins.error.message };
  }

  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  revalidatePath("/tarifario");
  return { ok: true, id: filas.length };
}
