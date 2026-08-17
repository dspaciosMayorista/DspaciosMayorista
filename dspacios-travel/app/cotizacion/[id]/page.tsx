import { createClient } from "@/lib/supabase/server";
import { contextoCotizacion, autorizaTenant } from "@/lib/cotizacion/acceso";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ContratoDocumento } from "@/components/contrato/ContratoDocumento";
import { CotizacionManualDocumento } from "@/components/contrato/CotizacionManualDocumento";
import { PrintButton } from "@/components/contrato/PrintButton";
import type {
  Venta,
  ContratoPasajero,
  ContratoHotel,
  ContratoVuelo,
  ContratoItem,
} from "@/types/database";
import { tituloDocumento } from "@/lib/utils/tituloDocumento";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createClient();
  const { data: cot } = await sb.from("cotizaciones").select("codigo, detalle, payload, tenant").eq("id", Number(id)).maybeSingle();

  // ⚠️ generateMetadata NUNCA debe filtrar título/código/cliente de una
  // cotización a la que el visitante no tiene acceso: el <title> se renderiza
  // aparte del cuerpo de la página, así que un chequeo solo en el componente
  // no alcanza a protegerlo. Se repite aquí el mismo chequeo de tenant.
  const ctx = await contextoCotizacion();
  if (!cot || !autorizaTenant(ctx, cot.tenant)) {
    return { title: { absolute: "Cotización" } };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = cot?.detalle as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = cot?.payload as any;
  const cliente = d?.venta?.cliente ?? d?.venta?.titular ?? payload?.cliente?.nombre ?? null;
  return { title: { absolute: tituloDocumento("Cotización", cot?.codigo ?? id, cliente) } };
}

type Detalle = {
  venta: Venta;
  pasajeros: ContratoPasajero[];
  hoteles: ContratoHotel[];
  vuelos: ContratoVuelo[];
  items: ContratoItem[];
};

const PRINT_STYLES = `
  .contrato-doc, .contrato-doc * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  @page { size: A4; margin: 12mm; }
  @media print {
    html, body { background: #fff !important; }
    .contrato-doc { box-shadow: none !important; }
  }
`;

export default async function CotizacionImprimiblePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = await createClient();

  const { data: cot } = await sb
    .from("cotizaciones")
    .select("codigo, detalle, vigencia_hasta, tipo, payload, created_at, tenant")
    .eq("id", Number(id))
    .maybeSingle();

  if (!cot || !cot.detalle) notFound();

  // Cierra la vía enumerable entre agencias (V2): ya no basta con conocer el
  // id — hace falta acceso al tenant de la cotización. Misma respuesta (404)
  // sin importar si el id no existe o si pertenece a la otra agencia. El
  // acceso público de verdad sigue siendo /cot/[token] (share_token
  // impredecible), que no pasa por aquí.
  const ctx = await contextoCotizacion();
  if (!autorizaTenant(ctx, cot.tenant)) notFound();

  const volverLink = (
    <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
      <Link href={`/dashboard/cotizaciones/${id}`} className="text-sm text-gray-500 hover:text-gray-800">
        ← Volver a la cotización
      </Link>
      <PrintButton />
    </div>
  );

  // ── Cotización MANUAL: usa su propio componente ───────────────────────────
  if (cot.tipo === "manual") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = cot.detalle as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = (cot.payload ?? {}) as any;
    const ventaSnap = (d?.venta ?? {}) as Record<string, unknown>;
    const items: { descripcion: string; cantidad?: number; tarifa_unit?: number; valor: number }[] = (d?.items ?? []).map(
      (it: Record<string, unknown>) => ({
        descripcion: String(it.descripcion ?? ""),
        cantidad: it.cantidad != null ? Number(it.cantidad) : undefined,
        tarifa_unit: it.tarifa_unit != null ? Number(it.tarifa_unit) : undefined,
        // Compat: cotizaciones viejas guardaban el valor en tarifa_adulto.
        valor: Number(it.valor ?? it.tarifa_adulto ?? 0),
      })
    );

    return (
      <div className="min-h-screen bg-gray-100 py-6">
        {volverLink}
        <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
          <div className="overflow-hidden rounded-xl shadow-sm print:rounded-none print:shadow-none">
            <CotizacionManualDocumento
              codigo={cot.codigo ?? ""}
              venta={ventaSnap as Parameters<typeof CotizacionManualDocumento>[0]["venta"]}
              items={items}
              cliente={payload?.cliente ?? {}}
              incluye={d?.incluye ?? null}
              noIncluye={d?.noIncluye ?? null}
              vigenciaHasta={cot.vigencia_hasta}
              fechaEmision={cot.created_at ? String(cot.created_at).slice(0, 10) : null}
            />
          </div>
        </div>
        <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      </div>
    );
  }

  // ── Cotización del TARIFARIO: flujo original ──────────────────────────────
  const d = cot.detalle as unknown as Detalle;

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      {volverLink}
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
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
    </div>
  );
}
