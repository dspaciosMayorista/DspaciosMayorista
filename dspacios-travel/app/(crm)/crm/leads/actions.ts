"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tenantContext } from "@/lib/tenant.server";
import {
  CRM_LEAD_ETAPAS,
  CRM_LEAD_ROLES,
  CRM_LEAD_RESPONSABLE_ROLES,
  esCanalLead,
  esEtapaLead,
  normalizarDocumentoLead,
  normalizarEmailLead,
  normalizarTelefonoLead,
  type CrmLeadEtapa,
} from "@/lib/crm/leads";

type Result = { ok: true; id?: number } | { ok: false; error: string; id?: number };
type PerfilLead = { id: string; email: string | null; rol: string | null; tenant: string | null };

const oNull = (s?: string | null) => {
  const v = (s ?? "").trim();
  return v ? v : null;
};

async function perfilActual(): Promise<{ sb: Awaited<ReturnType<typeof createClient>>; perfil: PerfilLead | null }> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { sb, perfil: null };
  const { data } = await sb
    .from("usuarios")
    .select("id, email, rol, tenant")
    .eq("id", user.id)
    .maybeSingle();
  return { sb, perfil: data as PerfilLead | null };
}

function autorizado(perfil: PerfilLead | null) {
  return CRM_LEAD_ROLES.includes((perfil?.rol ?? "") as never);
}

function puedeAsignar(perfil: PerfilLead | null) {
  return ["superadmin", "gerencia", "administracion"].includes(perfil?.rol ?? "");
}

async function buscarDuplicadoVisible(
  sb: Awaited<ReturnType<typeof createClient>>,
  tenant: string,
  input: { telefono?: string; email?: string; documento?: string },
) {
  const telefono = normalizarTelefonoLead(input.telefono);
  const email = normalizarEmailLead(input.email);
  const documento = normalizarDocumentoLead(input.documento);
  const consulta = () => sb.from("crm_leads").select("id").eq("tenant", tenant).limit(1);

  if (telefono) {
    const { data } = await consulta().eq("telefono_norm", telefono).maybeSingle();
    if (data?.id) return data.id as number;
  }
  if (email) {
    const { data } = await consulta().eq("email_norm", email).maybeSingle();
    if (data?.id) return data.id as number;
  }
  if (documento) {
    const { data } = await consulta().eq("documento_norm", documento).maybeSingle();
    if (data?.id) return data.id as number;
  }
  return undefined;
}

async function mensajeDuplicado(
  sb: Awaited<ReturnType<typeof createClient>>,
  tenant: string,
  input: { telefono?: string; email?: string; documento?: string },
): Promise<Result> {
  const id = await buscarDuplicadoVisible(sb, tenant, input);
  return { ok: false, error: id ? `Ya existe otro lead con esos datos (#${id}).` : "Ya existe otro lead con ese teléfono, correo o documento.", id };
}

export type LeadInput = {
  nombre: string;
  canal: string;
  telefono?: string;
  email?: string;
  documento?: string;
  interes?: string;
  origenDetalle?: string;
  notas?: string;
  responsableId?: string | null;
  proximaAccionAt?: string | null;
};

export async function crearLead(input: LeadInput): Promise<Result> {
  const { sb, perfil } = await perfilActual();
  if (!autorizado(perfil)) return { ok: false, error: "Sin permiso para crear leads." };

  const nombre = oNull(input.nombre);
  if (!nombre) return { ok: false, error: "El nombre es obligatorio; usa 'Desconocido' si aún no lo tienes." };
  if (!esCanalLead(input.canal)) return { ok: false, error: "Canal inválido." };

  const { tenant } = await tenantContext();
  const responsableId = oNull(input.responsableId);
  if (responsableId && !puedeAsignar(perfil) && responsableId !== perfil?.id) {
    return { ok: false, error: "Solo gerencia o administración pueden asignar a otra persona." };
  }

  const { data, error } = await sb
    .from("crm_leads")
    .insert({
      tenant,
      canal: input.canal,
      nombre,
      telefono: oNull(input.telefono),
      email: oNull(input.email),
      documento: oNull(input.documento),
      interes: oNull(input.interes),
      origen_detalle: oNull(input.origenDetalle),
      notas: oNull(input.notas),
      responsable_id: responsableId,
      creado_por: perfil?.id,
      proxima_accion_at: oNull(input.proximaAccionAt),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return mensajeDuplicado(sb, tenant, input);
    return { ok: false, error: error.message };
  }

  const id = data.id as number;
  const cuerpo = [
    `Lead creado desde ${input.canal}.`,
    input.notas?.trim() ? input.notas.trim() : "",
  ].filter(Boolean).join("\n\n");

  await sb.from("crm_lead_actividades").insert({
    lead_id: id,
    tipo: input.canal === "instagram" ? "instagram" : input.canal === "whatsapp" ? "whatsapp" : "nota",
    cuerpo,
    proxima_accion_at: oNull(input.proximaAccionAt),
    actor_id: perfil?.id,
    actor_email: perfil?.email,
  });

  revalidatePath("/crm/leads");
  return { ok: true, id };
}

export async function actualizarLead(id: number, input: LeadInput): Promise<Result> {
  const { sb, perfil } = await perfilActual();
  if (!autorizado(perfil)) return { ok: false, error: "Sin permiso para actualizar leads." };
  const nombre = oNull(input.nombre);
  if (!nombre) return { ok: false, error: "El nombre es obligatorio." };
  if (!esCanalLead(input.canal)) return { ok: false, error: "Canal inválido." };

  const { data: actual } = await sb.from("crm_leads").select("tenant, responsable_id").eq("id", id).maybeSingle();
  if (!actual) return { ok: false, error: "Lead no encontrado o sin permiso." };
  const responsableId = oNull(input.responsableId);
  if (responsableId !== actual.responsable_id && !puedeAsignar(perfil)) {
    return { ok: false, error: "Solo gerencia o administración pueden reasignar leads." };
  }

  const { error } = await sb.from("crm_leads").update({
    canal: input.canal,
    nombre,
    telefono: oNull(input.telefono),
    email: oNull(input.email),
    documento: oNull(input.documento),
    interes: oNull(input.interes),
    origen_detalle: oNull(input.origenDetalle),
    notas: oNull(input.notas),
    responsable_id: responsableId,
    proxima_accion_at: oNull(input.proximaAccionAt),
  }).eq("id", id);

  if (error) {
    if (error.code === "23505") return mensajeDuplicado(sb, actual.tenant, input);
    return { ok: false, error: error.message };
  }

  if (responsableId !== actual.responsable_id) {
    await sb.from("crm_lead_actividades").insert({
      lead_id: id,
      tipo: "reasignacion",
      cuerpo: `Responsable actualizado.`,
      actor_id: perfil?.id,
      actor_email: perfil?.email,
    });
  }

  revalidatePath("/crm/leads");
  revalidatePath(`/crm/leads/${id}`);
  return { ok: true, id };
}

export async function cambiarEtapaLead(id: number, etapa: string): Promise<Result> {
  const { sb, perfil } = await perfilActual();
  if (!autorizado(perfil)) return { ok: false, error: "Sin permiso para cambiar etapa." };
  if (!esEtapaLead(etapa)) return { ok: false, error: "Etapa inválida." };

  const cerrada = etapa === "descartado" || etapa === "archivado";
  const { data: actual } = await sb.from("crm_leads").select("etapa").eq("id", id).maybeSingle();
  if (!actual) return { ok: false, error: "Lead no encontrado o sin permiso." };
  if (actual.etapa === etapa) return { ok: true, id };

  const { error } = await sb.from("crm_leads").update({
    etapa,
    cerrado_at: cerrada ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await sb.from("crm_lead_actividades").insert({
    lead_id: id,
    tipo: cerrada ? "cierre" : "cambio_etapa",
    cuerpo: `Etapa: ${actual.etapa} -> ${etapa}.`,
    actor_id: perfil?.id,
    actor_email: perfil?.email,
  });

  revalidatePath("/crm/leads");
  revalidatePath(`/crm/leads/${id}`);
  return { ok: true, id };
}

export async function agregarActividadLead(
  id: number,
  input: { tipo: string; cuerpo: string; proximaAccionAt?: string | null },
): Promise<Result> {
  const { sb, perfil } = await perfilActual();
  if (!autorizado(perfil)) return { ok: false, error: "Sin permiso para registrar actividad." };
  const tipo = input.tipo || "nota";
  const tiposPermitidos = ["nota", "llamada", "whatsapp", "instagram", "email", "reunion"];
  if (!tiposPermitidos.includes(tipo)) return { ok: false, error: "Tipo de actividad inválido." };
  const cuerpo = oNull(input.cuerpo);
  if (!cuerpo) return { ok: false, error: "La actividad necesita una nota." };

  const proxima = oNull(input.proximaAccionAt);
  const { error } = await sb.from("crm_lead_actividades").insert({
    lead_id: id,
    tipo,
    cuerpo,
    proxima_accion_at: proxima,
    actor_id: perfil?.id,
    actor_email: perfil?.email,
  });
  if (error) return { ok: false, error: error.message };

  if (proxima) {
    const { error: updateError } = await sb.from("crm_leads").update({ proxima_accion_at: proxima }).eq("id", id);
    if (updateError) return { ok: false, error: updateError.message };
  }

  revalidatePath("/crm/leads");
  revalidatePath(`/crm/leads/${id}`);
  return { ok: true, id };
}

export async function proximasEtapas(): Promise<readonly CrmLeadEtapa[]> {
  return CRM_LEAD_ETAPAS;
}

export async function responsablesLead() {
  const { sb, perfil } = await perfilActual();
  if (!autorizado(perfil)) return [];
  const { data } = await sb
    .from("usuarios")
    .select("id, nombre, email, rol, tenant")
    .in("rol", [...CRM_LEAD_RESPONSABLE_ROLES])
    .eq("activo", true)
    .order("nombre");
  return data ?? [];
}
