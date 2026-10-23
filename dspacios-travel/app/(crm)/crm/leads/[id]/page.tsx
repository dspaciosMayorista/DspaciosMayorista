import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LeadDetalleClient, type ActividadRow, type LeadDetalle, type ResponsableOpt } from "./LeadDetalleClient";
import { CRM_LEAD_ROLES } from "@/lib/crm/leads";

export const dynamic = "force-dynamic";

export default async function LeadDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isFinite(leadId)) notFound();

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("id, rol").eq("id", user.id).maybeSingle()
    : { data: null };

  if (!CRM_LEAD_ROLES.includes((perfil?.rol ?? "") as never)) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Lead</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Módulo comercial interno.</p>
      </div>
    );
  }

  const [{ data: lead }, { data: actividades }, { data: responsables }] = await Promise.all([
    sb
      .from("crm_leads")
      .select("id, tenant, etapa, canal, nombre, telefono, email, documento, interes, origen_detalle, notas, responsable_id, proxima_accion_at, cerrado_at, created_at, updated_at")
      .eq("id", leadId)
      .maybeSingle(),
    sb
      .from("crm_lead_actividades")
      .select("id, lead_id, tipo, cuerpo, proxima_accion_at, actor_id, actor_email, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
    sb
      .from("usuarios")
      .select("id, nombre, email, rol, tenant")
      .in("rol", ["gerencia", "administracion", "venta"])
      .eq("activo", true)
      .order("nombre"),
  ]);

  if (!lead) notFound();

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <Link href="/crm/leads" className="text-sm font-medium text-gray-500 hover:text-gray-800">← Leads</Link>
      <div className="mb-5 mt-3">
        <h1 className="text-2xl font-bold text-gray-900">{lead.nombre}</h1>
        <p className="mt-1 text-sm text-gray-500">Ficha manual del lead, seguimiento y bitácora comercial.</p>
      </div>
      <LeadDetalleClient
        lead={lead as LeadDetalle}
        actividades={(actividades ?? []) as ActividadRow[]}
        responsables={(responsables ?? []) as ResponsableOpt[]}
        puedeReasignar={["superadmin", "gerencia", "administracion"].includes(perfil?.rol ?? "")}
        usuarioId={perfil?.id ?? ""}
      />
    </div>
  );
}
