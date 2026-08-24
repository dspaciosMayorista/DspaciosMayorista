"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  type TramoInput,
  MAX_NOTA,
  oNull,
  parsearNumeroContrato,
  parsearNota,
  parsearEstadoEmisionInput,
  parsearTramos,
  validarTramos,
} from "./frontera-tramos";

export type { TramoInput };

type Result = { ok: true } | { ok: false; error: string };

// Forma que devuelve `guardar_tramos_contrato()` (returns table explícito,
// NUNCA setof contrato_vuelos + select * — ver migración 157) — mismas
// columnas snake_case que ya consume TramosEditor.tsx vía su tipo local
// `TramoDB` (carga inicial desde la vista `contrato_vuelos_editor`).
export type TramoGuardado = {
  id: number;
  numero_contrato: string;
  aerolinea: string | null;
  record: string | null;
  direccion: string | null;
  origen_codigo: string | null;
  origen_ciudad: string | null;
  destino_codigo: string | null;
  destino_ciudad: string | null;
  numero_vuelo: string | null;
  fecha_salida: string | null;
  hora_salida: string | null;
  hora_llegada: string | null;
  servicios: string | null;
  orden: number;
};

type ResultTramos = { ok: true; tramos: TramoGuardado[] } | { ok: false; error: string };

// ── Editor operativo de vuelos del contrato (migración 157) ────────────────
// Reemplaza contrato_vuelos completo de un contrato, vía el RPC
// `guardar_tramos_contrato` (SECURITY DEFINER — control_vuelo no tiene RLS
// propia sobre contrato_vuelos/ventas; la autorización real la hace
// acceso_editar_vuelos_contrato() DENTRO del RPC, en Postgres, no aquí). Este
// archivo NUNCA usa el cliente service-role: siempre el cliente de sesión
// (`createClient()`), así que el tenant/rol que decide es el del usuario
// autenticado real, nunca uno que el cliente pudiera mandar.
//
// La validación/parsing de los argumentos PÚBLICOS (tratados como
// `unknown` — una Server Action se puede invocar con lo que sea que llegue
// en el cuerpo de la petición HTTP, los tipos de TS no protegen eso en
// runtime) vive en ./frontera-tramos.ts, un módulo puro sin "use server"
// para poder probarse importándolo directo desde node --test.

// SQLSTATE que Postgres asigna a un `RAISE EXCEPTION` sin ERRCODE explícito
// (todas las excepciones de negocio de guardar_tramos_contrato()/
// actualizar_estado_emision_contrato() son así) — confirmado contra el RPC
// real. Cualquier OTRO código (violación de constraint, timeout, error de
// red, RLS/permiso inesperado, etc.) es un error interno: nunca se
// reenvía tal cual al navegador — nombres de tabla/función/constraint/SQL
// no son para el usuario final. Se registra del lado del servidor (esta
// Server Action YA corre en el servidor) y se devuelve un mensaje genérico.
const SQLSTATE_EXCEPCION_NEGOCIO = "P0001";

function mensajeSeguro(error: { message: string; code?: string }, contexto: string): string {
  if (error.code === SQLSTATE_EXCEPCION_NEGOCIO) return error.message;
  console.error(`[contrato-vuelos-actions:${contexto}] error inesperado (code=${error.code ?? "?"}):`, error);
  return "No se pudo completar la operación. Intenta de nuevo o contacta a soporte.";
}

export async function guardarTramosContrato(numeroContratoIn: unknown, tramosIn: unknown): Promise<ResultTramos> {
  const numeroContrato = parsearNumeroContrato(numeroContratoIn);
  if (!numeroContrato) return { ok: false, error: "Número de contrato inválido." };

  const tramosR = parsearTramos(tramosIn);
  if (!tramosR.ok) return { ok: false, error: tramosR.error };
  const tramos = tramosR.tramos;

  const err = validarTramos(tramos);
  if (err) return { ok: false, error: err };

  const sb = await createClient();
  const { data, error } = await sb.rpc("guardar_tramos_contrato", {
    p_numero_contrato: numeroContrato,
    p_tramos: tramos.map((t) => ({
      id: t.id,
      aerolinea: oNull(t.aerolinea),
      record: oNull(t.record),
      direccion: t.direccion || null,
      origenCodigo: oNull(t.origenCodigo),
      origenCiudad: oNull(t.origenCiudad),
      destinoCodigo: oNull(t.destinoCodigo),
      destinoCiudad: oNull(t.destinoCiudad),
      numeroVuelo: oNull(t.numeroVuelo),
      fecha: oNull(t.fecha),
      horaSalida: oNull(t.horaSalida),
      horaLlegada: oNull(t.horaLlegada),
      servicios: oNull(t.servicios),
    })),
  });
  if (error) return { ok: false, error: mensajeSeguro(error, "guardar_tramos_contrato") };

  revalidatePath(`/dashboard/vuelos/contrato/${numeroContrato}`);
  revalidatePath("/dashboard/vuelos");
  revalidatePath("/dashboard/vuelos/historico");
  return { ok: true, tramos: (data ?? []) as TramoGuardado[] };
}

// Estado de emisión del CONTRATO completo (no por tramo) — RPC
// `actualizar_estado_emision_contrato`, mismo motivo de SECURITY DEFINER que
// guardar_tramos_contrato. `""` se traduce a `null` ("Por confirmar") — nunca
// se fuerza a 'pendiente'.
export async function actualizarEstadoEmisionContrato(
  numeroContratoIn: unknown,
  estadoEmisionIn: unknown,
  notaIn: unknown
): Promise<Result> {
  const numeroContrato = parsearNumeroContrato(numeroContratoIn);
  if (!numeroContrato) return { ok: false, error: "Número de contrato inválido." };

  const estadoR = parsearEstadoEmisionInput(estadoEmisionIn);
  if (!estadoR.ok) return { ok: false, error: "Estado de emisión inválido." };

  const notaR = parsearNota(notaIn);
  if (!notaR.ok) return { ok: false, error: `La nota debe ser texto de máximo ${MAX_NOTA} caracteres.` };

  const sb = await createClient();
  const { error } = await sb.rpc("actualizar_estado_emision_contrato", {
    p_numero_contrato: numeroContrato,
    p_estado_emision: estadoR.valor || null,
    p_nota: oNull(notaR.nota),
  });
  if (error) return { ok: false, error: mensajeSeguro(error, "actualizar_estado_emision_contrato") };

  revalidatePath(`/dashboard/vuelos/contrato/${numeroContrato}`);
  revalidatePath("/dashboard/vuelos");
  revalidatePath("/dashboard/vuelos/historico");
  return { ok: true };
}
