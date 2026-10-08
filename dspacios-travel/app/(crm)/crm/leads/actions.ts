"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tenantContext } from "@/lib/tenant.server";
import {
  CRM_LEAD_ETAPAS,
  CRM_LEAD_ROLES,
  avisoCoincidenciasLead,
  esEtapaLead,
  validarEntradaLead,
  type CoincidenciaLead,
  type CrmLeadEtapa,
  type EntradaLeadValidada,
  type LeadCrearInput,
  type LeadFormularioCompleto,
} from "@/lib/crm/leads";

// `aviso` lleva las coincidencias que NO bloquean (telefono, correo o mismo
// numero con otro tipo): el alta o la edicion ya quedaron hechas.
type Result = { ok: true; id?: number; aviso?: string | null } | { ok: false; error: string; id?: number };
type PerfilLead = { id: string; email: string | null; rol: string | null; tenant: string | null };

const oNull = (s?: string | null) => {
  const v = (s ?? "").trim();
  return v ? v : null;
};

// Una Server Action recibe lo que mande el navegador: el id del lead tiene que
// ser un entero positivo antes de llegar a ninguna RPC.
const idValido = (id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0;

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

// El mensaje de una RPC llega como "crm_lead_duplicado:<id>"; el id permite
// decirle al usuario cuál lead ya existe. Solo hay un duplicado que bloquea:
// mismo tenant + tipo + número de documento. El id viene vacío cuando ese lead
// no es visible para quien escribe (es de otro asesor). La validación fuerte
// (mismo tenant, rol comercial, activo) vive en SQL, no aquí.
function mensajeRpc(error: { message: string } | null): Result {
  const msg = error?.message ?? "No se pudo completar la operacion.";
  const dup = /^crm_lead_duplicado:(\d*)/.exec(msg);
  if (dup) {
    return dup[1]
      ? { ok: false, error: `Ya existe otro lead con ese tipo y numero de documento (#${dup[1]}).`, id: Number(dup[1]) }
      : { ok: false, error: "Ya existe otro lead con ese tipo y numero de documento en esta agencia." };
  }
  // `crm_lead_actualizar` exige el formulario completo; la app siempre lo manda,
  // asi que esto solo aparece si algo llamo a la RPC con un payload recortado.
  const payload = /^crm_lead_payload_(?:incompleto|invalido): (.*)$/.exec(msg);
  if (payload) return { ok: false, error: `Datos del lead incompletos o invalidos: ${payload[1]}` };
  return { ok: false, error: msg };
}

function avisoDe(data: unknown): string | null {
  const coincidencias = (data as { coincidencias?: CoincidenciaLead[] } | null)?.coincidencias;
  return avisoCoincidenciasLead(Array.isArray(coincidencias) ? coincidencias : null);
}

// Siempre las once claves: `crm_lead_actualizar` rechaza un payload parcial
// (una clave ausente no significa "no tocar") y `crm_lead_crear` las acepta.
function datosLead(input: EntradaLeadValidada, tenant?: string) {
  return {
    tenant,
    canal: input.canal,
    nombre: input.nombre,
    telefono: input.telefono,
    email: input.email,
    tipo_doc: input.tipoDoc,
    documento: input.documento,
    interes: input.interes,
    origen_detalle: input.origenDetalle,
    notas: input.notas,
    responsable_id: input.responsableId,
    proxima_accion_at: input.proximaAccionAt,
  };
}

// Alta y edicion van por RPC (`crm_lead_crear` / `crm_lead_actualizar`): alli
// viven, en la MISMA transaccion, el cambio de negocio y su bitacora, la regla
// de responsable por tenant y la excepcion de "cero filas afectadas". Aqui solo
// se filtran datos de entrada obviamente invalidos para no gastar un viaje.
//
// Alta: los campos opcionales se pueden omitir (se completan vacios).
export async function crearLead(input: LeadCrearInput): Promise<Result> {
  const { sb, perfil } = await perfilActual();
  if (!autorizado(perfil)) return { ok: false, error: "Sin permiso para crear leads." };
  const entrada = validarEntradaLead(input, "crear");
  if (!entrada.ok) return { ok: false, error: entrada.error };

  const { tenant } = await tenantContext();
  const { data, error } = await sb.rpc("crm_lead_crear", { p_datos: datosLead(entrada.datos, tenant) });
  if (error) return mensajeRpc(error);

  const id = (data as { id?: number } | null)?.id;
  revalidatePath("/crm/leads");
  return typeof id === "number" ? { ok: true, id, aviso: avisoDe(data) } : { ok: false, error: "No se pudo crear el lead." };
}

// Edicion: formulario COMPLETO. Una clave ausente se rechaza aqui, antes de
// llamar a Supabase; rellenarla con "" la convertiria en "borrar ese dato" y la
// RPC recibiria un formulario aparentemente completo. El tipo lo exige en
// compilacion y `validarEntradaLead(..., "editar")` en runtime, porque una
// Server Action recibe lo que mande el navegador.
export async function actualizarLead(id: number, input: LeadFormularioCompleto): Promise<Result> {
  const { sb, perfil } = await perfilActual();
  if (!autorizado(perfil)) return { ok: false, error: "Sin permiso para actualizar leads." };
  if (!idValido(id)) return { ok: false, error: "Lead invalido." };
  const entrada = validarEntradaLead(input, "editar");
  if (!entrada.ok) return { ok: false, error: entrada.error };

  const { data, error } = await sb.rpc("crm_lead_actualizar", {
    p_lead: id,
    p_datos: datosLead(entrada.datos),
  });
  if (error) return mensajeRpc(error);

  revalidatePath("/crm/leads");
  revalidatePath(`/crm/leads/${id}`);
  return data ? { ok: true, id, aviso: avisoDe(data) } : { ok: false, error: "No se pudo actualizar el lead." };
}

// Toma para si un lead SIN responsable de su propio tenant. La condicion vive
// en SQL (`where responsable_id is null`), asi que la carrera entre dos asesores
// la resuelve el bloqueo de fila: uno gana y el otro recibe el error.
export async function tomarLead(id: number): Promise<Result> {
  const { sb, perfil } = await perfilActual();
  if (!autorizado(perfil)) return { ok: false, error: "Sin permiso para tomar leads." };
  if (!idValido(id)) return { ok: false, error: "Lead invalido." };

  const { data, error } = await sb.rpc("crm_lead_tomar", { p_lead: id });
  if (error) return mensajeRpc(error);

  revalidatePath("/crm/leads");
  revalidatePath(`/crm/leads/${id}`);
  return data ? { ok: true, id } : { ok: false, error: "No se pudo tomar el lead." };
}

export async function cambiarEtapaLead(id: number, etapa: string): Promise<Result> {
  const { sb, perfil } = await perfilActual();
  if (!autorizado(perfil)) return { ok: false, error: "Sin permiso para cambiar etapa." };
  if (!idValido(id)) return { ok: false, error: "Lead invalido." };
  if (!esEtapaLead(etapa)) return { ok: false, error: "Etapa invalida." };

  const { data, error } = await sb.rpc("crm_lead_cambiar_etapa", { p_lead: id, p_etapa: etapa });
  if (error) return mensajeRpc(error);

  revalidatePath("/crm/leads");
  revalidatePath(`/crm/leads/${id}`);
  return data ? { ok: true, id } : { ok: false, error: "No se pudo cambiar la etapa." };
}

export async function agregarActividadLead(
  id: number,
  input: { tipo: string; cuerpo: string; proximaAccionAt?: string | null },
): Promise<Result> {
  const { sb, perfil } = await perfilActual();
  if (!autorizado(perfil)) return { ok: false, error: "Sin permiso para registrar actividad." };
  if (!idValido(id)) return { ok: false, error: "Lead invalido." };

  const { data, error } = await sb.rpc("crm_lead_registrar_actividad", {
    p_lead: id,
    p_tipo: input.tipo || "nota",
    p_cuerpo: input.cuerpo ?? "",
    p_proxima_accion_at: oNull(input.proximaAccionAt),
  });
  if (error) return mensajeRpc(error);

  revalidatePath("/crm/leads");
  revalidatePath(`/crm/leads/${id}`);
  return data ? { ok: true, id } : { ok: false, error: "No se pudo registrar la actividad." };
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
    .in("rol", ["gerencia", "administracion", "venta"])
    .eq("activo", true)
    .order("nombre");
  return data ?? [];
}