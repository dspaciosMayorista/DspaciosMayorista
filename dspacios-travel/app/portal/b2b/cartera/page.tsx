import Link from "next/link";
import { PortalShell, Titulo, Aviso, SubPestanas, TablaScroll, Vacio } from "@/components/portal/PortalShell";
import { BotonTarifario } from "@/components/portal/BotonTarifario";
import { PortalGate } from "@/components/portal/PortalGate";
import { AvisoHistoricoIncompleto } from "@/components/portal/AvisoHistoricoIncompleto";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { numeroVisible } from "@/lib/tenant";
import { resolverContextoPortal, cargarConjuntoPortal, linkPagoPortal } from "@/lib/portal/b2bPortalServidor";
import { carteraDe, partirCartera } from "@/lib/portal/b2bPortal";

export const dynamic = "force-dynamic";

export default async function PortalCartera({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return <PortalGate ctx={ctx} />;
  const { vista } = await searchParams;
  const actual = vista === "pagos" ? "pagos" : "saldo";

  const [conjunto, linkPago] = await Promise.all([cargarConjuntoPortal(ctx, { abonos: true }), linkPagoPortal()]);
  const cartera = carteraDe(conjunto.ventas, conjunto.abonos);
  const { conSaldo, pagos } = partirCartera(cartera, conjunto.abonos);
  const porContrato = new Map(cartera.map((f) => [f.numero_contrato, f]));
  const abonosOrdenados = [...conjunto.abonos].sort((a, b) => String(b.fecha_abono ?? "").localeCompare(String(a.fecha_abono ?? "")) || b.id - a.id);

  return (
    <PortalShell nombre={ctx.nombre} rol={ctx.rol} cta={<BotonTarifario />} activa="cartera" mostrarAgentes={ctx.esTitularAgencia} linkPago={linkPago}>
      <Titulo apoyo={<>Valor, pagos y saldo de tus contratos, en la moneda de cobro de cada uno.</>}>Cartera</Titulo>
      <SubPestanas
        base="/portal/b2b/cartera" actual={actual} etiqueta="Vista de cartera"
        items={[{ id: "saldo", label: "Con saldo", cuenta: conSaldo.length }, { id: "pagos", label: "Pagos", cuenta: pagos.length }]}
      />
      {conjunto.historicoIncompleto && <AvisoHistoricoIncompleto />}
      {!conjunto.abonosCompletos && (
        <Aviso>
          No pudimos leer todos tus pagos, así que los saldos pueden estar incompletos. Intenta más tarde.
        </Aviso>
      )}

      {actual === "saldo" ? (
        conSaldo.length === 0 ? <Vacio>No tienes contratos con saldo pendiente.</Vacio> : (
          <TablaScroll etiqueta="Contratos con saldo" ancho="min-w-[860px]">
            <thead>
              <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                <th scope="col" className="px-3 py-2">Contrato</th><th scope="col" className="px-3 py-2">Cliente</th><th scope="col" className="px-3 py-2">Salida</th>
                <th scope="col" className="px-3 py-2 text-right">Valor</th><th scope="col" className="px-3 py-2 text-right">Abonos</th><th scope="col" className="px-3 py-2 text-right">Saldo</th>
                <th scope="col" className="px-3 py-2 text-right">Estado de cuenta</th>
              </tr>
            </thead>
            <tbody>
              {conSaldo.map((f) => (
                <tr key={f.numero_contrato} className="border-t border-gray-50">
                  <th scope="row" className="px-3 py-2 text-left font-mono font-semibold text-[#1D7C9A]">{numeroVisible(f.numero_contrato)}</th>
                  <td className="px-3 py-2 text-gray-700">{f.cliente ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(f.fecha_salida)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoneda(f.valor, f.moneda)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoneda(f.pagado, f.moneda)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: "#C0392B" }}>{formatMoneda(f.saldo, f.moneda)}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/estado-cuenta/${encodeURIComponent(f.numero_contrato)}`} target="_blank" className="text-xs font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>Ver</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </TablaScroll>
        )
      ) : abonosOrdenados.length === 0 ? (
        <Vacio>Aún no hay pagos registrados en tus contratos.</Vacio>
      ) : (
        <TablaScroll etiqueta="Historial de pagos" ancho="min-w-[760px]">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th scope="col" className="px-3 py-2">Fecha</th><th scope="col" className="px-3 py-2">Contrato</th><th scope="col" className="px-3 py-2">Forma de pago</th>
              <th scope="col" className="px-3 py-2 text-right">Valor</th><th scope="col" className="px-3 py-2 text-right">Saldo del contrato</th><th scope="col" className="px-3 py-2 text-right">Recibo</th>
            </tr>
          </thead>
          <tbody>
            {abonosOrdenados.map((a) => {
              const f = porContrato.get(a.numero_contrato);
              if (!f) return null;
              return (
                <tr key={a.id} className="border-t border-gray-50">
                  <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(a.fecha_abono)}</td>
                  <th scope="row" className="px-3 py-2 text-left font-mono font-semibold text-[#1D7C9A]">{numeroVisible(a.numero_contrato)}</th>
                  <td className="px-3 py-2 text-xs text-gray-600">{a.forma_pago ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoneda(Number(a.valor_abono ?? 0), f.moneda)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatMoneda(f.saldo, f.moneda)}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/recibo/${a.id}`} target="_blank" className="text-xs font-medium hover:underline" style={{ color: "var(--brand-primary)" }}>Recibo</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TablaScroll>
      )}
    </PortalShell>
  );
}
