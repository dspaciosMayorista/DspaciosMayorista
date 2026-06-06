"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { ACOM_ROOMS, type AcomRoom } from "@/lib/acomodaciones";
import { generarTarifas, type DubaiParams } from "@/lib/calc/calculadoras";
import type { Json } from "@/types/database";

type Result = { ok: true; id?: number } | { ok: false; error: string };
const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export async function crearHotel(input: {
  nombre: string;
  destinoId: number;
  proveedorId: number | null;
  zona: string;
  edadInfanteMin: number;
  edadInfanteMax: number;
  edadNinoMin: number;
  edadNinoMax: number;
  categoriaIds: number[];
  regimenIds: number[];
  rangosEdad?: number[];
  contactoTelefono?: string;
  emailComercial?: string;
}): Promise<Result> {
  const sb = await createClient();
  const { data: hotel, error } = await sb
    .from("hoteles")
    .insert({
      nombre: input.nombre.trim(),
      destino_id: input.destinoId,
      proveedor_id: input.proveedorId,
      zona: oNull(input.zona),
      edad_infante_min: input.edadInfanteMin,
      edad_infante_max: input.edadInfanteMax,
      edad_nino_min: input.edadNinoMin,
      edad_nino_max: input.edadNinoMax,
      rangos_edad: input.rangosEdad?.length ? input.rangosEdad : null,
      contacto_telefono: oNull(input.contactoTelefono ?? ""),
      email_comercial: oNull(input.emailComercial ?? ""),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  if (input.categoriaIds.length) {
    const { error: ce } = await sb.from("hotel_categorias").insert(
      input.categoriaIds.map((categoria_id) => ({ hotel_id: hotel.id, categoria_id }))
    );
    if (ce) return { ok: false, error: ce.message };
  }
  if (input.regimenIds.length) {
    const { error: re } = await sb.from("hotel_regimenes").insert(
      input.regimenIds.map((plan_id) => ({ hotel_id: hotel.id, plan_id }))
    );
    if (re) return { ok: false, error: re.message };
  }

  revalidatePath("/dashboard/producto/hoteles");
  return { ok: true, id: hotel.id };
}

export async function eliminarHotel(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("hoteles").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/producto/hoteles");
  return { ok: true };
}

// Reemplaza las categorías de habitación y regímenes asignados a un hotel.
// No toca las tarifas ya cargadas (tarifa_hotel guarda categoría/régimen como texto).
export async function actualizarHotelCategoriasRegimenes(
  hotelId: number,
  categoriaIds: number[],
  regimenIds: number[],
): Promise<Result> {
  const sb = await createClient();
  await sb.from("hotel_categorias").delete().eq("hotel_id", hotelId);
  await sb.from("hotel_regimenes").delete().eq("hotel_id", hotelId);
  if (categoriaIds.length) {
    const { error } = await sb.from("hotel_categorias").insert(
      categoriaIds.map((categoria_id) => ({ hotel_id: hotelId, categoria_id }))
    );
    if (error) return { ok: false, error: error.message };
  }
  if (regimenIds.length) {
    const { error } = await sb.from("hotel_regimenes").insert(
      regimenIds.map((plan_id) => ({ hotel_id: hotelId, plan_id }))
    );
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

export async function actualizarHotelConfig(
  hotelId: number,
  input: {
    zona: string;
    edadInfanteMin: number;
    edadInfanteMax: number;
    edadNinoMin: number;
    edadNinoMax: number;
    rangosEdad: number[];
    contactoTelefono?: string;
    emailComercial?: string;
  }
): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("hoteles")
    .update({
      zona: oNull(input.zona),
      edad_infante_min: input.edadInfanteMin,
      edad_infante_max: input.edadInfanteMax,
      edad_nino_min: input.edadNinoMin,
      edad_nino_max: input.edadNinoMax,
      rangos_edad: input.rangosEdad.length ? input.rangosEdad : null,
      contacto_telefono: oNull(input.contactoTelefono ?? ""),
      email_comercial: oNull(input.emailComercial ?? ""),
    })
    .eq("id", hotelId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

// ── Configuración de acomodaciones por hotel (reservar por habitaciones) ────
export type AcomConfigInput = {
  acomodacion: AcomRoom;
  pax_tarifa: number;
  pax_max: number;
  adt_min: number;
  adt_max: number;
  chd_min: number;
  chd_max: number;
  inf_min: number;
  inf_max: number;
};

export async function actualizarHotelAcomodaciones(
  hotelId: number,
  input: { paxMin: number | null; paxMax: number | null; acomodaciones: AcomConfigInput[] }
): Promise<Result> {
  const sb = await createClient();

  const { error: he } = await sb
    .from("hoteles")
    .update({ pax_min: input.paxMin, pax_max: input.paxMax })
    .eq("id", hotelId);
  if (he) return { ok: false, error: he.message };

  // Upsert por (hotel_id, acomodacion): reemplaza la config completa del hotel.
  const filas = input.acomodaciones
    .filter((a) => ACOM_ROOMS.includes(a.acomodacion))
    .map((a) => ({
      hotel_id: hotelId,
      acomodacion: a.acomodacion,
      pax_tarifa: Math.max(0, Math.trunc(a.pax_tarifa) || 0),
      pax_max: Math.max(0, Math.trunc(a.pax_max) || 0),
      adt_min: Math.max(0, Math.trunc(a.adt_min) || 0),
      adt_max: Math.max(0, Math.trunc(a.adt_max) || 0),
      chd_min: Math.max(0, Math.trunc(a.chd_min) || 0),
      chd_max: Math.max(0, Math.trunc(a.chd_max) || 0),
      inf_min: Math.max(0, Math.trunc(a.inf_min) || 0),
      inf_max: Math.max(0, Math.trunc(a.inf_max) || 0),
    }));
  if (filas.length) {
    const { error } = await sb
      .from("hotel_acomodaciones")
      .upsert(filas, { onConflict: "hotel_id,acomodacion" });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

// ── Temporadas y promociones del hotel ─────────────────────────────────────
// Las fechas SÍ se pueden cruzar: la `prioridad` decide cuál prima. Una promo es
// una temporada con tipo 'descuento_pct'/'descuento_monto' (o 'tarifa' de reemplazo).
export async function crearTemporada(input: {
  hotelId: number;
  nombre: string;
  inicio: string;
  fin: string;
  prioridad?: number;
  compraInicio?: string;
  compraFin?: string;
  tipo?: string;                 // 'tarifa' | 'descuento_pct' | 'descuento_monto'
  descuentoValor?: number | null;
}): Promise<Result> {
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  if (!input.inicio || !input.fin) return { ok: false, error: "Debes indicar fecha de inicio y fin." };
  if (input.fin < input.inicio) return { ok: false, error: "La fecha final no puede ser menor que la inicial." };
  const tipo = input.tipo ?? "tarifa";
  if (tipo !== "tarifa" && !(Number(input.descuentoValor) > 0)) {
    return { ok: false, error: "Una promoción de descuento necesita un valor (% o monto) mayor a 0." };
  }
  if (input.compraInicio && input.compraFin && input.compraFin < input.compraInicio) {
    return { ok: false, error: "La vigencia de compra: la fecha final no puede ser menor que la inicial." };
  }

  const sb = await createClient();
  const { error } = await sb.from("hotel_temporadas").insert({
    hotel_id: input.hotelId,
    nombre: input.nombre.trim(),
    fecha_inicio: input.inicio,
    fecha_fin: input.fin,
    prioridad: Math.max(1, Math.trunc(Number(input.prioridad) || 1)),
    compra_inicio: input.compraInicio || null,
    compra_fin: input.compraFin || null,
    tipo,
    descuento_valor: tipo === "tarifa" ? null : Number(input.descuentoValor) || 0,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${input.hotelId}`);
  return { ok: true };
}

export async function eliminarTemporada(id: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("hotel_temporadas").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

// ── Tarifa neta del hotel ─────────────────────────────────────────────────
export async function crearTarifa(input: {
  hotelId: number;
  tipoHabitacion: string;
  alimentacion: string;
  temporada: string;
  netoSencilla: number | null;
  netoDoble: number | null;
  netoTriple: number | null;
  netoMultiple: number | null;
  netoNino: number | null;
  netoNino2: number | null;
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("tarifa_hotel").insert({
    hotel_id: input.hotelId,
    tipo_habitacion: oNull(input.tipoHabitacion),
    alimentacion: oNull(input.alimentacion),
    temporada: oNull(input.temporada),
    neto_sencilla: input.netoSencilla,
    neto_doble: input.netoDoble,
    neto_triple: input.netoTriple,
    neto_multiple: input.netoMultiple,
    neto_nino: input.netoNino,
    neto_nino2: input.netoNino2,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${input.hotelId}`);
  return { ok: true };
}

export async function actualizarTarifa(
  id: number,
  hotelId: number,
  input: {
    tipoHabitacion: string;
    alimentacion: string;
    temporada: string;
    netoSencilla: number | null;
    netoDoble: number | null;
    netoTriple: number | null;
    netoMultiple: number | null;
    netoNino: number | null;
    netoNino2: number | null;
  }
): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("tarifa_hotel")
    .update({
      tipo_habitacion: oNull(input.tipoHabitacion),
      alimentacion: oNull(input.alimentacion),
      temporada: oNull(input.temporada),
      neto_sencilla: input.netoSencilla,
      neto_doble: input.netoDoble,
      neto_triple: input.netoTriple,
      neto_multiple: input.netoMultiple,
      neto_nino: input.netoNino,
      neto_nino2: input.netoNino2,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

export async function eliminarTarifa(id: number, hotelId: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("tarifa_hotel").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

// ── Cargas masivas (CSV) ───────────────────────────────────────────────────
type CargaResult = { ok: boolean; insertados: number; errores: string[] };
const numCsv = (s?: string) => (s ? parseInt(String(s).replace(/[^\d-]/g, ""), 10) || 0 : 0);
const numCsvN = (s?: string) => (s && s.trim() !== "" ? numCsv(s) : null);

export async function cargarHotelesMasivo(rows: Record<string, string>[]): Promise<CargaResult> {
  const sb = await createClient();
  const [{ data: destinos }, { data: provs }, { data: cats }, { data: regs }, { data: rangos }] = await Promise.all([
    sb.from("destinos").select("id, nombre"),
    sb.from("proveedores").select("id, nombre").eq("tipo", "hotelero"),
    sb.from("categorias_habitacion").select("id, nombre"),
    sb.from("planes_alimentacion").select("id, codigo"),
    sb.from("rangos_edad").select("id, denominacion"),
  ]);
  const dmap = new Map((destinos ?? []).map((d) => [d.nombre.trim().toLowerCase(), d.id]));
  const pmap = new Map((provs ?? []).map((p) => [p.nombre.trim().toLowerCase(), p.id]));
  const cmap = new Map((cats ?? []).map((c) => [c.nombre.trim().toLowerCase(), c.id]));
  const rmap = new Map((regs ?? []).map((r) => [r.codigo.trim().toLowerCase(), r.id]));
  const remap = new Map((rangos ?? []).map((x) => [x.denominacion.trim().toLowerCase(), x.id]));
  const errores: string[] = [];
  let insertados = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const nombre = (r.nombre || "").trim();
    if (!nombre) { errores.push(`Fila ${linea}: falta nombre.`); continue; }
    const destinoId = r.destino ? dmap.get(r.destino.trim().toLowerCase()) : undefined;
    if (!destinoId) { errores.push(`Fila ${linea} (${nombre}): destino "${r.destino ?? ""}" no existe.`); continue; }
    const provId = r.proveedor ? pmap.get(r.proveedor.trim().toLowerCase()) ?? null : null;
    const rangosEdad = (r.rangos_edad || "")
      .split(/[|;]/).map((x) => remap.get(x.trim().toLowerCase())).filter((x): x is number => !!x);
    const { data: hotel, error } = await sb
      .from("hoteles")
      .insert({
        nombre, destino_id: destinoId, proveedor_id: provId, zona: oNull(r.zona || ""),
        edad_infante_min: numCsv(r.edad_infante_min) || 0, edad_infante_max: numCsv(r.edad_infante_max) || 2,
        edad_nino_min: numCsv(r.edad_nino_min) || 2, edad_nino_max: numCsv(r.edad_nino_max) || 10,
        rangos_edad: rangosEdad.length ? rangosEdad : null,
        pax_min: numCsvN(r.pax_min), pax_max: numCsvN(r.pax_max),
        contacto_telefono: oNull(r.contacto_telefono || ""), email_comercial: oNull(r.email_comercial || ""),
      })
      .select("id")
      .single();
    if (error || !hotel) { errores.push(`Fila ${linea} (${nombre}): ${error?.message ?? "no se insertó"}`); continue; }
    const catIds = (r.categorias || "").split(/[|;]/).map((x) => cmap.get(x.trim().toLowerCase())).filter((x): x is number => !!x);
    const regIds = (r.regimenes || "").split(/[|;]/).map((x) => rmap.get(x.trim().toLowerCase())).filter((x): x is number => !!x);
    if (catIds.length) await sb.from("hotel_categorias").insert(catIds.map((categoria_id) => ({ hotel_id: hotel.id, categoria_id })));
    if (regIds.length) await sb.from("hotel_regimenes").insert(regIds.map((plan_id) => ({ hotel_id: hotel.id, plan_id })));
    insertados++;
  }
  revalidatePath("/dashboard/producto/hoteles");
  return { ok: errores.length === 0, insertados, errores };
}

export async function cargarTarifasMasivo(rows: Record<string, string>[]): Promise<CargaResult> {
  const sb = await createClient();
  const { data: hoteles } = await sb.from("hoteles").select("id, nombre, destino_id, destinos(nombre)");
  type HRow = { id: number; nombre: string; destino_id: number; destinos: { nombre: string } | null };
  const lista = (hoteles ?? []) as unknown as HRow[];
  const errores: string[] = [];
  let insertados = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const nombre = (r.hotel || "").trim().toLowerCase();
    if (!nombre) { errores.push(`Fila ${linea}: falta hotel.`); continue; }
    let candidatos = lista.filter((h) => h.nombre.trim().toLowerCase() === nombre);
    if (candidatos.length > 1 && r.destino) {
      candidatos = candidatos.filter((h) => (h.destinos?.nombre ?? "").trim().toLowerCase() === r.destino.trim().toLowerCase());
    }
    if (!candidatos.length) { errores.push(`Fila ${linea}: hotel "${r.hotel}" no encontrado.`); continue; }
    if (candidatos.length > 1) { errores.push(`Fila ${linea}: hotel "${r.hotel}" está duplicado; agrega columna destino.`); continue; }
    const { error } = await sb.from("tarifa_hotel").insert({
      hotel_id: candidatos[0].id,
      tipo_habitacion: oNull(r.categoria || ""),
      alimentacion: oNull(r.regimen || ""),
      temporada: oNull(r.temporada || ""),
      neto_sencilla: numCsvN(r.neto_sencilla),
      neto_doble: numCsvN(r.neto_doble),
      neto_triple: numCsvN(r.neto_triple),
      neto_multiple: numCsvN(r.neto_multiple),
      neto_nino: numCsvN(r.neto_nino),
      neto_nino2: numCsvN(r.neto_nino2),
    });
    if (error) { errores.push(`Fila ${linea} (${r.hotel}): ${error.message}`); continue; }
    insertados++;
  }
  revalidatePath("/dashboard/producto/hoteles");
  return { ok: errores.length === 0, insertados, errores };
}

// Carga masiva de TEMPORADAS del hotel (nombre + rango de fechas). Es la info que
// le faltaba al cargue de tarifas: aquí se definen las FECHAS de cada temporada.
// Mismo criterio que el formulario manual: las fechas no pueden cruzarse.
export async function cargarTemporadasMasivo(rows: Record<string, string>[]): Promise<CargaResult> {
  const sb = await createClient();
  const { data: hoteles } = await sb.from("hoteles").select("id, nombre, destino_id, destinos(nombre)");
  type HRow = { id: number; nombre: string; destino_id: number; destinos: { nombre: string } | null };
  const lista = (hoteles ?? []) as unknown as HRow[];
  const errores: string[] = [];
  let insertados = 0;
  const reFecha = /^\d{4}-\d{2}-\d{2}$/;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const hotelNombre = (r.hotel || "").trim().toLowerCase();
    const nombre = (r.temporada || "").trim();
    const inicio = (r.fecha_inicio || "").trim();
    const fin = (r.fecha_fin || "").trim();
    if (!hotelNombre) { errores.push(`Fila ${linea}: falta hotel.`); continue; }
    if (!nombre) { errores.push(`Fila ${linea}: falta el nombre de la temporada.`); continue; }
    if (!reFecha.test(inicio) || !reFecha.test(fin)) { errores.push(`Fila ${linea} (${r.temporada}): las fechas deben ir como AAAA-MM-DD.`); continue; }
    if (fin < inicio) { errores.push(`Fila ${linea} (${r.temporada}): la fecha final no puede ser menor que la inicial.`); continue; }

    let candidatos = lista.filter((h) => h.nombre.trim().toLowerCase() === hotelNombre);
    if (candidatos.length > 1 && r.destino) {
      candidatos = candidatos.filter((h) => (h.destinos?.nombre ?? "").trim().toLowerCase() === r.destino.trim().toLowerCase());
    }
    if (!candidatos.length) { errores.push(`Fila ${linea}: hotel "${r.hotel}" no encontrado.`); continue; }
    if (candidatos.length > 1) { errores.push(`Fila ${linea}: hotel "${r.hotel}" duplicado; agrega columna destino.`); continue; }
    const hotelId = candidatos[0].id;

    // Verifica solapamiento (incluye las temporadas insertadas en filas previas).
    const { data: existentes } = await sb
      .from("hotel_temporadas")
      .select("nombre, fecha_inicio, fecha_fin")
      .eq("hotel_id", hotelId);
    // Solo se omite el duplicado EXACTO (mismo nombre + mismas fechas).
    // Los cruces de fechas ahora son válidos (la prioridad decide cuál prima).
    let saltar = false;
    for (const e of existentes ?? []) {
      if (e.nombre?.trim().toLowerCase() === nombre.toLowerCase() && e.fecha_inicio === inicio && e.fecha_fin === fin) {
        saltar = true; break;
      }
    }
    if (saltar) continue;

    const ci = (r.compra_inicio || "").trim();
    const cf = (r.compra_fin || "").trim();
    const { error } = await sb.from("hotel_temporadas").insert({
      hotel_id: hotelId, nombre, fecha_inicio: inicio, fecha_fin: fin,
      prioridad: Math.max(1, numCsv(r.prioridad) || 1),
      compra_inicio: reFecha.test(ci) ? ci : null,
      compra_fin: reFecha.test(cf) ? cf : null,
    });
    if (error) { errores.push(`Fila ${linea} (${nombre}): ${error.message}`); continue; }
    insertados++;
  }
  revalidatePath("/dashboard/producto/hoteles");
  return { ok: errores.length === 0, insertados, errores };
}

// Carga masiva de ACOMODACIONES por hotel ("reservar por habitaciones"): pax que
// cubre la tarifa de 1 habitación, pax máx por habitación y mín/máx de
// adultos/niños/infantes. Una fila = una acomodación (sencilla/doble/triple/múltiple).
export async function cargarAcomodacionesMasivo(rows: Record<string, string>[]): Promise<CargaResult> {
  const sb = await createClient();
  const { data: hoteles } = await sb.from("hoteles").select("id, nombre, destinos(nombre)");
  type HRow = { id: number; nombre: string; destinos: { nombre: string } | null };
  const lista = (hoteles ?? []) as unknown as HRow[];
  const errores: string[] = [];
  let insertados = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const hotelNombre = (r.hotel || "").trim().toLowerCase();
    const acom = (r.acomodacion || "").trim().toLowerCase() as AcomRoom;
    if (!hotelNombre) { errores.push(`Fila ${linea}: falta hotel.`); continue; }
    if (!ACOM_ROOMS.includes(acom)) { errores.push(`Fila ${linea}: acomodación "${r.acomodacion}" inválida (usa: ${ACOM_ROOMS.join(", ")}).`); continue; }
    let candidatos = lista.filter((h) => h.nombre.trim().toLowerCase() === hotelNombre);
    if (candidatos.length > 1 && r.destino) {
      candidatos = candidatos.filter((h) => (h.destinos?.nombre ?? "").trim().toLowerCase() === r.destino.trim().toLowerCase());
    }
    if (!candidatos.length) { errores.push(`Fila ${linea}: hotel "${r.hotel}" no encontrado.`); continue; }
    if (candidatos.length > 1) { errores.push(`Fila ${linea}: hotel "${r.hotel}" duplicado; agrega columna destino.`); continue; }

    const fila = {
      hotel_id: candidatos[0].id,
      acomodacion: acom,
      pax_tarifa: numCsv(r.pax_tarifa) || 0,
      pax_max: numCsv(r.pax_max) || 0,
      adt_min: numCsv(r.adt_min) || 0, adt_max: numCsv(r.adt_max) || 0,
      chd_min: numCsv(r.chd_min) || 0, chd_max: numCsv(r.chd_max) || 0,
      inf_min: numCsv(r.inf_min) || 0, inf_max: numCsv(r.inf_max) || 0,
    };
    const { error } = await sb.from("hotel_acomodaciones").upsert(fila, { onConflict: "hotel_id,acomodacion" });
    if (error) { errores.push(`Fila ${linea} (${r.hotel}): ${error.message}`); continue; }
    insertados++;
  }
  revalidatePath("/dashboard/producto/hoteles");
  return { ok: errores.length === 0, insertados, errores };
}

// ── Calculadora de tarifas (estructura especial por hotel) ──────────────────
// Guarda el tipo + parámetros de la calculadora del hotel.
export async function guardarCalculadora(
  hotelId: number,
  tipo: string,
  params: DubaiParams
): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("hotel_calculadora")
    .upsert(
      { hotel_id: hotelId, tipo, params: params as unknown as Json, updated_at: new Date().toISOString() },
      { onConflict: "hotel_id" }
    );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

// Genera las filas de tarifa_hotel a partir de la calculadora del hotel.
// REEMPLAZA las tarifas existentes del hotel (en un hotel por fórmula, todas
// las tarifas salen de la fórmula).
export async function generarTarifasCalculadora(
  hotelId: number
): Promise<{ ok: true; generadas: number } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: calc } = await sb
    .from("hotel_calculadora")
    .select("tipo, params")
    .eq("hotel_id", hotelId)
    .maybeSingle();
  if (!calc) return { ok: false, error: "Este hotel no tiene calculadora configurada. Guárdala primero." };

  const filas = generarTarifas(calc.tipo, calc.params);
  if (!filas.length) return { ok: false, error: "No hay bases con precio para generar tarifas." };

  // Reemplaza las tarifas del hotel por las recién calculadas.
  await sb.from("tarifa_hotel").delete().eq("hotel_id", hotelId);
  const { error } = await sb
    .from("tarifa_hotel")
    .insert(filas.map((f) => ({ ...f, hotel_id: hotelId })));
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true, generadas: filas.length };
}
