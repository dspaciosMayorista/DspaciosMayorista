"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { esEstadoEmision, type EstadoEmision } from "@/lib/vuelos/control";

type Result = { ok: true } | { ok: false; error: string };

const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

// ── Editor operativo de vuelos del contrato (migración 157) ────────────────
// Reemplaza contrato_vuelos completo de un contrato, vía el RPC
// `guardar_tramos_contrato` (SECURITY DEFINER — control_vuelo no tiene RLS
// propia sobre contrato_vuelos/ventas; la autorización real la hace
// acceso_editar_vuelos_contrato() DENTRO del RPC, en Postgres, no aquí). Este
// archivo NUNCA usa el cliente service-role: siempre el cliente de sesión
// (`createClient()`), así que el tenant/rol que decide es el del usuario
// autenticado real, nunca uno que el cliente pudiera mandar.
export type TramoInput = {
  id: number | null;
  aerolinea: string;
  record: string;
  direccion: "" | "ida" | "regreso";
  origenCodigo: string;
  origenCiudad: string;
  destinoCodigo: string;
  destinoCiudad: string;
  numeroVuelo: string;
  fecha: string;
  horaSalida: string;
  horaLlegada: string;
  servicios: string;
};

function validarTramos(tramos: TramoInput[]): string | null {
  if (!tramos.length) return "Debe haber al menos un tramo.";
  for (const t of tramos) {
    if (t.direccion && t.direccion !== "ida" && t.direccion !== "regreso") return "Tramo inválido.";
    if (t.fecha && t.fecha.trim() === "") continue;
  }
  return null;
}

export async function guardarTramosContrato(numeroContrato: string, tramos: TramoInput[]): Promise<Result> {
  const err = validarTramos(tramos);
  if (err) return { ok: false, error: err };

  const sb = await createClient();
  const { error } = await sb.rpc("guardar_tramos_contrato", {
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
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/vuelos/contrato/${numeroContrato}`);
  revalidatePath("/dashboard/vuelos");
  revalidatePath("/dashboard/vuelos/historico");
  return { ok: true };
}

// Estado de emisión del CONTRATO completo (no por tramo) — RPC
// `actualizar_estado_emision_contrato`, mismo motivo de SECURITY DEFINER que
// guardar_tramos_contrato. `""` se traduce a `null` ("Por confirmar") — nunca
// se fuerza a 'pendiente'.
export async function actualizarEstadoEmisionContrato(
  numeroContrato: string,
  estadoEmision: EstadoEmision | "",
  nota: string
): Promise<Result> {
  if (estadoEmision && !esEstadoEmision(estadoEmision)) return { ok: false, error: "Estado de emisión inválido." };

  const sb = await createClient();
  const { error } = await sb.rpc("actualizar_estado_emision_contrato", {
    p_numero_contrato: numeroContrato,
    p_estado_emision: estadoEmision || null,
    p_nota: oNull(nota),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/vuelos/contrato/${numeroContrato}`);
  revalidatePath("/dashboard/vuelos");
  revalidatePath("/dashboard/vuelos/historico");
  return { ok: true };
}
