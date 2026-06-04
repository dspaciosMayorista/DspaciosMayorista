import { createClient } from "@/lib/supabase/server";
import { getEmpresaConfig } from "@/lib/empresa";
import { EmpresaForm } from "./EmpresaForm";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function EmpresaPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };

  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Información de la empresa</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Este módulo es de uso interno (administración / gerencia).
        </p>
      </div>
    );
  }

  const empresa = await getEmpresaConfig(sb);

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Información de la empresa</h1>
        <p className="mt-1 text-sm text-gray-500">
          Marca, datos tributarios, cuenta bancaria y condiciones que usa toda la app
          (logo, encabezado y pie del contrato, tarifario público). Configúralo una vez.
        </p>
      </div>
      <EmpresaForm inicial={empresa} />
    </div>
  );
}
