import { createClient } from "@/lib/supabase/server";
import { calcularRentabilidad } from "@/lib/finanzas/rentabilidad";
import { PuntoEquilibrioClient, type EmpRow, type CostoRow } from "./PuntoEquilibrioClient";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function PuntoEquilibrioPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Punto de equilibrio</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Este módulo es de uso interno (administración / gerencia).
        </p>
      </div>
    );
  }

  const [{ data: empleados }, { data: costos }, rent] = await Promise.all([
    sb.from("pe_empleados").select("*").eq("activo", true).order("created_at"),
    sb.from("pe_costos").select("*").eq("activo", true).order("created_at"),
    // Mismo cálculo (helper) que el módulo Rentabilidad → margen idéntico.
    calcularRentabilidad(),
  ]);
  const margenNeto = rent.margenNeto;
  const margenBruto = rent.margenBruto;

  // Ventas del mes en curso (ingreso de los contratos vendidos este mes).
  const ahora = new Date();
  const mesActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}`;
  let ventasMes = 0, contratosMes = 0;
  for (const f of rent.filas) {
    if (f.mes === mesActual) { ventasMes += f.ingreso; contratosMes += 1; }
  }

  const emps: EmpRow[] = (empleados ?? []).map((e) => ({
    id: e.id, nombre: e.nombre, tipo: (e.tipo as "empleado" | "servicios"),
    salario: Number(e.salario) || 0, auxilio: !!e.auxilio, riesgo: e.riesgo || "I",
    declarante: !!e.declarante, contratoPath: e.contrato_path ?? null, contratoNombre: e.contrato_nombre ?? null,
  }));
  const cs: CostoRow[] = (costos ?? []).map((c) => ({
    id: c.id, concepto: c.concepto, categoria: c.categoria ?? "",
    clasificacion: (c.clasificacion as "fijo" | "variable"), valor: Number(c.valor) || 0,
  }));

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Punto de equilibrio</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">
        Cuánto debes vender al mes para cubrir costos y gastos, con el margen neto que viene corriendo de Rentabilidad.
      </p>
      <PuntoEquilibrioClient empleados={emps} costos={cs} margenNeto={margenNeto} margenBruto={margenBruto} ventasMes={ventasMes} contratosMes={contratosMes} />
    </div>
  );
}
