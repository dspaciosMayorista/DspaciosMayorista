import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { PlanCuentasClient } from "./PlanCuentasClient";

export const dynamic = "force-dynamic";
const ROLES_CONTABLES = ["superadmin", "gerencia", "administracion"];

export default async function PlanCuentasPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES_CONTABLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Plan de cuentas (PUC)</h1>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No tienes permisos para ver este módulo. Solicítalo a un administrador.
        </p>
      </div>
    );
  }

  const tenant = await getTenant();
  const { data: cuentas } = await sb
    .from("puc_cuentas")
    .select("id, codigo, nombre, nivel, padre_id, naturaleza, permite_movimiento, activa")
    .eq("tenant", tenant)
    .order("codigo");

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Plan de cuentas (PUC)</h1>
        <p className="mt-1 text-sm text-gray-500">
          Catálogo jerárquico de cuentas contables (clase → grupo → cuenta → subcuenta → auxiliar), con una base ya
          cargada de las cuentas típicas de una agencia de viajes. Solo las cuentas marcadas &quot;recibe movimiento&quot;
          (las hojas del árbol) pueden usarse en el libro diario — las demás son de agrupación.
        </p>
      </div>
      <PlanCuentasClient cuentasIniciales={cuentas ?? []} />
    </div>
  );
}
