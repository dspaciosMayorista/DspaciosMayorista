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
import type { ComposicionBernaloDocumento, HabitacionBernaloDocumento } from "@/lib/reservar/alojamientoBernaloDocumento";
import { condicionesTarifaParaRender } from "@/lib/calc/condicionesTarifa";
import { tituloDocumento } from "@/lib/utils/tituloDocumento";
import { paginaPublicaComparativa } from "@/lib/cotizacion/comparativaDocumento";
import { netoTotalExigibleDeDetalle } from "@/lib/cotizacion/asistidaB2B";
import { cargarAgenciaDeCotizacion } from "@/lib/cotizacion/agenciaCotizacion";

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
  // Snapshot Bernalo de la cotización (ver `crearCotizacionCarrito`) — mismo
  // shape que usa la ruta autenticada `app/cotizacion/[id]/page.tsx`. Ausente
  // en cotizaciones sin hoteles Bernalo.
  habitacionesBernalo?: HabitacionBernaloDocumento[];
  composicionBernalo?: ComposicionBernaloDocumento[];
  // #102: solo en una venta B2B asistida en NETO (ver `crearCotizacionCarrito`).
  b2bExterno?: { netoTotalExigible?: number };
  // #75: Incluye / No incluye congelado en el snapshot (p. ej. la opción elegida de una comparativa).
  incluye?: string | null;
  noIncluye?: string | null;
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
  // #35: una comparativa (enlace de SOLO lectura) se resuelve en su propio componente, también únicamente por
  // share_token. Para continuar con una opción hay que pasar por el checkout o enviar una solicitud: el token nunca escribe.
  const comparativa = await paginaPublicaComparativa(token);
  if (comparativa) return comparativa;

  const sb = createAdminClient();

  const { data: cot } = await sb
    .from("cotizaciones")
    .select("codigo, detalle, vigencia_hasta, tenant")
    .eq("share_token", token)
    .maybeSingle();

  if (!cot || !cot.detalle) notFound();
  const d = cot.detalle as unknown as Detalle;
  // #102: venta B2B asistida en NETO ⇒ el enlace público muestra solo el total exigible (nunca el PVP original ni la comisión). Sale de
  // `detalle.b2bExterno`, el único dato externo-seguro del plan; esta página no lee `payload` (datos personales y términos internos).
  const netoTotalExigible = netoTotalExigibleDeDetalle(d.b2bExterno);
  // RNT, NIT y cuenta de pago de la agencia dueña de la cotización (el tenant sale de la fila hallada por el token, no de la URL).
  const agenciaRes = await cargarAgenciaDeCotizacion(sb, cot.tenant);
  // Falla explícita (no se imprime el RNT de otra agencia): error técnico, fila ausente o sin RNT en Minorista.
  if (!agenciaRes.ok) throw new Error(agenciaRes.mensaje);
  const agencia = agenciaRes.agencia;

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
            hoteles={(d.hoteles ?? []).map((h) => ({ ...h, condiciones_tarifa: condicionesTarifaParaRender(h.condiciones_tarifa) }))}
            vuelos={d.vuelos ?? []}
            items={d.items ?? []}
            habitacionesBernalo={d.habitacionesBernalo ?? []}
            composicionBernalo={d.composicionBernalo ?? []}
            totalPagado={0}
            esCotizacion
            codigo={cot.codigo}
            vigenciaHasta={cot.vigencia_hasta}
            netoTotalExigible={netoTotalExigible}
            agencia={agencia}
            incluye={d.incluye ?? null}
            noIncluye={d.noIncluye ?? null}
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
