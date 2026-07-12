import { createClient } from "@/lib/supabase/server";
import { listarCuentasParaAuxiliar } from "./actions";
import { LibroAuxiliarClient } from "./LibroAuxiliarClient";

export const dynamic = "force-dynamic";
const ROLES_CONTABLES = ["superadmin", "gerencia", "administracion"];

export default async function LibroAuxiliarPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES_CONTABLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Libro auxiliar</h1>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No tienes permisos para ver este módulo. Solicítalo a un administrador.
        </p>
      </div>
    );
  }

  const cuentasR = await listarCuentasParaAuxiliar();

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Libro auxiliar</h1>
        <p className="mt-1 text-sm text-gray-500">
          Movimientos de una cuenta contable con saldo corrido — el detalle detrás del libro diario, por cuenta.
        </p>
      </div>
      <LibroAuxiliarClient cuentas={cuentasR.ok ? cuentasR.cuentas : []} />
    </div>
  );
}
