import { createClient } from "@/lib/supabase/server";
import { UsuariosClient } from "./UsuariosClient";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  const admin = ["superadmin", "administracion"].includes(perfil?.rol ?? "");

  if (!admin) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Usuarios</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Solo superadmin / administración pueden gestionar usuarios.
        </p>
      </div>
    );
  }

  const { data: usuarios } = await sb
    .from("usuarios")
    .select("id, email, nombre, rol, activo")
    .order("nombre");

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Usuarios</h1>
      <p className="mb-6 text-sm text-gray-500">
        Crea las cuentas del equipo y asígnales su rol. El asesor (venta) no ve costos ni utilidades.
      </p>
      <UsuariosClient usuarios={usuarios ?? []} />
    </div>
  );
}
