import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/contrato/PrintButton";
import { VoucherDocumento } from "@/components/voucher/VoucherDocumento";
import type { VoucherContenido } from "@/app/(dashboard)/dashboard/contratos/[numero]/voucher-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sb = createAdminClient();
  const { data } = await sb.from("vouchers").select("proveedor").eq("share_token", token).maybeSingle();
  return { title: data ? `Voucher ${data.proveedor ?? ""} — D'spacios Travel` : "Voucher — D'spacios Travel" };
}

// Vista pública del voucher por token (sin login) para imprimir/guardar.
export default async function VoucherPublicoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sb = createAdminClient();
  const { data: v } = await sb.from("vouchers").select("contenido").eq("share_token", token).maybeSingle();
  if (!v || !v.contenido) notFound();
  const c = v.contenido as unknown as VoucherContenido;

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="overflow-hidden rounded-xl bg-white shadow-sm print:rounded-none print:shadow-none">
          <VoucherDocumento c={c} />
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
