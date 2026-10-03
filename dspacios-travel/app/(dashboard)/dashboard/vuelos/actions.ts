"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { regenerarTarifariosDeBloqueo, generarTarifario } from "../paquetes/actions";
import {
  esModalidadEmision,
  esEstadoEmision,
  esEstadoPago,
  type ModalidadEmision,
  type EstadoEmision,
  type EstadoPago,
} from "@/lib/vuelos/control";
import { validarInfanteVueloInput, type InfanteVueloInput } from "@/lib/vuelos/infanteVuelo";
import {
  esEstadoManual,
  esIdPositivo,
  esModoMover,
  esOperacionId,
  mensajeErrorRpc,
  type EstadoManual,
  type ModoMover,
} from "@/lib/vuelos/operaciones";

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
  // Modalidad de emisión del record — OBLIGATORIA al crear (migración 152).
  // Los estados de emisión/pago NO se piden aquí: un bloqueo nuevo nace
  // 'pendiente' en los dos, lo decide esta función, no el formulario.
  modalidadEmision: ModalidadEmision;
};

/**
 * Crea un record y sus N sillas `disponible` en UNA transacción
 * (`crear_bloqueo`, migración 195, con autorización AUT-1): nunca queda un
 * record con cupos sin sus sillas.
 */
export async function crearBloqueo(input: BloqueoInput): Promise<Result> {
  if (!esModalidadEmision(input.modalidadEmision)) {
    return { ok: false, error: "Selecciona la modalidad de emisión (serie o grupo)." };
  }
  if (!(input.record ?? "").trim()) return { ok: false, error: "Falta el record (PNR)." };
  const cupos = Number(input.cuposTotal);
  if (!Number.isInteger(cupos) || cupos < 0) return { ok: false, error: "Los cupos deben ser un número entero mayor o igual a 0." };
  const sb = await createClient();
  const { data, error } = await sb.rpc("crear_bloqueo", { p_datos: datosBloqueoDeInput(input), p_cupos: cupos });
  if (error) return { ok: false, error: mensajeErrorRpc(error).error };
  const id = Number((data as { id?: number } | null)?.id);
  revalidatePath("/dashboard/vuelos");
  return Number.isInteger(id) && id > 0 ? { ok: true, id } : { ok: true };
}

// Datos del record para `crear_bloqueo` (migración 195): claves = columnas.
// La función vuelve a validarlo todo; aquí solo se arma el objeto.
type DatosBloqueo = Record<string, string | number | number[] | null>;

function datosBloqueoDeInput(input: BloqueoInput): DatosBloqueo {
  return {
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
    modalidad_emision: input.modalidadEmision,
    estado_emision: "pendiente",
    estado_pago: "pendiente",
  };
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

// ── Control general del record: modalidad, emisión y pago (migración 152) ──
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

// Delega TODO en el RPC atómico `actualizar_control_bloqueo` (migración
// 152): SELECT ... FOR UPDATE + UPDATE + INSERT en bloqueo_cambios, las tres
// en una sola transacción — si el INSERT del historial falla, el UPDATE
// también se revierte. Antes esta función hacía esas tres operaciones como
// llamadas sueltas de supabase-js: si la del historial fallaba, el bloqueo
// ya había quedado modificado sin ningún rastro de que eso pasó.
//
// `createClient()` (cliente autenticado normal, NUNCA `service_role`) — el
// RPC no es `security definer`, corre con el rol de la sesión y queda sujeto
// a las mismas policies de `bloqueos_vuelo`/`bloqueo_cambios` de siempre.
// `revalidatePath` solo se llama DESPUÉS de confirmar que no hubo error.
export async function actualizarControlBloqueo(bloqueoId: number, input: ControlBloqueoInput): Promise<Result> {
  if (!esModalidadEmision(input.modalidadEmision)) return { ok: false, error: "Modalidad de emisión inválida." };
  if (!esEstadoEmision(input.estadoEmision)) return { ok: false, error: "Estado de emisión inválido." };
  if (!esEstadoPago(input.estadoPago)) return { ok: false, error: "Estado de pago inválido." };

  const sb = await createClient();
  const { error } = await sb.rpc("actualizar_control_bloqueo", {
    p_bloqueo_id: bloqueoId,
    p_modalidad_emision: input.modalidadEmision,
    p_estado_emision: input.estadoEmision,
    p_estado_pago: input.estadoPago,
    p_nota: input.nota,
  });
  if (error) return { ok: false, error: error.message };

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

// Modalidad/estados del control (migración 152) — validación ESTRICTA: un
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
    if (!modalidad) { errores.push(`Fila ${linea} (${record}): modalidad_emision debe ser "serie" o "grupo".`); continue; }
    const estadoEmision = parseEstadoEmisionCSV(r.estado_emision);
    if (!estadoEmision) { errores.push(`Fila ${linea} (${record}): estado_emision debe ser "pendiente" o "emitido" (o dejarse vacío).`); continue; }
    const estadoPago = parseEstadoPagoCSV(r.estado_pago);
    if (!estadoPago) { errores.push(`Fila ${linea} (${record}): estado_pago debe ser "pendiente" o "pagado" (o dejarse vacío).`); continue; }

    if (cupos < 0) { errores.push(`Fila ${linea} (${record}): cupos_total no puede ser negativo.`); continue; }

    // Cada fila es atómica (crear_bloqueo, migración 195): el record y sus
    // sillas se crean juntos o no se crea nada. Un error de la fila se reporta
    // y la fila NO cuenta como insertada; las demás filas siguen.
    const { error } = await sb.rpc("crear_bloqueo", {
      p_datos: {
        record, aerolinea: oNull(r.aerolinea || ""), proveedor_id: provId, destino_id: destinoId, ruta: oNull(r.ruta || ""), origen: oNull(r.origen || ""),
        vuelo_ida: oNull(r.vuelo_ida || ""), fecha_ida: parseFechaCSV(r.fecha_ida), hora_salida_ida: dCsv(r.hora_salida_ida), hora_llegada_ida: dCsv(r.hora_llegada_ida),
        vuelo_regreso: oNull(r.vuelo_regreso || ""), fecha_regreso: parseFechaCSV(r.fecha_regreso), hora_salida_reg: dCsv(r.hora_salida_reg), hora_llegada_reg: dCsv(r.hora_llegada_reg),
        tarifa_neta: numCsv(r.tarifa_neta) || null, tarifa_para_empaquetar: numCsv(r.tarifa_para_empaquetar),
        fecha_devolucion: parseFechaCSV(r.fecha_devolucion), fecha_emision: parseFechaCSV(r.fecha_emision), notas: oNull(r.notas || ""),
        rangos_edad: rangosEdad.length ? rangosEdad : null,
        modalidad_emision: modalidad, estado_emision: estadoEmision, estado_pago: estadoPago,
      },
      p_cupos: cupos,
    });
    if (error) { errores.push(`Fila ${linea} (${record}): ${mensajeErrorRpc(error).error}`); continue; }
    insertados++;
  }
  revalidatePath("/dashboard/vuelos");
  return { ok: errores.length === 0, insertados, errores };
}

// ── Inventario: trasladar, mover, retirar, estados (tareas 2 y 3) ──────────
// Todas estas acciones delegan en funciones de la base (migración 194). Cada
// una corre en UNA transacción con autorización por rol/agencia/contrato,
// bloqueo de los records involucrados e idempotencia por `operacionId`. Aquí
// solo se valida la forma de los datos: llamar la acción directamente, sin
// pasar por el formulario, no salta ninguna regla.

function revalidarRecords(...ids: (number | null | undefined)[]) {
  for (const id of new Set(ids)) if (id) revalidatePath(`/dashboard/vuelos/${id}`);
  revalidatePath("/dashboard/vuelos");
}

export type TrasladoResult =
  | { ok: true; repetida: boolean; movidas: number }
  | { ok: false; error: string };

/**
 * Traslada N cupos LIBRES del record origen (Y) al destino (X): mueve las
 * mismas filas, Y pierde N y X gana N; la suma no cambia. Solo mismo destino,
 * mismo proveedor y vuelo destino no salido.
 */
export async function cambiarSillas(input: {
  origenId: number;
  destinoId: number;
  cantidad: number;
  motivo: string;
  operacionId: string;
}): Promise<TrasladoResult> {
  if (!esIdPositivo(input?.origenId) || !esIdPositivo(input?.destinoId))
    return { ok: false, error: "Elige el record de origen y el de destino." };
  if (input.origenId === input.destinoId)
    return { ok: false, error: "El origen y el destino deben ser distintos." };
  if (!Number.isInteger(input.cantidad) || input.cantidad < 1)
    return { ok: false, error: "Cantidad inválida." };
  if (!esOperacionId(input.operacionId))
    return { ok: false, error: "Falta el identificador de la operación; recarga la página." };

  const sb = await createClient();
  const { data, error } = await sb.rpc("trasladar_cupos", {
    p_origen: input.origenId,
    p_destino: input.destinoId,
    p_cantidad: input.cantidad,
    p_motivo: (input.motivo ?? "").trim() || null,
    p_operacion_id: input.operacionId,
  });
  if (error) return { ok: false, error: mensajeErrorRpc(error).error };
  const r = (data ?? {}) as { repetida?: boolean; movidas?: number };
  revalidarRecords(input.origenId, input.destinoId);
  return { ok: true, repetida: !!r.repetida, movidas: Number(r.movidas ?? input.cantidad) };
}

export type EstadoSillaManual = EstadoManual;

/**
 * Cambio MANUAL de estado según la matriz DIR-1. Solo sillas sin contrato ni
 * pasajero, con motivo. Devuelta es definitiva; No vendida → Devuelta exige
 * confirmar que es una devolución real a la aerolínea.
 */
export async function cambiarEstadoSilla(
  sillaId: number,
  estado: EstadoSillaManual,
  bloqueoId: number,
  motivo: string,
  devolucionReal = false
): Promise<Result> {
  if (!esIdPositivo(sillaId)) return { ok: false, error: "Silla no válida." };
  if (!esEstadoManual(estado))
    return { ok: false, error: "Ese cambio de estado no se hace a mano: usa reservar, confirmar venta, liberar silla o retirar cupo." };
  if (!(motivo ?? "").trim()) return { ok: false, error: "Escribe el motivo del cambio de estado." };
  const sb = await createClient();
  const { error } = await sb.rpc("cambiar_estado_silla", {
    p_silla_id: sillaId,
    p_estado: estado,
    p_motivo: motivo.trim(),
    p_devolucion_real: devolucionReal === true,
  });
  if (error) return { ok: false, error: mensajeErrorRpc(error).error };
  revalidarRecords(bloqueoId);
  return { ok: true };
}

// ── Contrato MANUAL en una silla (venta externa al sistema) ────────────────
// Solo sobre un cupo libre; la silla queda CONFIRMADA. Si la referencia
// corresponde a un contrato del sistema, se exige permiso sobre ese contrato
// (un contrato de Minorista solo lo toca quien tenga acceso a él).
export async function asignarContratoManual(
  sillaId: number,
  contratoManual: string,
  bloqueoId: number
): Promise<Result> {
  if (!esIdPositivo(sillaId)) return { ok: false, error: "Silla no válida." };
  if (!(contratoManual ?? "").trim()) return { ok: false, error: "Escribe el número de contrato manual." };
  const sb = await createClient();
  const { error } = await sb.rpc("asignar_contrato_manual", { p_silla_id: sillaId, p_referencia: contratoManual });
  if (error) return { ok: false, error: mensajeErrorRpc(error).error };
  revalidarRecords(bloqueoId);
  return { ok: true };
}

export async function quitarContratoManual(sillaId: number, bloqueoId: number): Promise<Result> {
  if (!esIdPositivo(sillaId)) return { ok: false, error: "Silla no válida." };
  const sb = await createClient();
  const { error } = await sb.rpc("quitar_contrato_manual", { p_silla_id: sillaId });
  if (error) return { ok: false, error: mensajeErrorRpc(error).error };
  revalidarRecords(bloqueoId);
  return { ok: true };
}

// ── Retirar un cupo LIBRE del record (D8) ──────────────────────────────────
// La fila NO se borra: queda `retirada`, deja de contar como cupo y de
// venderse, y el retiro queda en el historial. cupos_total baja en 1.
export async function retirarCupo(
  sillaId: number,
  bloqueoId: number,
  motivo: string,
  operacionId: string
): Promise<Result> {
  if (!esIdPositivo(sillaId)) return { ok: false, error: "Silla no válida." };
  if (!esOperacionId(operacionId))
    return { ok: false, error: "Falta el identificador de la operación; recarga la página." };
  const sb = await createClient();
  const { error } = await sb.rpc("retirar_cupo", {
    p_silla_id: sillaId,
    p_motivo: (motivo ?? "").trim() || null,
    p_operacion_id: operacionId,
  });
  if (error) return { ok: false, error: mensajeErrorRpc(error).error };
  revalidarRecords(bloqueoId);
  return { ok: true };
}

/**
 * Elimina un record y sus sillas en UNA transacción (`eliminar_bloqueo`,
 * migración 195, con autorización AUT-1). La función rechaza, sin borrar
 * nada, si el record tiene historial de movimientos, sillas con contrato,
 * contrato manual o datos de pasajero, contratos vinculados, o producto
 * (paquete, tarifario, itinerario) que lo use.
 */
export async function eliminarBloqueo(id: number): Promise<Result> {
  if (!esIdPositivo(id)) return { ok: false, error: "Bloqueo no válido." };
  const sb = await createClient();
  // Paquetes que lo usaban (armado_vuelos cae en cascada al borrar): se
  // regeneran DESPUÉS para que el tarifario deje de publicar esa salida.
  const { data: usados } = await sb.from("armado_vuelos").select("paquete_id").eq("bloqueo_id", id);
  const paqIds = [...new Set((usados ?? []).map((u) => u.paquete_id))];

  const { error } = await sb.rpc("eliminar_bloqueo", { p_bloqueo_id: id });
  if (error) return { ok: false, error: mensajeErrorRpc(error).error };
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
  if (!esIdPositivo(sillaId)) return { ok: false, error: "Silla no válida." };
  const sb = await createClient();
  const { error } = await sb.rpc("editar_pasajero_silla", {
    p_silla_id: sillaId,
    p_datos: {
      pasajero_nombres: data?.pasajero_nombres ?? "",
      pasajero_apellidos: data?.pasajero_apellidos ?? "",
      tipo_doc: data?.tipo_doc ?? "",
      numero_doc: data?.numero_doc ?? "",
      nacimiento: data?.nacimiento ?? "",
      asesor: data?.asesor ?? "",
      hotel: data?.hotel ?? "",
      acomodacion: data?.acomodacion ?? "",
      plazo: data?.plazo ?? "",
    },
  });
  if (error) return { ok: false, error: mensajeErrorRpc(error).error };
  revalidatePath(`/dashboard/vuelos/${bloqueoId}`);
  return { ok: true };
}

// Borra el pasajero de la silla y la LIBERA (vuelve a 'disponible'), quitando
// también `contrato_manual`: una silla libre que conservara esa referencia
// chocaría con el CHECK `sillas_contrato_unico` (migración 085) en cuanto una
// reserva le asignara `numero_contrato`. No toca el contrato (la venta).
export async function borrarPasajeroSilla(sillaId: number, bloqueoId: number): Promise<Result> {
  if (!esIdPositivo(sillaId)) return { ok: false, error: "Silla no válida." };
  const sb = await createClient();
  const { error } = await sb.rpc("liberar_silla", { p_silla_id: sillaId });
  if (error) return { ok: false, error: mensajeErrorRpc(error).error };
  revalidarRecords(bloqueoId);
  return { ok: true };
}

export type MoverPasajeroOpciones = {
  /** Obligatorio, sin valor por defecto: el usuario debe elegirlo. */
  modo: ModoMover;
  /** Confirmación explícita cuando la tarifa neta del destino es distinta. */
  aceptaTarifaDistinta?: boolean;
  motivo?: string;
  operacionId: string;
};

export type MoverResult =
  | {
      ok: true;
      repetida: boolean;
      movidas: number;
      contrato: string | null;
      avisoTarifaDistinta: boolean;
      avisoRecordContrato: boolean;
      /** D3-c: tramos del vuelo del contrato orgánico reescritos de Y a X. */
      tramosActualizados: number;
      /** La silla usa contrato_manual: D3-c no aplica (ni fechas ni tramos). */
      contratoManual: boolean;
    }
  | { ok: false; error: string; requiereConfirmarTarifa?: boolean };

/**
 * Mueve el pasajero de una silla OCUPADA a otro record. Todas las sillas de su
 * contrato en el record viajan juntas (no se reparte un contrato entre records).
 *  - `solo_datos`: ocupa sillas libres que YA existen en el destino y libera
 *    las de origen; los cupos no cambian. Sin libres suficientes → rechazo.
 *  - `con_cupo`: traslada las mismas filas; origen −n, destino +n.
 * D3-c: si la silla tiene numero_contrato, el destino debe tener las mismas
 * fechas de ida y regreso y los tramos del contrato que apuntaban al origen
 * pasan al destino en la misma transacción. Con contrato_manual no aplica.
 * Nunca crea sillas. No recalcula importes (costo ni CxP).
 */
export async function moverPasajeroSilla(
  sillaId: number,
  origenId: number,
  destinoId: number,
  opciones: MoverPasajeroOpciones
): Promise<MoverResult> {
  if (!esIdPositivo(sillaId) || !esIdPositivo(destinoId))
    return { ok: false, error: "Elige la silla y el record destino." };
  if (origenId === destinoId) return { ok: false, error: "Elige un record distinto al actual." };
  if (!esModoMover(opciones?.modo))
    return {
      ok: false,
      error: "Elige cómo recibirá el record destino al pasajero: solo sus datos (usa un cupo libre de destino) o con su cupo.",
    };
  if (!esOperacionId(opciones.operacionId))
    return { ok: false, error: "Falta el identificador de la operación; recarga la página." };

  const sb = await createClient();
  const { data, error } = await sb.rpc("mover_pasajero", {
    p_silla_id: sillaId,
    p_destino: destinoId,
    p_modo: opciones.modo,
    p_acepta_tarifa_distinta: opciones.aceptaTarifaDistinta === true,
    p_motivo: (opciones.motivo ?? "").trim() || null,
    p_operacion_id: opciones.operacionId,
  });
  if (error) {
    const m = mensajeErrorRpc(error);
    return m.tarifaDistinta
      ? { ok: false, error: m.error, requiereConfirmarTarifa: true }
      : { ok: false, error: m.error };
  }
  const r = (data ?? {}) as {
    repetida?: boolean; movidas?: number; contrato?: string | null;
    aviso_tarifa_distinta?: boolean; aviso_record_contrato?: boolean;
    tramos_actualizados?: number; contrato_manual?: boolean;
  };
  revalidarRecords(origenId, destinoId);
  return {
    ok: true,
    repetida: !!r.repetida,
    movidas: Number(r.movidas ?? 0),
    contrato: r.contrato ?? null,
    avisoTarifaDistinta: !!r.aviso_tarifa_distinta,
    avisoRecordContrato: !!r.aviso_record_contrato,
    tramosActualizados: Number(r.tramos_actualizados ?? 0),
    contratoManual: !!r.contrato_manual,
  };
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
      // Solo sillas sin contrato: con la fase C (cierre de escritura directa) los datos de
      // una silla con contrato solo se editan por editar_pasajero_silla.
      .is("numero_contrato", null)
      .is("contrato_manual", null)
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

export type { InfanteVueloInput };

// ── Infante SIN silla, alta/edición directa desde el detalle de un vuelo ───
// (migración 168, RPC estrecho `guardar_infante_vuelo`). El cliente NUNCA
// manda numero_contrato/responsable_id: manda la silla CONCRETA del adulto
// responsable (bloqueoId + sillaResponsableId), tal cual la rindió esta
// página — el server relee bloqueos_vuelo.fecha_ida, exige que esa silla sea
// real en ESE bloqueo (autorización estrecha de control_vuelo incluida) y
// resuelve el contrato/responsable desde cero. La validación de aquí solo
// adelanta mensajes; el RPC vuelve a validar todo — ver lib/vuelos/infanteVuelo.ts.
export async function guardarInfanteVuelo(
  bloqueoId: number,
  sillaResponsableId: number,
  infanteId: number | null,
  input: InfanteVueloInput
): Promise<Result> {
  const v = validarInfanteVueloInput(input);
  if (!v.ok) return v;

  const sb = await createClient();
  const { error } = await sb.rpc("guardar_infante_vuelo", {
    p_bloqueo_id: bloqueoId,
    p_silla_responsable_id: sillaResponsableId,
    p_infante_id: infanteId,
    p_nombres: input.nombreCompleto.trim(),
    p_apellidos: "",
    p_tipo_doc: input.tipoDoc.trim(),
    p_numero_doc: input.numeroDoc.trim(),
    p_fecha_nacimiento: input.fechaNacimiento,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/vuelos/${bloqueoId}`);
  revalidatePath("/dashboard/vuelos/pasajeros");
  return { ok: true };
}
