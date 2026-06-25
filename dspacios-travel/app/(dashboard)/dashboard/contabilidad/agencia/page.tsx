import { createClient } from "@/lib/supabase/server";
import { tenantContext } from "@/lib/tenant.server";
import { TENANT_LABEL } from "@/lib/tenant";
import { AgenciaForm } from "./AgenciaForm";

export const dynamic = "force-dynamic";
const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function AgenciaPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Datos de la agencia</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Uso contable (administración / gerencia).</p>
      </div>
    );
  }

  const { tenant } = await tenantContext();
  const { data: ag } = await sb.from("agencias").select("*").eq("tenant", tenant).maybeSingle();

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Datos de la agencia · {TENANT_LABEL[tenant]}</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">
        Identidad tributaria (del RUT) de la agencia activa. Se usa en recibos, estados de cuenta,
        facturación y estados financieros. Cambia de agencia con el selector de arriba para editar la otra.
      </p>
      <AgenciaForm data={(ag ?? {}) as Record<string, string | boolean | null>} />
    </div>
  );
}
