import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { liquidarEmpleadoContrato, type ClaseRiesgo } from "@/lib/calc/nomina";
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

  const tenant = await getTenant();
  // Ventas: cada contrato pertenece a un mes (por viaje = fecha_salida, por venta = fecha_venta).
  const { data: ventas } = await sb
    .from("ventas")
    .select(
      "numero_contrato, fecha_salida, fecha_venta, moneda, trm_contrato, precio_venta, costo_hotel, costo_aereo, costo_receptivo, costo_asistencia, otros_costos, estado"
    ).eq("tenant", tenant);

  // Entradas reales: abonos de cartera. Ya entran en PESOS (monto_cop).
  const { data: abonos } = await sb
    .from("abonos")
    .select("numero_contrato, valor_abono, monto_cop").eq("tenant", tenant);

  // Salidas reales: pagos a proveedores (log ilimitado en cxp_pagos). En USD se
  // pagan en pesos a la TRM del día (valor × trm); en COP, trm = 1.
  const { data: cxp } = await sb
    .from("cuentas_por_pagar")
    .select("id, numero_contrato").eq("tenant", tenant);
  const numeroPorCuenta = new Map((cxp ?? []).map((c) => [c.id, c.numero_contrato as string]));
  const cxpIds = (cxp ?? []).map((c) => c.id);
  const { data: pagosCxp } = cxpIds.length
    ? await sb.from("cxp_pagos").select("cuenta_por_pagar_id, valor, trm").in("cuenta_por_pagar_id", cxpIds)
    : { data: [] };

  // TRM de referencia (fallback para esperado de contratos USD sin abonos).
  const { data: paramsRows } = await sb.from("parametros_tributarios").select("parametro, valor");
  const trmReferencia = Number((paramsRows ?? []).find((p) => p.parametro === "trm_referencia")?.valor) || 0;

  // Costos fijos mensuales desde Punto de equilibrio (nómina + costos fijos).
  const [{ data: empleados }, { data: peCostos }, { data: movs }] = await Promise.all([
    sb.from("pe_empleados").select("salario, tipo, auxilio, riesgo").eq("activo", true).eq("tenant", tenant),
    sb.from("pe_costos").select("valor, clasificacion").eq("activo", true).eq("tenant", tenant),
    sb.from("contabilidad_movimientos").select("fecha, tipo, valor").eq("tenant", tenant),
  ]);
  const nominaMes = (empleados ?? []).reduce((a, e) => {
    if ((e.tipo as string) === "servicios") return a + (Number(e.salario) || 0);
    const l = liquidarEmpleadoContrato(Number(e.salario) || 0, !!e.auxilio, (e.riesgo as ClaseRiesgo) || "I", true);
    return a + l.costoTotalMensual;
  }, 0);
  const fijosPe = (peCostos ?? []).filter((c) => (c.clasificacion as string) === "fijo").reduce((a, c) => a + (Number(c.valor) || 0), 0);
  const fijosDefault = nominaMes + fijosPe;

  // Movimientos de pagos (fuera de contrato) imputados por mes.
  const movMap = new Map<string, { ingresos: number; egresos: number }>();
  for (const m of movs ?? []) {
    const mes = m.fecha ? String(m.fecha).slice(0, 7) : "";
    if (!mes) continue;
    const cur = movMap.get(mes) ?? { ingresos: 0, egresos: 0 };
    if ((m.tipo as string) === "ingreso") cur.ingresos += Number(m.valor) || 0;
    else cur.egresos += Number(m.valor) || 0;
    movMap.set(mes, cur);
  }
  const movimientos = [...movMap.entries()].map(([mes, v]) => ({ mes, ...v }));

  // Cobrado real en pesos (suma de monto_cop; en abonos viejos COP = valor_abono).
  const cobradoPorContrato = new Map<string, number>();
  for (const a of abonos ?? []) {
    const k = a.numero_contrato as string;
    if (!k) continue;
    const cop = Number(a.monto_cop) || Number(a.valor_abono) || 0;
    cobradoPorContrato.set(k, (cobradoPorContrato.get(k) ?? 0) + cop);
  }
  // Pagado real en pesos (valor × trm; trm 1 si null = COP).
  const pagadoPorContrato = new Map<string, number>();
  for (const p of pagosCxp ?? []) {
    const k = numeroPorCuenta.get(p.cuenta_por_pagar_id);
    if (!k) continue;
    const pag = (Number(p.valor) || 0) * (Number(p.trm) || 1);
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
    // Factor a COP para el ESPERADO (PVP/costos en USD): TRM promedio del contrato
    // o, si aún no tiene abonos, la TRM de referencia.
    const esUSD = ((v.moneda as string) ?? "COP") === "USD";
    const factor = esUSD ? (Number(v.trm_contrato) || trmReferencia || 0) : 1;
    return {
      numero_contrato: nc,
      fecha_salida: (v.fecha_salida as string | null) ?? null,
      fecha_venta: (v.fecha_venta as string | null) ?? null,
      estado: (v.estado as string) ?? "",
      // Todo ya en PESOS: el módulo no necesita una TRM manual.
      precio_venta: (Number(v.precio_venta) || 0) * factor,
      costo_total: costoTotal * factor,
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
      <FlujoCajaClient contratos={contratos} fijosDefault={fijosDefault} movimientos={movimientos} />
    </div>
  );
}
