import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ContratoDocumento } from "@/components/contrato/ContratoDocumento";
import { PrintButton } from "@/components/contrato/PrintButton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero } = await params;
  return { title: `Contrato ${decodeURIComponent(numero)} — D'spacios Travel` };
}

export default async function ContratoImprimiblePage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero: raw } = await params;
  const numero = decodeURIComponent(raw);
  const sb = await createClient();

  const [
    { data: venta },
    { data: pasajeros },
    { data: hoteles },
    { data: vuelos },
    { data: items },
    { data: abonos },
  ] = await Promise.all([
    sb.from("ventas").select("*").eq("numero_contrato", numero).single(),
    sb.from("contrato_pasajeros").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_hoteles").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_vuelos").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_items").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("abonos").select("valor_abono").eq("numero_contrato", numero),
  ]);

  if (!venta) notFound();

  const totalPagado = (abonos ?? []).reduce(
    (s, a) => s + (a.valor_abono ?? 0),
    0
  );

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      {/* Barra (no se imprime) */}
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link
          href={`/dashboard/contratos/${encodeURIComponent(numero)}`}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          ← Volver al contrato
        </Link>
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
            /* Forzar impresión de colores de fondo (azul, grises) en el PDF */
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
