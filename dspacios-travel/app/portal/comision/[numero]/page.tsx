import { notFound } from "next/navigation";
import Link from "next/link";
import { PrintButton } from "@/components/contrato/PrintButton";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { pesosEnLetras } from "@/lib/utils/numeroALetras";
import { agenciaDe } from "@/lib/tenant.server";
import { esTenant } from "@/lib/tenant";
import { resolverComisionB2B } from "@/lib/finanzas/comisionResolver";

export const dynamic = "force-dynamic";

export default async function CuentaCobroPage({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  const r = await resolverComisionB2B(numero);
  if (!r) notFound();

  // Cuenta de cobro = documento de PERSONA NATURAL (freelance). Las agencias
  // (persona jurídica) deben facturar electrónicamente, no generan este documento.
  if (r.tipoAsesorEfectivo === "agencia" && !r.esInterno) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-sm text-gray-600">
          Esta comisión corresponde a una agencia (persona jurídica). Las agencias deben
          enviar su factura electrónica para cobrar la comisión, no una cuenta de cobro.
        </p>
      </div>
    );
  }

  const { detalle, aliadoInfo, aliado, moneda } = r;
  const montoComision = detalle.totalPagar;
  const hoy = new Date().toISOString().slice(0, 10);
  // Membrete: razón/nombre comercial de la agencia dueña del contrato (mayorista
  // o minorista) — antes estaba fijo en "Mayorista", incorrecto para minorista.
  const tenantVenta = esTenant(r.tenant) ? r.tenant : "mayorista";
  const agencia = await agenciaDe(tenantVenta);
  const nombreAgencia = agencia?.nombre_comercial || agencia?.razon_social || "D'SPACIOS TRAVEL";
  const nitAgencia = agencia?.nit ?? null;
  const direccionAgencia = agencia?.direccion ?? null;

  const concepto = `Comisión por venta — Contrato ${r.numeroContrato} — Cliente ${r.cliente}${r.destino ? ` — Destino ${r.destino}` : ""}`;

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link href="/portal/b2b" className="text-sm text-gray-500 hover:text-gray-800">← Mis contratos</Link>
        <div className="flex items-center gap-3">
          {r.aliadoB2bId != null && (
            <Link href={`/portal/comision/${encodeURIComponent(r.numeroContrato)}/estado-cuenta`} className="text-sm text-gray-500 hover:text-gray-800">
              Estado de cuenta →
            </Link>
          )}
          <PrintButton />
        </div>
      </div>
      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="cuenta-doc rounded-xl bg-white p-6 shadow-sm print:rounded-none print:p-0 print:shadow-none">
          <h1 className="text-center text-xl font-bold" style={{ color: "var(--brand-primary)" }}>CUENTA DE COBRO</h1>
          <p className="mt-0.5 text-center text-xs text-gray-500">Fecha de elaboración: {formatFechaLarga(hoy)}</p>

          {/* ── Encabezado: quien cobra / a quién ─────────────────────── */}
          <div className="mt-3 grid grid-cols-2 gap-4 border-y border-gray-100 py-3 text-xs text-gray-700">
            <div>
              <p className="text-gray-400">DE (quien cobra)</p>
              <p className="text-sm font-semibold text-gray-900">{aliado}</p>
              {aliadoInfo?.nit && <p>{aliadoInfo.tipo_documento ?? "NIT"}: {aliadoInfo.nit}</p>}
              {aliadoInfo?.direccion && <p>{aliadoInfo.direccion}</p>}
              {aliadoInfo?.telefono && <p>Tel: {aliadoInfo.telefono}</p>}
              {aliadoInfo?.email && <p>{aliadoInfo.email}</p>}
            </div>
            <div>
              <p className="text-gray-400">COMPAÑÍA</p>
              <p className="text-sm font-semibold text-gray-900">{nombreAgencia}</p>
              {nitAgencia && <p>NIT: {nitAgencia}</p>}
              {direccionAgencia && <p>{direccionAgencia}</p>}
            </div>
          </div>

          <div className="mt-3 text-center">
            <p className="text-xs text-gray-500">DEBE LA SUMA DE</p>
            <p className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(montoComision, moneda)}</p>
            <p className="text-xs text-gray-500">({pesosEnLetras(montoComision, moneda === "USD" ? "USD" : "COP")})</p>
          </div>

          <div className="mt-3 text-xs text-gray-700">
            <p className="text-gray-400">POR CONCEPTO DE</p>
            <p className="font-medium">{concepto}</p>
          </div>

          {/* ── Desglose: de dónde sale el valor ─────────────────────── */}
          <table className="mt-3 w-full border-collapse text-xs">
            <tbody>
              <tr className="border-b border-gray-100"><td className="py-1 text-gray-500">Fecha de viaje</td><td className="py-1 text-right">{formatFechaLarga(r.fechaSalida)}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-1 text-gray-500">Total PVP</td><td className="py-1 text-right tabular-nums">{formatMoneda(detalle.pvp, moneda)}</td></tr>
              {detalle.baseComisionable != null && (
                <tr className="border-b border-gray-100"><td className="py-1 text-gray-500">Base comisionable</td><td className="py-1 text-right tabular-nums">{formatMoneda(detalle.baseComisionable, moneda)}</td></tr>
              )}
              <tr className="border-b border-gray-100">
                <td className="py-1 text-gray-500">{detalle.esPctEfectivo ? "% comisión (efectivo)" : "% comisión"}</td>
                <td className="py-1 text-right tabular-nums">{(detalle.pctComision * 100).toFixed(2)}%</td>
              </tr>
              {detalle.comisionBase != null && (
                <tr className="border-b border-gray-100"><td className="py-1 text-gray-500">Comisión</td><td className="py-1 text-right tabular-nums">{formatMoneda(detalle.comisionBase, moneda)}</td></tr>
              )}
              {detalle.recobroAliado != null && detalle.recobroAliado > 0 && (
                <tr className="border-b border-gray-100"><td className="py-1 text-gray-500">Recobro</td><td className="py-1 text-right tabular-nums">{formatMoneda(detalle.recobroAliado, moneda)}</td></tr>
              )}
              {detalle.aplicaRetencion && detalle.retencion != null && detalle.retencion > 0 && (
                <tr className="border-b border-gray-100">
                  <td className="py-1 text-gray-500">Retención en la fuente ({((detalle.pctRetencion ?? 0) * 100).toFixed(1)}%)</td>
                  <td className="py-1 text-right tabular-nums text-red-600">− {formatMoneda(detalle.retencion, moneda)}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="mt-2 flex items-center justify-between rounded-lg bg-[rgba(29,124,154,0.06)] px-3 py-2">
            <span className="text-xs font-semibold text-gray-700">Total a cobrar</span>
            <span className="text-base font-bold" style={{ color: "var(--brand-primary)" }}>{formatMoneda(montoComision, moneda)}</span>
          </div>

          {/* ── Declaración de retención (Art. 383 E.T.) ─────────────── */}
          {detalle.aplicaRetencion === false && (
            <div className="mt-3 text-[10px] leading-snug text-gray-500">
              <p>
                Para efectos de lo establecido en el parágrafo 2 del Artículo 383 del E.T., modificado por el
                Artículo 17 de la Ley 1819 de 2016, manifiesto que:
              </p>
              <ol className="ml-4 list-decimal">
                <li>No he contratado o vinculado dos (2) personas o más trabajadores asociados a la actividad que desarrollo.</li>
                <li>En el año gravable anterior mis ingresos o ventas no superaron las 3.300 UVT.</li>
                <li>No soy declarante de renta.</li>
              </ol>
              <p className="mt-1 text-center font-semibold text-gray-600">NO HACER RETENCIÓN EN LA FUENTE</p>
            </div>
          )}

          {/* ── Datos de pago del aliado ──────────────────────────────── */}
          {aliadoInfo?.numero_cuenta && (
            <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[10px] leading-snug text-gray-600">
              <p className="font-semibold text-gray-700">Forma de pago: Transferencia bancaria</p>
              <p>
                {aliadoInfo.banco ?? "—"} — {aliadoInfo.tipo_cuenta ?? "—"} · A nombre de {aliadoInfo.nombre} · N.° {aliadoInfo.numero_cuenta}
              </p>
            </div>
          )}

          <div className="mt-6 text-xs text-gray-600">
            <div className="border-t border-gray-300 pt-1" style={{ width: 220 }}>Firma</div>
            <p className="mt-0.5">{aliado}</p>
            {aliadoInfo?.nit && <p className="text-[10px] text-gray-400">{aliadoInfo.tipo_documento ?? "NIT"} {aliadoInfo.nit}</p>}
          </div>

          <footer className="mt-4 border-t border-gray-200 pt-2 text-center text-[9px] text-gray-400">
            Documento generado por el Portal B2B de D&apos;spacios Travel.
          </footer>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        .cuenta-doc, .cuenta-doc * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        @page { size: letter; margin: 12mm; }
        @media print { html, body { background: #fff !important; } }
      ` }} />
    </div>
  );
}
