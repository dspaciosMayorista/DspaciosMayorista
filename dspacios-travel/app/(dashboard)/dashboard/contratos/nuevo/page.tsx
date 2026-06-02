import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { NuevoContratoForm } from "../NuevoContratoForm";

export const dynamic = "force-dynamic";

export default async function NuevoContratoPage() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  let asesorDefault = "";
  if (user) {
    const { data: perfil } = await sb
      .from("usuarios")
      .select("nombre")
      .eq("id", user.id)
      .single();
    asesorDefault = perfil?.nombre ?? "";
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <Link
        href="/dashboard/contratos"
        className="text-sm text-gray-400 hover:text-gray-600"
      >
        ← Contratos
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-semibold text-gray-900">
        Nuevo contrato
      </h1>
      <p className="mb-6 text-sm text-gray-500">
        Captura el cliente, el paquete, los pasajeros y los valores. Al guardar
        se genera el contrato y su documento imprimible.
      </p>
      <NuevoContratoForm asesorDefault={asesorDefault} />
    </div>
  );
}
