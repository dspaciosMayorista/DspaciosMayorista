import { notFound } from "next/navigation";
import { accesoVoucherPorToken } from "@/lib/voucher/accesoVoucher.server";
import { esVoucherVigente } from "@/lib/voucher/accesoVoucher";
import { PrintButton } from "@/components/contrato/PrintButton";
import { VoucherDocumento } from "@/components/voucher/VoucherDocumento";
import { VoucherVueloDocumento } from "@/components/voucher/VoucherVueloDocumento";
import { esVoucherVuelo } from "@/lib/voucher/vuelo";
import { vueloVisible } from "@/lib/voucher/pnrVoucher";
import { contratoPagadoCompleto } from "@/lib/voucher/pagoCompleto";
import { contarServiciosAereos } from "@/lib/voucher/serviciosAereos";
import type { VoucherContenido } from "@/app/(dashboard)/dashboard/contratos/[numero]/voucher-actions";
import { tituloDocumento } from "@/lib/utils/tituloDocumento";

export const dynamic = "force-dynamic";

const ETIQUETA_TIPO_VOUCHER: Record<string, string> = {
  hotel: "Voucher Hotel",
  traslado: "Voucher Traslados",
  asistencia: "Voucher Asistencia",
  vuelo: "Voucher Vuelo",
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

// 338 (ADL-042): un voucher aéreo cuyos tramos cambiaron («revisar») o cuyo servicio ya no existe («retirado») NUNCA se entrega como vigente: sin itinerario, con el motivo.
function VoucherNoVigente({ retirado, interno }: { retirado: boolean; interno: boolean }) {
  return (
    <div className="min-h-screen bg-gray-100 py-10">
      <div className="mx-auto max-w-xl rounded-xl bg-white p-6 shadow-sm" data-testid="voucher-no-vigente" data-estado={retirado ? "retirado" : "revisar"}>
        <h1 className="text-lg font-semibold text-gray-800">{retirado ? "Voucher retirado" : "Voucher en actualización"}</h1>
        <p className="mt-2 text-sm text-gray-600">
          {retirado
            ? "El servicio aéreo de este voucher ya no figura en el contrato, así que este documento no es válido."
            : "Los vuelos de este servicio cambiaron después de generar este voucher. El documento vigente se publicará en este mismo enlace cuando se actualice."}
        </p>
        <p className="mt-2 text-sm text-gray-600">{interno ? "Genera de nuevo los vouchers de vuelo desde el contrato (el enlace se conserva si el servicio sigue existiendo)." : "Comunícate con tu asesor."}</p>
      </div>
    </div>
  );
}

// Vista del voucher por token (requiere sesión; ver acceso arriba) para imprimir/guardar.
export default async function VoucherPublicoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await accesoVoucherPorToken(token);
  if (!r.ok) { if (r.motivo === "no_vigente") return <VoucherNoVigente retirado={r.estado === "retirado"} interno={false} />; notFound(); }
  const estadoVoucher = r.voucher.estado ?? "vigente";
  if (estadoVoucher === "retirado") return <VoucherNoVigente retirado interno={r.modo === "interno"} />;
  const cRaw = r.voucher.contenido as unknown;
  const tenant = r.tenant === "minorista" ? "minorista" : "mayorista";
  // ADL-041: el PNR guardado solo se muestra con el contrato 100 % pagado (ver lib/voucher/pnrVoucher.ts: el aliado ya pasó esa comprobación; la vista interna hace una consulta y solo si hay PNR).
  const vuelo = esVoucherVuelo(cRaw) ? await vueloVisible(cRaw, r.modo, r.voucher.numero_contrato, contratoPagadoCompleto) : null;
  // Rev2 B1-05: solo para el voucher aéreo, UNA lectura acotada del número de servicios aéreos vigentes (el voucher dice que no hay pasajero↔tramo cuando hay más de uno).
  const serviciosAereos = vuelo ? await contarServiciosAereos(r.voucher.numero_contrato) : null;

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      {!esVoucherVigente(r.voucher) && (
        <div className="mx-auto mb-3 max-w-3xl rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700" data-testid="voucher-desactualizado">
          Desactualizado: los vuelos del servicio cambiaron después de generar este voucher. No lo entregues; vuelve a generarlo desde el contrato.
        </div>
      )}
      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="overflow-hidden rounded-xl bg-white shadow-sm print:rounded-none print:shadow-none">
          {vuelo ? <VoucherVueloDocumento c={vuelo.contenido} tenant={tenant} pnrPendientePago={vuelo.pnrPendientePago} serviciosAereos={serviciosAereos} /> : <VoucherDocumento c={cRaw as VoucherContenido} tenant={tenant} />}
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
