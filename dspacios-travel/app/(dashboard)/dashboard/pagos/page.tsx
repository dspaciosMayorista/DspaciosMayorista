import { createClient } from "@/lib/supabase/server";
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

  const { data: cxp } = await sb
    .from("cuentas_por_pagar")
    .select(
      "id, numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, moneda, fecha_obligacion, fecha_vencimiento, aplica_retencion, pct_retencion, abono1, fecha_abono1, abono2, fecha_abono2, abono3, fecha_abono3"
    )
    .order("fecha_vencimiento", { ascending: true, nullsFirst: false });

  const rows: PagoRow[] = (cxp ?? []).map((c) => {
    const pagos = [
      { n: 1, valor: c.abono1 ?? 0, fecha: c.fecha_abono1 as string | null },
      { n: 2, valor: c.abono2 ?? 0, fecha: c.fecha_abono2 as string | null },
      { n: 3, valor: c.abono3 ?? 0, fecha: c.fecha_abono3 as string | null },
    ].filter((p) => p.valor > 0);
    const pagado = pagos.reduce((s, p) => s + p.valor, 0);
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
      pagos,
      pagado,
      saldo: Math.max(valorTotal - pagado, 0),
    };
  });

  const proveedores = Array.from(
    new Set(rows.map((r) => r.proveedor).filter((p): p is string => !!p))
  ).sort((a, b) => a.localeCompare(b));

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Pagos a proveedores — por pagar</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cuentas por pagar con su saldo. Registra pagos y consulta el estado de cuenta de cada
          proveedor sin entrar a cada contrato.
        </p>
      </div>
      <PagosList rows={rows} proveedores={proveedores} />
    </div>
  );
}
