"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import {
  esPeriodicidad, validarVencimiento, periodosPorAnio,
  type Periodicidad, type ReglaDigitos,
} from "@/lib/contabilidad/calendarioTributario";

// Calendario tributario (#43-1a, migración 215). La RLS de la 215 es el candado
// real (ver/configurar/registrar por rol y agencia); este control de rol solo
// evita viajes inútiles y da un mensaje claro.
type Result = { ok: true } | { ok: false; error: string };
const RUTA = "/dashboard/contabilidad/calendario-tributario";
const ROLES = ["superadmin", "gerencia", "administracion"];

type Contexto =
  | { ok: false; error: string }
  | { ok: true; sb: Awaited<ReturnType<typeof createClient>>; tenant: Awaited<ReturnType<typeof getTenant>> };

async function contexto(): Promise<Contexto> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión venció. Vuelve a ingresar." };
  const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).single();
  if (!ROLES.includes(perfil?.rol ?? "")) return { ok: false, error: "No tienes permisos para el calendario tributario." };
  return { ok: true, sb, tenant: await getTenant() };
}

function errorLegible(msg: string): string {
  if (/PERIODO_INVALIDO|DIGITOS_INVALIDOS|CAMBIO_BLOQUEADO|TENANT_INMUTABLE/.test(msg)) return msg.replace(/^[A-Z_]+:\s*/, "");
  if (/uq_obligacion_nombre|duplicate key/.test(msg)) return "Ya existe una obligación con ese nombre en esta agencia.";
  if (/row-level security|permission denied/.test(msg)) return "No tienes permisos para esta acción en esta agencia.";
  return msg;
}

export type ObligacionInput = {
  id?: number;
  nombre: string;
  periodicidad: Periodicidad;
  reglaDigitos: ReglaDigitos;
  diasAviso: number;
  requierePago: boolean;
  activa: boolean;
  notas?: string | null;
};

export async function guardarObligacion(input: ObligacionInput): Promise<Result> {
  const nombre = (input.nombre ?? "").trim();
  if (!nombre) return { ok: false, error: "Escribe el nombre de la obligación (ej. Retención en la fuente)." };
  if (!esPeriodicidad(input.periodicidad)) return { ok: false, error: "Elige una periodicidad válida." };
  if (![0, 1, 2].includes(input.reglaDigitos)) return { ok: false, error: "Elige cómo se asigna la fecha (dígitos del NIT)." };
  const dias = Number(input.diasAviso);
  if (!Number.isInteger(dias) || dias < 0 || dias > 90) return { ok: false, error: "Los días de aviso van de 0 a 90." };

  const ctx = await contexto();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const fila = {
    nombre, periodicidad: input.periodicidad, regla_digitos: input.reglaDigitos, dias_aviso: dias,
    requiere_pago: !!input.requierePago, activa: !!input.activa, notas: input.notas?.trim() || null,
  };
  const { error } = input.id
    ? await ctx.sb.from("obligacion_tributaria").update(fila).eq("id", input.id).eq("tenant", ctx.tenant)
    : await ctx.sb.from("obligacion_tributaria").insert({ ...fila, tenant: ctx.tenant });
  if (error) return { ok: false, error: errorLegible(error.message) };
  revalidatePath(RUTA);
  return { ok: true };
}

export async function eliminarObligacion(id: number): Promise<Result> {
  const ctx = await contexto();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { data, error } = await ctx.sb.from("obligacion_tributaria").delete().eq("id", id).eq("tenant", ctx.tenant).select("id");
  if (error) return { ok: false, error: errorLegible(error.message) };
  if (!data?.length) return { ok: false, error: "La obligación no existe o no tienes permisos para eliminarla." };
  revalidatePath(RUTA);
  return { ok: true };
}

/**
 * Guarda las fechas de un año. `filas` trae TODAS las celdas editadas: con
 * fecha se crean o actualizan; con `fecha: null` se borran. Primero el upsert,
 * después los borrados: si algo falla no se pierde lo que ya estaba cargado.
 */
export async function guardarFechas(
  obligacionId: number,
  anio: number,
  filas: { periodo: number; digitos: string; fecha: string | null }[],
): Promise<Result> {
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return { ok: false, error: "Año inválido." };
  const ctx = await contexto();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { data: ob, error: e1 } = await ctx.sb.from("obligacion_tributaria")
    .select("id, periodicidad, regla_digitos").eq("id", obligacionId).eq("tenant", ctx.tenant).maybeSingle();
  if (e1) return { ok: false, error: errorLegible(e1.message) };
  if (!ob || !esPeriodicidad(ob.periodicidad)) return { ok: false, error: "La obligación no existe en esta agencia." };
  const regla = ob.regla_digitos as ReglaDigitos;

  const conFecha = filas.filter((f) => f.fecha);
  for (const f of conFecha) {
    const err = validarVencimiento({ periodicidad: ob.periodicidad, reglaDigitos: regla }, { periodo: f.periodo, digitos: f.digitos, fecha: f.fecha! });
    if (err) return { ok: false, error: err };
  }
  if (conFecha.length) {
    const { error } = await ctx.sb.from("obligacion_vencimiento").upsert(
      conFecha.map((f) => ({ tenant: ctx.tenant, obligacion_id: ob.id, anio, periodo: f.periodo, digitos: f.digitos, fecha: f.fecha! })),
      { onConflict: "obligacion_id,anio,periodo,digitos" },
    );
    if (error) return { ok: false, error: errorLegible(error.message) };
  }
  for (const f of filas.filter((x) => !x.fecha)) {
    if (f.periodo < 1 || f.periodo > periodosPorAnio(ob.periodicidad)) continue;
    const { error } = await ctx.sb.from("obligacion_vencimiento").delete()
      .eq("obligacion_id", ob.id).eq("tenant", ctx.tenant).eq("anio", anio).eq("periodo", f.periodo).eq("digitos", f.digitos);
    if (error) return { ok: false, error: errorLegible(error.message) };
  }
  revalidatePath(RUTA);
  return { ok: true };
}

/** Registra (o borra, con `null`) la fecha de presentación o de pago de un periodo. */
export async function registrarCumplimiento(input: {
  obligacionId: number; anio: number; periodo: number;
  presentadaEn: string | null; pagadaEn: string | null; nota?: string | null;
}): Promise<Result> {
  for (const f of [input.presentadaEn, input.pagadaEn]) {
    if (f && !/^\d{4}-\d{2}-\d{2}$/.test(f)) return { ok: false, error: "Fecha inválida." };
  }
  const ctx = await contexto();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const { error } = await ctx.sb.from("obligacion_cumplimiento").upsert({
    tenant: ctx.tenant, obligacion_id: input.obligacionId, anio: input.anio, periodo: input.periodo,
    presentada_en: input.presentadaEn, pagada_en: input.pagadaEn, nota: input.nota?.trim() || null,
  }, { onConflict: "obligacion_id,anio,periodo" });
  if (error) return { ok: false, error: errorLegible(error.message) };
  revalidatePath(RUTA);
  return { ok: true };
}
