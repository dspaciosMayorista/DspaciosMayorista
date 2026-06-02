import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatCOP, formatFechaLarga } from "@/lib/utils";
import { ShareButtons } from "./ShareButtons";
import { GestionTabs } from "./GestionTabs";
import { EstadoVenta } from "./EstadoVenta";
import { fiscalFromParams } from "@/lib/calc/finanzas";

export const dynamic = "force-dynamic";

export default async function ContratoDetallePage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero: raw } = await params;
  const numero = decodeURIComponent(raw);
  const sb = await createClient();

  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  const verFinanzas = ["superadmin", "gerencia", "administracion", "operaciones"].includes(perfil?.rol ?? "");

  const [
    { data: venta },
    { data: abonos },
    { data: cxp },
    { data: b2b },
    { data: facturas },
    { data: asesores },
  ] = await Promise.all([
    sb.from("ventas").select("*").eq("numero_contrato", numero).single(),
    sb.from("abonos").select("id, valor_abono, forma_pago, referencia, fecha_abono").eq("numero_contrato", numero).order("fecha_abono", { ascending: false }),
    sb.from("cuentas_por_pagar").select("*").eq("numero_contrato", numero).order("id"),
    sb.from("aliados_b2b").select("*").eq("numero_contrato", numero).order("id"),
    sb.from("facturacion").select("*").eq("numero_contrato", numero).order("id"),
    sb.from("asesores").select("nombre, email, pct_comision_base"),
  ]);

  const { data: paramsRows } = await sb.from("parametros_tributarios").select("parametro, valor");
  const fiscal = fiscalFromParams(paramsRows ?? []);

  if (!venta) notFound();

  const totalPagado = (abonos ?? []).reduce((s, a) => s + (a.valor_abono ?? 0), 0);
  const saldo = Math.max(venta.precio_venta - totalPagado, 0);

  // Buscar el % de comisión del asesor (por email o por nombre de firma)
  const asesorNombre = venta.asesor_firma_nombre ?? venta.asesor ?? "";
  const asesorRow = (asesores ?? []).find(
    (a) => a.email === venta.asesor || a.nombre === asesorNombre
  );
  const asesorPct = asesorRow?.pct_comision_base ?? 0.08;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/contratos" className="text-sm text-gray-400 hover:text-gray-600">
        ← Contratos
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold text-gray-900">{venta.numero_contrato}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {venta.cliente} · {venta.destino ?? "—"} · Viaje {formatFechaLarga(venta.fecha_salida)}
          </p>
          <div className="mt-2">
            <EstadoVenta numero={venta.numero_contrato} estado={venta.estado} plazo={venta.plazo} puedeConfirmar={verFinanzas} />
          </div>
        </div>
        <Link href={`/contrato/${encodeURIComponent(numero)}`} target="_blank">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>Ver / Imprimir contrato →</Button>
        </Link>
      </div>

      {/* Totales */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl p-4 text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
          <div className="text-xs opacity-80">Precio de venta</div>
          <div className="text-xl font-bold">{formatCOP(venta.precio_venta)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-400">Total pagado</div>
          <div className="text-xl font-bold" style={{ color: "var(--brand-success)" }}>{formatCOP(totalPagado)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-400">Saldo pendiente</div>
          <div className="text-xl font-bold text-gray-800">{formatCOP(saldo)}</div>
        </div>
      </div>

      {/* Compartir */}
      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-gray-700">Compartir con el cliente</p>
        <ShareButtons token={venta.share_token} numero={venta.numero_contrato} cliente={venta.cliente} />
      </div>

      {/* Flujo de la venta */}
      <GestionTabs
        numero={numero}
        precioVenta={venta.precio_venta}
        asesorNombre={asesorNombre}
        asesorPct={asesorPct}
        fiscal={fiscal}
        verFinanzas={verFinanzas}
        costos={{
          costo_hotel: venta.costo_hotel,
          costo_aereo: venta.costo_aereo,
          costo_receptivo: venta.costo_receptivo,
          costo_asistencia: venta.costo_asistencia,
          otros_costos: venta.otros_costos,
        }}
        abonos={abonos ?? []}
        totalPagado={totalPagado}
        cuentasPorPagar={cxp ?? []}
        comisionesB2B={b2b ?? []}
        facturas={facturas ?? []}
      />
    </div>
  );
}
