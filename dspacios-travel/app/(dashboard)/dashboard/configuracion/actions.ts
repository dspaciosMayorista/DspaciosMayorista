"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { ok: false; error: string };

// ── Rangos de edad (catálogo) ──────────────────────────────────────────────
export async function crearRangoEdad(input: {
  denominacion: string;
  edadMin: number;
  edadMax: number;
}): Promise<Result> {
  if (!input.denominacion.trim()) return { ok: false, error: "La denominación es obligatoria." };
  if (input.edadMax < input.edadMin) return { ok: false, error: "La edad máxima no puede ser menor que la mínima." };
  const sb = await createClient();
  const { error } = await sb.from("rangos_edad").insert({
    denominacion: input.denominacion.trim(),
    edad_min: input.edadMin,
    edad_max: input.edadMax,
    activo: true,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function eliminarRangoEdad(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("rangos_edad").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function crearAsesor(input: {
  nombre: string;
  email: string;
  pctComisionBase: number;
  metaMensual: number;
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("asesores").insert({
    nombre: input.nombre.trim(),
    email: input.email.trim() || null,
    pct_comision_base: input.pctComisionBase,
    meta_mensual: input.metaMensual,
    activo: true,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function actualizarAsesor(
  id: number,
  pctComisionBase: number,
  aplicaRetencion?: boolean
): Promise<Result> {
  const sb = await createClient();
  const patch: { pct_comision_base: number; aplica_retencion?: boolean } = { pct_comision_base: pctComisionBase };
  if (aplicaRetencion !== undefined) patch.aplica_retencion = aplicaRetencion;
  const { error } = await sb.from("asesores").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function eliminarAsesor(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("asesores").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

// ── Formas de pago (catálogo) ──────────────────────────────────────────────
export async function crearFormaPago(nombre: string): Promise<Result> {
  if (!nombre.trim()) return { ok: false, error: "El nombre es obligatorio." };
  const sb = await createClient();
  const { error } = await sb.from("formas_pago").insert({ nombre: nombre.trim() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function eliminarFormaPago(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("formas_pago").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function actualizarParametro(parametro: string, valor: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("parametros_tributarios")
    .update({ valor, updated_at: new Date().toISOString() })
    .eq("parametro", parametro);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

// ── Escalas de comisión (asesor interno) ───────────────────────────────────
export async function crearEscala(nombre: string): Promise<Result> {
  if (!nombre.trim()) return { ok: false, error: "Ponle un nombre a la escala." };
  const sb = await createClient();
  const { error } = await sb.from("escalas_comision").insert({ nombre: nombre.trim() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function eliminarEscala(id: number): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("escalas_comision").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

// Reemplaza TODOS los rangos de una escala (UI edita la lista completa).
export async function guardarRangosEscala(
  escalaId: number,
  rangos: { pvp_desde: number; pvp_hasta: number | null; pct: number }[]
): Promise<Result> {
  const sb = await createClient();
  await sb.from("escala_rangos").delete().eq("escala_id", escalaId);
  const limpios = rangos
    .filter((r) => Number(r.pct) >= 0)
    .map((r, i) => ({
      escala_id: escalaId,
      pvp_desde: Math.max(0, Number(r.pvp_desde) || 0),
      pvp_hasta: r.pvp_hasta == null || r.pvp_hasta === undefined ? null : Math.max(0, Number(r.pvp_hasta) || 0),
      pct: Math.max(0, Number(r.pct) || 0),
      orden: i,
    }));
  if (limpios.length) {
    const { error } = await sb.from("escala_rangos").insert(limpios);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function asignarEscalaAsesor(asesorId: number, escalaId: number | null): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("asesores").update({ escala_id: escalaId }).eq("id", asesorId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

// Asigna escala / retención a un USUARIO (asesor interno = usuario rol 'venta').
export async function actualizarEscalaUsuario(
  usuarioId: string,
  patch: { escalaId?: number | null; aplicaRetencion?: boolean }
): Promise<Result> {
  const sb = await createClient();
  const upd: { escala_id?: number | null; aplica_retencion?: boolean } = {};
  if (patch.escalaId !== undefined) upd.escala_id = patch.escalaId;
  if (patch.aplicaRetencion !== undefined) upd.aplica_retencion = patch.aplicaRetencion;
  const { error } = await sb.from("usuarios").update(upd).eq("id", usuarioId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

// ── Destinatarios de solicitudes de reserva (tarifario dinámico) ───────────
export async function actualizarConfigSolicitudes(input: {
  whatsapp: string; emails: string; mensajeExtra: string;
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("config_solicitudes").update({
    whatsapp: input.whatsapp.trim() || null,
    emails: input.emails.trim() || null,
    mensaje_extra: input.mensajeExtra.trim() || null,
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

// ── Video de fondo del tarifario (global) ──────────────────────────────────
export async function actualizarConfigSitio(input: { videoFondoUrl: string }): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("config_sitio").update({
    video_fondo_url: input.videoFondoUrl.trim() || null,
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  revalidatePath("/tarifario");
  return { ok: true };
}

// ── Notificaciones por correo (Resend) ─────────────────────────────────────
export async function actualizarConfigNotificaciones(input: {
  remitente: string; destinatarios: string; diasAnticipacion: number;
  alertaCxp: boolean; alertaCuotas: boolean; alertaBloqueos: boolean; activo: boolean;
}): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb.from("config_notificaciones").update({
    remitente: input.remitente.trim() || "D'spacios Travel <info@dspaciostravel.com>",
    destinatarios: input.destinatarios.trim() || null,
    dias_anticipacion: Math.max(0, Math.trunc(input.diasAnticipacion) || 5),
    alerta_cxp: input.alertaCxp, alerta_cuotas: input.alertaCuotas, alerta_bloqueos: input.alertaBloqueos,
    activo: input.activo, updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/configuracion");
  return { ok: true };
}

export async function enviarNotificacionPrueba(): Promise<Result> {
  const { enviarNotificaciones } = await import("@/lib/notificaciones");
  const r = await enviarNotificaciones({ forzar: true });
  if (!r.ok) return { ok: false, error: r.error ?? "No se pudo enviar." };
  return { ok: true };
}
