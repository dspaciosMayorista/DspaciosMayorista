"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { exigirEscrituraCatalogoGlobal } from "@/lib/auth/contextoAgencia";
import { createAdminClient } from "@/lib/supabase/admin";
import { lineasHistorialAliado, type FilaAuditoria, type LineaHistorial } from "@/lib/aliados/historial";
import { corregirFichaAliado, MSG_SIN_PERMISO_CORRECCION, type RespuestaCorreccion } from "@/lib/aliados/correccionServidor";
import type { EntradaCorreccion } from "@/lib/aliados/correccion";

type Result = { ok: true } | { ok: false; error: string };
const oNull = (s: string) => (s && s.trim() !== "" ? s.trim() : null);

export type AliadoInput = {
  nombre: string;
  tipo: "agencia" | "freelance";
  nit: string;
  tipoDocumento: string;   // "NIT" | "CC"
  direccion: string;
  contacto: string;
  email: string;
  telefono: string;
  pctComision: number | null;   // override (fracción); null = usa el default general
  aplicaRetencion: boolean;
  pctRetencion: number;         // fracción
  banco: string;
  tipoCuenta: string;
  numeroCuenta: string;
};

export async function crearAliado(input: AliadoInput): Promise<Result> {
  // D8/D9: los catálogos globales solo se escriben desde Mayorista (la RLS lo exige igual).
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  if (!input.nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const sb = await createClient();
  const { error } = await sb.from("aliados").insert({
    nombre: input.nombre.trim(),
    tipo: input.tipo,
    nit: oNull(input.nit),
    tipo_documento: input.tipoDocumento || "NIT",
    direccion: oNull(input.direccion),
    contacto: oNull(input.contacto),
    email: oNull(input.email),
    telefono: oNull(input.telefono),
    pct_comision: input.pctComision,
    aplica_retencion: input.aplicaRetencion,
    pct_retencion: input.pctRetencion,
    banco: oNull(input.banco),
    tipo_cuenta: oNull(input.tipoCuenta),
    numero_cuenta: oNull(input.numeroCuenta),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/aliados");
  return { ok: true };
}

export async function actualizarAliado(
  id: number,
  patch: {
    pctComision?: number | null; aplicaRetencion?: boolean; pctRetencion?: number;
    tipoDocumento?: string; direccion?: string; banco?: string; tipoCuenta?: string; numeroCuenta?: string;
    /** #102 (migración 238): un aliado inactivo no se puede cotizar como beneficiario de una venta B2B asistida. */
    activo?: boolean;
  }
): Promise<Result> {
  // D8/D9: los catálogos globales solo se escriben desde Mayorista (la RLS lo exige igual).
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const sb = await createClient();
  const upd: {
    pct_comision?: number | null; aplica_retencion?: boolean; pct_retencion?: number;
    tipo_documento?: string; direccion?: string | null; banco?: string | null; tipo_cuenta?: string | null; numero_cuenta?: string | null;
    activo?: boolean;
  } = {};
  if (patch.activo !== undefined) upd.activo = patch.activo;
  if (patch.pctComision !== undefined) upd.pct_comision = patch.pctComision;
  if (patch.aplicaRetencion !== undefined) upd.aplica_retencion = patch.aplicaRetencion;
  if (patch.pctRetencion !== undefined) upd.pct_retencion = patch.pctRetencion;
  if (patch.tipoDocumento !== undefined) upd.tipo_documento = patch.tipoDocumento || "NIT";
  if (patch.direccion !== undefined) upd.direccion = oNull(patch.direccion);
  if (patch.banco !== undefined) upd.banco = oNull(patch.banco);
  if (patch.tipoCuenta !== undefined) upd.tipo_cuenta = oNull(patch.tipoCuenta);
  if (patch.numeroCuenta !== undefined) upd.numero_cuenta = oNull(patch.numeroCuenta);
  const { error } = await sb.from("aliados").update(upd).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/aliados");
  return { ok: true };
}

export async function eliminarAliado(id: number): Promise<Result> {
  // D8/D9: los catálogos globales solo se escriben desde Mayorista (la RLS lo exige igual).
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const sb = await createClient();
  const { error } = await sb.from("aliados").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/aliados");
  return { ok: true };
}

/**
 * #25 — Historial de cambios de UNA ficha (auditoría por trigger + ediciones del portal). Una sola lectura acotada (100 filas), solo al pedirlo.
 * Lo autoriza la RLS de `auditoria` (superadmin y gerencia); aquí se comprueba igual para dar un mensaje claro y no depender de «0 filas = sin cambios».
 */
export async function historialCambiosAliado(id: number): Promise<{ ok: true; lineas: LineaHistorial[] } | { ok: false; error: string }> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Aliado inválido." };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "No autorizado." };
  const { data: perfil } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  if (!perfil || perfil.activo === false || !["superadmin", "gerencia"].includes(String(perfil.rol))) {
    return { ok: false, error: "Solo superadmin y gerencia consultan el historial de cambios." };
  }
  const { data, error } = await sb.from("auditoria")
    .select("id, creado_en, actor_email, actor_nombre, actor_rol, accion, despues, cambios")
    .eq("tabla", "aliados").eq("registro_id", String(id))
    .order("creado_en", { ascending: false }).order("id", { ascending: false }).limit(100);
  if (error) return { ok: false, error: "No se pudo leer el historial." };
  return { ok: true, lineas: lineasHistorialAliado((data ?? []) as unknown as FilaAuditoria[]) };
}

/**
 * #25 (ADL-039) — Corrección de nombre, teléfono, correo y documento de una ficha, solo superadmin y gerencia (ver `correccionServidor`).
 * La sesión es la única fuente del actor; del formulario solo se leen las llaves permitidas. Los catálogos globales solo se escriben desde Mayorista.
 */
export async function corregirDatosAliado(id: number, entrada: EntradaCorreccion): Promise<RespuestaCorreccion> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: MSG_SIN_PERMISO_CORRECCION };
  const { data: perfil } = await sb.from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  const actor = perfil ? { id: user.id, rol: (perfil.rol as string | null) ?? null, activo: (perfil.activo as boolean | null) ?? null } : null;
  // El rol se comprueba ANTES de la compuerta del catálogo para no revelar a otros roles su estado.
  if (!actor || actor.activo !== true || !(["superadmin", "gerencia"] as string[]).includes(String(actor.rol))) return { ok: false, error: MSG_SIN_PERMISO_CORRECCION };
  const catalogo = await exigirEscrituraCatalogoGlobal();
  if (!catalogo.ok) return catalogo;
  const e = entrada ?? ({} as EntradaCorreccion);
  const limpia: EntradaCorreccion = { nombre: e.nombre, telefono: e.telefono, email: e.email, tipoDocumento: e.tipoDocumento, nit: e.nit, esperado: e.esperado, confirmaImpacto: e.confirmaImpacto === true };
  const r = await corregirFichaAliado({ sb, admin: createAdminClient() }, actor, id, limpia);
  if (r.ok && r.cambios.length) revalidatePath("/dashboard/aliados");
  return r;
}
