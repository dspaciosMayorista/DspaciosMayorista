"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { esEstadoEmision, type EstadoEmision } from "@/lib/vuelos/control";

type Result = { ok: true } | { ok: false; error: string };

const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

// Forma que devuelve `guardar_tramos_contrato()` (setof contrato_vuelos) —
// mismas columnas snake_case que ya consume TramosEditor.tsx vía su tipo
// local `TramoDB` (carga inicial desde la vista `contrato_vuelos_editor`).
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

const MAX_TRAMOS = 20;
const RE_IATA = /^[A-Z]{3}$/;
const RE_HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Espejo LIVIANO (solo UX, feedback inmediato) de la validación real, que
// vive en Postgres dentro de guardar_tramos_contrato() — esa es la única
// autoridad (el RPC es SECURITY DEFINER, nunca confía en lo que valide el
// cliente). Mismos límites/reglas que el lado servidor.
function validarTramos(tramos: TramoInput[]): string | null {
  if (!tramos.length) return "Debe haber al menos un tramo.";
  if (tramos.length > MAX_TRAMOS) return `No se pueden guardar más de ${MAX_TRAMOS} tramos en un solo contrato.`;

  const idsVistos = new Set<number>();
  for (const t of tramos) {
    if (t.id !== null) {
      if (!Number.isInteger(t.id) || t.id <= 0) return "El id de un tramo es inválido.";
      if (idsVistos.has(t.id)) return `Un tramo repite el id ${t.id}.`;
      idsVistos.add(t.id);
    }

    if (t.direccion && t.direccion !== "ida" && t.direccion !== "regreso") return "La dirección de un tramo es inválida.";

    const origen = oNull(t.origenCodigo);
    const destino = oNull(t.destinoCodigo);
    if (origen && !RE_IATA.test(origen.toUpperCase())) return "El código de origen debe tener exactamente 3 letras.";
    if (destino && !RE_IATA.test(destino.toUpperCase())) return "El código de destino debe tener exactamente 3 letras.";
    if (Boolean(origen) !== Boolean(destino)) return "Un tramo debe traer origen y destino juntos, o ninguno de los dos.";

    if (t.fecha && !RE_FECHA.test(t.fecha.trim())) return "La fecha de un tramo no es válida.";
    if (t.horaSalida && !RE_HORA.test(t.horaSalida.trim())) return "La hora de salida de un tramo no es válida.";
    if (t.horaLlegada && !RE_HORA.test(t.horaLlegada.trim())) return "La hora de llegada de un tramo no es válida.";

    if (t.aerolinea.length > 80) return "La aerolínea de un tramo es demasiado larga.";
    if (t.record.length > 20) return "El record (PNR) de un tramo es demasiado largo.";
    if (t.origenCiudad.length > 80 || t.destinoCiudad.length > 80) return "El nombre de una ciudad es demasiado largo.";
    if (t.numeroVuelo.length > 15) return "El número de vuelo es demasiado largo.";
    if (t.servicios.length > 500) return "El campo de servicios es demasiado largo.";

    const vacio = !oNull(t.aerolinea) && !oNull(t.record) && !t.direccion && !origen && !destino
      && !oNull(t.numeroVuelo) && !oNull(t.fecha) && !oNull(t.horaSalida) && !oNull(t.horaLlegada) && !oNull(t.servicios);
    if (vacio) return "Un tramo no puede estar completamente vacío.";
  }
  return null;
}

export async function guardarTramosContrato(numeroContrato: string, tramos: TramoInput[]): Promise<ResultTramos> {
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
  if (error) return { ok: false, error: error.message };

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
