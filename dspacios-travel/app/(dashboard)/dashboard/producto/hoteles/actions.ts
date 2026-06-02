"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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

export async function actualizarHotelConfig(
  hotelId: number,
  input: {
    zona: string;
    edadInfanteMin: number;
    edadInfanteMax: number;
    edadNinoMin: number;
    edadNinoMax: number;
    rangosEdad: number[];
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
    })
    .eq("id", hotelId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
  return { ok: true };
}

// ── Temporadas del hotel ──────────────────────────────────────────────────
export async function crearTemporada(
  hotelId: number,
  nombre: string,
  inicio: string,
  fin: string
): Promise<Result> {
  if (!nombre.trim()) return { ok: false, error: "El nombre de la temporada es obligatorio." };
  if (!inicio || !fin) return { ok: false, error: "Debes indicar fecha de inicio y fin." };
  if (fin < inicio) return { ok: false, error: "La fecha final no puede ser menor que la inicial." };

  const sb = await createClient();

  // No se permite solapar fechas con otra temporada del mismo hotel:
  // una noche solo puede pertenecer a una temporada.
  const { data: existentes } = await sb
    .from("hotel_temporadas")
    .select("nombre, fecha_inicio, fecha_fin")
    .eq("hotel_id", hotelId);
  for (const e of existentes ?? []) {
    if (!e.fecha_inicio || !e.fecha_fin) continue;
    // Solapan si inicio <= fin_existente && fin >= inicio_existente
    if (inicio <= e.fecha_fin && fin >= e.fecha_inicio) {
      return {
        ok: false,
        error: `Las fechas se cruzan con la temporada "${e.nombre}" (${e.fecha_inicio} → ${e.fecha_fin}).`,
      };
    }
  }

  const { error } = await sb.from("hotel_temporadas").insert({
    hotel_id: hotelId,
    nombre: nombre.trim(),
    fecha_inicio: inicio,
    fecha_fin: fin,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/producto/hoteles/${hotelId}`);
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
  const [{ data: destinos }, { data: provs }, { data: cats }, { data: regs }] = await Promise.all([
    sb.from("destinos").select("id, nombre"),
    sb.from("proveedores").select("id, nombre").eq("tipo", "hotelero"),
    sb.from("categorias_habitacion").select("id, nombre"),
    sb.from("planes_alimentacion").select("id, codigo"),
  ]);
  const dmap = new Map((destinos ?? []).map((d) => [d.nombre.trim().toLowerCase(), d.id]));
  const pmap = new Map((provs ?? []).map((p) => [p.nombre.trim().toLowerCase(), p.id]));
  const cmap = new Map((cats ?? []).map((c) => [c.nombre.trim().toLowerCase(), c.id]));
  const rmap = new Map((regs ?? []).map((r) => [r.codigo.trim().toLowerCase(), r.id]));
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
    const { data: hotel, error } = await sb
      .from("hoteles")
      .insert({
        nombre, destino_id: destinoId, proveedor_id: provId, zona: oNull(r.zona || ""),
        edad_infante_min: numCsv(r.edad_infante_min) || 0, edad_infante_max: numCsv(r.edad_infante_max) || 2,
        edad_nino_min: numCsv(r.edad_nino_min) || 2, edad_nino_max: numCsv(r.edad_nino_max) || 10,
      })
      .select("id")
      .single();
    if (error || !hotel) { errores.push(`Fila ${linea} (${nombre}): ${error?.message ?? "no se insertó"}`); continue; }
    const catIds = (r.categorias || "").split(";").map((x) => cmap.get(x.trim().toLowerCase())).filter((x): x is number => !!x);
    const regIds = (r.regimenes || "").split(";").map((x) => rmap.get(x.trim().toLowerCase())).filter((x): x is number => !!x);
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
