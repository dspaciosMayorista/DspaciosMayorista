import { createClient } from "@/lib/supabase/server";
import { ConfigClient } from "./ConfigClient";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  const admin = ["superadmin", "administracion", "gerencia"].includes(perfil?.rol ?? "");

  if (!admin) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Configuración</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Solo administración / gerencia pueden ver la configuración.
        </p>
      </div>
    );
  }

  const [{ data: asesores }, { data: parametros }] = await Promise.all([
    sb.from("asesores").select("id, nombre, email, pct_comision_base, meta_mensual").order("nombre"),
    sb.from("parametros_tributarios").select("parametro, valor, descripcion").order("parametro"),
  ]);

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Configuración</h1>
      <p className="mb-6 text-sm text-gray-500">Asesores, comisiones y parámetros tributarios.</p>
      <ConfigClient asesores={asesores ?? []} parametros={parametros ?? []} />
    </div>
  );
}
