import { createClient } from "@/lib/supabase/server";
import { LeadsClient, type LeadRow, type ResponsableOpt } from "./LeadsClient";
import { CRM_LEAD_ROLES } from "@/lib/crm/leads";

export const dynamic = "force-dynamic";

export default async function CrmLeadsPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("id, rol").eq("id", user.id).maybeSingle()
    : { data: null };

  if (!CRM_LEAD_ROLES.includes((perfil?.rol ?? "") as never)) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Leads</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Módulo comercial interno.</p>
      </div>
    );
  }

  const [{ data: leads }, { data: responsables }] = await Promise.all([
    sb
      .from("crm_leads")
      .select("id, tenant, etapa, canal, nombre, telefono, email, tipo_doc, documento, interes, origen_detalle, notas, responsable_id, proxima_accion_at, cerrado_at, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(500),
    sb
      .from("usuarios")
      .select("id, nombre, email, rol, tenant")
      .in("rol", ["gerencia", "administracion", "venta"])
      .eq("activo", true)
      .order("nombre"),
  ]);

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
        <p className="mt-1 text-sm text-gray-500">
          Captura manual de oportunidades desde WhatsApp e Instagram, con responsable, etapa y próxima acción.
        </p>
      </div>
      <LeadsClient
        leads={(leads ?? []) as LeadRow[]}
        responsables={(responsables ?? []) as ResponsableOpt[]}
        puedeReasignar={["superadmin", "gerencia", "administracion"].includes(perfil?.rol ?? "")}
        usuarioId={perfil?.id ?? ""}
      />
    </div>
  );
}
