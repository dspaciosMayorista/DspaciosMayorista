import Link from "next/link";
import { PortalShell, Titulo, Aviso, TablaScroll, Vacio } from "@/components/portal/PortalShell";
import { BotonTarifario } from "@/components/portal/BotonTarifario";
import { PortalGate } from "@/components/portal/PortalGate";
import { AvisoHistoricoIncompleto } from "@/components/portal/AvisoHistoricoIncompleto";
import { numeroVisible } from "@/lib/tenant";
import { resolverContextoPortal, cargarConjuntoPortal, linkPagoPortal } from "@/lib/portal/b2bPortalServidor";
import { documentosDe } from "@/lib/portal/b2bPortal";

export const dynamic = "force-dynamic";

const NO = <span className="text-xs text-gray-400">No disponible</span>;
const ENLACE = "text-xs font-medium hover:underline";
const COLOR = { color: "var(--brand-primary)" };

export default async function PortalDocumentos() {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return <PortalGate ctx={ctx} />;

  const [conjunto, linkPago] = await Promise.all([cargarConjuntoPortal(ctx, { abonos: true, vouchers: true }), linkPagoPortal()]);
  // Solo contratos PROPIOS: participar por comisión no da acceso a los documentos del contrato.
  const filas = documentosDe(conjunto.ventas, conjunto.vouchers, conjunto.abonos);
  const incompleto = !conjunto.abonosCompletos || !conjunto.vouchersCompletos;

  return (
    <PortalShell nombre={ctx.nombre} rol={ctx.rol} cta={<BotonTarifario />} activa="documentos" mostrarAgentes={ctx.esTitularAgencia} linkPago={linkPago}>
      <Titulo apoyo={<>Solo se enlazan los documentos que existen. Los contratos en los que solo participas por comisión no incluyen documentos.</>}>Documentos</Titulo>
      {conjunto.historicoIncompleto && <AvisoHistoricoIncompleto />}
      {incompleto && (
        <Aviso>
          No pudimos leer todos los documentos; algunos pueden figurar como no disponibles. Intenta más tarde.
        </Aviso>
      )}
      {filas.length === 0 ? (
        <Vacio>Aún no tienes contratos con documentos.</Vacio>
      ) : (
        <TablaScroll etiqueta="Documentos por contrato" ancho="min-w-[820px]">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th scope="col" className="px-3 py-2">Contrato</th><th scope="col" className="px-3 py-2">Contrato (PDF)</th><th scope="col" className="px-3 py-2">Voucher</th>
              <th scope="col" className="px-3 py-2">Estado de cuenta</th><th scope="col" className="px-3 py-2">Recibos de caja</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((d) => (
              <tr key={d.numero_contrato} className="border-t border-gray-50 align-top">
                <th scope="row" className="px-3 py-2 text-left font-mono font-semibold text-[#1D7C9A]">{numeroVisible(d.numero_contrato)}</th>
                <td className="px-3 py-2">
                  {d.contratoToken ? <Link href={`/c/${d.contratoToken}`} target="_blank" className={ENLACE} style={COLOR}>Contrato</Link> : NO}
                </td>
                <td className="px-3 py-2">
                  {d.vouchers.length === 0 ? NO : (
                    <ul className="space-y-0.5">
                      {d.vouchers.map((v, i) => (
                        <li key={v.token}><Link href={`/voucher/${v.token}`} target="_blank" className={ENLACE} style={COLOR}>{v.tipo ? `Voucher ${v.tipo}` : `Voucher ${i + 1}`}</Link></li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Link href={`/estado-cuenta/${encodeURIComponent(d.numero_contrato)}`} target="_blank" className={ENLACE} style={COLOR}>Estado de cuenta</Link>
                </td>
                <td className="px-3 py-2">
                  {d.recibos.length === 0 ? NO : (
                    <ul className="space-y-0.5">
                      {d.recibos.map((r) => (
                        <li key={r.id}><Link href={`/recibo/${r.id}`} target="_blank" className={ENLACE} style={COLOR}>Recibo RC-{String(r.id).padStart(6, "0")}</Link></li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TablaScroll>
      )}
    </PortalShell>
  );
}
