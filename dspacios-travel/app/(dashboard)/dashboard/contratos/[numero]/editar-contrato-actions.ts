"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { calcularEdad } from "@/lib/utils";
import { payloadGuardarPasajeros } from "@/lib/reservar/pasajerosEdicion";

type Result = { ok: true } | { ok: false; error: string };

async function rol(sb: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("usuarios").select("rol").eq("id", user.id).single();
  return data?.rol ?? null;
}

// Asignar / cambiar el asesor interno del contrato (roles de gestión).
export async function actualizarAsesorContrato(numero: string, asesorNombre: string): Promise<Result> {
  const sb = await createClient();
  const r = await rol(sb);
  if (!["superadmin", "gerencia", "administracion", "operaciones"].includes(r ?? "")) {
    return { ok: false, error: "No tienes permiso para cambiar el asesor." };
  }
  const nombre = asesorNombre.trim() || null;
  const { error } = await sb.from("ventas").update({ asesor_firma_nombre: nombre, asesor: nombre }).eq("numero_contrato", numero);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}

export type PasajeroEdit = {
  // Presente si esta fila ya existe en la base (se cargó desde
  // contrato_pasajeros); ausente/null si es una fila nueva agregada en el
  // formulario. El RPC la conserva (upsert por id) o la inserta — nunca se
  // borra y reinserta todo, precisamente para que el servidor pueda saber
  // qué es "histórico" (ver la regla de abuelo en la migración 167).
  id?: number | null;
  nombre: string; tipoId: string; identificacion: string; fechaNacimiento: string;
  esInfante: boolean; // legacy — el servidor SIEMPRE recalcula, este campo ya no se envía ni se persiste tal cual.
  // Solo para infantes: posición (índice, dentro de ESTE mismo arreglo tal
  // como se envía) del pasajero adulto responsable. `null`/ausente = infante
  // sin vincular — el RPC decide si eso se permite (histórico ya así) o se
  // rechaza (infante nuevo, obligatorio) — nunca se decide aquí en el cliente.
  responsableIndex?: number | null;
};

// Reemplazar los pasajeros del contrato — retoma el pendiente CHD/INF. TODA
// la lógica de negocio (recalcular es_infante desde la fecha real,
// mandatoriedad del vínculo INF→responsable para infantes nuevos con
// excepción de abuelo para históricos, upsert por id, reconciliación
// atómica de sillas) vive en el RPC `guardar_pasajeros_contrato`
// (migración 167) — UNA sola llamada, una sola transacción. Aquí solo se
// valida lo que mejora la experiencia (mensajes tempranos antes del viaje
// de red); el servidor SQL es la única autoridad real y vuelve a validar
// todo desde cero.
export async function actualizarPasajerosContrato(numero: string, pasajerosRaw: PasajeroEdit[]): Promise<Result> {
  const sb = await createClient();
  const r = await rol(sb);
  if (!["superadmin", "gerencia", "administracion", "operaciones", "venta"].includes(r ?? "")) {
    return { ok: false, error: "No tienes permiso para editar pasajeros." };
  }
  if (!Array.isArray(pasajerosRaw)) return { ok: false, error: "Formato de pasajeros inválido." };

  // Solo se descartan filas totalmente vacías (sin ningún dato) — el resto
  // debe venir completo, mismos validadores de siempre (adelantan el error
  // sin esperar el viaje de red; el RPC los vuelve a exigir igual).
  //
  // `responsableIndex` referencia una posición del arreglo TAL COMO lo
  // mandó el formulario (`pasajerosRaw`) — si una fila vacía de en medio se
  // descarta aquí, todo lo que va después se corre una posición, y un
  // `responsableIndex` que apuntaba a una fila más adelante quedaría
  // apuntando a la persona equivocada. Se remapea explícitamente contra la
  // posición NUEVA (dentro de `filasConDato`) antes de armar el payload.
  const conIndiceOriginal = pasajerosRaw.map((p, idxOriginal) => ({ p, idxOriginal }));
  const filasConDato = conIndiceOriginal.filter(
    ({ p }) => p.nombre?.trim() || p.identificacion?.trim() || p.fechaNacimiento?.trim()
  );
  if (!filasConDato.length) return { ok: false, error: "Debe haber al menos un pasajero." };
  const nuevaPosicionPorOriginal = new Map(filasConDato.map(({ idxOriginal }, nuevaPos) => [idxOriginal, nuevaPos]));
  const filasRemapeadas = filasConDato.map(({ p }) => ({
    ...p,
    responsableIndex: p.responsableIndex != null ? (nuevaPosicionPorOriginal.get(p.responsableIndex) ?? null) : null,
  }));

  const docOk = (tipo: string, num: string) => tipo === "PAS" || /^\d+$/.test(num.trim());
  const { data: venta } = await sb.from("ventas").select("fecha_salida").eq("numero_contrato", numero).maybeSingle();
  const ref = venta?.fecha_salida ?? null;
  const vistos = new Set<string>();
  for (let i = 0; i < filasRemapeadas.length; i++) {
    const p = filasRemapeadas[i];
    if (!p.nombre?.trim()) return { ok: false, error: `Pasajero ${i + 1}: el nombre es obligatorio.` };
    if (!p.identificacion?.trim()) return { ok: false, error: `Pasajero ${i + 1}: el número de documento es obligatorio.` };
    if (!docOk(p.tipoId, p.identificacion)) return { ok: false, error: `Pasajero ${i + 1}: el documento debe ser solo números (excepto Pasaporte).` };
    if (!p.fechaNacimiento?.trim()) return { ok: false, error: `Pasajero ${i + 1}: la fecha de nacimiento es obligatoria.` };
    const edad = calcularEdad(p.fechaNacimiento, ref);
    if (edad != null && edad < 18 && p.tipoId === "CC") return { ok: false, error: `Pasajero ${i + 1}: un menor no puede tener CC (usa RC o TI).` };
    const k = `${p.tipoId}-${p.identificacion.trim()}`;
    if (vistos.has(k)) return { ok: false, error: `Pasajero ${i + 1}: documento repetido.` };
    vistos.add(k);
  }

  const { error } = await sb.rpc("guardar_pasajeros_contrato", {
    p_numero_contrato: numero,
    p_pasajeros: payloadGuardarPasajeros(filasRemapeadas),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}
