import { createClient } from "@/lib/supabase/server";
import { FlujoCajaClient, type ContratoFlujo } from "./FlujoCajaClient";

export const dynamic = "force-dynamic";

const ROLES_CONTABLES = ["superadmin", "gerencia", "administracion", "operaciones"];

export default async function FlujoCajaPage() {
  const sb = await createClient();

  const {
    data: { user },
  } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  if (!ROLES_CONTABLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Flujo de caja</h1>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No tienes permisos para ver el flujo de caja. Solicítalo a un administrador.
        </p>
      </div>
    );
  }

  // Ventas: cada contrato pertenece a un mes (por viaje = fecha_salida, por venta = fecha_venta).
  const { data: ventas } = await sb
    .from("ventas")
    .select(
      "numero_contrato, fecha_salida, fecha_venta, moneda, precio_venta, costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos, estado"
    );

  // Entradas reales: abonos de cartera (lo cobrado por contrato).
  const { data: abonos } = await sb
    .from("abonos")
    .select("numero_contrato, valor_abono");

  // Salidas reales: pagos a proveedores (abonos de cuentas por pagar).
  const { data: cxp } = await sb
    .from("cuentas_por_pagar")
    .select("numero_contrato, abono1, abono2, abono3");

  const cobradoPorContrato = new Map<string, number>();
  for (const a of abonos ?? []) {
    const k = a.numero_contrato as string;
    if (!k) continue;
    cobradoPorContrato.set(k, (cobradoPorContrato.get(k) ?? 0) + (Number(a.valor_abono) || 0));
  }
  const pagadoPorContrato = new Map<string, number>();
  for (const c of cxp ?? []) {
    const k = c.numero_contrato as string;
    if (!k) continue;
    const pag = (Number(c.abono1) || 0) + (Number(c.abono2) || 0) + (Number(c.abono3) || 0);
    pagadoPorContrato.set(k, (pagadoPorContrato.get(k) ?? 0) + pag);
  }

  const contratos: ContratoFlujo[] = (ventas ?? []).map((v) => {
    const nc = v.numero_contrato as string;
    const costoTotal =
      (Number(v.costo_hotel) || 0) +
      (Number(v.costo_aereo) || 0) +
      (Number(v.costo_receptivo) || 0) +
      (Number(v.costo_asistencia) || 0) +
      (Number(v.otros_costos) || 0);
    return {
      numero_contrato: nc,
      fecha_salida: (v.fecha_salida as string | null) ?? null,
      fecha_venta: (v.fecha_venta as string | null) ?? null,
      moneda: (v.moneda as string) ?? "COP",
      estado: (v.estado as string) ?? "",
      precio_venta: Number(v.precio_venta) || 0,
      costo_total: costoTotal,
      cobrado: cobradoPorContrato.get(nc) ?? 0,
      pagado: pagadoPorContrato.get(nc) ?? 0,
    };
  });

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Flujo de caja</h1>
        <p className="mt-1 text-sm text-gray-500">
          Flujo presente y futuro: cada contrato se imputa a su mes (por viaje o por venta) con sus
          ingresos y egresos, aunque el movimiento de caja ocurra antes. Ve el hoy, el próximo mes y
          lo proyectado.
        </p>
      </div>
      <FlujoCajaClient contratos={contratos} />
    </div>
  );
}
