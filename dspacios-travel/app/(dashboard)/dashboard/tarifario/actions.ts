"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// ─── Destinos ──────────────────────────────────────────────────────
export async function crearDestino(nombre: string, codigoIata?: string, pais?: string) {
  const sb = await createClient();
  const limpio = nombre.trim().toUpperCase();
  if (!limpio) throw new Error("El nombre del destino es obligatorio.");

  // Evitar duplicados sin importar mayúsculas/minúsculas (ej. "Cartagena" vs "CARTAGENA").
  const { data: existentes } = await sb.from("destinos").select("nombre");
  const yaExiste = (existentes ?? []).some(
    (d) => d.nombre.trim().toLowerCase() === limpio.toLowerCase()
  );
  if (yaExiste) throw new Error(`Ya existe un destino "${limpio}".`);

  const { error } = await sb.from("destinos").insert({
    nombre: limpio,
    codigo_iata: codigoIata?.trim().toUpperCase() || null,
    pais: pais?.trim() || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/tarifario");
  revalidatePath("/dashboard/producto/destinos");
}

export async function eliminarDestino(id: number) {
  const sb = await createClient();
  const { error } = await sb.from("destinos").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/tarifario");
}

// Lista curada de destinos turísticos famosos (nombre + IATA) para cargar de una.
// Colombia, República Dominicana y México. Se omiten los que ya existan.
const DESTINOS_SUGERIDOS: { nombre: string; iata: string; pais: string }[] = [
  // Colombia
  { nombre: "CARTAGENA", iata: "CTG", pais: "Colombia" },
  { nombre: "SAN ANDRÉS", iata: "ADZ", pais: "Colombia" },
  { nombre: "SANTA MARTA", iata: "SMR", pais: "Colombia" },
  { nombre: "BOGOTÁ", iata: "BOG", pais: "Colombia" },
  { nombre: "MEDELLÍN", iata: "MDE", pais: "Colombia" },
  { nombre: "CALI", iata: "CLO", pais: "Colombia" },
  { nombre: "BARRANQUILLA", iata: "BAQ", pais: "Colombia" },
  { nombre: "PEREIRA", iata: "PEI", pais: "Colombia" },
  { nombre: "ARMENIA", iata: "AXM", pais: "Colombia" },
  { nombre: "LETICIA", iata: "LET", pais: "Colombia" },
  { nombre: "RIOHACHA", iata: "RCH", pais: "Colombia" },
  // República Dominicana
  { nombre: "PUNTA CANA", iata: "PUJ", pais: "República Dominicana" },
  { nombre: "SANTO DOMINGO", iata: "SDQ", pais: "República Dominicana" },
  { nombre: "PUERTO PLATA", iata: "POP", pais: "República Dominicana" },
  { nombre: "LA ROMANA", iata: "LRM", pais: "República Dominicana" },
  { nombre: "SAMANÁ", iata: "AZS", pais: "República Dominicana" },
  { nombre: "SANTIAGO DE LOS CABALLEROS", iata: "STI", pais: "República Dominicana" },
  // México
  { nombre: "CANCÚN", iata: "CUN", pais: "México" },
  { nombre: "CIUDAD DE MÉXICO", iata: "MEX", pais: "México" },
  { nombre: "LOS CABOS", iata: "SJD", pais: "México" },
  { nombre: "PUERTO VALLARTA", iata: "PVR", pais: "México" },
  { nombre: "COZUMEL", iata: "CZM", pais: "México" },
  { nombre: "TULUM", iata: "TQO", pais: "México" },
  { nombre: "MÉRIDA", iata: "MID", pais: "México" },
  { nombre: "GUADALAJARA", iata: "GDL", pais: "México" },
  { nombre: "MAZATLÁN", iata: "MZT", pais: "México" },
  { nombre: "ACAPULCO", iata: "ACA", pais: "México" },
  { nombre: "OAXACA", iata: "OAX", pais: "México" },
];

export async function cargarDestinosSugeridos(): Promise<{ insertados: number; omitidos: number }> {
  const sb = await createClient();
  const { data: existentes } = await sb.from("destinos").select("nombre");
  const yaHay = new Set((existentes ?? []).map((d) => d.nombre.trim().toLowerCase()));

  const nuevos = DESTINOS_SUGERIDOS
    .filter((d) => !yaHay.has(d.nombre.toLowerCase()))
    .map((d) => ({ nombre: d.nombre, codigo_iata: d.iata, pais: d.pais }));

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
