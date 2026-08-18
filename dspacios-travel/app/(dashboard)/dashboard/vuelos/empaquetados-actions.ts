"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { esEstadoEmision, esEstadoPago, type EstadoEmision, type EstadoPago } from "@/lib/vuelos/control";

type Result = { ok: true; id?: number } | { ok: false; error: string };

const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

// ── Inventario de EMPAQUETADOS (migración 156) — tarifas de SISTEMA, sin
// cupo negociado, sin sillas, sin dueño obligatorio (puede existir antes de
// vincularse a un paquete). Modalidad "Sistema" fija — nunca se pide ni se
// guarda, es la tabla de origen la que la determina.
export type EmpaquetadoInput = {
  record: string;             // opcional — PNR, se agrega al comprar/emitir
  aerolinea: string;
  proveedorId: number | null;
  destinoId: number | null;
  ruta: string;
  origen: string;
  vueloIda: string;
  fechaIda: string;           // obligatoria
  horaSalidaIda: string;
  horaLlegadaIda: string;
  vueloRegreso: string;
  fechaRegreso: string;
  horaSalidaReg: string;
  horaLlegadaReg: string;
  tarifaProveedor: number;
  tarifaParaEmpaquetar: number;
  feeInfante: number;
  compraInicio: string;
  compraFin: string;
  estadoEmision: EstadoEmision | "";
  estadoPago: EstadoPago | "";
  notas: string;
  activo: boolean;
};

export async function crearEmpaquetado(input: EmpaquetadoInput): Promise<Result> {
  if (!input.fechaIda) return { ok: false, error: "La fecha de ida es obligatoria." };
  if (input.estadoEmision && !esEstadoEmision(input.estadoEmision)) return { ok: false, error: "Estado de emisión inválido." };
  if (input.estadoPago && !esEstadoPago(input.estadoPago)) return { ok: false, error: "Estado de pago inválido." };

  const sb = await createClient();
  const { data, error } = await sb
    .from("empaquetados")
    .insert({
      record: oNull(input.record)?.toUpperCase() ?? null,
      aerolinea: oNull(input.aerolinea),
      proveedor_id: input.proveedorId,
      destino_id: input.destinoId,
      ruta: oNull(input.ruta),
      origen: oNull(input.origen),
      vuelo_ida: oNull(input.vueloIda),
      fecha_ida: input.fechaIda,
      hora_salida_ida: oNull(input.horaSalidaIda),
      hora_llegada_ida: oNull(input.horaLlegadaIda),
      vuelo_regreso: oNull(input.vueloRegreso),
      fecha_regreso: oNull(input.fechaRegreso),
      hora_salida_reg: oNull(input.horaSalidaReg),
      hora_llegada_reg: oNull(input.horaLlegadaReg),
      tarifa_proveedor: Number(input.tarifaProveedor) || 0,
      tarifa_para_empaquetar: Number(input.tarifaParaEmpaquetar) || 0,
      fee_infante: Number(input.feeInfante) || 0,
      compra_inicio: oNull(input.compraInicio),
      compra_fin: oNull(input.compraFin),
      estado_emision: input.estadoEmision || null,
      estado_pago: input.estadoPago || null,
      notas: oNull(input.notas),
      activo: input.activo,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/vuelos");
  return { ok: true, id: data.id };
}

export async function actualizarEmpaquetado(id: number, input: EmpaquetadoInput): Promise<Result> {
  if (!input.fechaIda) return { ok: false, error: "La fecha de ida es obligatoria." };
  if (input.estadoEmision && !esEstadoEmision(input.estadoEmision)) return { ok: false, error: "Estado de emisión inválido." };
  if (input.estadoPago && !esEstadoPago(input.estadoPago)) return { ok: false, error: "Estado de pago inválido." };

  const sb = await createClient();
  const { error } = await sb
    .from("empaquetados")
    .update({
      record: oNull(input.record)?.toUpperCase() ?? null,
      aerolinea: oNull(input.aerolinea),
      proveedor_id: input.proveedorId,
      destino_id: input.destinoId,
      ruta: oNull(input.ruta),
      origen: oNull(input.origen),
      vuelo_ida: oNull(input.vueloIda),
      fecha_ida: input.fechaIda,
      hora_salida_ida: oNull(input.horaSalidaIda),
      hora_llegada_ida: oNull(input.horaLlegadaIda),
      vuelo_regreso: oNull(input.vueloRegreso),
      fecha_regreso: oNull(input.fechaRegreso),
      hora_salida_reg: oNull(input.horaSalidaReg),
      hora_llegada_reg: oNull(input.horaLlegadaReg),
      tarifa_proveedor: Number(input.tarifaProveedor) || 0,
      tarifa_para_empaquetar: Number(input.tarifaParaEmpaquetar) || 0,
      fee_infante: Number(input.feeInfante) || 0,
      compra_inicio: oNull(input.compraInicio),
      compra_fin: oNull(input.compraFin),
      estado_emision: input.estadoEmision || null,
      estado_pago: input.estadoPago || null,
      notas: oNull(input.notas),
      activo: input.activo,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/vuelos");
  revalidatePath(`/dashboard/vuelos/empaquetados/${id}`);
  revalidatePath("/dashboard/vuelos/historico");
  return { ok: true, id };
}

// Borra el empaquetado y, por ON DELETE CASCADE de `armado_empaquetados`,
// también sus vínculos con paquetes (no deja filas huérfanas). Confirmación
// la maneja el cliente (no hay un "deshacer" — a diferencia de un bloqueo,
// aquí no hay sillas/contratos que dependan de esta fila).
export async function eliminarEmpaquetado(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("empaquetados").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/vuelos");
  revalidatePath("/dashboard/vuelos/historico");
  return { ok: true };
}

// ── Vincular/desvincular un empaquetado a un paquete (armado_empaquetados) ──
// Mismo patrón que setVuelo/armado_vuelos (paquetes/actions.ts) — el mismo
// empaquetado puede vincularse a varios paquetes sin duplicarse (upsert por
// PK compuesta; desvincular es un DELETE de la fila de enlace, nunca borra
// el empaquetado en sí).
export async function setEmpaquetado(
  paqueteId: number,
  empaquetadoId: number,
  checked: boolean,
  aplicaMk: boolean,
  ta: number
): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    await sb.from("armado_empaquetados").delete().eq("paquete_id", paqueteId).eq("empaquetado_id", empaquetadoId);
  } else {
    const { error } = await sb
      .from("armado_empaquetados")
      .upsert(
        { paquete_id: paqueteId, empaquetado_id: empaquetadoId, aplica_mk: aplicaMk, ta: Number(ta) || 0 },
        { onConflict: "paquete_id,empaquetado_id" }
      );
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true };
}

// Seleccionar / quitar TODOS los empaquetados disponibles — mismo patrón que
// setTodosVuelos (paquetes/actions.ts).
export async function setTodosEmpaquetados(
  paqueteId: number,
  empaquetadoIds: number[],
  checked: boolean
): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    await sb.from("armado_empaquetados").delete().eq("paquete_id", paqueteId);
  } else if (empaquetadoIds.length) {
    const { error } = await sb
      .from("armado_empaquetados")
      .upsert(
        empaquetadoIds.map((id) => ({ paquete_id: paqueteId, empaquetado_id: id, aplica_mk: true, ta: 0 })),
        { onConflict: "paquete_id,empaquetado_id", ignoreDuplicates: true }
      );
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath(`/dashboard/paquetes/${paqueteId}`);
  return { ok: true };
}
