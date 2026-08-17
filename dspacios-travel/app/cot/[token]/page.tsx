import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { ContratoDocumento } from "@/components/contrato/ContratoDocumento";
import { PrintButton } from "@/components/contrato/PrintButton";
import type {
  Venta,
  ContratoPasajero,
  ContratoHotel,
  ContratoVuelo,
  ContratoItem,
} from "@/types/database";
import { tituloDocumento } from "@/lib/utils/tituloDocumento";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sb = createAdminClient();
  const { data } = await sb.from("cotizaciones").select("codigo, detalle").eq("share_token", token).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data?.detalle as any;
  const cliente = d?.venta?.cliente ?? d?.venta?.titular ?? null;
  return { title: { absolute: data ? tituloDocumento("Cotización", data.codigo, cliente) : "Cotización" } };
}

type Detalle = {
  venta: Venta;
  pasajeros: ContratoPasajero[];
  hoteles: ContratoHotel[];
  vuelos: ContratoVuelo[];
  items: ContratoItem[];
};

// Vista pública (sin login) de una cotización, por token imposible de adivinar.
// El cliente del tarifario la guarda/imprime y la muestra en la oficina.
//
// `createAdminClient()` es correcto aquí: no hay sesión (RLS no tiene con qué
// evaluar), así que el service-role es indispensable. La validación de acceso
// explícita que lo justifica es el propio `.eq("share_token", token)` — un
// UUID impredecible y de un solo uso por cotización (migración 058) — nunca
// se filtra por `id` ni se expone un listado: cada token solo abre SU
// cotización exacta.
export default async function CotizacionPublicaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sb = createAdminClient();

  const { data: cot } = await sb
    .from("cotizaciones")
    .select("codigo, detalle, vigencia_hasta")
    .eq("share_token", token)
    .maybeSingle();

  if (!cot || !cot.detalle) notFound();
  const d = cot.detalle as unknown as Detalle;

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-end px-4 print:hidden">
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
