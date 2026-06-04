import { createClient } from "@/lib/supabase/server";
import { calcComisionB2B } from "@/lib/calc/finanzas";
import { ComisionesList, type ComB2BRow } from "./ComisionesList";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function ComisionesPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Comisiones</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Este módulo es de uso interno (administración / gerencia).
        </p>
      </div>
    );
  }

  const [{ data: b2b }, { data: ventas }] = await Promise.all([
    sb.from("aliados_b2b").select("*").order("id", { ascending: false }),
    sb.from("ventas").select("numero_contrato, cliente, canal, tipo_asesor, agencia_nombre, freelance_nombre"),
  ]);
  const clientePorContrato = new Map<string, string>();
  for (const v of ventas ?? []) clientePorContrato.set(v.numero_contrato, v.cliente ?? "");

  const rowsRegistradas: ComB2BRow[] = (b2b ?? []).map((b) => {
    const c = calcComisionB2B({
      precioVenta: b.precio_venta, pctComision: b.pct_comision,
      recobroTotal: b.recobro_total, pctRecobroAliado: b.pct_recobro_aliado,
      aplicaRetencion: b.aplica_retencion, pctRetencion: b.pct_retencion,
    });
    return {
      id: b.id,
      numero_contrato: b.numero_contrato,
      cliente: clientePorContrato.get(b.numero_contrato) ?? null,
      aliado: b.aliado,
      nit: b.nit,
      pct_comision: b.pct_comision,
      totalComision: c.totalComision,
      retencion: c.retencion,
      totalPagar: c.totalPagar,
      estado: b.estado,
      fecha_pago: b.fecha_pago,
    };
  });

  // Ventas B2B (agencia/freelance) que aún NO tienen comisión registrada → "por definir".
  const conRegistro = new Set((b2b ?? []).map((b) => b.numero_contrato));
  const ventasB2B = (ventas ?? []).filter(
    (v) => v.canal === "B2B" || v.tipo_asesor === "agencia" || v.tipo_asesor === "freelance"
  );
  const rowsPorDefinir: ComB2BRow[] = ventasB2B
    .filter((v) => !conRegistro.has(v.numero_contrato))
    .map((v, i) => ({
      id: -(i + 1), // sintético (no editable)
      numero_contrato: v.numero_contrato,
      cliente: v.cliente ?? null,
      aliado: v.agencia_nombre || v.freelance_nombre || null,
      nit: null,
      pct_comision: null,
      totalComision: 0,
      retencion: 0,
      totalPagar: null,
      estado: "sin_definir",
      fecha_pago: null,
      sinComision: true,
    }));

  const rows: ComB2BRow[] = [...rowsRegistradas, ...rowsPorDefinir];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Comisiones B2B</h1>
        <p className="mt-1 text-sm text-gray-500">
          Comisiones de aliados B2B por contrato y su estado de pago. Marca cada una como pagada o pendiente.
        </p>
      </div>
      <ComisionesList rows={rows} />
    </div>
  );
}
