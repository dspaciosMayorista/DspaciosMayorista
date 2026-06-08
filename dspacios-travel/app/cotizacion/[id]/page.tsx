import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ContratoDocumento } from "@/components/contrato/ContratoDocumento";
import { PrintButton } from "@/components/contrato/PrintButton";
import type {
  Venta,
  ContratoPasajero,
  ContratoHotel,
  ContratoVuelo,
  ContratoItem,
} from "@/types/database";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Cotización ${id} — D'spacios Travel` };
}

type Detalle = {
  venta: Venta;
  pasajeros: ContratoPasajero[];
  hoteles: ContratoHotel[];
  vuelos: ContratoVuelo[];
  items: ContratoItem[];
};

export default async function CotizacionImprimiblePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createClient();

  const { data: cot } = await sb
    .from("cotizaciones")
    .select("codigo, detalle, vigencia_hasta")
    .eq("id", Number(id))
    .maybeSingle();

  if (!cot || !cot.detalle) notFound();
  const d = cot.detalle as unknown as Detalle;

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      {/* Barra (no se imprime) */}
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link
          href={`/dashboard/cotizaciones/${id}`}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          ← Volver a la cotización
        </Link>
        <PrintButton />
      </div>

      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="overflow-hidden rounded-xl shadow-sm print:rounded-none print:shadow-none">
          <ContratoDocumento
            venta={d.venta}
            pasajeros={d.pasajeros ?? []}
            hoteles={d.hoteles ?? []}
            vuelos={d.vuelos ?? []}
            items={d.items ?? []}
            totalPagado={0}
            esCotizacion
            codigo={cot.codigo}
            vigenciaHasta={cot.vigencia_hasta}
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
