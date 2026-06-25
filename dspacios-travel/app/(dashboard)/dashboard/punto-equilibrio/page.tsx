import { createClient } from "@/lib/supabase/server";
import { calcRentabilidad, fiscalFromParams } from "@/lib/calc/finanzas";
import { liquidarFacturacion } from "@/lib/contabilidad/facturacion";
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

  const [{ data: ventas }, { data: paramsRows }, { data: facturacionCfg }, { data: empleados }, { data: costos }] = await Promise.all([
    sb.from("ventas").select("numero_contrato, precio_venta, costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos, moneda, trm_contrato"),
    sb.from("parametros_tributarios").select("parametro, valor"),
    sb.from("contrato_facturacion").select("numero_contrato, irt, ingreso_exento"),
    sb.from("pe_empleados").select("*").eq("activo", true).order("created_at"),
    sb.from("pe_costos").select("*").eq("activo", true).order("created_at"),
  ]);

  const fiscal = fiscalFromParams(paramsRows ?? []);
  const trmReferencia = Number((paramsRows ?? []).find((p) => p.parametro === "trm_referencia")?.valor) || 0;
  const factCfg = new Map((facturacionCfg ?? []).map((c) => [c.numero_contrato, { irt: Number(c.irt) || 0, exento: Number(c.ingreso_exento) || 0 }]));

  // Margen NETO corriendo (de Rentabilidad): Σ utilidad neta / Σ ingreso.
  let totIngreso = 0, totUtilNeta = 0, totPVP = 0, totCosto = 0;
  for (const v of ventas ?? []) {
    const f = (v.moneda ?? "COP") === "USD" ? (Number(v.trm_contrato) || trmReferencia || 0) : 1;
    const pvp = (Number(v.precio_venta) || 0) * f;
    const costo = ((Number(v.costo_hotel) || 0) + (Number(v.costo_aereo) || 0) + (Number(v.costo_receptivo) || 0) + (Number(v.costo_asistencia) || 0) + (Number(v.otros_costos) || 0)) * f;
    const cfg = factCfg.get(v.numero_contrato);
    const liq = cfg ? liquidarFacturacion({ pvp: Number(v.precio_venta) || 0, irt: cfg.irt, ingresoExento: cfg.exento }, fiscal.IVA) : null;
    const rent = calcRentabilidad({
      precioVenta: pvp, costoDirecto: costo,
      baseProvisiones: liq ? liq.ingresoPropio * f : undefined,
      ivaGenerado: liq ? liq.ivaGenerado * f : 0,
      fiscal,
    });
    totIngreso += rent.ingreso;
    totUtilNeta += rent.utilNeta;
    totPVP += pvp; totCosto += costo;
  }
  const margenNeto = totIngreso > 0 ? (totUtilNeta / totIngreso) * 100 : 0;
  const margenBruto = totPVP > 0 ? ((totPVP - totCosto) / totPVP) * 100 : 0;

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
      <PuntoEquilibrioClient empleados={emps} costos={cs} margenNeto={margenNeto} margenBruto={margenBruto} />
    </div>
  );
}
