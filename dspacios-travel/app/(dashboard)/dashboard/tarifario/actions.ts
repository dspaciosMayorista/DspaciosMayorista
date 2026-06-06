"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ─── Destinos ──────────────────────────────────────────────────────
export async function crearDestino(nombre: string, codigoIata?: string) {
  const sb = await createClient();
  const limpio = nombre.trim().toUpperCase();
  if (!limpio) throw new Error("El nombre del destino es obligatorio.");

  // Evitar duplicados sin importar mayúsculas/minúsculas (ej. "Cartagena" vs "CARTAGENA").
  const { data: existentes } = await sb.from("destinos").select("nombre");
  const yaExiste = (existentes ?? []).some(
    (d) => d.nombre.trim().toLowerCase() === limpio.toLowerCase()
  );
  if (yaExiste) throw new Error(`Ya existe un destino "${limpio}".`);

  const { error } = await sb.from("destinos").insert({ nombre: limpio, codigo_iata: codigoIata?.trim().toUpperCase() || null });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/tarifario");
}

export async function eliminarDestino(id: number) {
  const sb = await createClient();
  const { error } = await sb.from("destinos").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/tarifario");
}

// Lista curada de destinos turísticos famosos (nombre + IATA) para cargar de una.
// Colombia, República Dominicana y México. Se omiten los que ya existan.
const DESTINOS_SUGERIDOS: { nombre: string; iata: string }[] = [
  // Colombia
  { nombre: "CARTAGENA", iata: "CTG" },
  { nombre: "SAN ANDRÉS", iata: "ADZ" },
  { nombre: "SANTA MARTA", iata: "SMR" },
  { nombre: "BOGOTÁ", iata: "BOG" },
  { nombre: "MEDELLÍN", iata: "MDE" },
  { nombre: "CALI", iata: "CLO" },
  { nombre: "BARRANQUILLA", iata: "BAQ" },
  { nombre: "PEREIRA", iata: "PEI" },
  { nombre: "ARMENIA", iata: "AXM" },
  { nombre: "LETICIA", iata: "LET" },
  { nombre: "RIOHACHA", iata: "RCH" },
  // República Dominicana
  { nombre: "PUNTA CANA", iata: "PUJ" },
  { nombre: "SANTO DOMINGO", iata: "SDQ" },
  { nombre: "PUERTO PLATA", iata: "POP" },
  { nombre: "LA ROMANA", iata: "LRM" },
  { nombre: "SAMANÁ", iata: "AZS" },
  { nombre: "SANTIAGO DE LOS CABALLEROS", iata: "STI" },
  // México
  { nombre: "CANCÚN", iata: "CUN" },
  { nombre: "CIUDAD DE MÉXICO", iata: "MEX" },
  { nombre: "LOS CABOS", iata: "SJD" },
  { nombre: "PUERTO VALLARTA", iata: "PVR" },
  { nombre: "COZUMEL", iata: "CZM" },
  { nombre: "TULUM", iata: "TQO" },
  { nombre: "MÉRIDA", iata: "MID" },
  { nombre: "GUADALAJARA", iata: "GDL" },
  { nombre: "MAZATLÁN", iata: "MZT" },
  { nombre: "ACAPULCO", iata: "ACA" },
  { nombre: "OAXACA", iata: "OAX" },
];

export async function cargarDestinosSugeridos(): Promise<{ insertados: number; omitidos: number }> {
  const sb = await createClient();
  const { data: existentes } = await sb.from("destinos").select("nombre");
  const yaHay = new Set((existentes ?? []).map((d) => d.nombre.trim().toLowerCase()));

  const nuevos = DESTINOS_SUGERIDOS
    .filter((d) => !yaHay.has(d.nombre.toLowerCase()))
    .map((d) => ({ nombre: d.nombre, codigo_iata: d.iata }));

  if (nuevos.length) {
    const { error } = await sb.from("destinos").insert(nuevos);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/dashboard/tarifario");
  revalidatePath("/dashboard/producto/destinos");
  return { insertados: nuevos.length, omitidos: DESTINOS_SUGERIDOS.length - nuevos.length };
}

// ─── Hoteles ───────────────────────────────────────────────────────
export async function crearHotel(destinoId: number, nombre: string, zona?: string, notas?: string) {
  const sb = await createClient();
  const { error } = await sb.from("hoteles").insert({
    destino_id: destinoId,
    nombre,
    zona: zona || null,
    notas: notas || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}

export async function eliminarHotel(id: number, destinoId: number) {
  const sb = await createClient();
  const { error } = await sb.from("hoteles").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}

// ─── Temporadas ────────────────────────────────────────────────────
export async function crearTemporada(
  destinoId: number,
  nombre: "ALTA" | "MEDIA" | "BAJA",
  anio: number,
  fechas: { inicio: string; fin: string }[]
) {
  const sb = await createClient();
  const { data: temp, error } = await sb
    .from("temporadas")
    .insert({ destino_id: destinoId, nombre, anio })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (fechas.length > 0) {
    const { error: fe } = await sb.from("temporada_fechas").insert(
      fechas.map((f) => ({ temporada_id: temp.id, fecha_inicio: f.inicio, fecha_fin: f.fin }))
    );
    if (fe) throw new Error(fe.message);
  }
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}

export async function eliminarTemporada(id: number, destinoId: number) {
  const sb = await createClient();
  const { error } = await sb.from("temporadas").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}

// ─── Tarifas (Módulo de Producto) ──────────────────────────────────
export type PrecioAcomodacion = {
  acomodacion: "sencilla" | "doble" | "triple" | "multiple" | "nino";
  precio: number;
};

export async function guardarTarifa(data: {
  hotelId: number;
  habitacionId?: number | null;
  planId: number;
  temporadaId: number;
  noches: number;
  comisionable: boolean;
  impuestoNoComisionable: number;
  costoBase?: number | null;
  pctMk?: number | null;
  notas?: string;
  precios: PrecioAcomodacion[];
  destinoId: number;
}) {
  const sb = await createClient();

  // Upsert tarifa principal
  const { data: tarifa, error } = await sb
    .from("tarifas")
    .upsert(
      {
        hotel_id: data.hotelId,
        habitacion_id: data.habitacionId ?? null,
        plan_id: data.planId,
        temporada_id: data.temporadaId,
        noches: data.noches,
        comisionable: data.comisionable,
        impuesto_no_comisionable: data.impuestoNoComisionable,
        costo_base: data.costoBase ?? null,
        pct_mk: data.pctMk ?? null,
        notas: data.notas ?? null,
        activo: true,
      },
      { onConflict: "hotel_id,plan_id,temporada_id,noches" }
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Reemplazar precios
  await sb.from("tarifa_precios").delete().eq("tarifa_id", tarifa.id);
  if (data.precios.length > 0) {
    const { error: pe } = await sb.from("tarifa_precios").insert(
      data.precios.map((p) => ({ tarifa_id: tarifa.id, acomodacion: p.acomodacion, precio: p.precio }))
    );
    if (pe) throw new Error(pe.message);
  }
  revalidatePath(`/dashboard/tarifario/${data.destinoId}`);
}

export async function eliminarTarifa(id: number, destinoId: number) {
  const sb = await createClient();
  // tarifa_precios cae por FK on delete cascade; si no, lo limpiamos explícito
  await sb.from("tarifa_precios").delete().eq("tarifa_id", id);
  const { error } = await sb.from("tarifas").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}

// ─── Inclusiones ──────────────────────────────────────────────────
export async function crearInclusion(
  destinoId: number,
  tipo: "incluye" | "no_incluye",
  texto: string
) {
  const sb = await createClient();
  const { error } = await sb.from("inclusiones").insert({ destino_id: destinoId, tipo, texto });
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}

export async function eliminarInclusion(id: number, destinoId: number) {
  const sb = await createClient();
  const { error } = await sb.from("inclusiones").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dashboard/tarifario/${destinoId}`);
}
