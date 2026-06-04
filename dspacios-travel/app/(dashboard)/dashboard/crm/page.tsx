import { createClient } from "@/lib/supabase/server";
import { CrmClient, type Contacto } from "./CrmClient";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion", "operaciones", "venta"];

export default async function CrmPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">CRM</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Módulo interno.</p>
      </div>
    );
  }

  const { data } = await sb
    .from("crm_contactos")
    .select("id, categoria, nombre, email, telefono, ciudad, pais, fecha_nacimiento, genero, origen, acepta_publicidad, no_contactar")
    .order("created_at", { ascending: false })
    .limit(2000);

  return (
    <div
      className="min-h-full"
      style={{ background: "linear-gradient(180deg, rgba(38,187,217,0.10) 0%, rgba(102,181,150,0.06) 28%, rgba(255,255,255,0) 60%)" }}
    >
      {/* Banner de marca */}
      <div className="bg-brand-gradient px-4 py-7 text-white md:px-8">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-2xl font-bold">CRM — Base de datos de contactos</h1>
          <p className="mt-1 text-sm text-white/85">
            Clientes finales, agencias, freelance, empresas y pasajeros. Base compartida con el portal.
            Pensado para campañas de email y publicidad.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <CrmClient contactos={(data ?? []) as Contacto[]} />
      </div>
    </div>
  );
}
