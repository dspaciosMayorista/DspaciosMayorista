import { createClient } from "@/lib/supabase/server";
import { calcularRentabilidad } from "@/lib/finanzas/rentabilidad";
import { RentabilidadList, type RentRow } from "./RentabilidadList";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function RentabilidadPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Rentabilidad</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Este módulo es de uso interno (administración / gerencia).
        </p>
      </div>
    );
  }

  const { filas } = await calcularRentabilidad();
  const rows = filas as RentRow[];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Rentabilidad</h1>
        <p className="mt-1 text-sm text-gray-500">
          Utilidad neta por contrato con las provisiones colombianas (ICA, Bomberil, Fontur, Renta),
          comisiones e IVA. Filtra por asesor, destino, mes o clasificación; abre cada fila para ver el desglose.
        </p>
      </div>
      <RentabilidadList rows={rows} />
    </div>
  );
}
