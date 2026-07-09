import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { RetencionesClient } from "./RetencionesClient";

export const dynamic = "force-dynamic";
const ROLES_CONTABLES = ["superadmin", "gerencia", "administracion"];

export default async function RetencionesPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  if (!ROLES_CONTABLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Retenciones a proveedores</h1>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No tienes permisos para ver este módulo. Solicítalo a un administrador.
        </p>
      </div>
    );
  }

  const tenant = await getTenant();
  const { data: cxp } = await sb.from("cuentas_por_pagar").select("numero_contrato").eq("tenant", tenant);
  const contratos = Array.from(new Set((cxp ?? []).map((c) => c.numero_contrato as string))).sort().reverse();

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Retenciones a proveedores</h1>
        <p className="mt-1 text-sm text-gray-500">
          Busca un contrato y el tipo de proveedor (hotel, aéreo, receptivo…) para registrar la
          retefuente que le practicaste: se descuenta del saldo pendiente del proveedor, igual
          que un abono, y queda la fecha en que se practicó + el mes en que la vas a declarar a
          la DIAN.
        </p>
      </div>
      <RetencionesClient contratos={contratos} />
    </div>
  );
}
