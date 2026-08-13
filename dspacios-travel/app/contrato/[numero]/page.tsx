import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ContratoDocumento } from "@/components/contrato/ContratoDocumento";
import { PrintButton } from "@/components/contrato/PrintButton";
import { adjuntarNotaRegimen } from "@/lib/contrato/regimenNotas";
import { agenciaDe } from "@/lib/tenant.server";
import type { Tenant } from "@/lib/tenant";
import { tituloDocumento } from "@/lib/utils/tituloDocumento";

// El título usa el cliente SIEMPRE por el cliente con sesión (RLS), nunca por
// service-role: el número de contrato es secuencial y adivinable (00-0481), así
// que con service-role cualquiera podía sacar el nombre del cliente de un
// contrato ajeno leyendo el <title>, aunque el cuerpo de la página sí quedara
// bloqueado. Sin permiso de lectura, el título cae al genérico.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero: raw } = await params;
  const numero = decodeURIComponent(raw);
  const sb = await createClient();
  const { data } = await sb.from("ventas").select("cliente").eq("numero_contrato", numero).maybeSingle();
  return { title: { absolute: tituloDocumento("Contrato", numero, data?.cliente) } };
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
    { data: planes },
  ] = await Promise.all([
    sb.from("ventas").select("*").eq("numero_contrato", numero).single(),
    sb.from("contrato_pasajeros").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_hoteles").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_vuelos").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_items").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("abonos").select("valor_abono").eq("numero_contrato", numero),
    sb.from("planes_alimentacion").select("codigo, nombre, nota_especial"),
  ]);

  if (!venta) notFound();

  const agencia = await agenciaDe((venta.tenant as Tenant | null) ?? undefined);

  const totalPagado = (abonos ?? []).reduce(
    (s, a) => s + (a.valor_abono ?? 0),
    0
  );
  const hotelesConNota = adjuntarNotaRegimen(hoteles ?? [], planes ?? []);

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
            hoteles={hotelesConNota}
            vuelos={vuelos ?? []}
            items={items ?? []}
            totalPagado={totalPagado}
            agencia={agencia}
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
