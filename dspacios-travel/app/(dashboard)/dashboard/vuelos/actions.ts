"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true; id?: number } | { ok: false; error: string };

const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type BloqueoInput = {
  record: string;
  aerolinea: string;
  proveedorId: number | null;
  destinoId: number | null;
  ruta: string;
  origen: string;
  tarifaNeta: number;
  vueloIda: string;
  fechaIda: string;
  horaSalidaIda: string;
  horaLlegadaIda: string;
  vueloRegreso: string;
  fechaRegreso: string;
  horaSalidaReg: string;
  horaLlegadaReg: string;
  cuposTotal: number;
  tarifaParaEmpaquetar: number;
  fechaDevolucion: string;
  fechaEmision: string;
  notas: string;
  rangosEdad?: number[];
};

export async function crearBloqueo(input: BloqueoInput): Promise<Result> {
  const sb = await createClient();

  const { data: bloqueo, error } = await sb
    .from("bloqueos_vuelo")
    .insert({
      record: input.record.trim().toUpperCase(),
      aerolinea: oNull(input.aerolinea),
      proveedor_id: input.proveedorId,
      destino_id: input.destinoId,
      ruta: oNull(input.ruta),
      origen: oNull(input.origen),
      tarifa_neta: input.tarifaNeta || null,
      vuelo_ida: oNull(input.vueloIda),
      fecha_ida: oNull(input.fechaIda),
      hora_salida_ida: oNull(input.horaSalidaIda),
      hora_llegada_ida: oNull(input.horaLlegadaIda),
      vuelo_regreso: oNull(input.vueloRegreso),
      fecha_regreso: oNull(input.fechaRegreso),
      hora_salida_reg: oNull(input.horaSalidaReg),
      hora_llegada_reg: oNull(input.horaLlegadaReg),
      cupos_total: input.cuposTotal,
      tarifa_para_empaquetar: input.tarifaParaEmpaquetar,
      fecha_devolucion: oNull(input.fechaDevolucion),
      fecha_emision: oNull(input.fechaEmision),
      notas: oNull(input.notas),
      rangos_edad: input.rangosEdad?.length ? input.rangosEdad : null,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  // Generar las sillas (1..cupos) en estado disponible
  if (input.cuposTotal > 0) {
    const sillas = Array.from({ length: input.cuposTotal }, (_, i) => ({
      bloqueo_id: bloqueo.id,
      numero_silla: i + 1,
      estado: "disponible" as const,
    }));
    const { error: se } = await sb.from("sillas").insert(sillas);
    if (se) return { ok: false, error: se.message };
  }

  revalidatePath("/dashboard/vuelos");
  return { ok: true, id: bloqueo.id };
}

// Editar un bloqueo existente (no modifica cupos/sillas ya generadas).
export type BloqueoEditInput = Omit<BloqueoInput, "cuposTotal">;
export async function actualizarBloqueo(id: number, input: BloqueoEditInput): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("bloqueos_vuelo")
    .update({
      record: input.record.trim().toUpperCase(),
      aerolinea: oNull(input.aerolinea),
      proveedor_id: input.proveedorId,
      destino_id: input.destinoId,
      ruta: oNull(input.ruta),
      origen: oNull(input.origen),
      tarifa_neta: input.tarifaNeta || null,
      vuelo_ida: oNull(input.vueloIda),
      fecha_ida: oNull(input.fechaIda),
      hora_salida_ida: oNull(input.horaSalidaIda),
      hora_llegada_ida: oNull(input.horaLlegadaIda),
      vuelo_regreso: oNull(input.vueloRegreso),
      fecha_regreso: oNull(input.fechaRegreso),
      hora_salida_reg: oNull(input.horaSalidaReg),
      hora_llegada_reg: oNull(input.horaLlegadaReg),
      tarifa_para_empaquetar: input.tarifaParaEmpaquetar,
      fecha_devolucion: oNull(input.fechaDevolucion),
      fecha_emision: oNull(input.fechaEmision),
      notas: oNull(input.notas),
      rangos_edad: input.rangosEdad?.length ? input.rangosEdad : null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/vuelos/${id}`);
  return { ok: true, id };
}

// ── Cambio operacional (vuelos/horas/fechas) con registro en historial ────────
export type CambioOperacionalInput = {
  vueloIda: string; fechaIda: string; horaSalidaIda: string; horaLlegadaIda: string;
  vueloRegreso: string; fechaRegreso: string; horaSalidaReg: string; horaLlegadaReg: string;
  nota: string;
};

export async function registrarCambioOperacional(
  bloqueoId: number,
  input: CambioOperacionalInput
): Promise<Result> {
  const sb = await createClient();

  const { data: actual } = await sb
    .from("bloqueos_vuelo")
    .select("vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg")
    .eq("id", bloqueoId)
    .single();
  if (!actual) return { ok: false, error: "Bloqueo no encontrado." };

  // Campos a comparar (etiqueta · valor actual · valor nuevo)
  const campos: [string, string, string | null, string | null][] = [
    ["# Vuelo ida", "vuelo_ida", actual.vuelo_ida, oNull(input.vueloIda)],
    ["Fecha ida", "fecha_ida", actual.fecha_ida, oNull(input.fechaIda)],
    ["Hora salida ida", "hora_salida_ida", actual.hora_salida_ida, oNull(input.horaSalidaIda)],
    ["Hora llegada ida", "hora_llegada_ida", actual.hora_llegada_ida, oNull(input.horaLlegadaIda)],
    ["# Vuelo regreso", "vuelo_regreso", actual.vuelo_regreso, oNull(input.vueloRegreso)],
    ["Fecha regreso", "fecha_regreso", actual.fecha_regreso, oNull(input.fechaRegreso)],
    ["Hora salida regreso", "hora_salida_reg", actual.hora_salida_reg, oNull(input.horaSalidaReg)],
    ["Hora llegada regreso", "hora_llegada_reg", actual.hora_llegada_reg, oNull(input.horaLlegadaReg)],
  ];

  const cambios = campos.filter(([, , antes, despues]) => (antes ?? "") !== (despues ?? ""));
  if (!cambios.length && !input.nota.trim()) return { ok: false, error: "No hay cambios para registrar." };

  // Aplica los cambios al bloqueo (campos conocidos; los iguales no cambian nada)
  if (cambios.length) {
    const { error } = await sb
      .from("bloqueos_vuelo")
      .update({
        vuelo_ida: oNull(input.vueloIda),
        fecha_ida: oNull(input.fechaIda),
        hora_salida_ida: oNull(input.horaSalidaIda),
        hora_llegada_ida: oNull(input.horaLlegadaIda),
        vuelo_regreso: oNull(input.vueloRegreso),
        fecha_regreso: oNull(input.fechaRegreso),
        hora_salida_reg: oNull(input.horaSalidaReg),
        hora_llegada_reg: oNull(input.horaLlegadaReg),
      })
      .eq("id", bloqueoId);
    if (error) return { ok: false, error: error.message };
  }

  // Detalle del historial (antes → después)
  const detalle = cambios.map(([lbl, , antes, despues]) => `${lbl}: ${antes ?? "—"} → ${despues ?? "—"}`).join(" · ");

  // Quién lo registra
  const { data: { user } } = await sb.auth.getUser();
  let quien = user?.email ?? null;
  if (user) {
    const { data: perfil } = await sb.from("usuarios").select("nombre").eq("id", user.id).maybeSingle();
    if (perfil?.nombre) quien = perfil.nombre;
  }

  const { error: le } = await sb.from("bloqueo_cambios").insert({
    bloqueo_id: bloqueoId,
    detalle: detalle || null,
    nota: oNull(input.nota),
    registrado_por: quien,
  });
  if (le) return { ok: false, error: le.message };

  revalidatePath(`/dashboard/vuelos/${bloqueoId}`);
  return { ok: true, id: bloqueoId };
}

// ── Carga masiva de bloqueos (CSV) ─────────────────────────────────────────
const numCsv = (s?: string) => (s ? parseInt(String(s).replace(/[^\d-]/g, ""), 10) || 0 : 0);
const dCsv = (s?: string) => (s && s.trim() !== "" ? s.trim() : null);

export async function cargarBloqueosMasivo(
  rows: Record<string, string>[]
): Promise<{ ok: boolean; insertados: number; errores: string[] }> {
  const sb = await createClient();
  const [{ data: destinos }, { data: provs }, { data: rangos }] = await Promise.all([
    sb.from("destinos").select("id, nombre"),
    sb.from("proveedores").select("id, nombre"),
    sb.from("rangos_edad").select("id, denominacion"),
  ]);
  const dmap = new Map((destinos ?? []).map((d) => [d.nombre.trim().toLowerCase(), d.id]));
  const pmap = new Map((provs ?? []).map((p) => [p.nombre.trim().toLowerCase(), p.id]));
  const rmap = new Map((rangos ?? []).map((x) => [x.denominacion.trim().toLowerCase(), x.id]));
  const errores: string[] = [];
  let insertados = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const record = (r.record || "").trim().toUpperCase();
    if (!record) { errores.push(`Fila ${linea}: falta record (PNR).`); continue; }
    let destinoId: number | null = null;
    if (r.destino && r.destino.trim()) {
      destinoId = dmap.get(r.destino.trim().toLowerCase()) ?? null;
      if (destinoId === null) errores.push(`Fila ${linea}: destino "${r.destino}" no existe (se deja sin destino).`);
    }
    const provId = r.proveedor ? pmap.get(r.proveedor.trim().toLowerCase()) ?? null : null;
    const rangosEdad = (r.rangos_edad || "")
      .split(/[|;]/).map((x) => rmap.get(x.trim().toLowerCase())).filter((x): x is number => !!x);
    const cupos = numCsv(r.cupos_total);
    const { data: bq, error } = await sb
      .from("bloqueos_vuelo")
      .insert({
        record, aerolinea: oNull(r.aerolinea || ""), proveedor_id: provId, destino_id: destinoId, ruta: oNull(r.ruta || ""), origen: oNull(r.origen || ""),
        vuelo_ida: oNull(r.vuelo_ida || ""), fecha_ida: dCsv(r.fecha_ida), hora_salida_ida: dCsv(r.hora_salida_ida), hora_llegada_ida: dCsv(r.hora_llegada_ida),
        vuelo_regreso: oNull(r.vuelo_regreso || ""), fecha_regreso: dCsv(r.fecha_regreso), hora_salida_reg: dCsv(r.hora_salida_reg), hora_llegada_reg: dCsv(r.hora_llegada_reg),
        cupos_total: cupos, tarifa_neta: numCsv(r.tarifa_neta) || null, tarifa_para_empaquetar: numCsv(r.tarifa_para_empaquetar),
        fecha_devolucion: dCsv(r.fecha_devolucion), fecha_emision: dCsv(r.fecha_emision), notas: oNull(r.notas || ""),
        rangos_edad: rangosEdad.length ? rangosEdad : null,
      })
      .select("id")
      .single();
    if (error || !bq) { errores.push(`Fila ${linea} (${record}): ${error?.message ?? "no se insertó"}`); continue; }
    if (cupos > 0) {
      const sillas = Array.from({ length: cupos }, (_, k) => ({ bloqueo_id: bq.id, numero_silla: k + 1, estado: "disponible" as const }));
      await sb.from("sillas").insert(sillas);
    }
    insertados++;
  }
  revalidatePath("/dashboard/vuelos");
  return { ok: errores.length === 0, insertados, errores };
}

export async function cambiarSillas(input: {
  origenId: number;
  destinoId: number;
  cantidad: number;
  motivo: string;
}): Promise<Result> {
  const sb = await createClient();
  if (input.origenId === input.destinoId)
    return { ok: false, error: "El origen y el destino deben ser distintos." };
  if (input.cantidad <= 0) return { ok: false, error: "Cantidad inválida." };

  // Sillas disponibles en el origen
  const { data: libres } = await sb
    .from("sillas")
    .select("id")
    .eq("bloqueo_id", input.origenId)
    .in("estado", ["disponible", "cambio_entrante"])
    .order("numero_silla")
    .limit(input.cantidad);
  if (!libres || libres.length < input.cantidad)
    return { ok: false, error: `Solo hay ${libres?.length ?? 0} sillas disponibles en el origen.` };
  const ids = libres.map((s) => s.id);

  // Origen → CAMBIO
  const { error: e1 } = await sb.from("sillas").update({ estado: "cambio" }).in("id", ids);
  if (e1) return { ok: false, error: e1.message };

  // Siguiente número de silla en el destino
  const { data: maxRows } = await sb
    .from("sillas")
    .select("numero_silla")
    .eq("bloqueo_id", input.destinoId)
    .order("numero_silla", { ascending: false })
    .limit(1);
  const next = maxRows?.[0]?.numero_silla ?? 0;

  // Destino → nuevas CAMBIO ENTRANTE
  const nuevas = Array.from({ length: input.cantidad }, (_, i) => ({
    bloqueo_id: input.destinoId,
    numero_silla: next + i + 1,
    estado: "cambio_entrante" as const,
  }));
  const { error: e2 } = await sb.from("sillas").insert(nuevas);
  if (e2) return { ok: false, error: e2.message };

  // Registrar movimientos
  await sb.from("movimientos_silla").insert(
    ids.map((silla_id) => ({
      silla_id,
      bloqueo_origen_id: input.origenId,
      bloqueo_destino_id: input.destinoId,
      motivo: input.motivo || null,
    }))
  );

  revalidatePath(`/dashboard/vuelos/${input.origenId}`);
  revalidatePath(`/dashboard/vuelos/${input.destinoId}`);
  revalidatePath("/dashboard/vuelos");
  return { ok: true };
}

export type EstadoSillaManual = "disponible" | "en_plazo" | "confirmada" | "devuelta" | "no_vendida";

export async function cambiarEstadoSilla(
  sillaId: number,
  estado: EstadoSillaManual,
  bloqueoId: number
): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("sillas")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("id", sillaId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/vuelos/${bloqueoId}`);
  revalidatePath("/dashboard/vuelos");
  return { ok: true };
}

export async function eliminarBloqueo(id: number): Promise<Result> {
  const sb = await createClient();
  // Borrar sillas primero (no hay cascade declarado)
  await sb.from("sillas").delete().eq("bloqueo_id", id);
  const { error } = await sb.from("bloqueos_vuelo").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/vuelos");
  return { ok: true };
}
