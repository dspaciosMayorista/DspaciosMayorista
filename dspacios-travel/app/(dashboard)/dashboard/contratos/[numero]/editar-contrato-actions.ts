"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { calcularEdad } from "@/lib/utils";
import { esInfantePorEdad, pasajeroConsumeSilla } from "@/lib/reservar/pasajeros";

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
  nombre: string; tipoId: string; identificacion: string; fechaNacimiento: string;
  esInfante: boolean; // legacy — el servidor SIEMPRE recalcula (ver esInfantePorEdad), este campo ya no se persiste tal cual.
  // Solo para infantes: posición (índice, dentro de ESTE mismo arreglo tal
  // como se envía) del pasajero adulto responsable. `null`/ausente = infante
  // aún sin vincular — se permite guardar así (no se fuerza el vínculo al
  // guardar), pero un valor presente se valida server-side siempre.
  responsableIndex?: number | null;
};

// Reemplazar los pasajeros del contrato (con validaciones) — retoma el
// pendiente CHD/INF: `es_infante` se recalcula SIEMPRE aquí desde la fecha
// de nacimiento contra `ventas.fecha_salida` (nunca se confía en el flag del
// cliente); el vínculo INF→adulto responsable se valida y persiste en
// `contrato_pasajeros.responsable_id` (migración 167); y el inventario de
// sillas del bloqueo negociado (si lo hay) se reconcilia atómicamente contra
// la nueva cantidad de pasajeros que SÍ ocupan silla, vía el RPC
// `ajustar_sillas_por_pasajeros` (mismo criterio que la creación —
// lib/reservar/pasajeros.ts::pasajeroConsumeSilla, nunca infantes).
export async function actualizarPasajerosContrato(numero: string, pasajerosRaw: PasajeroEdit[]): Promise<Result> {
  const sb = await createClient();
  const r = await rol(sb);
  if (!["superadmin", "gerencia", "administracion", "operaciones", "venta"].includes(r ?? "")) {
    return { ok: false, error: "No tienes permiso para editar pasajeros." };
  }
  if (!Array.isArray(pasajerosRaw)) return { ok: false, error: "Formato de pasajeros inválido." };
  const { data: venta } = await sb.from("ventas").select("fecha_salida").eq("numero_contrato", numero).maybeSingle();
  const ref = venta?.fecha_salida ?? null;

  // Se conserva el índice ORIGINAL de cada fila (antes de descartar vacías)
  // porque `responsableIndex` referencia esa misma posición tal como la
  // mandó el formulario.
  const conIndice = pasajerosRaw.map((p, idxOriginal) => ({ p, idxOriginal }));
  // Solo se descartan filas totalmente vacías (sin ningún dato). El resto debe
  // venir completo: mismos validadores del contrato del tarifario.
  const filasConDato = conIndice.filter(
    ({ p }) => p.nombre?.trim() || p.identificacion?.trim() || p.fechaNacimiento?.trim()
  );
  if (!filasConDato.length) return { ok: false, error: "Debe haber al menos un pasajero." };

  const docOk = (tipo: string, num: string) => tipo === "PAS" || /^\d+$/.test(num.trim());

  // Validaciones por pasajero: datos completos + edad + documento repetido.
  // `esInfantePorIdx` guarda el resultado AUTORITATIVO (por fecha real, nunca
  // el checkbox/flag del cliente) indexado por posición ORIGINAL — es la
  // fuente que se reutiliza para el insert, el vínculo de responsable y la
  // reconciliación de sillas más abajo.
  const vistos = new Set<string>();
  const esInfantePorIdx = new Map<number, boolean>();
  for (let i = 0; i < filasConDato.length; i++) {
    const { p, idxOriginal } = filasConDato[i];
    if (!p.nombre?.trim()) return { ok: false, error: `Pasajero ${i + 1}: el nombre es obligatorio.` };
    if (!p.identificacion?.trim()) return { ok: false, error: `Pasajero ${i + 1}: el número de documento es obligatorio.` };
    if (!docOk(p.tipoId, p.identificacion)) return { ok: false, error: `Pasajero ${i + 1}: el documento debe ser solo números (excepto Pasaporte).` };
    if (!p.fechaNacimiento?.trim()) return { ok: false, error: `Pasajero ${i + 1}: la fecha de nacimiento es obligatoria.` };
    const edad = calcularEdad(p.fechaNacimiento, ref);
    if (edad != null && edad < 18 && p.tipoId === "CC") return { ok: false, error: `Pasajero ${i + 1}: un menor no puede tener CC (usa RC o TI).` };
    const k = `${p.tipoId}-${p.identificacion.trim()}`;
    if (vistos.has(k)) return { ok: false, error: `Pasajero ${i + 1}: documento repetido.` };
    vistos.add(k);
    esInfantePorIdx.set(idxOriginal, esInfantePorEdad(p.fechaNacimiento, ref));
  }

  // Vínculo INF→adulto: se valida COMPLETO server-side antes de tocar la
  // base — nunca se confía en que el formulario ya lo haya validado. La
  // integridad real (mismo contrato, adulto de verdad) la garantiza además
  // el trigger de la migración 167 como defensa en profundidad.
  for (const { p, idxOriginal } of filasConDato) {
    if (!esInfantePorIdx.get(idxOriginal)) continue;
    if (p.responsableIndex == null) continue; // permitido: infante todavía sin vincular
    if (!Number.isInteger(p.responsableIndex)) return { ok: false, error: "El adulto responsable indicado no es válido." };
    if (p.responsableIndex === idxOriginal) return { ok: false, error: "Un infante no puede ser su propio responsable." };
    const respEsInfante = esInfantePorIdx.get(p.responsableIndex);
    if (respEsInfante === undefined) return { ok: false, error: "El adulto responsable indicado no existe en esta lista." };
    if (respEsInfante) return { ok: false, error: "El adulto responsable no puede ser, a su vez, un infante." };
  }

  await sb.from("contrato_pasajeros").delete().eq("numero_contrato", numero);
  const filas = filasConDato.map(({ p, idxOriginal }, i) => ({
    numero_contrato: numero,
    nombre: p.nombre.trim(),
    tipo_id: p.tipoId || "CC",
    identificacion: p.identificacion.trim() || null,
    fecha_nacimiento: p.fechaNacimiento || null,
    es_infante: esInfantePorIdx.get(idxOriginal)!,
    orden: i,
  }));
  const { error } = await sb.from("contrato_pasajeros").insert(filas);
  if (error) return { ok: false, error: error.message };

  // Vínculos de responsable: se resuelven en una segunda pasada porque
  // `responsable_id` apunta al `id` REAL (autogenerado) de la fila del
  // adulto, que solo se conoce después del insert — nunca se confía en el
  // orden de retorno del propio insert; se relee por `orden` (columna que sí
  // se controla exactamente arriba, 1:1 con la posición en `filasConDato`).
  const hayResponsables = filasConDato.some(({ p, idxOriginal }) => esInfantePorIdx.get(idxOriginal) && p.responsableIndex != null);
  if (hayResponsables) {
    const { data: insertadas, error: selError } = await sb
      .from("contrato_pasajeros")
      .select("id, orden")
      .eq("numero_contrato", numero)
      .order("orden");
    if (selError) return { ok: false, error: selError.message };
    const idPorOrden = new Map((insertadas ?? []).map((row) => [row.orden, row.id]));
    const ordenPorIdxOriginal = new Map(filasConDato.map(({ idxOriginal }, orden) => [idxOriginal, orden]));
    for (let orden = 0; orden < filasConDato.length; orden++) {
      const { p, idxOriginal } = filasConDato[orden];
      if (!esInfantePorIdx.get(idxOriginal) || p.responsableIndex == null) continue;
      const ordenResponsable = ordenPorIdxOriginal.get(p.responsableIndex);
      if (ordenResponsable == null) continue; // ya validado arriba, no debería ocurrir
      const idInfante = idPorOrden.get(orden);
      const idResponsable = idPorOrden.get(ordenResponsable);
      if (idInfante == null || idResponsable == null) continue;
      const { error: upErr } = await sb.from("contrato_pasajeros").update({ responsable_id: idResponsable }).eq("id", idInfante);
      if (upErr) return { ok: false, error: upErr.message };
    }
  }

  // Reconciliación de sillas (no-op si el contrato no usa sillas propias —
  // porción terrestre/empaquetado/dinámico): la nueva cantidad de pasajeros
  // que SÍ ocupan silla (nunca infantes) debe calzar con lo que hay
  // asignado. Atómico y con candado de concurrencia dentro del propio RPC.
  const holdersNuevo = filasConDato.filter(({ idxOriginal }) => pasajeroConsumeSilla(esInfantePorIdx.get(idxOriginal)!)).length;
  const { error: rpcError } = await sb.rpc("ajustar_sillas_por_pasajeros", { p_numero_contrato: numero, p_holders_nuevo: holdersNuevo });
  if (rpcError) return { ok: false, error: rpcError.message };

  revalidatePath(`/dashboard/contratos/${numero}`);
  return { ok: true };
}
