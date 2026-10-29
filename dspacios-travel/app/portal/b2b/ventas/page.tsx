import Link from "next/link";
import { PortalShell, SubPestanas, TablaScroll, Vacio } from "@/components/portal/PortalShell";
import { PortalGate } from "@/components/portal/PortalGate";
import { AvisoHistoricoIncompleto } from "@/components/portal/AvisoHistoricoIncompleto";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { numeroVisible } from "@/lib/tenant";
import { resolverContextoPortal, cargarConjuntoPortal, linkPagoPortal, monedaOfertaDe } from "@/lib/portal/b2bPortalServidor";
import { origenVenta } from "@/lib/portal/b2bPortal";

export const dynamic = "force-dynamic";

const ESTADO_COMISION: Record<string, string> = {
  pendiente: "Pendiente", cuenta_cobro: "Cuenta de cobro", facturada: "Facturada", pagada: "Pagada",
  parcial: "Abono parcial", descontada: "Descontada",
};
const AGENCIA: Record<string, string> = { mayorista: "Mayorista", minorista: "Minorista" };

export default async function PortalVentas({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return <PortalGate ctx={ctx} />;
  const { vista } = await searchParams;
  const actual = vista === "asistidas" ? "asistidas" : "directas";

  const [conjunto, linkPago] = await Promise.all([cargarConjuntoPortal(ctx), linkPagoPortal()]);
  const directas = conjunto.ventas.filter((v) => origenVenta(v, ctx.userId) === "directa");
  const asistidas = conjunto.ventas.filter((v) => origenVenta(v, ctx.userId) === "asistida");
  const filas = actual === "directas" ? directas : asistidas;

  return (
    <PortalShell nombre={ctx.nombre} activa="ventas" mostrarAgentes={ctx.esTitularAgencia} linkPago={linkPago}>
      <h1 className="mb-1 text-lg font-semibold text-gray-900">Mis ventas</h1>
      <p className="mb-4 text-xs text-gray-500">
        Directas: contratos que generaste tú. Asistidas: contratos que armó D&apos;spacios para ti o que vienen de Minorista. Los saldos y pagos están en Cartera.
      </p>
      <SubPestanas
        base="/portal/b2b/ventas" actual={actual} etiqueta="Tipo de venta"
        items={[{ id: "directas", label: "Directas", cuenta: directas.length }, { id: "asistidas", label: "Asistidas", cuenta: asistidas.length }]}
      />
      {conjunto.historicoIncompleto && <AvisoHistoricoIncompleto />}
      {(conjunto.legacyNoVerificado || !conjunto.participacionCompleta) && (
        <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No pudimos verificar parte de tu histórico, así que por seguridad no se muestra ahora. Intenta más tarde o comunícate con tu asesor.
        </p>
      )}
      {filas.length === 0 ? (
        <Vacio>
          {actual === "directas"
            ? <>Aún no tienes ventas directas. Empieza en el <Link href="/tarifario" className="font-semibold" style={{ color: "var(--brand-primary)" }}>tarifario</Link>.</>
            : "Aún no tienes ventas asistidas."}
        </Vacio>
      ) : (
        <TablaScroll etiqueta="Ventas" ancho="min-w-[900px]">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th scope="col" className="px-3 py-2">Contrato</th><th scope="col" className="px-3 py-2">Agencia</th><th scope="col" className="px-3 py-2">Cliente</th>
              <th scope="col" className="px-3 py-2">Destino</th><th scope="col" className="px-3 py-2">Salida</th><th scope="col" className="px-3 py-2">Estado</th>
              <th scope="col" className="px-3 py-2">Compra</th><th scope="col" className="px-3 py-2 text-right">Comisión</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((v) => {
              const num = v.numero_contrato;
              const part = v.relacion === "participacion";
              const vis = conjunto.comisiones.get(num) ?? null;
              const com = vis?.importe ?? null;
              return (
                <tr key={num} className="border-t border-gray-50">
                  <th scope="row" className="px-3 py-2 text-left font-mono font-semibold text-[#1D7C9A]">{numeroVisible(num)}</th>
                  <td className="px-3 py-2 text-xs text-gray-600">{AGENCIA[v.tenant ?? "mayorista"] ?? v.tenant}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {part ? <span className="text-xs text-gray-400">Participación por comisión</span> : (v.cliente ?? "—")}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{v.destino ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(v.fecha_salida)}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{v.estado ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">{part ? "—" : v.modo_compra === "comisionable" ? "Comisionable" : v.modo_compra === "neta" ? "Neta" : "—"}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {com != null && com > 0 ? formatMoneda(com, monedaOfertaDe(conjunto.crudas.get(num))) : "—"}
                    {vis?.estado ? <span className="block text-[10px] text-gray-400">{ESTADO_COMISION[vis.estado] ?? vis.estado}</span> : null}
                    {/* Cuenta de cobro solo en contratos propios: su resolvedor decide el beneficiario por la comisión más reciente, no por la tuya. */}
                    {!part && vis?.cobrable && vis.tipo === "freelance" && (
                      <Link href={`/portal/comision/${encodeURIComponent(num)}`} className="block text-[10px] font-medium" style={{ color: "var(--brand-accent)" }}>Cuenta de cobro</Link>
                    )}
                    {!part && vis?.cobrable && vis.tipo === "agencia" && <span className="block text-[10px] text-gray-400">Factura electrónica</span>}
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
