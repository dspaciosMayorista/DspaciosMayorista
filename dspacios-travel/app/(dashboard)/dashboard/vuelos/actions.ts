"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { regenerarTarifariosDeBloqueo, generarTarifario } from "../paquetes/actions";
import {
  esModalidadEmision,
  esEstadoEmision,
  esEstadoPago,
  MODALIDAD_LABEL,
  ESTADO_EMISION_LABEL,
  ESTADO_PAGO_LABEL,
  SIN_DEFINIR,
  type ModalidadEmision,
  type EstadoEmision,
  type EstadoPago,
} from "@/lib/vuelos/control";

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
  // Modalidad de emisión del record — OBLIGATORIA al crear (migración 151).
  // Los estados de emisión/pago NO se piden aquí: un bloqueo nuevo nace
  // 'pendiente' en los dos, lo decide esta función, no el formulario.
  modalidadEmision: ModalidadEmision;
};

export async function crearBloqueo(input: BloqueoInput): Promise<Result> {
  if (!esModalidadEmision(input.modalidadEmision)) {
    return { ok: false, error: "Selecciona la modalidad de emisión (individual o grupo)." };
  }
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
      modalidad_emision: input.modalidadEmision,
      estado_emision: "pendiente",
      estado_pago: "pendiente",
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
// "Editar bloqueo" (general) NO toca modalidad/estados — esos tres campos
// tienen su propio editor con historial (`actualizarControlBloqueo`, pestaña
// "Control"), igual que horario/vuelo tiene el suyo (`registrarCambioOperacional`).
export type BloqueoEditInput = Omit<BloqueoInput, "cuposTotal" | "modalidadEmision">;
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
  await regenerarTarifariosDeBloqueo(id); // la tarifa/fechas del aéreo cambió → recalcula paquetes
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
  await regenerarTarifariosDeBloqueo(bloqueoId); // fechas/vuelos cambiaron → recalcula
  return { ok: true, id: bloqueoId };
}

// ── Control general del record: modalidad, emisión y pago (migración 151) ──
// Los tres campos son manuales y ajenos a la tarifa/fecha del vuelo, así que
// —a diferencia de `actualizarBloqueo`/`registrarCambioOperacional`— esta
// función NO llama `regenerarTarifariosDeBloqueo`: no hay nada que recalcular
// en los paquetes armados por cambiar solo modalidad/emisión/pago.
export type ControlBloqueoInput = {
  modalidadEmision: ModalidadEmision;
  estadoEmision: EstadoEmision;
  estadoPago: EstadoPago;
  nota: string;
};

export async function actualizarControlBloqueo(bloqueoId: number, input: ControlBloqueoInput): Promise<Result> {
  if (!esModalidadEmision(input.modalidadEmision)) return { ok: false, error: "Modalidad de emisión inválida." };
  if (!esEstadoEmision(input.estadoEmision)) return { ok: false, error: "Estado de emisión inválido." };
  if (!esEstadoPago(input.estadoPago)) return { ok: false, error: "Estado de pago inválido." };

  const sb = await createClient();
  const { data: actual } = await sb
    .from("bloqueos_vuelo")
    .select("modalidad_emision, estado_emision, estado_pago")
    .eq("id", bloqueoId)
    .maybeSingle();
  if (!actual) return { ok: false, error: "Bloqueo no encontrado." };

  // Antes→después con las mismas etiquetas que ve el usuario (no los valores
  // crudos de la BD) — "null" se registra como "Sin definir", nunca en blanco.
  const campos: [string, string | null, string, Record<string, string>][] = [
    ["Modalidad de emisión", actual.modalidad_emision, input.modalidadEmision, MODALIDAD_LABEL],
    ["Estado de emisión", actual.estado_emision, input.estadoEmision, ESTADO_EMISION_LABEL],
    ["Estado de pago", actual.estado_pago, input.estadoPago, ESTADO_PAGO_LABEL],
  ];
  const cambios = campos.filter(([, antes, despues]) => (antes ?? "") !== despues);
  if (!cambios.length && !input.nota.trim()) return { ok: false, error: "No hay cambios para registrar." };

  if (cambios.length) {
    const { error } = await sb
      .from("bloqueos_vuelo")
      .update({
        modalidad_emision: input.modalidadEmision,
        estado_emision: input.estadoEmision,
        estado_pago: input.estadoPago,
      })
      .eq("id", bloqueoId);
    if (error) return { ok: false, error: error.message };
  }

  const detalle = cambios
    .map(([lbl, antes, despues, labels]) => `${lbl}: ${antes ? (labels[antes] ?? antes) : SIN_DEFINIR} → ${labels[despues]}`)
    .join(" · ");

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
  revalidatePath("/dashboard/vuelos");
  revalidatePath("/dashboard/vuelos/historico");
  return { ok: true, id: bloqueoId };
}

// ── Carga masiva de bloqueos (CSV) ─────────────────────────────────────────
const numCsv = (s?: string) => (s ? parseInt(String(s).replace(/[^\d-]/g, ""), 10) || 0 : 0);

// Convierte fecha CSV a YYYY-MM-DD.
// Acepta: dd/mm/aa · dd/mm/aaaa · ya en YYYY-MM-DD. Ignora vacíos.
function parseFechaCSV(s?: string): string | null {
  if (!s || s.trim() === "") return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yy}-${mm}-${dd}`;
  }
  return t;
}

// Hora CSV: ya se asume HH:MM (24h). Solo normaliza vacíos.
const dCsv = (s?: string) => (s && s.trim() !== "" ? s.trim() : null);

// Modalidad/estados del control (migración 151) — validación ESTRICTA: un
// valor que no sea exactamente uno de los esperados (vacío incluido, para
// modalidad) rechaza la fila entera, no se adivina ni se deja pasar en null.
function parseModalidadCSV(s?: string): ModalidadEmision | null {
  const t = (s || "").trim().toLowerCase();
  return esModalidadEmision(t) ? t : null;
}
// Estados de emisión/pago: vacío = 'pendiente' (un bloqueo nuevo genuinamente
// empieza así). Cualquier otro texto tiene que ser exactamente uno de los
// valores válidos — si no, la fila se rechaza en vez de asumir 'pendiente'
// por defecto (eso ocultaría un typo del CSV como si no hubiera problema).
function parseEstadoEmisionCSV(s?: string): EstadoEmision | null {
  const t = (s || "").trim().toLowerCase();
  if (t === "") return "pendiente";
  return esEstadoEmision(t) ? t : null;
}
function parseEstadoPagoCSV(s?: string): EstadoPago | null {
  const t = (s || "").trim().toLowerCase();
  if (t === "") return "pendiente";
  return esEstadoPago(t) ? t : null;
}

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

    const modalidad = parseModalidadCSV(r.modalidad_emision);
    if (!modalidad) { errores.push(`Fila ${linea} (${record}): modalidad_emision debe ser "individual" o "grupo".`); continue; }
    const estadoEmision = parseEstadoEmisionCSV(r.estado_emision);
    if (!estadoEmision) { errores.push(`Fila ${linea} (${record}): estado_emision debe ser "pendiente" o "emitido" (o dejarse vacío).`); continue; }
    const estadoPago = parseEstadoPagoCSV(r.estado_pago);
    if (!estadoPago) { errores.push(`Fila ${linea} (${record}): estado_pago debe ser "pendiente" o "pagado" (o dejarse vacío).`); continue; }

    const { data: bq, error } = await sb
      .from("bloqueos_vuelo")
      .insert({
        record, aerolinea: oNull(r.aerolinea || ""), proveedor_id: provId, destino_id: destinoId, ruta: oNull(r.ruta || ""), origen: oNull(r.origen || ""),
        vuelo_ida: oNull(r.vuelo_ida || ""), fecha_ida: parseFechaCSV(r.fecha_ida), hora_salida_ida: dCsv(r.hora_salida_ida), hora_llegada_ida: dCsv(r.hora_llegada_ida),
        vuelo_regreso: oNull(r.vuelo_regreso || ""), fecha_regreso: parseFechaCSV(r.fecha_regreso), hora_salida_reg: dCsv(r.hora_salida_reg), hora_llegada_reg: dCsv(r.hora_llegada_reg),
        cupos_total: cupos, tarifa_neta: numCsv(r.tarifa_neta) || null, tarifa_para_empaquetar: numCsv(r.tarifa_para_empaquetar),
        fecha_devolucion: parseFechaCSV(r.fecha_devolucion), fecha_emision: parseFechaCSV(r.fecha_emision), notas: oNull(r.notas || ""),
        rangos_edad: rangosEdad.length ? rangosEdad : null,
        modalidad_emision: modalidad, estado_emision: estadoEmision, estado_pago: estadoPago,
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

  // Mantener cupos_total en sincronía: el origen pierde N cupos (salieron a otro
  // record) y el destino gana N. Así el campo guardado no se desfasa del conteo
  // real de sillas.
  const [{ data: bo }, { data: bd }] = await Promise.all([
    sb.from("bloqueos_vuelo").select("cupos_total").eq("id", input.origenId).maybeSingle(),
    sb.from("bloqueos_vuelo").select("cupos_total").eq("id", input.destinoId).maybeSingle(),
  ]);
  await Promise.all([
    sb.from("bloqueos_vuelo").update({ cupos_total: Math.max(0, (Number(bo?.cupos_total) || 0) - input.cantidad) }).eq("id", input.origenId),
    sb.from("bloqueos_vuelo").update({ cupos_total: (Number(bd?.cupos_total) || 0) + input.cantidad }).eq("id", input.destinoId),
  ]);

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

// ── Contrato MANUAL en una silla (venta externa al sistema) ────────────────
// Excluyente con el contrato orgánico: si la silla ya nació de una venta del
// sistema (numero_contrato), NO se le puede poner manual. Al asignarlo, la
// silla queda CONFIRMADA (ocupa el cupo).
export async function asignarContratoManual(
  sillaId: number,
  contratoManual: string,
  bloqueoId: number
): Promise<Result> {
  const sb = await createClient();
  const num = (contratoManual ?? "").trim();
  if (!num) return { ok: false, error: "Escribe el número de contrato manual." };

  const { data: s } = await sb.from("sillas").select("numero_contrato, estado").eq("id", sillaId).maybeSingle();
  if (!s) return { ok: false, error: "Silla no encontrada." };
  if (s.numero_contrato)
    return { ok: false, error: `Esta silla ya tiene el contrato orgánico ${s.numero_contrato}. No puede tener uno manual.` };
  if (s.estado === "cambio" || s.estado === "cambio_entrante")
    return { ok: false, error: "Una silla en cambio no admite contrato manual." };

  const { error } = await sb
    .from("sillas")
    // Cast: los tipos generados aún no incluyen contrato_manual (migración 085).
    .update({ contrato_manual: num, estado: "confirmada", updated_at: new Date().toISOString() } as never)
    .eq("id", sillaId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/vuelos/${bloqueoId}`);
  revalidatePath("/dashboard/vuelos");
  return { ok: true };
}

export async function quitarContratoManual(sillaId: number, bloqueoId: number): Promise<Result> {
  const sb = await createClient();
  const { data: s } = await (sb.from("sillas").select("contrato_manual").eq("id", sillaId).maybeSingle() as unknown as Promise<{ data: { contrato_manual: string | null } | null }>);
  if (!s) return { ok: false, error: "Silla no encontrada." };
  if (!s.contrato_manual) return { ok: false, error: "Esta silla no tiene contrato manual." };
  const { error } = await sb
    .from("sillas")
    .update({ contrato_manual: null, estado: "disponible", updated_at: new Date().toISOString() } as never)
    .eq("id", sillaId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/vuelos/${bloqueoId}`);
  revalidatePath("/dashboard/vuelos");
  return { ok: true };
}

// ── Eliminar un cupo (silla) del bloqueo ───────────────────────────────────
// Solo se permite quitar sillas DISPONIBLES (o cambio_entrante sin asignar): si
// había 10 cupos y se elimina uno, quedan 9. Decrementa cupos_total y registra
// el movimiento en el historial de cambios.
export async function eliminarCupo(sillaId: number, bloqueoId: number): Promise<Result> {
  const sb = await createClient();
  const { data: s } = await (sb
    .from("sillas")
    .select("estado, numero_silla, numero_contrato, contrato_manual")
    .eq("id", sillaId)
    .maybeSingle() as unknown as Promise<{ data: { estado: string; numero_silla: number | null; numero_contrato: string | null; contrato_manual: string | null } | null }>);
  if (!s) return { ok: false, error: "Silla no encontrada." };
  if (!["disponible", "cambio_entrante"].includes(s.estado) || s.numero_contrato || s.contrato_manual)
    return { ok: false, error: "Solo se pueden eliminar cupos disponibles (sin venta ni contrato)." };

  // movimientos_silla referencia la silla (FK sin cascade): limpiar primero.
  await sb.from("movimientos_silla").delete().eq("silla_id", sillaId);
  const { error } = await sb.from("sillas").delete().eq("id", sillaId);
  if (error) return { ok: false, error: error.message };

  // Decrementar cupos_total del bloqueo (no baja de 0).
  const { data: b } = await sb.from("bloqueos_vuelo").select("cupos_total").eq("id", bloqueoId).maybeSingle();
  const nuevo = Math.max(0, (Number(b?.cupos_total) || 0) - 1);
  await sb.from("bloqueos_vuelo").update({ cupos_total: nuevo }).eq("id", bloqueoId);

  // Registrar en el historial de cambios del bloqueo.
  const { data: { user } } = await sb.auth.getUser();
  await sb.from("bloqueo_cambios").insert({
    bloqueo_id: bloqueoId,
    detalle: `Cupo eliminado (silla ${s.numero_silla ?? "?"}). Cupos: ${nuevo}.`,
    registrado_por: user?.email ?? null,
  });

  revalidatePath(`/dashboard/vuelos/${bloqueoId}`);
  revalidatePath("/dashboard/vuelos");
  return { ok: true };
}

export async function eliminarBloqueo(id: number): Promise<Result> {
  const sb = await createClient();
  // Captura los paquetes que usaban el bloqueo ANTES de borrarlo; se regeneran
  // DESPUÉS para que el tarifario deje de publicar esa salida.
  const { data: usados } = await sb.from("armado_vuelos").select("paquete_id").eq("bloqueo_id", id);
  const paqIds = [...new Set((usados ?? []).map((u) => u.paquete_id))];

  // Dependencias sin cascade que bloquean el borrado:
  // 1) movimientos_silla → silla_id de las sillas de este bloqueo, y los
  //    movimientos donde este bloqueo es origen o destino de un cambio.
  const { data: sillasDel } = await sb.from("sillas").select("id").eq("bloqueo_id", id);
  const sillaIds = (sillasDel ?? []).map((s) => s.id);
  if (sillaIds.length) await sb.from("movimientos_silla").delete().in("silla_id", sillaIds);
  await sb.from("movimientos_silla").delete().eq("bloqueo_origen_id", id);
  await sb.from("movimientos_silla").delete().eq("bloqueo_destino_id", id);

  // 2) Sillas del bloqueo.
  const { error: es } = await sb.from("sillas").delete().eq("bloqueo_id", id);
  if (es) return { ok: false, error: `No se pudieron borrar las sillas: ${es.message}` };

  // 3) El bloqueo. Si aún lo referencia un contrato/paquete, Postgres lo impide;
  //    devolvemos el motivo claro en vez de tragarnos el error.
  const { error } = await sb.from("bloqueos_vuelo").delete().eq("id", id);
  if (error) {
    const fk = /foreign key|violates|referenced/i.test(error.message);
    return { ok: false, error: fk
      ? "No se puede eliminar: el bloqueo está referenciado por un contrato o paquete. Quita esas referencias primero."
      : error.message };
  }
  for (const pid of paqIds) { try { await generarTarifario(pid); } catch { /* sigue */ } }
  revalidatePath("/dashboard/vuelos");
  return { ok: true };
}

// ── Pasajeros de una silla: editar / borrar (liberar) / mover de record ──────
export type PasajeroSillaInput = {
  pasajero_nombres: string; pasajero_apellidos: string;
  tipo_doc: string; numero_doc: string; nacimiento: string;
  asesor: string; hotel: string; acomodacion: string; plazo: string;
};

export async function editarPasajeroSilla(
  sillaId: number,
  bloqueoId: number,
  data: PasajeroSillaInput
): Promise<Result> {
  const sb = await createClient();
  const v = (s: string) => (s && s.trim() ? s.trim() : null);
  const { error } = await sb
    .from("sillas")
    .update({
      pasajero_nombres: v(data.pasajero_nombres),
      pasajero_apellidos: v(data.pasajero_apellidos),
      tipo_doc: v(data.tipo_doc),
      numero_doc: v(data.numero_doc),
      nacimiento: v(data.nacimiento),
      asesor: v(data.asesor),
      hotel: v(data.hotel),
      acomodacion: v(data.acomodacion),
      plazo: v(data.plazo),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sillaId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/vuelos/${bloqueoId}`);
  return { ok: true };
}

// Borra el pasajero de la silla y la LIBERA (vuelve a 'disponible'). No toca el
// contrato; es una operación manual del control de vuelos.
export async function borrarPasajeroSilla(sillaId: number, bloqueoId: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("sillas")
    .update({
      estado: "disponible",
      numero_contrato: null,
      pasajero_nombres: null, pasajero_apellidos: null, tipo_doc: null, numero_doc: null, nacimiento: null,
      asesor: null, agencia: null, hotel: null, acomodacion: null, plazo: null,
      inf_nombres: null, inf_apellidos: null, inf_tipo_doc: null, inf_numero: null, inf_nacimiento: null, responsable_menor: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sillaId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/vuelos/${bloqueoId}`);
  revalidatePath("/dashboard/vuelos");
  return { ok: true };
}

// Mueve el pasajero (con su estado y contrato) a otro record: lo copia como
// nueva silla en el destino, deja la silla de origen DISPONIBLE (liberada y
// limpia) y registra el cambio en movimientos_silla.
export async function moverPasajeroSilla(
  sillaId: number,
  origenId: number,
  destinoId: number
): Promise<Result> {
  const sb = await createClient();
  if (origenId === destinoId) return { ok: false, error: "Elige un record distinto al actual." };

  const { data: orig } = await sb.from("sillas").select("*").eq("id", sillaId).single();
  if (!orig) return { ok: false, error: "Silla no encontrada." };

  const { data: maxRows } = await sb
    .from("sillas").select("numero_silla")
    .eq("bloqueo_id", destinoId).order("numero_silla", { ascending: false }).limit(1);
  const next = (maxRows?.[0]?.numero_silla ?? 0) + 1;

  const { error: eIns } = await sb.from("sillas").insert({
    bloqueo_id: destinoId, numero_silla: next, estado: orig.estado,
    numero_contrato: orig.numero_contrato,
    pasajero_nombres: orig.pasajero_nombres, pasajero_apellidos: orig.pasajero_apellidos,
    tipo_doc: orig.tipo_doc, numero_doc: orig.numero_doc, nacimiento: orig.nacimiento,
    asesor: orig.asesor, agencia: orig.agencia, hotel: orig.hotel, acomodacion: orig.acomodacion, plazo: orig.plazo,
    inf_nombres: orig.inf_nombres, inf_apellidos: orig.inf_apellidos, inf_tipo_doc: orig.inf_tipo_doc,
    inf_numero: orig.inf_numero, inf_nacimiento: orig.inf_nacimiento, responsable_menor: orig.responsable_menor,
  });
  if (eIns) return { ok: false, error: eIns.message };

  // Origen → DISPONIBLE (liberada y limpia); el cambio queda en movimientos_silla.
  await sb.from("sillas").update({
    estado: "disponible",
    numero_contrato: null,
    pasajero_nombres: null, pasajero_apellidos: null, tipo_doc: null, numero_doc: null, nacimiento: null,
    asesor: null, agencia: null, hotel: null, acomodacion: null, plazo: null,
    inf_nombres: null, inf_apellidos: null, inf_tipo_doc: null, inf_numero: null, inf_nacimiento: null, responsable_menor: null,
    updated_at: new Date().toISOString(),
  }).eq("id", sillaId);
  await sb.from("movimientos_silla").insert({
    silla_id: sillaId, bloqueo_origen_id: origenId, bloqueo_destino_id: destinoId,
    motivo: "Cambio de pasajero a otro record",
  });

  revalidatePath(`/dashboard/vuelos/${origenId}`);
  revalidatePath(`/dashboard/vuelos/${destinoId}`);
  revalidatePath("/dashboard/vuelos");
  return { ok: true };
}

// ── Carga masiva de PASAJEROS ──────────────────────────────────────────────
// Cada fila trae su PNR (record). El pasajero se asigna a una silla LIBRE de ese
// record (sin pasajero, estado disponible/cambio_entrante). Reglas pedidas:
//  - Repetido por documento en el MISMO PNR → se omite (ya está ahí).
//  - Mismo documento en OTRO PNR → alarma para revisar (no bloquea).
//  - PNR que no existe → se cuenta y se avisa cuántos pasajeros lo traen.
//  - Si un PNR no tiene cupos libres suficientes → se avisa.
export async function cargarPasajerosMasivo(
  rows: Record<string, string>[]
): Promise<{ ok: boolean; insertados: number; errores: string[] }> {
  const sb = await createClient();
  const errores: string[] = [];

  // PNR (record) → bloqueo. record es único.
  const { data: bloqueos } = await sb.from("bloqueos_vuelo").select("id, record");
  const recordToId = new Map<string, number>();
  for (const b of bloqueos ?? []) {
    const r = (b.record ?? "").trim().toUpperCase();
    if (r) recordToId.set(r, b.id);
  }

  // Documento → records donde ya aparece (pasajeros ya cargados). Se va
  // actualizando con el propio lote para detectar repetidos dentro del archivo.
  const { data: existentes } = await sb
    .from("sillas")
    .select("numero_doc, bloqueos_vuelo(record)")
    .not("numero_doc", "is", null);
  const docRecords = new Map<string, Set<string>>();
  for (const s of existentes ?? []) {
    const doc = (s.numero_doc ?? "").trim();
    if (!doc) continue;
    const rec = ((s.bloqueos_vuelo as unknown as { record: string | null } | null)?.record ?? "").trim().toUpperCase();
    const set = docRecords.get(doc) ?? new Set<string>();
    if (rec) set.add(rec);
    docRecords.set(doc, set);
  }

  type Pas = { nombres: string; apellidos: string; tipoDoc: string; doc: string; nacimiento: string | null };
  const aCargarPorPnr = new Map<string, Pas[]>();
  const pnrInexistente = new Set<string>();
  let pnrInexistenteCount = 0;
  let omitidos = 0;
  const reFecha = /^\d{4}-\d{2}-\d{2}$/;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linea = i + 2;
    const pnr = (r.pnr || r.record || "").trim().toUpperCase();
    const nombres = (r.nombres || "").trim();
    const apellidos = (r.apellidos || "").trim();
    const tipoDoc = (r.tipo_doc || "").trim();
    const doc = (r.numero_doc || "").trim();
    const nacRaw = (r.nacimiento || "").trim();
    const nacimiento = reFecha.test(nacRaw) ? nacRaw : null;

    if (!pnr) { errores.push(`Fila ${linea}: sin PNR.`); continue; }
    if (!doc) { errores.push(`Fila ${linea}: sin número de documento.`); continue; }
    if (!nombres && !apellidos) { errores.push(`Fila ${linea}: sin nombre.`); continue; }

    const records = docRecords.get(doc) ?? new Set<string>();
    if (records.has(pnr)) { omitidos++; continue; } // ya está en ese PNR → omitir
    if (records.size > 0) {
      errores.push(`⚠️ Revisar: ${nombres} ${apellidos} (doc ${doc}) ya aparece en el PNR ${[...records].join(", ")} y ahora en ${pnr}.`);
    }
    records.add(pnr);
    docRecords.set(doc, records);

    if (!recordToId.has(pnr)) { pnrInexistenteCount++; pnrInexistente.add(pnr); continue; }
    const arr = aCargarPorPnr.get(pnr) ?? [];
    arr.push({ nombres, apellidos, tipoDoc, doc, nacimiento });
    aCargarPorPnr.set(pnr, arr);
  }

  if (pnrInexistenteCount > 0)
    errores.push(`⚠️ ${pnrInexistenteCount} pasajero(s) tienen un PNR que no existe: ${[...pnrInexistente].join(", ")}.`);
  if (omitidos > 0)
    errores.push(`${omitidos} pasajero(s) omitido(s): ya estaban en el mismo PNR (documento repetido).`);

  // Asignación a sillas libres por record.
  let insertados = 0;
  for (const [pnr, pas] of aCargarPorPnr) {
    const bloqueoId = recordToId.get(pnr)!;
    const { data: libres } = await sb
      .from("sillas")
      .select("id")
      .eq("bloqueo_id", bloqueoId)
      .in("estado", ["disponible", "cambio_entrante"])
      .is("pasajero_nombres", null)
      .order("numero_silla")
      .limit(pas.length);
    const ids = (libres ?? []).map((s) => s.id);
    if (ids.length < pas.length)
      errores.push(`PNR ${pnr}: faltaron ${pas.length - ids.length} cupo(s) libre(s) para ${pas.length} pasajero(s).`);
    for (let k = 0; k < ids.length && k < pas.length; k++) {
      const p = pas[k];
      const { error } = await sb.from("sillas").update({
        pasajero_nombres: p.nombres || null,
        pasajero_apellidos: p.apellidos || null,
        tipo_doc: p.tipoDoc || null,
        numero_doc: p.doc || null,
        nacimiento: p.nacimiento,
        updated_at: new Date().toISOString(),
      }).eq("id", ids[k]);
      if (error) errores.push(`PNR ${pnr}: ${error.message}`);
      else insertados++;
    }
    revalidatePath(`/dashboard/vuelos/${bloqueoId}`);
  }
  revalidatePath("/dashboard/vuelos/pasajeros");
  return { ok: errores.length === 0, insertados, errores };
}
