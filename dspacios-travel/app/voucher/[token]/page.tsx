import { notFound } from "next/navigation";
import { accesoVoucherPorToken } from "@/lib/voucher/accesoVoucher.server";
import { PrintButton } from "@/components/contrato/PrintButton";
import { VoucherDocumento } from "@/components/voucher/VoucherDocumento";
import type { VoucherContenido } from "@/app/(dashboard)/dashboard/contratos/[numero]/voucher-actions";
import { tituloDocumento } from "@/lib/utils/tituloDocumento";

export const dynamic = "force-dynamic";

const ETIQUETA_TIPO_VOUCHER: Record<string, string> = {
  hotel: "Voucher Hotel",
  traslado: "Voucher Traslados",
  asistencia: "Voucher Asistencia",
};

// #53 (307): el token identifica el documento, NO autoriza. Metadata y página llaman la MISMA resolución (cacheada por petición): sin sesión válida, sin permiso o, para un aliado,
// sin el contrato 100 % pagado, el título no revela nada y la página responde 404. El personal interno ve la vista previa en cualquier momento (lo decide la RLS de `vouchers`).
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await accesoVoucherPorToken(token);
  if (!r.ok) return { title: { absolute: "Voucher" } };
  const c = r.voucher.contenido as unknown as VoucherContenido | undefined;
  const etiqueta = ETIQUETA_TIPO_VOUCHER[r.voucher.tipo ?? ""] ?? "Voucher Servicios";
  return { title: { absolute: tituloDocumento(etiqueta, r.voucher.numero_contrato, c?.titular) } };
}

// Vista del voucher por token (requiere sesión; ver acceso arriba) para imprimir/guardar.
export default async function VoucherPublicoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await accesoVoucherPorToken(token);
  if (!r.ok) notFound();
  const c = r.voucher.contenido as unknown as VoucherContenido;
  const tenant = r.tenant === "minorista" ? "minorista" : "mayorista";

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="overflow-hidden rounded-xl bg-white shadow-sm print:rounded-none print:shadow-none">
          <VoucherDocumento c={c} tenant={tenant} />
        </div>
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .voucher-doc, .voucher-doc * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            @page { size: A4; margin: 10mm; }
            @media print { html, body { background: #fff !important; } }
          `,
        }}
      />
    </div>
  );
}
