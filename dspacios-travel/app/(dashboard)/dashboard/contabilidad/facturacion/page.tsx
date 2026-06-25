import { createClient } from "@/lib/supabase/server";
import { FacturacionClient, type FactRow } from "./FacturacionClient";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "gerencia", "administracion"];

export default async function FacturacionPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  if (!ROLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Facturación</h1>
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Este módulo es de uso contable (administración / gerencia).
        </p>
      </div>
    );
  }

  const [{ data: ventas }, { data: cfgs }, { data: cxp }, { data: params }] = await Promise.all([
    sb.from("ventas")
      .select("numero_contrato, cliente, destino, fecha_venta, precio_venta, moneda, estado")
      .order("fecha_venta", { ascending: false }),
    sb.from("contrato_facturacion").select("numero_contrato, irt, ingreso_exento, tipo_exento, observacion, dian_emitida"),
    sb.from("cuentas_por_pagar").select("numero_contrato, valor_total, clasificacion"),
    sb.from("parametros_tributarios").select("valor").eq("parametro", "IVA").maybeSingle(),
  ]);

  const ivaPct = Number(params?.valor) || 0.19;
  const cfgMap = new Map((cfgs ?? []).map((c) => [c.numero_contrato, c]));
  // IRT según proveedores: suma de las CxP marcadas IRT por contrato.
  const irtProvMap = new Map<string, number>();
  for (const c of cxp ?? []) {
    if (((c.clasificacion as string) ?? "costo") !== "irt") continue;
    irtProvMap.set(c.numero_contrato, (irtProvMap.get(c.numero_contrato) ?? 0) + (Number(c.valor_total) || 0));
  }

  const rows: FactRow[] = (ventas ?? []).map((v) => {
    const c = cfgMap.get(v.numero_contrato);
    return {
      numero_contrato: v.numero_contrato,
      cliente: v.cliente ?? null,
      destino: v.destino ?? null,
      mes: v.fecha_venta ? String(v.fecha_venta).slice(0, 7) : "",
      precio_venta: Number(v.precio_venta) || 0,
      moneda: (v.moneda as string) ?? "COP",
      estado: (v.estado as string) ?? "",
      irtProveedores: irtProvMap.get(v.numero_contrato) ?? 0,
      dianEmitida: !!c?.dian_emitida,
      cfg: c
        ? {
            irt: Number(c.irt) || 0,
            ingresoExento: Number(c.ingreso_exento) || 0,
            tipoExento: (c.tipo_exento as "exento" | "excluido" | null) ?? null,
            observacion: c.observacion ?? "",
          }
        : null,
    };
  });

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Facturación</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configura, por contrato, cuánto se factura como <b>IRT</b> (ingreso para terceros:
          hoteles/aerolíneas) y cuánto como <b>Ingreso propio</b> (intermediación). El ingreso propio
          puede llevar IVA incluido. Las provisiones de rentabilidad se calculan sobre el ingreso propio.
        </p>
      </div>
      <FacturacionClient rows={rows} ivaPct={ivaPct} />
    </div>
  );
}
