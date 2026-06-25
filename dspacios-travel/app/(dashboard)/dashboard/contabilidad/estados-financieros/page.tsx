import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function EstadosFinancierosPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user ? await sb.from("usuarios").select("rol").eq("id", user.id).single() : { data: null };
  const permitido = ROLES.includes(perfil?.rol ?? "");

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Estados financieros</h1>
      {!permitido ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Uso contable (administración / gerencia).</p>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm text-gray-600">
            Aquí armaremos el <b>Estado de Resultados</b> (P&amp;G) y el <b>flujo</b> por periodo, uniendo
            ingresos de ventas (Rentabilidad), costos directos, nómina y costos fijos (Punto de equilibrio) y los
            movimientos de pagos fuera de contrato.
          </p>
          <p className="mt-3 text-xs text-gray-400">
            En construcción. Para que las cifras cuadren necesito definir contigo el <b>periodo</b> (mes/año) y
            cómo imputar los costos fijos recurrentes frente a las ventas acumuladas.
          </p>
        </div>
      )}
    </div>
  );
}
