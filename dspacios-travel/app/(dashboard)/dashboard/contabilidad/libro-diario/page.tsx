import { createClient } from "@/lib/supabase/server";
import { listarAsientos, listarCuentasMovimiento } from "./actions";
import { LibroDiarioClient } from "./LibroDiarioClient";

export const dynamic = "force-dynamic";
const ROLES_CONTABLES = ["superadmin", "gerencia", "administracion"];

export default async function LibroDiarioPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  if (!ROLES_CONTABLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Libro diario</h1>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No tienes permisos para ver este módulo. Solicítalo a un administrador.
        </p>
      </div>
    );
  }

  const [asientosR, cuentasR] = await Promise.all([listarAsientos(), listarCuentasMovimiento()]);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Libro diario</h1>
        <p className="mt-1 text-sm text-gray-500">
          Registro cronológico de asientos contables (partida doble: el débito siempre debe cuadrar con el crédito).
          Algunos módulos (ej. Conciliaciones bancarias) generan asientos automáticos aquí.
        </p>
      </div>
      <LibroDiarioClient
        asientosIniciales={asientosR.ok ? asientosR.asientos : []}
        cuentas={cuentasR.ok ? cuentasR.cuentas : []}
      />
    </div>
  );
}
