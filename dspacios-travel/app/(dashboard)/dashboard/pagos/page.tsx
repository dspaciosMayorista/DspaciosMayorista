import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import { sumarRetencionesPorCuenta } from "@/lib/finanzas/retenciones";
import { PagosList, type PagoRow } from "./PagosList";

export const dynamic = "force-dynamic";

const ROLES_CONTABLES = ["superadmin", "gerencia", "administracion", "operaciones"];

export default async function PagosPage() {
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
        <h1 className="text-2xl font-semibold text-gray-900">Pagos a proveedores</h1>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No tienes permisos para ver los pagos a proveedores. Solicítalo a un administrador.
        </p>
      </div>
    );
  }

  const tenant = await getTenant();
  const { data: cxp } = await sb
    .from("cuentas_por_pagar")
    .select(
      "id, numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, moneda, fecha_obligacion, fecha_vencimiento, aplica_retencion, pct_retencion, clasificacion, base_gravable, iva_proveedor"
    )
    .eq("tenant", tenant)
    .order("fecha_vencimiento", { ascending: true, nullsFirst: false });

  const cxpIds = (cxp ?? []).map((c) => c.id);
  const [{ data: retenciones }, { data: pagosCxp }] = cxpIds.length
    ? await Promise.all([
        sb.from("retenciones_cxp").select("cuenta_por_pagar_id, valor").in("cuenta_por_pagar_id", cxpIds),
        sb.from("cxp_pagos").select("id, cuenta_por_pagar_id, fecha, valor, trm").in("cuenta_por_pagar_id", cxpIds).order("fecha").order("id"),
      ])
    : [{ data: [] }, { data: [] }];
  const retenidoPorCuenta = sumarRetencionesPorCuenta(
    (retenciones ?? []).map((r) => ({ cuenta_por_pagar_id: r.cuenta_por_pagar_id as number, valor: Number(r.valor) || 0 }))
  );
  const pagosPorCuenta = new Map<number, { id: number; valor: number; fecha: string | null; trm: number | null }[]>();
  for (const p of pagosCxp ?? []) {
    const arr = pagosPorCuenta.get(p.cuenta_por_pagar_id) ?? [];
    arr.push({ id: p.id, valor: Number(p.valor) || 0, fecha: p.fecha, trm: p.trm });
    pagosPorCuenta.set(p.cuenta_por_pagar_id, arr);
  }

  const rows: PagoRow[] = (cxp ?? []).map((c) => {
    const pagos = pagosPorCuenta.get(c.id) ?? [];
    const pagado = pagos.reduce((s, p) => s + p.valor, 0);
    const retenido = retenidoPorCuenta[c.id] ?? 0;
    const valorTotal = c.valor_total ?? 0;
    return {
      id: c.id,
      numero_contrato: c.numero_contrato,
      proveedor: c.proveedor,
      tipo_proveedor: c.tipo_proveedor,
      servicio: c.servicio,
      valor_total: valorTotal,
      moneda: c.moneda ?? "COP",
      fecha_obligacion: c.fecha_obligacion as string | null,
      fecha_vencimiento: c.fecha_vencimiento as string | null,
      aplica_retencion: c.aplica_retencion,
      pct_retencion: c.pct_retencion,
      clasificacion: ((c.clasificacion as string) ?? "costo") as "costo" | "irt",
      base_gravable: c.base_gravable as number | null,
      iva_proveedor: c.iva_proveedor as number | null,
      pagos,
      pagado,
      retenido,
      saldo: Math.max(valorTotal - pagado - retenido, 0),
    };
  });

  const proveedores = Array.from(
    new Set(rows.map((r) => r.proveedor).filter((p): p is string => !!p))
  ).sort((a, b) => a.localeCompare(b));

  // Catálogo completo (para asignar proveedor a las CxP que nacen sin él).
  const { data: cat } = await sb.from("proveedores").select("nombre").order("nombre");
  const catalogo = (cat ?? []).map((p) => p.nombre as string).filter(Boolean);
  const { data: ivaParam } = await sb.from("parametros_tributarios").select("valor").eq("parametro", "IVA").maybeSingle();
  const ivaPct = Number(ivaParam?.valor) || 0.19;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Proveedores — por pagar</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cuentas por pagar con su saldo. Registra pagos, configura la factura del proveedor
          (IRT / Costo + base gravable) y consulta el estado de cuenta de cada proveedor.
        </p>
      </div>
      <PagosList rows={rows} proveedores={proveedores} catalogo={catalogo} ivaPct={ivaPct} />
    </div>
  );
}
