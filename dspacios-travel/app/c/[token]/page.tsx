import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { ContratoDocumento } from "@/components/contrato/ContratoDocumento";
import { PrintButton } from "@/components/contrato/PrintButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = createAdminClient();
  const { data } = await sb
    .from("ventas")
    .select("numero_contrato")
    .eq("share_token", token)
    .single();
  return {
    title: data
      ? `Contrato ${data.numero_contrato} — D'spacios Travel`
      : "Contrato — D'spacios Travel",
  };
}

export default async function ContratoPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = createAdminClient();

  const { data: venta } = await sb
    .from("ventas")
    .select("*")
    .eq("share_token", token)
    .single();

  if (!venta) notFound();

  const numero = venta.numero_contrato;
  const [
    { data: pasajeros },
    { data: hoteles },
    { data: vuelos },
    { data: items },
    { data: abonos },
  ] = await Promise.all([
    sb.from("contrato_pasajeros").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_hoteles").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_vuelos").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_items").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("abonos").select("valor_abono").eq("numero_contrato", numero),
  ]);

  const totalPagado = (abonos ?? []).reduce(
    (s, a) => s + (a.valor_abono ?? 0),
    0
  );

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-end px-4 print:hidden">
        <PrintButton />
      </div>

      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="overflow-hidden rounded-xl shadow-sm print:rounded-none print:shadow-none">
          <ContratoDocumento
            venta={venta}
            pasajeros={pasajeros ?? []}
            hoteles={hoteles ?? []}
            vuelos={vuelos ?? []}
            items={items ?? []}
            totalPagado={totalPagado}
          />
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .contrato-doc, .contrato-doc * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            @page { size: A4; margin: 12mm; }
            @media print {
              html, body { background: #fff !important; }
              .contrato-doc { box-shadow: none !important; }
            }
          `,
        }}
      />
    </div>
  );
}
