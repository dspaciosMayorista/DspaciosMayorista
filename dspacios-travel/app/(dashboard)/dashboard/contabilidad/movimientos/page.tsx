import { createClient } from "@/lib/supabase/server";
import { MovimientosClient, type MovRow } from "./MovimientosClient";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function MovimientosPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Movimientos de pagos</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">Uso contable (administración / gerencia).</p>
      </div>
    );
  }

  const { data: movs } = await sb
    .from("contabilidad_movimientos")
    .select("*")
    .order("fecha", { ascending: false })
    .order("id", { ascending: false });

  const rows: MovRow[] = (movs ?? []).map((m) => ({
    id: m.id, fecha: m.fecha, tipo: (m.tipo as "ingreso" | "egreso"),
    concepto: m.concepto, tercero: m.tercero ?? "", categoria: m.categoria ?? "",
    medioPago: m.medio_pago ?? "", valor: Number(m.valor) || 0,
    comprobante: m.comprobante ?? "", observacion: m.observacion ?? "",
  }));

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Movimientos de pagos</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">
        Compras, pagos e ingresos que <b>no</b> están ligados a un contrato (arriendo, servicios, compras de
        oficina, reintegros…). Alimentan los estados financieros y la conciliación bancaria.
      </p>
      <MovimientosClient rows={rows} />
    </div>
  );
}
