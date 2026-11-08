import Link from "next/link";
import { PortalShell, Titulo, Aviso, SubPestanas, TablaScroll, Vacio } from "@/components/portal/PortalShell";
import { BotonTarifario } from "@/components/portal/BotonTarifario";
import { PortalGate } from "@/components/portal/PortalGate";
import { AvisoHistoricoIncompleto } from "@/components/portal/AvisoHistoricoIncompleto";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { numeroVisible } from "@/lib/tenant";
import { resolverContextoPortal, cargarConjuntoPortal, linkPagoPortal, monedaOfertaDe } from "@/lib/portal/b2bPortalServidor";
import { origenVenta, salidasProximasRango } from "@/lib/portal/b2bPortal";
import { hoyBogota } from "@/lib/cotizacion/vigencia";
import { createAdminClient } from "@/lib/supabase/admin";
import { cargarVuelosPortal } from "@/lib/portal/vuelosPortalServidor";
import { FilaVuelosContrato } from "@/components/portal/VuelosContrato";

export const dynamic = "force-dynamic";

const ESTADO_COMISION: Record<string, string> = {
  pendiente: "Pendiente", cuenta_cobro: "Cuenta de cobro", facturada: "Facturada", pagada: "Pagada",
  parcial: "Abono parcial", descontada: "Descontada", en_revision: "En revisión contable",
};
const AGENCIA: Record<string, string> = { mayorista: "Mayorista", minorista: "Minorista" };

export default async function PortalVentas({ searchParams }: { searchParams: Promise<{ vista?: string; salidas?: string }> }) {
  const ctx = await resolverContextoPortal();
  if (ctx.estado !== "ok") return <PortalGate ctx={ctx} />;
  const { vista, salidas } = await searchParams;
  const soloProximas = salidas === "proximas";
  // #99: desde el contador se abre en «Todas» (directas + asistidas); Directas/Asistidas siguen filtrando.
  const actual = vista === "asistidas" ? "asistidas" : vista === "directas" ? "directas" : soloProximas ? "todas" : "directas";

  const [conjunto, linkPago] = await Promise.all([cargarConjuntoPortal(ctx), linkPagoPortal()]);
  // #99: el mismo filtro que el contador del inicio; ordena por salida ascendente y excluye anulados y participación.
  const base = soloProximas ? salidasProximasRango(conjunto.ventas, hoyBogota()) : conjunto.ventas;
  const directas = base.filter((v) => origenVenta(v, ctx.userId) === "directa");
  const asistidas = base.filter((v) => origenVenta(v, ctx.userId) === "asistida");
  const filas = actual === "todas" ? base.filter((v) => directas.includes(v) || asistidas.includes(v)) : actual === "directas" ? directas : asistidas;

  // #85: vuelos solo de contratos propios de las filas mostradas (la autorización ya la resolvió cargarConjuntoPortal).
  const vuelos = await cargarVuelosPortal(createAdminClient(), filas);

  return (
    <PortalShell nombre={ctx.nombre} rol={ctx.rol} cta={<BotonTarifario />} activa="ventas" mostrarAgentes={ctx.esTitularAgencia} linkPago={linkPago}>
      <Titulo apoyo={<>
        Directas: contratos que generaste tú. Asistidas: contratos que armó D&apos;spacios para ti o que vienen de Minorista. Los saldos y pagos están en Cartera.
      </>}>Mis ventas</Titulo>
      <SubPestanas
        base="/portal/b2b/ventas" actual={actual} etiqueta="Tipo de venta" consulta={soloProximas ? "salidas=proximas" : undefined}
        items={[...(soloProximas ? [{ id: "todas", label: "Todas", cuenta: directas.length + asistidas.length }] : []), { id: "directas", label: "Directas", cuenta: directas.length }, { id: "asistidas", label: "Asistidas", cuenta: asistidas.length }]}
      />
      {soloProximas && (
        <Aviso>
          Salidas de hoy a los próximos 30 días ({directas.length + asistidas.length}), de la más cercana a la más lejana.{" "}
          <Link href="/portal/b2b/ventas" className="font-semibold underline">Ver todas</Link>
        </Aviso>
      )}
      {conjunto.historicoIncompleto && <AvisoHistoricoIncompleto />}
      {(conjunto.legacyNoVerificado || !conjunto.participacionCompleta) && (
        <Aviso>
          No pudimos verificar parte de tu histórico, así que por seguridad no se muestra ahora. Intenta más tarde o comunícate con tu asesor.
        </Aviso>
      )}
      {filas.length === 0 ? (
        <Vacio>
          {soloProximas ? "No hay salidas en los próximos 30 días en esta pestaña." : actual === "directas"
            ? <>Aún no tienes ventas directas. Empieza en el <Link href="/tarifario" className="font-semibold" style={{ color: "var(--brand-primary)" }}>tarifario</Link>.</>
            : "Aún no tienes ventas asistidas."}
        </Vacio>
      ) : (
        <TablaScroll etiqueta="Ventas" ancho="min-w-[900px]" apilar>
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
              <th scope="col" className="px-3 py-2">Contrato</th><th scope="col" className="px-3 py-2">Agencia</th><th scope="col" className="px-3 py-2">Cliente</th>
              <th scope="col" className="px-3 py-2">Destino</th><th scope="col" className="px-3 py-2">Salida</th><th scope="col" className="px-3 py-2">Estado</th>
              <th scope="col" className="px-3 py-2">Compra</th><th scope="col" className="px-3 py-2 text-right">Comisión</th>
            </tr>
          </thead>
          <tbody>
            {filas.flatMap((v) => {
              const num = v.numero_contrato;
              const part = v.relacion === "participacion";
              const vis = conjunto.comisiones.get(num) ?? null;
              const com = vis?.importe ?? null;
              // La fila principal conserva su `key` (número de contrato); la de vuelos es hermana, no envoltorio.
              return [(
                <tr key={num} className="border-t border-gray-50">
                  <th scope="row" className="px-3 py-2 text-left font-mono font-semibold text-[#1D7C9A]">{numeroVisible(num)}</th>
                  <td data-label="Agencia" className="px-3 py-2 text-xs text-gray-600">{AGENCIA[v.tenant ?? "mayorista"] ?? v.tenant}</td>
                  <td data-label="Cliente" className="px-3 py-2 text-gray-700">
                    {part ? <span className="text-xs text-gray-400">Participación por comisión</span> : (v.cliente ?? "—")}
                  </td>
                  <td data-label="Destino" className="px-3 py-2 text-gray-600">{v.destino ?? "—"}</td>
                  <td data-label="Salida" className="px-3 py-2 text-xs text-gray-500">{formatFechaLarga(v.fecha_salida)}</td>
                  <td data-label="Estado" className="px-3 py-2 text-xs text-gray-600">{v.estado ?? "—"}</td>
                  <td data-label="Compra" className="px-3 py-2 text-xs text-gray-500">{part ? "—" : v.modo_compra === "comisionable" ? "Comisionable" : v.modo_compra === "neta" ? "Neta" : "—"}</td>
                  <td data-label="Comisión" className="px-3 py-2 text-right text-xs tabular-nums">
                    {com != null && com > 0 ? formatMoneda(com, monedaOfertaDe(conjunto.crudas.get(num))) : "—"}
                    {vis?.estado ? <span className="block text-[10px] text-gray-400">{ESTADO_COMISION[vis.estado] ?? vis.estado}</span> : null}
                    {/*
                      Cuenta de cobro y estado de cuenta en CUALQUIER fila cobrable, propia o de
                      participación: `resolverComisionB2B` ya resuelve el acceso por la ficha de
                      quien mira (no por la comisión más reciente del contrato), y `filasCobrables`
                      aísla el importe a SU fila — nunca la del otro aliado del mismo contrato.
                    */}
                    {vis?.cobrable && vis.tipo === "freelance" && (
                      <span className="mt-0.5 flex flex-col items-end gap-0.5">
                        <Link href={`/portal/comision/${encodeURIComponent(num)}`} className="block text-[10px] font-medium" style={{ color: "var(--brand-accent)" }}>Cuenta de cobro</Link>
                        <Link href={`/portal/comision/${encodeURIComponent(num)}/estado-cuenta`} className="block text-[10px] font-medium" style={{ color: "var(--brand-accent)" }}>Estado de cuenta</Link>
                      </span>
                    )}
                    {vis?.cobrable && vis.tipo === "agencia" && <span className="block text-[10px] text-gray-400">Factura electrónica</span>}
                  </td>
                </tr>
              ), ...(part ? [] : [<FilaVuelosContrato key={`${num}-vuelos`} datos={vuelos.porContrato.get(num)} />])];
            })}
          </tbody>
        </TablaScroll>
      )}
    </PortalShell>
  );
}
