"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

// Validación compartida cliente/servidor (defecto 6, revisión de PR #268):
// el formulario ya pone min="0" en los inputs de tarifa, pero eso es solo un
// atributo HTML — no impide un submit programático ni un valor negativo
// pegado a mano en algunos navegadores. Esta función es la ÚLTIMA palabra
// del lado del servidor antes de tocar la base de datos; los CHECK de
// Postgres (migración 156) son la línea de defensa final por si esta
// función se saltara — nunca al revés.
function validarEmpaquetado(input: EmpaquetadoInput): string | null {
  if (!input.fechaIda) return "La fecha de ida es obligatoria.";
  if (input.estadoEmision && !esEstadoEmision(input.estadoEmision)) return "Estado de emisión inválido.";
  if (input.estadoPago && !esEstadoPago(input.estadoPago)) return "Estado de pago inválido.";
  const tarifaProveedor = Number(input.tarifaProveedor);
  const tarifaEmpaquetar = Number(input.tarifaParaEmpaquetar);
  const feeInfante = Number(input.feeInfante);
  if (!Number.isFinite(tarifaProveedor) || tarifaProveedor < 0) return "La tarifa proveedor/sistema no puede ser negativa.";
  if (!Number.isFinite(tarifaEmpaquetar) || tarifaEmpaquetar < 0) return "La tarifa para empaquetar no puede ser negativa.";
  if (!Number.isFinite(feeInfante) || feeInfante < 0) return "El fee de infante no puede ser negativo.";
  if (input.fechaRegreso && input.fechaRegreso < input.fechaIda) return "La fecha de regreso no puede ser anterior a la fecha de ida.";
  if (input.compraInicio && input.compraFin && input.compraFin < input.compraInicio) return "La vigencia de compra (hasta) no puede ser anterior a (desde).";
  return null;
}

export async function crearEmpaquetado(input: EmpaquetadoInput): Promise<Result> {
  const err = validarEmpaquetado(input);
  if (err) return { ok: false, error: err };

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

// GENERALES: aerolínea, proveedor, ruta, horarios, tarifas, vigencia de
// compra, notas, activo. NO incluye record/estado_emision/estado_pago —
// esos son campos OPERATIVOS y se editan aparte, por
// `actualizarControlEmpaquetado` (defecto 8: atómico + con historial, mismo
// patrón que `actualizar_control_bloqueo`/ControlBloqueoForm). Mezclarlos
// aquí habría hecho que CUALQUIER edición general (p. ej. corregir la
// tarifa) también reescribiera el estado operativo sin pasar por el RPC ni
// quedar en el historial.
export type EmpaquetadoInputGeneral = Omit<EmpaquetadoInput, "record" | "estadoEmision" | "estadoPago">;

function validarEmpaquetadoGeneral(input: EmpaquetadoInputGeneral): string | null {
  return validarEmpaquetado({ ...input, record: "", estadoEmision: "", estadoPago: "" });
}

export async function actualizarEmpaquetado(id: number, input: EmpaquetadoInputGeneral): Promise<Result> {
  const err = validarEmpaquetadoGeneral(input);
  if (err) return { ok: false, error: err };

  const sb = await createClient();
  // Defecto 5 (revisión de PR #268): `.select("id")` + comprobar que
  // devolvió fila — sin esto, un UPDATE cuyo `where` no matchea ninguna fila
  // (RLS filtrando, o un id que ya no existe) NO es un error para
  // supabase-js: `error` queda null y el código anterior devolvía { ok:
  // true } igual, un falso éxito silencioso.
  const { data, error } = await sb
    .from("empaquetados")
    .update({
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
      notas: oNull(input.notas),
      activo: input.activo,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "No se pudo actualizar: el empaquetado no existe o no tienes permiso para editarlo." };

  revalidatePath("/dashboard/vuelos");
  revalidatePath(`/dashboard/vuelos/empaquetados/${id}`);
  revalidatePath("/dashboard/vuelos/historico");
  return { ok: true, id: data.id };
}

// Control operativo: record + estado_emision + estado_pago, ATÓMICO y con
// HISTORIAL (defecto 8) — llama al RPC `actualizar_control_empaquetado`
// (migración 156), que hace SELECT...FOR UPDATE + UPDATE + INSERT en
// `empaquetado_cambios` dentro de la MISMA transacción. Sin `security
// definer` ni `service_role`: corre con el rol de quien llama, sujeto a las
// mismas policies de `empaquetados`/`empaquetado_cambios`. `estadoEmision`/
// `estadoPago` en `""` se traducen a `null` ("Por confirmar") — NUNCA se
// fuerza a 'pendiente' (defecto 7): si el usuario deja el select en "Por
// confirmar", eso es exactamente lo que se guarda.
export async function actualizarControlEmpaquetado(
  id: number,
  input: { record: string; estadoEmision: EstadoEmision | ""; estadoPago: EstadoPago | ""; nota: string }
): Promise<Result> {
  if (input.estadoEmision && !esEstadoEmision(input.estadoEmision)) return { ok: false, error: "Estado de emisión inválido." };
  if (input.estadoPago && !esEstadoPago(input.estadoPago)) return { ok: false, error: "Estado de pago inválido." };

  const sb = await createClient();
  const { error } = await sb.rpc("actualizar_control_empaquetado", {
    p_empaquetado_id: id,
    p_record: oNull(input.record),
    p_estado_emision: input.estadoEmision || null,
    p_estado_pago: input.estadoPago || null,
    p_nota: oNull(input.nota),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/vuelos");
  revalidatePath(`/dashboard/vuelos/empaquetados/${id}`);
  revalidatePath("/dashboard/vuelos/historico");
  return { ok: true, id };
}

// Borra el empaquetado. Defecto 4 (revisión de PR #268): NO confía
// únicamente en el `ON DELETE RESTRICT` de la base de datos (migración
// 156) — antes de intentar el DELETE, revisa si está vinculado a algún
// paquete y, si lo está, devuelve un mensaje útil con la lista de paquetes
// (en vez del error crudo de Postgres) y recomienda desactivarlo. El
// RESTRICT de la BD sigue siendo la última palabra (defensa en profundidad:
// una condición de carrera entre el chequeo y el DELETE la sigue
// cubriendo), pero la UI nunca debería llegar a mostrar ese mensaje crudo.
// Defecto 5: `.select("id")` + comprobar fila para no reportar éxito falso.
export async function eliminarEmpaquetado(id: number): Promise<Result> {
  const sb = await createClient();

  const { data: enUso, error: eUso } = await sb
    .from("armado_empaquetados")
    .select("armado_paquetes(nombre)")
    .eq("empaquetado_id", id);
  if (eUso) return { ok: false, error: eUso.message };
  if (enUso && enUso.length) {
    const nombres = enUso
      .map((r) => (r.armado_paquetes as unknown as { nombre: string } | null)?.nombre)
      .filter((n): n is string => !!n);
    const lista = nombres.length ? nombres.join(", ") : `${enUso.length} paquete(s)`;
    return {
      ok: false,
      error: `No se puede eliminar: este empaquetado está vinculado a ${lista}. Desvincúlalo de esos paquetes o desactívalo (Activo = No) en vez de borrarlo.`,
    };
  }

  // Revisión posterior al PR #268, hallazgo 6: `armado_empaquetados` no era
  // el único vínculo que bloquea el borrado — un CONTRATO real ya reservado
  // desde este empaquetado (`ventas.empaquetado_ref_id`, migración 156)
  // tampoco debe perder su origen en silencio. Se consulta con service-role
  // (no con `sb`, el cliente de sesión): `control_vuelo` puede llegar hasta
  // aquí (tiene escritura sobre `empaquetados`) pero NO tiene SELECT sobre
  // `ventas` — con el cliente de sesión este chequeo daría "0 contratos"
  // por RLS aunque sí los hubiera, dejando pasar un borrado que debía
  // bloquearse. El FK (`ON DELETE RESTRICT` en `empaquetados` vía la CxP —
  // no, vía la propia referencia de `ventas.empaquetado_ref_id`) sigue como
  // defensa final si este chequeo se saltara por cualquier motivo.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const { data: enContratos, error: eCon } = await admin
      .from("ventas")
      .select("numero_contrato")
      .eq("empaquetado_ref_id", id)
      .order("numero_contrato");
    if (eCon) return { ok: false, error: eCon.message };
    if (enContratos && enContratos.length) {
      const lista = enContratos.map((v) => v.numero_contrato).join(", ");
      return {
        ok: false,
        error: `No se puede eliminar: este empaquetado tiene ${enContratos.length} contrato(s) vinculado(s) (${lista}). Desactívalo (Activo = No) en vez de borrarlo.`,
      };
    }
  }

  const { data, error } = await sb.from("empaquetados").delete().eq("id", id).select("id").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "No se pudo eliminar: el empaquetado no existe o no tienes permiso para borrarlo." };

  revalidatePath("/dashboard/vuelos");
  revalidatePath("/dashboard/vuelos/historico");
  return { ok: true };
}

// ── Vincular/desvincular un empaquetado a un paquete (armado_empaquetados) ──
// Mismo patrón que setVuelo/armado_vuelos (paquetes/actions.ts) — el mismo
// empaquetado puede vincularse a varios paquetes sin duplicarse (upsert por
// PK compuesta; desvincular es un DELETE de la fila de enlace, nunca borra
// el empaquetado en sí). Defecto 5: se revisan los errores de AMBAS ramas
// (antes el DELETE de desvincular ignoraba `error` por completo).
export async function setEmpaquetado(
  paqueteId: number,
  empaquetadoId: number,
  checked: boolean,
  aplicaMk: boolean,
  ta: number
): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    const { error } = await sb.from("armado_empaquetados").delete().eq("paquete_id", paqueteId).eq("empaquetado_id", empaquetadoId);
    if (error) return { ok: false, error: error.message };
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
// setTodosVuelos (paquetes/actions.ts). Defecto 5: el DELETE masivo también
// revisa su error ahora.
export async function setTodosEmpaquetados(
  paqueteId: number,
  empaquetadoIds: number[],
  checked: boolean
): Promise<Result> {
  const sb = await createClient();
  if (!checked) {
    const { error } = await sb.from("armado_empaquetados").delete().eq("paquete_id", paqueteId);
    if (error) return { ok: false, error: error.message };
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
