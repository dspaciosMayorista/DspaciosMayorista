import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accesoReferidos, mensajeErrorReferidos, type AccesoReferidos, type CandidatoReferido, type DecisionReferido, type EstadoReferido } from "./reglas";

// #76 — Referidos (migración 341). Todo pasa por funciones SECURITY DEFINER que reciben el ACTOR como id y vuelven a verificar rol activo y agencia: aquí el actor se deduce SIEMPRE de la sesión
// (nunca de un argumento del navegador) y el porcentaje/identidad del referidor salen de la base (asignación o código guardado). Sin sondeos ni reintentos: una llamada por acción o por carga de página.
// Las funciones son nuevas y aún no están en types/database.ts: se llaman sin tipo.
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
const rpcAdmin = () => { const a = createAdminClient(); return (a as unknown as { rpc: Rpc }).rpc.bind(a); };

export type ActorReferidos = { id: string; acceso: Extract<AccesoReferidos, { ok: true }> };

/** El usuario de la sesión y su acceso a «Referidos», o null (sin sesión, inactivo o rol no admitido). */
export async function actorReferidos(): Promise<ActorReferidos | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await createAdminClient().from("usuarios").select("rol, activo").eq("id", user.id).maybeSingle();
  const acceso = accesoReferidos(perfil);
  return acceso.ok ? { id: user.id, acceso } : null;
}

export type Referidor = {
  id: number; tenant: string; nombre: string; tipo_documento: string | null; documento: string | null; email: string | null; telefono: string | null; notas: string | null; activo: boolean;
  codigos: { codigo: string; pct: number; activo: boolean }[]; aliados_vigentes: number;
};
export type Asignacion = {
  id: number; aliado_id: number; aliado_nombre: string; referidor_id: number; referidor_nombre: string; tenant: string; pct: number; origen: "manual" | "codigo"; codigo: string | null;
  vigente_desde: string; vigente_hasta: string | null;
};
export type ContratoReferido = {
  id: number; numero_contrato: string; tenant: string; referidor_id: number; referidor_nombre: string; aliado_id: number; aliado_nombre: string; pct: number; origen: string; codigo: string | null;
  atribuido_en: string; moneda: string;
  /** Base GUARDADA de la comisión del aliado (en NETO, la original). null = no hay evidencia (o es ambigua): nunca un cero calculado. */
  base: number | null;
  /** Participación. null = sin evidencia de la base; 0 solo cuando la base guardada es 0 o el contrato está cancelado. */
  comision: number | null;
  estado: EstadoReferido; hay_mas: boolean; neto: boolean; comision_aliado_id: number | null;
};

export type Lectura<T> = { ok: true; datos: T } | { ok: false; error: string };

export async function cargarCatalogoReferidos(actor: ActorReferidos): Promise<Lectura<{ referidores: Referidor[]; asignaciones: Asignacion[] }>> {
  const { data, error } = await rpcAdmin()("referidos_catalogo", { p_actor: actor.id });
  if (error || typeof data !== "object" || data === null) return { ok: false, error: mensajeErrorReferidos(error) };
  const d = data as { referidores?: Referidor[]; asignaciones?: Asignacion[] };
  return { ok: true, datos: { referidores: d.referidores ?? [], asignaciones: d.asignaciones ?? [] } };
}

export async function cargarContratosReferidos(actor: ActorReferidos, f: { referidorId?: number | null; aliadoId?: number | null; estado?: string | null; limite?: number; antes?: number | null } = {}): Promise<Lectura<ContratoReferido[]>> {
  const { data, error } = await rpcAdmin()("referidos_contratos", {
    p_actor: actor.id, p_referidor_id: f.referidorId ?? null, p_aliado_id: f.aliadoId ?? null, p_estado: f.estado ?? null, p_limite: f.limite ?? 100, p_antes: f.antes ?? null,
  });
  if (error || !Array.isArray(data)) return { ok: false, error: mensajeErrorReferidos(error) };
  return { ok: true, datos: data as ContratoReferido[] };
}

export async function cargarCandidatosReferidos(actor: ActorReferidos): Promise<Lectura<CandidatoReferido[]>> {
  const { data, error } = await rpcAdmin()("referidos_candidatos", { p_actor: actor.id });
  if (error || !Array.isArray(data)) return { ok: false, error: mensajeErrorReferidos(error) };
  return { ok: true, datos: data as CandidatoReferido[] };
}

export type Resultado = { ok: true; estado: string } | { ok: false; error: string };
async function llamar(fn: string, args: Record<string, unknown>): Promise<Resultado> {
  const { data, error } = await rpcAdmin()(fn, args);
  if (error) return { ok: false, error: mensajeErrorReferidos(error) };
  const estado = (data as { estado?: unknown } | null)?.estado;
  return typeof estado === "string" ? { ok: true, estado } : { ok: false, error: mensajeErrorReferidos(null) };
}

export const guardarReferidor = (actor: ActorReferidos, d: { id: number | null; tenant: string; nombre: string; tipoDocumento: string; documento: string; email: string; telefono: string; notas: string; activo: boolean }) =>
  llamar("referidor_guardar", { p_actor: actor.id, p_id: d.id, p_tenant: d.tenant, p_nombre: d.nombre, p_tipo_documento: d.tipoDocumento, p_documento: d.documento, p_email: d.email, p_telefono: d.telefono, p_notas: d.notas, p_activo: d.activo });
export const definirCodigoReferido = (actor: ActorReferidos, d: { referidorId: number; codigo: string; pct: number; activo: boolean }) =>
  llamar("referidor_codigo_definir", { p_actor: actor.id, p_referidor_id: d.referidorId, p_codigo: d.codigo, p_pct: d.pct, p_activo: d.activo });
export const asignarReferido = (actor: ActorReferidos, d: { aliadoId: number; referidorId: number; pct: number; motivo: string }) =>
  llamar("referido_asignar", { p_actor: actor.id, p_aliado_id: d.aliadoId, p_referidor_id: d.referidorId, p_pct: d.pct, p_motivo: d.motivo });
export const aplicarCodigoReferido = (actorId: string, aliadoId: number, codigo: string) => llamar("referido_aplicar_codigo", { p_actor: actorId, p_aliado_id: aliadoId, p_codigo: codigo });
export const quitarReferido = (actor: ActorReferidos, d: { aliadoId: number; tenant: string; motivo: string }) =>
  llamar("referido_quitar", { p_actor: actor.id, p_aliado_id: d.aliadoId, p_tenant: d.tenant, p_motivo: d.motivo });

/** Decide el código escrito en el registro (superadmin/gerencia; la base lo vuelve a exigir). Para «confirmar_codigo», referidor y % son lo que la persona VIO: la base solo confirma si siguen siendo la regla guardada. */
export const decidirCandidatoReferido = (actor: ActorReferidos, solicitudId: number, d: DecisionReferido) =>
  llamar("referido_decidir_solicitud", {
    p_actor: actor.id, p_solicitud_id: solicitudId, p_decision: d.decision,
    p_referidor_id: d.decision === "descartar" ? null : d.referidorId, p_pct: d.decision === "descartar" ? null : d.pct,
  });
